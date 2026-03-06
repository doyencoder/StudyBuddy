import uuid
import re
from fastapi import APIRouter, HTTPException, Query

from app.models import (
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizQuestion,
    QuizSubmitRequest,
    QuizSubmitResponse,
    QuizResult,
    QuizHistoryResponse,
    QuizHistoryItem,
)
from app.services.gemini_service import embed_query, generate_quiz_questions, classify_weak_area
from app.services.search_service import (
    retrieve_chunks,
    retrieve_chunks_hybrid,
    conversation_has_documents,
)
from app.services.cosmos_service import save_quiz, get_quiz, submit_quiz, list_quizzes, ensure_conversation, save_message

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

    # ── Step 3: Generate questions via Gemini ─────────────────────────────────
    try:
        raw_questions = generate_quiz_questions(
            context_chunks=context_chunks,
            topic=request.topic or "",
            num_questions=request.num_questions,
        )
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
        except Exception:
            pass  # Non-critical — don't fail quiz generation over this

    try:
        await save_quiz(
            user_id=request.user_id,
            quiz_id=quiz_id,
            topic=topic_label,
            questions=raw_questions,
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
    )


# ── POST /quiz/submit ─────────────────────────────────────────────────────────

@router.post("/submit", response_model=QuizSubmitResponse)
async def quiz_submit(request: QuizSubmitRequest):
    """
    Grades submitted answers against stored correct answers.
    Calculates score, identifies weak areas, persists results to Cosmos DB.
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

    # Grade answers
    results = []
    correct_count = 0
    weak_areas = []

    for i, q in enumerate(stored_questions):
        selected = request.answers[i]
        correct = q["correct_index"]
        is_correct = selected == correct

        if is_correct:
            correct_count += 1
        else:
            weak_label = classify_weak_area(q["question"])
            weak_areas.append(weak_label)

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
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save results: {str(e)}")

    return QuizSubmitResponse(
        quiz_id=request.quiz_id,
        score=score,
        total_questions=total,
        correct_count=correct_count,
        weak_areas=weak_areas,
        results=[QuizResult(**r) for r in results],
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