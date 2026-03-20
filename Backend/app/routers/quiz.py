import uuid
import re
import json
from fastapi import APIRouter, HTTPException, Query

from app.models import (
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizPreclassifyRequest,
    QuizQuestion,
    QuizSubmitRequest,
    QuizSubmitResponse,
    QuizResult,
    QuizHistoryResponse,
    QuizHistoryItem,
)
from app.services.gemini_service import embed_query, generate_quiz_questions, batch_classify_weak_areas
from app.services.search_service import (
    retrieve_chunks,
    retrieve_chunks_hybrid,
    conversation_has_documents,
)
from app.services.cosmos_service import save_quiz, get_quiz, submit_quiz, list_quizzes, ensure_conversation, save_message, update_message_json, patch_weak_area_labels

router = APIRouter(prefix="/quiz", tags=["Quiz"])


# ── POST /quiz/generate ───────────────────────────────────────────────────────

@router.post("/generate", response_model=QuizGenerateResponse)
async def quiz_generate(request: QuizGenerateRequest):
    """
    Generates a quiz using a 3-step decision algorithm:

    Step 1 — Does this conversation have any uploaded documents?
               NO  → skip search entirely → general knowledge mode
               YES → continue to Step 2

    Step 2 — Is a specific topic given?
               YES → hybrid search (BM25 + vector via RRF)
                       chunks found → document-based quiz
                       no chunks   → topic unrelated to doc → general knowledge
               NO  → pure vector search at 0.5 → broad doc coverage

    Step 3 — Generate questions via Gemini, save to Cosmos, return to frontend
    """

    # ── Step 1: Hard gate — does this conversation have any documents? ─────────
    try:
        has_docs = conversation_has_documents(
            user_id=request.user_id,
            conversation_id=request.conversation_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document check failed: {str(e)}")

    # ── Step 2: Retrieve relevant chunks based on context ─────────────────────
    try:
        if not has_docs:
            # No documents in this chat → go straight to general knowledge
            context_chunks = []
            print(f"[Quiz] No docs in conversation {request.conversation_id} → general knowledge mode")

        elif request.topic:
            # Documents exist + specific topic → hybrid search (BM25 + vector)
            # This correctly handles:
            #   "skills" in resume   → BM25 finds keyword + vector finds meaning → passes ✅
            #   "basketball" missing → BM25 finds nothing → RRF too low → fails → general ✅
            query_embedding = embed_query(request.topic)
            context_chunks = retrieve_chunks_hybrid(
                topic=request.topic,
                query_embedding=query_embedding,
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                top_k=10,
                rrf_threshold=0.020,
            )
            print(f"[Quiz] Hybrid search for '{request.topic}' → {len(context_chunks)} chunks found")

        else:
            # Documents exist + no topic → broad vector search across all doc content
            query_embedding = embed_query("key concepts and important topics")
            context_chunks = retrieve_chunks(
                query_embedding=query_embedding,
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                top_k=10,
                score_threshold=0.5,
            )
            print(f"[Quiz] Broad vector search → {len(context_chunks)} chunks found")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG retrieval failed: {str(e)}")

    # ── Step 3: Generate questions + fun fact via Gemini (single call) ────────
    try:
        result = generate_quiz_questions(
            context_chunks=context_chunks,
            topic=request.topic or "",
            num_questions=request.num_questions,
        )
        raw_questions = result["questions"]
        fun_fact = result["fun_fact"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {str(e)}")

    # ── Step 4: Save full quiz to Cosmos DB (with correct_index) ──────────────
    quiz_id = str(uuid.uuid4())
    topic_label = request.topic if request.topic else "General Quiz"

    # Clean trailing conjunctions/prepositions left by frontend topic extraction
    topic_label_clean = re.sub(
        r'\b(and|or|the|a|an|for|of|in|on|with|about)\s*$',
        '', topic_label, flags=re.IGNORECASE
    ).strip() or topic_label

    # Ensure a conversation document exists so this chat appears in the sidebar
    if request.conversation_id:
        try:
            await ensure_conversation(
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                title=f"Quiz: {topic_label_clean}",
            )
            # Save the user's quiz request as a message so the chat isn't empty
            await save_message(
                conversation_id=request.conversation_id,
                user_id=request.user_id,
                role="user",
                content=f"Generate Quiz on: {topic_label_clean}",
            )
            # Save assistant message with quiz data embedded as JSON so that
            # when the user reopens this conversation from the sidebar, the
            # full interactive quiz card is reconstructed from history.
            quiz_payload = json.dumps({
                "__type": "quiz",
                "quiz_id": quiz_id,
                "topic": topic_label,
                "submitted": False,
                "questions": [
                    {"id": q["id"], "question": q["question"], "options": q["options"]}
                    for q in raw_questions
                ],
            })
            await save_message(
                conversation_id=request.conversation_id,
                user_id=request.user_id,
                role="assistant",
                content=quiz_payload,
            )
        except Exception:
            pass  # Non-critical — don't fail quiz generation over this

    try:
        await save_quiz(
            user_id=request.user_id,
            quiz_id=quiz_id,
            topic=topic_label,
            questions=raw_questions,
            conversation_id=request.conversation_id or "",
            fun_fact=fun_fact,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save quiz: {str(e)}")

    # ── Step 5: Return questions WITHOUT correct_index to frontend ─────────────
    questions_for_frontend = [
        QuizQuestion(
            id=q["id"],
            question=q["question"],
            options=q["options"],
        )
        for q in raw_questions
    ]

    return QuizGenerateResponse(
        quiz_id=quiz_id,
        topic=topic_label,
        questions=questions_for_frontend,
        fun_fact=fun_fact,
    )


# ── POST /quiz/preclassify ────────────────────────────────────────────────────

@router.post("/preclassify")
async def quiz_preclassify(request: QuizPreclassifyRequest):
    """
    Fired silently by the frontend as soon as a quiz is rendered.
    Sends ALL question texts to Gemini in ONE call and caches the labels
    in Cosmos so that /quiz/submit doesn't need to call Gemini at all.
    Non-blocking from the frontend's perspective — submit falls back
    gracefully if this hasn't completed yet.
    """
    try:
        quiz_doc = await get_quiz(quiz_id=request.quiz_id, user_id=request.user_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Quiz not found: {str(e)}")

    # Already preclassified — nothing to do
    if quiz_doc.get("weak_area_labels") is not None:
        return {"status": "already_cached"}

    questions = quiz_doc["questions"]
    try:
        labels = batch_classify_weak_areas(questions)
        await patch_weak_area_labels(
            quiz_id=request.quiz_id,
            user_id=request.user_id,
            labels=labels,
        )
    except Exception:
        # Non-critical — submit will fall back to on-the-spot classification
        pass

    return {"status": "ok"}


# ── POST /quiz/submit ─────────────────────────────────────────────────────────

@router.post("/submit", response_model=QuizSubmitResponse)
async def quiz_submit(request: QuizSubmitRequest):
    """
    Grades submitted answers against stored correct answers.
    Uses pre-cached weak area labels from /quiz/preclassify if available,
    otherwise falls back to classifying only the wrong questions on the spot
    (still one single Gemini call via batch_classify_weak_areas).
    """

    # Fetch quiz from Cosmos DB
    try:
        quiz_doc = await get_quiz(quiz_id=request.quiz_id, user_id=request.user_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Quiz not found: {str(e)}")

    stored_questions = quiz_doc["questions"]

    if len(request.answers) != len(stored_questions):
        raise HTTPException(
            status_code=400,
            detail=f"Expected {len(stored_questions)} answers, got {len(request.answers)}.",
        )

    # Use cached labels if preclassify already ran, else None (we'll batch below)
    cached_labels = quiz_doc.get("weak_area_labels")  # list[str] or None

    # Grade answers
    results = []
    correct_count = 0
    wrong_indices = []  # indices of wrong answers, for fallback classification

    # Bug 2 fix: unanswered_indices are questions that timed out and were force-set
    # to index 0 by the frontend. They must NEVER count as correct regardless of
    # whether correct_index happens to be 0.
    unanswered_set = set(request.unanswered_indices or [])

    for i, q in enumerate(stored_questions):
        selected = request.answers[i]
        correct = q["correct_index"]
        is_correct = (selected == correct) and (i not in unanswered_set)

        if is_correct:
            correct_count += 1
        else:
            wrong_indices.append(i)

        results.append({
            "question_id": q["id"],
            "correct":       is_correct,
            "selected_index": selected,
            "correct_index":  correct,
            "explanation":    q["explanation"],
            "question":       q["question"],
            "options":        q["options"],
        })

    total = len(stored_questions)
    score = round((correct_count / total) * 100)

    # Build weak_areas — use cached labels if available, else one batch call
    if cached_labels is not None:
        # Preclassify completed — just pick labels for wrong answers
        weak_areas = [cached_labels[i] for i in wrong_indices]
    elif wrong_indices:
        # Fallback: batch classify only the wrong questions in one Gemini call
        wrong_questions = [stored_questions[i] for i in wrong_indices]
        try:
            fallback_labels = batch_classify_weak_areas(wrong_questions)
        except Exception:
            fallback_labels = ["General"] * len(wrong_questions)
        weak_areas = fallback_labels
    else:
        weak_areas = []

    # Persist results to Cosmos DB
    try:
        await submit_quiz(
            quiz_id=request.quiz_id,
            user_id=request.user_id,
            score=score,
            correct_count=correct_count,
            total_questions=total,
            weak_areas=weak_areas,
            results=results,
            unanswered_indices=request.unanswered_indices,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save results: {str(e)}")

    # Update the conversation history message so reopening the chat shows
    # the quiz in its submitted/read-only state instead of resetting it.
    if quiz_doc.get("conversation_id"):
        try:
            await update_message_json(
                conversation_id=quiz_doc["conversation_id"],
                user_id=request.user_id,
                match_key="quiz_id",
                match_value=request.quiz_id,
                patch={
                    "submitted": True,
                    "score": score,
                    "correct_count": correct_count,
                    "total_questions": total,
                    "weak_areas": weak_areas,
                    "results": results,
                    "unanswered_indices": request.unanswered_indices,
                },
            )
        except Exception:
            pass  # Non-critical — quiz score is already saved above

    return QuizSubmitResponse(
        quiz_id=request.quiz_id,
        score=score,
        total_questions=total,
        correct_count=correct_count,
        weak_areas=weak_areas,
        results=[QuizResult(**r) for r in results],
        unanswered_indices=request.unanswered_indices,
    )


# ── GET /quiz/history ─────────────────────────────────────────────────────────

@router.get("/history", response_model=QuizHistoryResponse)
async def quiz_history(user_id: str = Query(...)):
    """
    Returns all submitted quizzes for a user, newest first.
    Used to populate the My Quizzes page.
    """
    try:
        raw = await list_quizzes(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch quiz history: {str(e)}")

    return QuizHistoryResponse(
        quizzes=[
            QuizHistoryItem(
                quiz_id=q["id"],
                topic=q.get("topic", "Unknown"),
                created_at=q.get("created_at", ""),
                submitted=q.get("submitted", False),
                score=q.get("score"),
                correct_count=q.get("correct_count"),
                total_questions=q.get("total_questions", 5),
                weak_areas=q.get("weak_areas", []),
                results=[QuizResult(**r) for r in q.get("results", [])],
            )
            for q in raw
        ]
    )


# ── GET /quiz/{quiz_id} ───────────────────────────────────────────────────────

@router.get("/{quiz_id}")
async def quiz_detail(quiz_id: str, user_id: str = Query(...)):
    """
    Returns the full detail of a single submitted quiz including
    questions, results, explanations, and weak areas.
    Called lazily by the frontend only when the user clicks a quiz card.
    """
    try:
        q = await get_quiz(quiz_id=quiz_id, user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Quiz not found: {str(e)}")

    results = [
        {
            "question_id":    r.get("question_id", ""),
            "correct":        r.get("correct", False),
            "selected_index": r.get("selected_index", 0),
            "correct_index":  r.get("correct_index", 0),
            "explanation":    r.get("explanation", ""),
            "question":       r.get("question", ""),
            "options":        r.get("options", []),
        }
        for r in q.get("results", [])
    ]

    return {
        "quiz_id":        q["id"],
        "topic":          q.get("topic", "Unknown"),
        "created_at":     q.get("created_at", ""),
        "submitted":      q.get("submitted", False),
        "score":          q.get("score"),
        "correct_count":  q.get("correct_count"),
        "total_questions": q.get("total_questions", 5),
        "weak_areas":     q.get("weak_areas", []),
        "results":        results,
        "unanswered_indices": q.get("unanswered_indices", []),
    }