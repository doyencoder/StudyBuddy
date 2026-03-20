import asyncio
import io
import json
import re
import uuid
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from app.models import ChatRequest, ChatHistoryResponse, ChatMessage
from app.services.gemini_service import (
    embed_query, embed_text, chat_stream, infer_topic_from_messages,
    classify_intent,
    generate_quiz_questions,
    generate_mermaid,
    generate_image as generate_image_bytes,
)
from app.services.search_service import (
    retrieve_chunks, retrieve_chunks_hybrid, store_chunks,
    create_index_if_not_exists, conversation_has_documents,
)
from app.services.doc_intelligence_service import extract_text_from_url
from app.utils.chunking import chunk_text
from app.services.cosmos_service import (
    create_conversation,
    save_message,
    get_messages,
    get_conversation_full,
    list_conversations,
    update_message_json,
    update_message_content,
    save_quiz,
    save_diagram,
    save_image_diagram,
    rename_conversation,
    delete_conversation,
    star_conversation,
)
from app.services.blob_service import upload_generated_image_to_blob
from app.services.study_plan_service import create_study_plan
from app.services.translator_service import translate_text
from app.services.tts_service import synthesize_speech

router = APIRouter(prefix="/chat", tags=["Chat"])


# ── Request models ────────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text: str
    target_language: str


class TTSRequest(BaseModel):
    text: str
    language: str
    voice_style: str = "buttery"


class InferTopicRequest(BaseModel):
    messages: List[dict]


class RegenerateRequest(BaseModel):
    user_id: str
    conversation_id: str
    message_id: str  # ID of the assistant message to regenerate


# ── POST /chat/regenerate ─────────────────────────────────────────────────────

@router.post("/regenerate")
async def regenerate_message_endpoint(request: RegenerateRequest):
    """
    Regenerates a specific assistant message without creating new Cosmos records.

    Unlike POST /chat/message this endpoint:
      - Does NOT append a new user message to Cosmos (original is already there).
      - REPLACES the content of the existing assistant message (no duplicate).
      - Injects an explicit variation instruction so Gemini produces a different
        answer instead of repeating the previous one verbatim.
    """
    # ── Fetch full conversation history ───────────────────────────────────────
    conv_data = await get_conversation_full(request.conversation_id)
    all_messages = conv_data["messages"]

    # ── Locate the target assistant message ───────────────────────────────────
    target_idx = next(
        (i for i, m in enumerate(all_messages) if m.get("id") == request.message_id),
        None,
    )
    if target_idx is None:
        raise HTTPException(status_code=404, detail="Message not found in conversation.")

    # ── Find the preceding user message ───────────────────────────────────────
    prior_messages = all_messages[:target_idx]
    preceding_user = next(
        (m for m in reversed(prior_messages) if m.get("role") == "user"), None
    )
    if not preceding_user:
        raise HTTPException(status_code=400, detail="No preceding user message found.")

    # Unwrap structured user content (chip / attachment JSON wrapper) to plain text
    user_text = preceding_user.get("content", "")
    if user_text.startswith('{"__type":'):
        try:
            parsed_user = json.loads(user_text)
            user_text = parsed_user.get("text") or user_text
        except Exception:
            pass

    # ── Previous assistant response (used to request variation) ───────────────
    prev_response = all_messages[target_idx].get("content", "")

    # ── RAG retrieval (same thresholds as regular chat) ───────────────────────
    q_text = user_text or "key concepts"
    context_chunks: list = []
    try:
        loop = asyncio.get_event_loop()
        has_docs = await loop.run_in_executor(
            None,
            lambda: conversation_has_documents(
                user_id=request.user_id,
                conversation_id=request.conversation_id,
            ),
        )
        if has_docs:
            query_embedding = await loop.run_in_executor(None, lambda: embed_query(q_text))
            context_chunks = retrieve_chunks(
                query_embedding=query_embedding,
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                top_k=5,
            )
            if not context_chunks:
                context_chunks = retrieve_chunks(
                    query_embedding=query_embedding,
                    user_id=request.user_id,
                    conversation_id=request.conversation_id,
                    top_k=5,
                    score_threshold=0.5,
                )
    except Exception:
        pass  # RAG failure is non-fatal — fall back to general knowledge

    # ── SSE stream ────────────────────────────────────────────────────────────
    async def regen_stream():
        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': request.conversation_id})}\n\n"

        # Build the question with an explicit variation instruction so Gemini
        # produces a meaningfully different answer, not a verbatim repeat.
        if prev_response.strip():
            regen_question = (
                f"{user_text}\n\n"
                f"[Regeneration instruction: Your previous answer covered this topic already. "
                f"Please respond with a fresh explanation — use different phrasing, "
                f"different examples or analogies, and a new angle or structure. "
                f"Do NOT repeat the same wording as before.]"
            )
        else:
            regen_question = user_text

        full_reply = ""
        try:
            for chunk in chat_stream(
                question=regen_question,
                context_chunks=context_chunks,
                history=prior_messages,  # history up to (not including) the target msg
            ):
                full_reply += chunk
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                await asyncio.sleep(0)  # flush TCP buffer after every token
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            return

        # ── Replace existing message in Cosmos (NO new record created) ────────
        await update_message_content(
            conversation_id=request.conversation_id,
            user_id=request.user_id,
            message_id=request.message_id,
            new_content=full_reply,
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        regen_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /chat/message ────────────────────────────────────────────────────────

@router.post("/message")
async def chat_message(request: ChatRequest):
    """
    Unified chat endpoint with intent classification and dispatch.

    1. Fetches history + pending_intent in ONE Cosmos read.
    2a. [OPT 1] If intent_hint set (chip click) → skip Gemini classify call entirely.
    2b. [OPT 2] Otherwise → run classify_intent + embed_query IN PARALLEL on thread pool.
    3. Clarification → streams question + stores pending_intent in Cosmos.
    4. [OPT 3] Skip Azure AI Search RAG calls when no documents exist in conversation.
    5. Feature intent → dispatches to quiz / diagram / image / study_plan.
    6. Default → existing RAG chat stream.
    """

    # ── Ensure conversation ───────────────────────────────────────────────────
    conversation_id = request.conversation_id
    if not conversation_id:
        conversation_id = await create_conversation(request.user_id)

    # ── History + pending_intent (single Cosmos read) ─────────────────────────
    conv_data = await get_conversation_full(conversation_id)
    prior_messages = conv_data["messages"]
    pending_intent = conv_data["pending_intent"]

    # ── OPTIMISATION 1: Skip classify_intent when chip already tells us intent ─
    # When intent_hint is set the user clicked a + menu chip — intent is 100%
    # known before any AI call. No reason to spend ~2000ms confirming it.
    # ── OPTIMISATION 2: Parallelise classify_intent + embed_query ─────────────
    # On the natural language path both calls are fully independent.
    # Running them on thread-pool workers via asyncio.gather() saves ~400ms.
    pre_embedding = None  # may be pre-computed by Opt 2 below

    if request.intent_hint:
        # Intent known from chip — build classification dict with no Gemini call
        msg_lower = (request.message or "").lower()
        num_q_match = re.search(r'(\d+)\s*(questions?|ques|qs\b|q\b|mcqs?)', msg_lower)
        # Parse weeks for study_plan chip: "4 weeks", "2 months" → weeks. Default 4.
        weeks_match = re.search(r'(\d+)\s*(week|month)', msg_lower)
        weeks_val = 4  # default — never ask the user for weeks
        if weeks_match:
            n = int(weeks_match.group(1))
            weeks_val = n * 4 if "month" in weeks_match.group(2) else n
        # Parse timer: "30 seconds", "1 minute", "2 mins" → seconds
        timer_match = re.search(r'(\d+)\s*(second|sec|minute|min)', msg_lower)
        timer_val = None
        if timer_match:
            n = int(timer_match.group(1))
            timer_val = n * 60 if "min" in timer_match.group(2) else n
        # Topic is missing only when: no message text AND no file attached.
        # If a file is attached, topic will be inferred from the document.
        has_attachment = bool(request.filename or request.attachments)
        no_topic = not request.message.strip() and not has_attachment

        # ── Clean topic from raw message ───────────────────────────────────────
        # The chip already tells us the INTENT (quiz / flowchart / etc.), so we
        # must strip any intent-describing words from the user's message to get
        # a clean topic string.  Without this, a message like
        # "give me a flowchart on photosynthesis" with the Quiz chip selected
        # would pass the entire sentence as the topic to generate_quiz_questions,
        # confusing Gemini and producing irrelevant / garbled questions.
        #
        # Strategy: remove common intent-verb phrases and prepositions that
        # precede the actual topic, then trim whitespace.
        _INTENT_STRIP = re.compile(
            r'^(please\s+)?(can\s+you\s+)?'
            r'(give\s+me\s+(a\s+)?|make\s+(a\s+|me\s+(a\s+)?)?|'
            r'create\s+(a\s+)?|generate\s+(a\s+)?|show\s+me\s+(a\s+)?|build\s+(a\s+)?|'
            r'i\s+want\s+(a\s+)?|produce\s+(a\s+)?)?'
            r'(timed\s+)?(quiz\s+me\s+on|quiz|test|questions?|mcq|flowchart|flow\s+chart|mindmap|mind\s+map|'
            r'diagram|image\s+of|image|picture\s+of|picture|illustration|study\s+plan|plan)\s*'
            r'(me\s+on\s+|about|on|for|of|regarding|related\s+to|covering)?\s*',
            re.IGNORECASE,
        )
        # Also strip trailing quantity phrases that got swept in ("5 questions", "10 mcqs")
        _TRAILING_STRIP = re.compile(
            r'\s*(with\s+)?\d+\s*(questions?|ques|qs\b|q\b|mcqs?|items?|mins?|minutes?|seconds?|secs?)\s*$',
            re.IGNORECASE,
        )
        raw_msg = request.message.strip()
        cleaned_topic = _INTENT_STRIP.sub("", raw_msg).strip()
        cleaned_topic = _TRAILING_STRIP.sub("", cleaned_topic).strip()
        # Fall back to full message only if stripping removed everything
        topic_val = cleaned_topic or raw_msg or ("[from_document]" if has_attachment else None)

        classification = {
            "intent":               request.intent_hint,
            "topic":                topic_val,
            "topic_source":         "message" if request.message.strip() else ("document" if has_attachment else "null"),
            "num_questions":        int(num_q_match.group(1)) if num_q_match else 5,
            "timeline_weeks":       weeks_val,
            "hours_per_week":       None,
            "timer_seconds":        timer_val,
            "needs_clarification":  no_topic,
            "clarification_question": (
                f"What topic would you like for your "
                f"{request.intent_hint.replace('_', ' ')}?"
                if no_topic else None
            ),
        }
    else:
        # Natural language path — run classify + embed concurrently on thread pool
        # Both are synchronous/blocking; run_in_executor pushes each to a worker
        # thread so they execute in parallel instead of sequentially.
        loop = asyncio.get_event_loop()
        classification, pre_embedding = await asyncio.gather(
            loop.run_in_executor(None, lambda: classify_intent(
                message=request.message,
                intent_hint=None,
                conversation_history=prior_messages,
                attached_filename=request.filename,
                pending_intent=pending_intent,
            )),
            loop.run_in_executor(None, lambda: embed_query(
                request.message or "key concepts"
            )),
        )

    intent              = classification["intent"]
    topic_raw           = classification.get("topic") or ""
    num_questions       = classification["num_questions"]
    timeline_weeks      = classification.get("timeline_weeks")
    hours_per_week      = classification.get("hours_per_week")
    timer_seconds       = classification.get("timer_seconds")
    needs_clarification = classification["needs_clarification"]
    clarification_q     = classification.get("clarification_question") or "Could you tell me more?"

    # "[from_document]" is sentinel meaning "derive topic from uploaded material"
    topic = "" if topic_raw == "[from_document]" else topic_raw

    # ── Build user_content for Cosmos ─────────────────────────────────────────
    has_chip = bool(request.intent_hint)
    has_att  = bool(request.attachments)

    if has_chip and has_att:
        user_content = json.dumps({
            "__type": "user_with_intent_and_attachments",
            "text": request.message,
            "intent_hint": request.intent_hint,
            "attachments": [
                {"name": a.name, "blob_url": a.blob_url, "file_type": a.file_type}
                for a in request.attachments
            ],
        })
    elif has_chip:
        user_content = json.dumps({
            "__type": "user_with_intent",
            "text": request.message,
            "intent_hint": request.intent_hint,
        })
    elif has_att:
        user_content = json.dumps({
            "__type": "user_with_attachments",
            "text": request.message,
            "attachments": [
                {"name": a.name, "blob_url": a.blob_url, "file_type": a.file_type}
                for a in request.attachments
            ],
        })
    else:
        user_content = request.message

    # ── Clarification short-circuit ───────────────────────────────────────────
    if needs_clarification:
        await save_message(
            conversation_id=conversation_id,
            user_id=request.user_id,
            role="user",
            content=user_content,
            pending_intent_update=intent if intent != "chat" else None,
        )
        await save_message(
            conversation_id=conversation_id,
            user_id=request.user_id,
            role="assistant",
            content=clarification_q,
        )

        async def clarification_stream():
            yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conversation_id})}\n\n"
            yield f"data: {json.dumps({'type': 'text', 'content': clarification_q})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            clarification_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── Save user message and clear pending_intent ────────────────────────────
    await save_message(
        conversation_id=conversation_id,
        user_id=request.user_id,
        role="user",
        content=user_content,
        pending_intent_update=None,
    )

    # ── OPTIMISATION 3: Skip RAG entirely when no documents exist ─────────────
    # conversation_has_documents() is a lightweight Azure Search call (top=1).
    # When no docs are uploaded both retrieve_chunks calls are guaranteed to
    # return [] — wasting ~600ms on two round-trips. Skip them entirely.
    # NOTE: This does NOT affect conversation memory — that comes from Cosmos
    # (prior_messages above), not from Azure Search.
    q_text = request.message or topic or "key concepts"
    query_embedding = None
    context_chunks  = []
    try:
        has_docs = conversation_has_documents(
            user_id=request.user_id,
            conversation_id=conversation_id,
        )
        if has_docs:
            # Use pre_embedding from Opt 2 parallelisation if available,
            # otherwise compute now (chip path didn't pre-compute one).
            query_embedding = pre_embedding if pre_embedding is not None else embed_query(q_text)
            context_chunks = retrieve_chunks(
                query_embedding=query_embedding,
                user_id=request.user_id,
                conversation_id=conversation_id,
                top_k=5,
            )
            if not context_chunks:
                context_chunks = retrieve_chunks(
                    query_embedding=query_embedding,
                    user_id=request.user_id,
                    conversation_id=conversation_id,
                    top_k=5,
                    score_threshold=0.5,
                )
        # else: no docs → skip embed + both retrieval calls (~600ms saved)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG retrieval failed: {str(e)}")

    # ── Event stream ──────────────────────────────────────────────────────────
    async def event_stream():
        active_chunks = context_chunks

        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conversation_id})}\n\n"

        # Blob RAG ingestion (when a file is sent with this message)
        if request.blob_url and request.filename:
            try:
                yield f"data: {json.dumps({'type': 'status', 'content': 'reading_document'})}\n\n"
                extracted = extract_text_from_url(request.blob_url)
                if extracted.strip():
                    chunks  = chunk_text(extracted)
                    embeddings = [embed_text(c) for c in chunks]
                    create_index_if_not_exists()
                    fid = str(uuid.uuid4())
                    store_chunks(
                        chunks=chunks, embeddings=embeddings,
                        user_id=request.user_id, conversation_id=conversation_id,
                        file_id=fid, filename=request.filename,
                    )
                    q_emb = embed_query(q_text)
                    active_chunks = retrieve_chunks(q_emb, request.user_id, conversation_id, top_k=5)
                    if not active_chunks:
                        active_chunks = retrieve_chunks(q_emb, request.user_id, conversation_id, top_k=5, score_threshold=0.5)
                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
            except Exception:
                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"

        # ── Dispatch ─────────────────────────────────────────────────────────
        if intent == "quiz":
            async for evt in _dispatch_quiz(request.user_id, conversation_id, topic, num_questions, timer_seconds=timer_seconds):
                yield evt
            return

        if intent in ("flowchart", "mindmap"):
            dtype = "flowchart" if intent == "flowchart" else "diagram"
            async for evt in _dispatch_diagram(request.user_id, conversation_id, topic, dtype, prior_messages, raw_message=request.message):
                yield evt
            return

        if intent == "image":
            async for evt in _dispatch_image(request.user_id, conversation_id, topic, prior_messages):
                yield evt
            return

        if intent == "study_plan":
            tw = int(timeline_weeks) if timeline_weeks else 4
            hw = int(hours_per_week) if hours_per_week else 8
            async for evt in _dispatch_study_plan(request.user_id, conversation_id, topic, tw, hw):
                yield evt
            return

        # ── Regular chat ──────────────────────────────────────────────────────
        # asyncio.sleep(0) after each chunk yields control back to the event loop,
        # forcing Uvicorn to flush its send buffer immediately instead of batching
        # multiple chunks together. Without this, the sync chat_stream() generator
        # blocks the event loop and causes tokens to arrive in bursts on the frontend.
        full_reply = ""
        try:
            for chunk in chat_stream(
                question=request.message,
                context_chunks=active_chunks,
                history=prior_messages,
            ):
                full_reply += chunk
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                await asyncio.sleep(0)  # ← flush: yield event loop control after every token
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            return

        saved = await save_message(
            conversation_id=conversation_id,
            user_id=request.user_id,
            role="assistant",
            content=full_reply,
        )
        # Emit the real Cosmos message ID so the frontend can update its local
        # UUID to match. Without this, clicking Regenerate immediately after
        # sending would pass a frontend-only UUID that Cosmos has never seen.
        yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved['id']})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Feature dispatch helpers ──────────────────────────────────────────────────

async def _dispatch_quiz(user_id, conversation_id, topic, num_questions, timer_seconds=None):
    try:
        has_docs = conversation_has_documents(user_id=user_id, conversation_id=conversation_id)
        if not has_docs:
            context_chunks = []
        elif topic:
            q_emb = embed_query(topic)
            context_chunks = retrieve_chunks_hybrid(
                topic=topic, query_embedding=q_emb,
                user_id=user_id, conversation_id=conversation_id,
                top_k=10, rrf_threshold=0.020,
            )
        else:
            q_emb = embed_query("key concepts and important topics")
            context_chunks = retrieve_chunks(
                query_embedding=q_emb, user_id=user_id,
                conversation_id=conversation_id, top_k=10, score_threshold=0.5,
            )

        result = generate_quiz_questions(
            context_chunks=context_chunks,
            topic=topic or "",
            num_questions=num_questions,
        )
        raw_questions = result["questions"]
        fun_fact = result["fun_fact"]

        quiz_id = str(uuid.uuid4())
        topic_label = (topic or "General Quiz").strip()
        topic_label = re.sub(
            r'\b(and|or|the|a|an|for|of|in|on|with|about)\s*$',
            '', topic_label, flags=re.IGNORECASE,
        ).strip() or topic_label

        await save_quiz(
            user_id=user_id, quiz_id=quiz_id, topic=topic_label,
            questions=raw_questions, conversation_id=conversation_id,
            fun_fact=fun_fact,
        )

        q_for_history = [
            {"id": q["id"], "question": q["question"], "options": q["options"]}
            for q in raw_questions
        ]
        await save_message(
            conversation_id=conversation_id, user_id=user_id,
            role="assistant",
            content=json.dumps({
                "__type": "quiz", "quiz_id": quiz_id,
                "topic": topic_label, "submitted": False,
                "questions": q_for_history, "fun_fact": fun_fact,
                "timer_seconds": timer_seconds,
                "num_questions": num_questions,
            }),
        )

        yield f"data: {json.dumps({'type': 'quiz_result', 'data': {'quiz_id': quiz_id, 'topic': topic_label, 'questions': q_for_history, 'fun_fact': fun_fact, 'timer_seconds': timer_seconds, 'num_questions': num_questions}})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'Quiz generation failed: {str(e)}'})}\n\n"
        yield "data: [DONE]\n\n"


async def _dispatch_diagram(user_id, conversation_id, topic, diagram_type, prior_messages, raw_message: str = ""):
    try:
        effective = topic or infer_topic_from_messages(prior_messages) or "General Topic"

        # ── Extract layout hint from the original user message ────────────────
        # classify_intent() strips keywords like "circular"/"horizontal" when
        # extracting topic — so we scan the raw message here to recover them.
        msg_lower = (raw_message or "").lower()
        if any(w in msg_lower for w in ("circular", "circle", "cyclic", "cycle diagram", "loop diagram")):
            layout_hint = "circular"
        elif any(w in msg_lower for w in ("horizontal", "left to right", "lr", "sideways")):
            layout_hint = "horizontal"
        elif any(w in msg_lower for w in ("vertical", "top down", "td", "top to bottom")):
            layout_hint = "vertical"
        elif any(w in msg_lower for w in ("diagonal",)):
            layout_hint = "horizontal"  # closest Mermaid equivalent
        else:
            layout_hint = None  # let gemini_service decide intelligently

        chunks = []
        try:
            q_emb = embed_query(effective)
            chunks = retrieve_chunks(
                query_embedding=q_emb, user_id=user_id,
                conversation_id=conversation_id, top_k=8, score_threshold=0.5,
            )
        except Exception:
            pass

        mermaid_code = generate_mermaid(topic=effective, diagram_type=diagram_type, context_chunks=chunks, layout_hint=layout_hint)
        saved = await save_diagram(
            user_id=user_id, conversation_id=conversation_id,
            diagram_type=diagram_type, topic=effective, mermaid_code=mermaid_code,
        )
        await save_message(
            conversation_id=conversation_id, user_id=user_id,
            role="assistant",
            content=json.dumps({
                "__type": "diagram", "diagram_id": saved["diagram_id"],
                "type": saved["type"], "topic": saved["topic"],
                "mermaid_code": saved["mermaid_code"], "created_at": saved["created_at"],
            }),
        )
        yield f"data: {json.dumps({'type': 'diagram_result', 'data': saved})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'Diagram generation failed: {str(e)}'})}\n\n"
        yield "data: [DONE]\n\n"


async def _dispatch_image(user_id, conversation_id, topic, prior_messages):
    try:
        effective = topic or infer_topic_from_messages(prior_messages) or "General Topic"
        chunks = []
        try:
            q_emb = embed_query(effective)
            chunks = retrieve_chunks(
                query_embedding=q_emb, user_id=user_id,
                conversation_id=conversation_id, top_k=3, score_threshold=0.5,
            )
        except Exception:
            pass

        image_bytes = generate_image_bytes(topic=effective, context_chunks=chunks)
        blob_result = upload_generated_image_to_blob(image_bytes=image_bytes, topic=effective, user_id=user_id)
        saved = await save_image_diagram(
            user_id=user_id, conversation_id=conversation_id,
            topic=effective, image_url=blob_result["blob_url"],
        )
        await save_message(
            conversation_id=conversation_id, user_id=user_id,
            role="assistant",
            content=json.dumps({
                "__type": "image", "diagram_id": saved["diagram_id"],
                "type": "image", "topic": saved["topic"],
                "image_url": saved["image_url"], "created_at": saved["created_at"],
            }),
        )
        yield f"data: {json.dumps({'type': 'image_result', 'data': saved})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'Image generation failed: {str(e)}'})}\n\n"
        yield "data: [DONE]\n\n"


async def _dispatch_study_plan(user_id, conversation_id, topic, timeline_weeks, hours_per_week):
    try:
        plan = await create_study_plan(
            user_id=user_id, conversation_id=conversation_id,
            topic=topic or None, timeline_weeks=timeline_weeks,
            hours_per_week=hours_per_week, focus_days=None,
        )
        weeks_data = [
            {
                "week_number": w.get("week_number", 0),
                "start_date": w.get("start_date", ""),
                "end_date": w.get("end_date", ""),
                "tasks": w.get("tasks", []),
                "estimate_hours": w.get("estimate_hours"),
            }
            for w in plan.get("weeks", [])
        ]
        result = {
            "plan_id": plan["plan_id"], "title": plan.get("title", ""),
            "start_date": plan.get("start_date", ""), "end_date": plan.get("end_date", ""),
            "weeks": weeks_data, "summary": plan.get("summary", ""), "goal_saved": False,
        }
        await save_message(
            conversation_id=conversation_id, user_id=user_id,
            role="assistant",
            content=json.dumps({"__type": "study_plan", **result}),
        )
        yield f"data: {json.dumps({'type': 'study_plan_result', 'data': result})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'Study plan generation failed: {str(e)}'})}\n\n"
        yield "data: [DONE]\n\n"


# ── GET /chat/history ─────────────────────────────────────────────────────────

@router.get("/history/{conversation_id}", response_model=ChatHistoryResponse)
async def chat_history(conversation_id: str):
    try:
        raw_messages = await get_messages(conversation_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch chat history: {str(e)}")

    if not raw_messages:
        raise HTTPException(status_code=404, detail=f"No conversation found with id '{conversation_id}'.")

    messages = [
        ChatMessage(id=m["id"], role=m["role"], content=m["content"], timestamp=m["timestamp"])
        for m in raw_messages
    ]
    return ChatHistoryResponse(conversation_id=conversation_id, messages=messages)


# ── GET /chat/conversations ───────────────────────────────────────────────────

@router.get("/conversations")
async def get_conversations(user_id: str = Query(...)):
    try:
        raw = await list_conversations(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch conversations: {str(e)}")

    conversations = []
    for conv in raw:
        # Explicit user rename always wins — check stored title FIRST
        if conv.get("title"):
            title = conv["title"]
        else:
            messages = conv.get("messages", [])
            first_user_msg = next((m for m in messages if m.get("role") == "user"), None)
            if first_user_msg:
                raw_title = first_user_msg.get("content", "Untitled Chat")
                try:
                    if '"__type"' in raw_title:
                        parsed = json.loads(raw_title)
                        t = parsed.get("__type", "")
                        if t in ("user_with_attachments", "user_with_intent",
                                 "user_with_intent_and_attachments"):
                            raw_title = (
                                parsed.get("text", "") or
                                (parsed.get("attachments") or [{}])[0].get("name", "Untitled Chat")
                            )
                except Exception:
                    pass
                title = raw_title[:45] + ("..." if len(raw_title) > 45 else "")
            else:
                title = "New Conversation"
        conversations.append({
            "conversation_id": conv.get("conversation_id"),
            "title": title,
            "created_at": conv.get("created_at", ""),
            "starred": conv.get("starred", False),
        })

    return {"conversations": conversations}


# ── PATCH /chat/conversations/{id}/rename ─────────────────────────────────────

class RenameRequest(BaseModel):
    user_id: str
    title: str

@router.patch("/conversations/{conversation_id}/rename")
async def rename_conversation_endpoint(conversation_id: str, request: RenameRequest):
    if not request.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
    updated = await rename_conversation(
        conversation_id=conversation_id,
        user_id=request.user_id,
        new_title=request.title,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"ok": True}


# ── DELETE /chat/conversations/{id} ──────────────────────────────────────────

@router.delete("/conversations/{conversation_id}")
async def delete_conversation_endpoint(conversation_id: str, user_id: str = Query(...)):
    deleted = await delete_conversation(
        conversation_id=conversation_id,
        user_id=user_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"ok": True}


# ── PATCH /chat/conversations/{id}/star ──────────────────────────────────────

class StarRequest(BaseModel):
    user_id: str
    starred: bool

@router.patch("/conversations/{conversation_id}/star")
async def star_conversation_endpoint(conversation_id: str, request: StarRequest):
    updated = await star_conversation(
        conversation_id=conversation_id,
        user_id=request.user_id,
        starred=request.starred,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"ok": True, "starred": request.starred}



@router.post("/translate")
async def translate_message(request: TranslateRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    try:
        translated = translate_text(text=request.text, target_language=request.target_language)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"translated_text": translated, "target_language": request.target_language}


# ── POST /chat/tts ────────────────────────────────────────────────────────────

@router.post("/tts")
async def text_to_speech(request: TTSRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    clean_text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    clean_text = re.sub(r"\*(.*?)\*",     r"\1", clean_text)
    clean_text = re.sub(r"`(.*?)`",       r"\1", clean_text)
    clean_text = re.sub(r"#{1,6}\s",      "",    clean_text)
    clean_text = re.sub(r"[-*]\s",        "",    clean_text)
    clean_text = clean_text.strip()

    if not clean_text:
        raise HTTPException(status_code=400, detail="No speakable text after cleaning.")

    try:
        mp3_bytes = synthesize_speech(text=clean_text, language=request.language, voice_style=request.voice_style)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return StreamingResponse(
        io.BytesIO(mp3_bytes),
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"},
    )


# ── POST /chat/infer-topic ────────────────────────────────────────────────────

@router.post("/infer-topic")
async def infer_topic(request: InferTopicRequest):
    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages provided.")
    try:
        topic = infer_topic_from_messages(request.messages)
        return {"topic": topic}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Topic inference failed: {str(e)}")