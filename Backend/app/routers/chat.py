import asyncio
import io
import json
import re
import uuid

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
from app.services.doc_intelligence_service import extract_text_from_url, extract_pages_from_url
from app.utils.chunking import chunk_text, chunk_by_paragraphs
from app.models import ChatRequest, ChatHistoryResponse, ChatMessage
from app.services.ai_service import (
    embed_query, embed_text, chat_stream, infer_topic_from_messages,
    classify_intent,
    generate_quiz_questions,
    generate_mermaid,
    generate_image as generate_image_bytes,
    extract_document_context,
)
from app.services.search_service import (
    retrieve_chunks, retrieve_chunks_hybrid, store_chunks,
    create_index_if_not_exists, conversation_has_documents,
    retrieve_chunks_smart,get_conversation_filenames,
)
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
from app.services.web_search_service import web_search, build_search_context, image_search, is_image_query, youtube_search, is_video_query, youtube_search_api
from app.utils.document_resolver import resolve_document_filter

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


# ── Helper: tag chunks with page numbers so Gemini knows which page ───────────

def _tag_chunks_with_pages(chunk_tuples: list) -> list:
    """
    Takes list of (text, page_number) tuples from retrieve_chunks_smart().
    Sorts by page number so Gemini receives content in document order,
    then prefixes each chunk with [Page N] so Gemini knows which page it came from.

    Returns plain list of tagged strings ready to pass to chat_stream().
    """
    if not chunk_tuples:
        return []
    sorted_tuples = sorted(
        [item for item in chunk_tuples if isinstance(item, tuple)],
        key=lambda x: (x[2] if len(x) > 2 else "", x[1])
    )
    result = []
    for item in sorted_tuples:
        text, page_num = item[0], item[1]
        filename = item[2] if len(item) > 2 else ""
        prefix = f"[File: {filename} | Page {page_num}]" if filename else f"[Page {page_num}]"
        result.append(f"{prefix}\n{text}")
    return result


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
    conv_data = await get_conversation_full(request.conversation_id)
    all_messages = conv_data["messages"]

    target_idx = next(
        (i for i, m in enumerate(all_messages) if m.get("id") == request.message_id),
        None,
    )
    if target_idx is None:
        raise HTTPException(status_code=404, detail="Message not found in conversation.")

    prior_messages = all_messages[:target_idx]
    preceding_user = next(
        (m for m in reversed(prior_messages) if m.get("role") == "user"), None
    )
    if not preceding_user:
        raise HTTPException(status_code=400, detail="No preceding user message found.")

    user_text = preceding_user.get("content", "")
    if user_text.startswith('{"__type":'):
        try:
            parsed_user = json.loads(user_text)
            user_text = parsed_user.get("text") or user_text
        except Exception:
            pass

    prev_response = all_messages[target_idx].get("content", "")

    # ── Check if the message being regenerated was a web search answer ─────────
    # If so, re-dispatch to _dispatch_web_search so we get fresh results,
    # fresh images, and fresh source citations instead of a plain text reply.
    is_web_search_regen = prev_response.strip().startswith('{"__type": "web_search_answer"')

    if is_web_search_regen:
        async def regen_stream():
            yield f"data: {json.dumps({'type': 'meta', 'conversation_id': request.conversation_id})}\n\n"
            async for evt in _dispatch_web_search(
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                query=user_text,
                prior_messages=prior_messages,
                update_message_id=request.message_id,
            ):
                yield evt

        return StreamingResponse(
            regen_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

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
            raw_chunks = retrieve_chunks_smart(
            query_embedding=query_embedding,
            user_id=request.user_id,
            conversation_id=request.conversation_id,
            top_k=5,
        )
        context_chunks = [text for text, *_ in raw_chunks]
    except Exception:
        pass  # RAG failure is non-fatal — fall back to general knowledge

    async def regen_stream():
        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': request.conversation_id})}\n\n"

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
                history=prior_messages,
            ):
                full_reply += chunk
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                await asyncio.sleep(0)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            return

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
    4. [OPT 3] Smart retrieval: page filter, hybrid search, dynamic top_k, skip when scope=general.
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

    pre_embedding = None  # may be pre-computed by Opt 2 below

    if request.intent_hint:
        # Intent known from chip — build classification dict with no Gemini call
        msg_lower = (request.message or "").lower()
        num_q_match = re.search(r"(\d+)\s*(questions?|ques|qs\b|q\b|mcqs?)", msg_lower)
        # Parse weeks for study_plan chip: "4 weeks", "2 months" → weeks. Default 4.
        weeks_match = re.search(r'(\d+)\s*(week|month)', msg_lower)
        weeks_val = 4
        if weeks_match:
            n = int(weeks_match.group(1))
            weeks_val = n * 4 if "month" in weeks_match.group(2) else n
        # Parse timer: "30 seconds", "1 minute", "2 mins" → seconds
        timer_match = re.search(r'(\d+)\s*(second|sec|minute|min)', msg_lower)
        timer_val = None
        if timer_match:
            n = int(timer_match.group(1))
            timer_val = n * 60 if "min" in timer_match.group(2) else n

        # ── Override fields take priority (used by retake to avoid encoding
        #    count/timer in the message text, which polluted quiz titles) ──────
        if request.num_questions_override is not None:
            num_q_match = None  # suppress regex result
            num_questions_val = request.num_questions_override
        else:
            num_questions_val = int(num_q_match.group(1)) if num_q_match else 5

        if request.timer_seconds_override is not None:
            timer_val = request.timer_seconds_override

        # Topic is missing only when: no message text AND no file attached.
        # If a file is attached, topic will be inferred from the document.
        # web_search is special: the message itself is the query — never ask for clarification.
        has_attachment = bool(request.filename or request.attachments)
        no_topic = (
            not request.message.strip()
            and not has_attachment
            and request.intent_hint != "web_search"
        )

        # ── Clean topic from raw message ───────────────────────────────────────
        # The chip already tells us the INTENT (quiz / flowchart / etc.), so we
        # must strip any intent-describing words from the user's message to get
        # a clean topic string.  Without this, a message like
        # "give me a flowchart on photosynthesis" with the Quiz chip selected
        # would pass the entire sentence as the topic to generate_quiz_questions,
        # confusing Gemini and producing irrelevant / garbled questions.
        #
        # Strategy: remove common intent-verb phrases and prepositions that
        # precede the actual topic, then trim whitespace. Apply TRAILING_STRIP
        # in a loop to handle multiple trailing quantity/time phrases.
        _INTENT_STRIP = re.compile(
            r'^(please\s+)?(can\s+you\s+)?'
            r'(give\s+me\s+(a\s+)?|make\s+(a\s+|me\s+(a\s+)?)?|'
            r'create\s+(a\s+)?|generate\s+(a\s+)?(fresh\s+)?|show\s+me\s+(a\s+)?|build\s+(a\s+)?|'
            r'i\s+want\s+(a\s+)?|produce\s+(a\s+)?)?'
            r'(timed\s+)?(quiz\s+me\s+on|quiz|test|questions?|mcq|flowchart|flow\s+chart|mindmap|mind\s+map|'
            r'diagram|image\s+of|image|picture\s+of|picture|illustration|study\s+plan|plan)\s*'
            r'(me\s+on\s+|about|on\s*:?\s*|for|of|regarding|related\s+to|covering)?\s*',
            re.IGNORECASE,
        )
        # Strip trailing quantity/time phrases — loop until stable so that
        # "rohit sharma, 3 questions, 60 seconds" strips both suffixes cleanly.
        _TRAILING_STRIP = re.compile(
            r'[\s,]*(with\s+)?\d+\s*(questions?|ques|qs\b|q\b|mcqs?|items?|mins?|minutes?|seconds?|secs?)\s*$',
            re.IGNORECASE,
        )
        raw_msg = request.message.strip()
        # Loop intent strip to handle legacy doubled prefixes (e.g. old retake messages
        # that inadvertently stacked "Generate a fresh quiz on:" twice).
        cleaned_topic = raw_msg
        while True:
            stripped = _INTENT_STRIP.sub("", cleaned_topic).strip()
            if stripped == cleaned_topic:
                break
            cleaned_topic = stripped
        # Loop trailing strip until nothing more is removed
        while True:
            stripped = _TRAILING_STRIP.sub("", cleaned_topic).strip().rstrip(",").strip()
            if stripped == cleaned_topic:
                break
            cleaned_topic = stripped
        # Fall back to full message only if stripping removed everything
        topic_val = cleaned_topic or raw_msg or ("[from_document]" if has_attachment else None)

        # ── Extract document/page context via small targeted LLM call ────────────
        # Only fires when chip is selected and user has typed a message.
        # Gives chip path the same page/document awareness as natural language path.
        page_numbers_chip = []
        if request.message.strip():
            try:
                loop = asyncio.get_event_loop()
                doc_context = await loop.run_in_executor(
                    None,
                    lambda: extract_document_context(request.message)
                )
                page_numbers_chip = doc_context.get("page_numbers") or []
                doc_ref           = doc_context.get("document_reference") or ""
                clean_topic       = doc_context.get("clean_topic") or ""

                # Use clean topic (strips "in document 1", "on page 3" etc.)
                if clean_topic:
                    topic_val = clean_topic

                # Merge doc reference into topic_val so resolve_document_filter
                # can match it against actual filenames later in dispatch
                if doc_ref and doc_ref.lower() not in (topic_val or "").lower():
                    topic_val = f"{topic_val} {doc_ref}".strip() if topic_val else doc_ref

            except Exception:
                pass   # non-fatal — falls back to empty

        classification = {
            "intent":               request.intent_hint,
            "topic":                topic_val,
            "topic_source":         "message" if request.message.strip() else ("document" if has_attachment else "null"),
            "num_questions":        num_questions_val,
            "timeline_weeks":       weeks_val,
            "hours_per_week":       None,
            "timer_seconds":        timer_val,
            "needs_clarification":  no_topic,
            "clarification_question": (
                f"What topic would you like for your "
                f"{request.intent_hint.replace('_', ' ')}?"
                if no_topic else None
            ),
            # default values for new fields when chip path is used
            "page_numbers": page_numbers_chip, "keywords": [], "query_type": "broad",
            "top_k_hint": "medium", "scope": "topic",
            "response_format": "paragraph", "detail_level": "detailed",
            "language_style": "formal", "is_comparison": False,
            "entities": [], "needs_document": True,
            "is_followup": False, "refers_to_previous": False,
        }
    else:
        # Natural language path — run classify + embed concurrently on thread pool
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

    # new classification fields
    page_numbers        = classification.get("page_numbers") or []
    keywords            = classification.get("keywords") or []
    query_type          = classification.get("query_type") or "broad"
    top_k_hint          = classification.get("top_k_hint") or "medium"
    scope               = classification.get("scope") or "topic"
    response_format     = classification.get("response_format") or "paragraph"
    detail_level        = classification.get("detail_level") or "detailed"
    language_style      = classification.get("language_style") or "formal"
    is_comparison       = classification.get("is_comparison") or False
    entities            = classification.get("entities") or []
    needs_document      = classification.get("needs_document", True)
    is_followup         = classification.get("is_followup") or False

    print(f"[DEBUG] page_numbers={page_numbers}, scope={scope}, top_k_hint={top_k_hint}, query_type={query_type}, needs_document={needs_document}")
    print(f"[DEBUG] response_format={response_format}, detail_level={detail_level}, language_style={language_style}")

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
                {"name": a.name, "blob_url": a.proxy_url or a.blob_url, "file_type": a.file_type}
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
                {"name": a.name, "blob_url": a.proxy_url or a.blob_url, "file_type": a.file_type}
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

    # ── Smart retrieval ───────────────────────────────────────────────────────
    # - scope=general / needs_document=False → skip Azure Search entirely
    # - page_numbers present → filter to specific pages only
    # - keywords present → use hybrid (BM25 + vector)
    # - scope=document → top_k=50 to fetch all chunks
    # NOTE: When file is uploaded inline with message, retrieval runs AGAIN
    # inside event_stream() AFTER chunks are stored. This pre-stream retrieval
    # only hits when docs were uploaded in a previous message.
    q_text = request.message or topic or "key concepts"
    query_embedding = None
    context_chunks  = []
    try:
        skip_retrieval = (scope == "general") or (not needs_document)
        print(f"[DEBUG-RETRIEVAL] page_numbers={page_numbers}, scope={scope}, skip={skip_retrieval}, use_hybrid={bool(keywords)}")

        if not skip_retrieval:
            has_docs = conversation_has_documents(
                user_id=request.user_id,
                conversation_id=conversation_id,
            )
            if has_docs:
                top_k_map = {"low": 3, "medium": 7, "high": 20}
                top_k = top_k_map.get(top_k_hint, 7)

                if scope == "document":
                    top_k = 50  # fetch all chunks for full-document queries

                query_embedding = pre_embedding if pre_embedding is not None else embed_query(q_text)

                use_hybrid = bool(keywords) or query_type in ("formula", "definition", "list", "specific")
                context_chunks = retrieve_chunks_smart(
                    query_embedding=query_embedding,
                    user_id=request.user_id,
                    conversation_id=conversation_id,
                    keywords=keywords if use_hybrid else None,
                    page_numbers=page_numbers if page_numbers else None,
                    top_k=top_k,
                    use_hybrid=use_hybrid,
                )
                print(f"[DEBUG-RETRIEVAL] pre-stream chunks retrieved: {len(context_chunks)}")

                # Sort by page number and tag each chunk with [Page N]
                context_chunks = _tag_chunks_with_pages(context_chunks)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG retrieval failed: {str(e)}")

    # ── Event stream ──────────────────────────────────────────────────────────
    async def event_stream():
        active_chunks = context_chunks

        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conversation_id})}\n\n"

        # Blob RAG ingestion (when one or more files are sent WITH this message)
        # Runs INSIDE the stream so retrieval happens AFTER chunks are stored —
        # this is critical for page filtering to work on the first message with a file.

        # Build a unified list of ALL files to ingest from this message.
        # request.blob_url carries the real SAS for the primary file (File 1).
        # request.attachments carries real SAS blob_urls for ALL files (including File 1).
        # We deduplicate by name so File 1 is never OCR'd twice.
        files_to_ingest = []
        if request.blob_url and request.filename:
            files_to_ingest.append((request.blob_url, request.filename))
        if request.attachments:
            for att in request.attachments:
                if att.name != request.filename:   # skip File 1 — already added above
                    files_to_ingest.append((att.blob_url, att.name))

        if files_to_ingest:
            try:
                yield f"data: {json.dumps({'type': 'status', 'content': 'reading_document'})}\n\n"
                loop = asyncio.get_event_loop()
                all_ingested_chunks: list = []

                for ingest_url, ingest_filename in files_to_ingest:
                    pages = await loop.run_in_executor(None, lambda u=ingest_url: extract_pages_from_url(u))
                    if not pages:
                        print(f"[WARN] No pages extracted from {ingest_filename} — skipping")
                        continue

                    chunk_dicts         = chunk_by_paragraphs(pages)
                    chunks              = [c["text"] for c in chunk_dicts]
                    page_numbers_stored = [c["page_number"] for c in chunk_dicts]

                    semaphore = asyncio.Semaphore(5)
                    async def embed_one(c):
                        async with semaphore:
                            return await asyncio.get_event_loop().run_in_executor(None, lambda: embed_text(c))
                    embeddings = await asyncio.gather(*[embed_one(c) for c in chunks])

                    create_index_if_not_exists()
                    fid = str(uuid.uuid4())
                    store_chunks(
                        chunks=chunks, embeddings=embeddings,
                        user_id=request.user_id, conversation_id=conversation_id,
                        file_id=fid, filename=ingest_filename,
                        page_numbers=page_numbers_stored,
                    )
                    print(f"[DEBUG-INGESTION] Indexed {len(chunks)} chunks from '{ingest_filename}'")
                    all_ingested_chunks.extend(chunks)

                if all_ingested_chunks:
                    # ── Retrieval AFTER all files stored so every file's chunks are findable ──
                    total = len(all_ingested_chunks)
                    tk = total if scope == "document" else min(total, 20)
                    q_emb = embed_query(q_text)
                    use_hybrid_post = bool(keywords) or query_type in ("formula", "definition", "list", "specific")
                    active_chunks = retrieve_chunks_smart(
                        query_embedding=q_emb,
                        user_id=request.user_id,
                        conversation_id=conversation_id,
                        keywords=keywords if use_hybrid_post else None,
                        page_numbers=page_numbers if page_numbers else None,
                        top_k=tk,
                        use_hybrid=use_hybrid_post,
                    )
                    print(f"[DEBUG-RETRIEVAL] post-ingestion chunks retrieved: {len(active_chunks)}")

                    # Sort by page and tag each chunk with [Page N]
                    active_chunks = _tag_chunks_with_pages(active_chunks)

                # Save a confirmation message listing ALL ingested files
                all_names = ", ".join(f"**{fname}**" for _, fname in files_to_ingest)
                try:
                    await save_message(
                        conversation_id=conversation_id,
                        user_id=request.user_id,
                        role="assistant",
                        content=(
                            f"📎 I've processed {all_names} ({len(all_ingested_chunks)} chunks indexed). "
                            f"You can now ask me questions about them, or generate a flowchart / diagram!"
                        ),
                    )
                except Exception:
                    pass  # Non-critical — don't fail over a Cosmos write

                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
            except Exception as e:
                import traceback
                print(f"[ERROR] Ingestion failed: {e}")
                traceback.print_exc()
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

        if intent == "web_search":
            async for evt in _dispatch_web_search(
                user_id=request.user_id,
                conversation_id=conversation_id,
                query=request.message,
                prior_messages=prior_messages,
            ):
                yield evt
            return

        # ── Regular chat ──────────────────────────────────────────────────────
        full_reply = ""
        try:
            for chunk in chat_stream(
                question=request.message,
                context_chunks=active_chunks,
                history=prior_messages,
                response_format=response_format,
                detail_level=detail_level,
                language_style=language_style,
            ):
                full_reply += chunk
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                await asyncio.sleep(0)  # flush: yield event loop control after every token
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            return

        saved = await save_message(
            conversation_id=conversation_id,
            user_id=request.user_id,
            role="assistant",
            content=full_reply,
        )
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
        filenames = get_conversation_filenames(user_id=user_id, conversation_id=conversation_id)
        filename_filter = resolve_document_filter(topic or "", filenames)

        q_emb = embed_query(topic or "key concepts and important topics")
        raw_chunks = retrieve_chunks_smart(
            query_embedding=q_emb,
            user_id=user_id,
            conversation_id=conversation_id,
            top_k=10,
            use_hybrid=bool(topic),
            keywords=[topic] if topic else None,
            filename_filter=filename_filter,
        )
        context_chunks = [text for text, *_ in raw_chunks]

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

        msg_lower = (raw_message or "").lower()
        if any(w in msg_lower for w in ("circular", "circle", "cyclic", "cycle diagram", "loop diagram")):
            layout_hint = "circular"
        elif any(w in msg_lower for w in ("horizontal", "left to right", "lr", "sideways")):
            layout_hint = "horizontal"
        elif any(w in msg_lower for w in ("vertical", "top down", "td", "top to bottom")):
            layout_hint = "vertical"
        elif any(w in msg_lower for w in ("diagonal",)):
            layout_hint = "horizontal"
        else:
            layout_hint = None

        chunks = []
        try:
            filenames = get_conversation_filenames(user_id=user_id, conversation_id=conversation_id)
            filename_filter = resolve_document_filter(effective, filenames)

            q_emb = embed_query(effective)
            raw_chunks = retrieve_chunks_smart(
                query_embedding=q_emb,
                user_id=user_id,
                conversation_id=conversation_id,
                top_k=8,
                filename_filter=filename_filter,
            )
            chunks = [text for text, *_ in raw_chunks]
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


# ── _dispatch_web_search ──────────────────────────────────────────────────────

async def _dispatch_web_search(user_id, conversation_id, query, prior_messages, update_message_id=None):
    """
    Routes to either image search or text search based on the query:

    IMAGE PATH (query asks for pictures/photos/diagrams):
      1. Calls SerpAPI google_images → returns thumbnail grid
      2. Gemini writes a one-line intro ("Here are images of X:")
      3. Emits web_search_images SSE event with image array
      4. No text sources row (images speak for themselves)

    TEXT PATH (factual / informational query):
      1. Calls SerpAPI google organic results
      2. Gemini streams a full answer from the snippets
      3. Emits web_search_sources SSE event with source chips
    """
    try:
        yield f"data: {json.dumps({'type': 'status', 'content': 'searching_web'})}\n\n"
        await asyncio.sleep(0)

        loop = asyncio.get_event_loop()

        # ── Route: video / image / text query ────────────────────────────────
        if is_video_query(query):
            # ── VIDEO PATH ────────────────────────────────────────────────────
            # Detect whether the user also wants an explanation alongside videos
            # e.g. "explain machine learning and recommend videos"
            import re as _re2
            _explain_vid_pattern = _re2.compile(
                r'\b(explain|describe|tell|what is|what are|how does|how do|'
                r'summarize|summary|detail|overview|teach|define|elaborate)\b',
                _re2.IGNORECASE,
            )
            wants_explanation = bool(_explain_vid_pattern.search(query))

            # ── Fetch videos: try YouTube Data API → SerpAPI → skip ───────────
            videos = []
            try:
                videos = await loop.run_in_executor(None, lambda: youtube_search_api(query, num_results=5))
            except Exception:
                # YouTube Data API unavailable — try SerpAPI YouTube engine
                try:
                    videos = await loop.run_in_executor(None, lambda: youtube_search(query, num_results=5))
                except Exception:
                    pass  # fall through — no videos, but we can still answer

            if wants_explanation:
                # ── EXPLAIN + VIDEOS PATH ─────────────────────────────────────
                # Run a web search for context, stream a full explanation,
                # then append video cards (if any) or source chips.
                try:
                    search_results = await loop.run_in_executor(None, lambda: web_search(query, num_results=6))
                except Exception:
                    search_results = []

                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
                await asyncio.sleep(0)

                search_context = build_search_context(search_results) if search_results else ""
                if search_context:
                    src_instr = "Use the following web search results as your primary source:\n\n" + search_context
                else:
                    src_instr = "Use your knowledge to answer."
                explain_vid_prompt = f"""You are StudyBuddy, a helpful study assistant.
The user asked: "{query}"
Give a thorough explanation of the topic. Use markdown (headings, bullet points) where helpful.
{src_instr}
At the very end of your response, add ONE short sentence like "Here are some recommended videos for [topic]:".
Do NOT add citation numbers like [1], [2].
CRITICAL: Do NOT include any URLs, hyperlinks, or markdown links (like [text](url)) anywhere in your response. Video links are displayed separately as clickable cards below."""

                from app.services.ai_service import chat_stream as _ai_stream
                full_reply = ""
                try:
                    for chunk in _ai_stream(question=query, context_chunks=[], history=[], system_prompt_override=explain_vid_prompt):
                        full_reply += chunk
                        yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                        await asyncio.sleep(0)
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                if videos:
                    yield f"data: {json.dumps({'type': 'web_search_videos', 'data': videos})}\n\n"
                    await asyncio.sleep(0)
                elif search_results:
                    yield f"data: {json.dumps({'type': 'web_search_sources', 'data': search_results})}\n\n"
                    await asyncio.sleep(0)

                new_content = json.dumps({
                    "__type": "web_search_answer",
                    "query": query, "answer": full_reply,
                    "sources": search_results if not videos else [],
                    "images": [], "videos": videos,
                })
                if update_message_id:
                    await update_message_content(conversation_id=conversation_id, user_id=user_id,
                                                 message_id=update_message_id, new_content=new_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': update_message_id})}\n\n"
                else:
                    saved_msg = await save_message(conversation_id=conversation_id, user_id=user_id,
                                                   role="assistant", content=new_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved_msg['id']})}\n\n"
                yield "data: [DONE]\n\n"
                return

            if not videos:
                # ── FALLBACK: no videos available — regular web search ─────────
                try:
                    fallback_results = await loop.run_in_executor(None, lambda: web_search(query, num_results=6))
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'content': f'Web search failed: {str(e)}'})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
                await asyncio.sleep(0)

                search_context = build_search_context(fallback_results)
                fallback_prompt = f"""You are StudyBuddy, a helpful study assistant.
The user asked: "{query}"
Use the web search results below to recommend the best learning resources for this topic.
Do NOT add citation numbers like [1], [2] — sources are shown separately.

{search_context}"""

                from app.services.ai_service import chat_stream as _ai_stream
                full_reply = ""
                try:
                    for chunk in _ai_stream(question=query, context_chunks=[], history=[], system_prompt_override=fallback_prompt):
                        full_reply += chunk
                        yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                        await asyncio.sleep(0)
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                yield f"data: {json.dumps({'type': 'web_search_sources', 'data': fallback_results})}\n\n"
                await asyncio.sleep(0)

                new_content = json.dumps({
                    "__type": "web_search_answer",
                    "query": query, "answer": full_reply,
                    "sources": fallback_results, "images": [], "videos": [],
                })
                if update_message_id:
                    await update_message_content(conversation_id=conversation_id, user_id=user_id,
                                                 message_id=update_message_id, new_content=new_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': update_message_id})}\n\n"
                else:
                    saved_msg = await save_message(conversation_id=conversation_id, user_id=user_id,
                                                   role="assistant", content=new_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved_msg['id']})}\n\n"
                yield "data: [DONE]\n\n"
                return

            # ── Videos retrieved successfully ─────────────────────────────────
            yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
            await asyncio.sleep(0)

            from app.services.ai_service import chat_stream as _ai_stream
            intro_prompt = f"""You are StudyBuddy. The user asked: "{query}"
YouTube video results are being displayed directly below your response.
Write ONE short sentence introducing what the user will see (e.g. "Here are some YouTube videos about photosynthesis:").
Do NOT list or describe the videos. Just one short intro sentence."""

            full_reply = ""
            try:
                for chunk in _ai_stream(question=query, context_chunks=[], history=[], system_prompt_override=intro_prompt):
                    full_reply += chunk
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                    await asyncio.sleep(0)
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                yield "data: [DONE]\n\n"
                return

            yield f"data: {json.dumps({'type': 'web_search_videos', 'data': videos})}\n\n"
            await asyncio.sleep(0)

            new_content = json.dumps({
                "__type": "web_search_answer",
                "query": query, "answer": full_reply,
                "sources": [], "images": [], "videos": videos,
            })
            if update_message_id:
                await update_message_content(conversation_id=conversation_id, user_id=user_id,
                                             message_id=update_message_id, new_content=new_content)
                yield f"data: {json.dumps({'type': 'message_saved', 'message_id': update_message_id})}\n\n"
            else:
                saved_msg = await save_message(conversation_id=conversation_id, user_id=user_id,
                                               role="assistant", content=new_content)
                yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved_msg['id']})}\n\n"
            yield "data: [DONE]\n\n"

        elif is_image_query(query):
            # ── IMAGE PATH ────────────────────────────────────────────────────
            # Detect whether this is a pure "show me images" request OR an
            # "explain X with images" request (needs a full text answer + images).
            # Pure image keywords: show, display, picture(s), photo(s), give me images
            # Mixed (explain+images): any query that also contains explain/tell/describe/what/how
            import re as _re
            _explain_pattern = _re.compile(
                r'\b(explain|describe|tell|what is|what are|how does|how do|summarize|'
                r'summary|detail|overview|teach|define|definition|elaborate)\b',
                _re.IGNORECASE,
            )
            wants_explanation = bool(_explain_pattern.search(query))

            # Always fetch images (used by both paths)
            try:
                images = await loop.run_in_executor(None, lambda: image_search(query, num_results=4))
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': f'Image search failed: {str(e)}'})}\n\n"
                yield "data: [DONE]\n\n"
                return

            yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
            await asyncio.sleep(0)

            from app.services.ai_service import chat_stream as _ai_stream

            if wants_explanation:
                # ── EXPLAIN + IMAGES PATH ─────────────────────────────────────
                # Do a full web search for context, then stream a complete answer,
                # then append the image grid at the end.
                try:
                    search_results = await loop.run_in_executor(None, lambda: web_search(query, num_results=6))
                except Exception:
                    search_results = []

                search_context = build_search_context(search_results) if search_results else ""
                # Build the source instruction outside the f-string (Python 3.10 forbids
                # backslashes inside f-string expressions).
                if search_context:
                    source_instruction = "Use the following web search results as your primary source:\n\n" + search_context
                else:
                    source_instruction = "Use your knowledge to answer."
                explain_prompt = f"""You are StudyBuddy, a helpful study assistant.
The user asked: "{query}"
Give a thorough explanation of the topic. Use markdown for formatting (headings, bullet points) where helpful.
{source_instruction}
At the very end of your response, add ONE short sentence like "Here are some images of [topic]:".
Do NOT add citation numbers like [1], [2]."""

                full_reply = ""
                try:
                    for chunk in _ai_stream(
                        question=query,
                        context_chunks=[],
                        history=[],
                        system_prompt_override=explain_prompt,
                    ):
                        full_reply += chunk
                        yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                        await asyncio.sleep(0)
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                yield f"data: {json.dumps({'type': 'web_search_images', 'data': images})}\n\n"
                await asyncio.sleep(0)

                new_img_explain_content = json.dumps({
                    "__type": "web_search_answer",
                    "query": query,
                    "answer": full_reply,
                    "sources": search_results,
                    "images": images,
                    "videos": [],
                })
                if update_message_id:
                    await update_message_content(conversation_id=conversation_id, user_id=user_id,
                                                 message_id=update_message_id, new_content=new_img_explain_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': update_message_id})}\n\n"
                else:
                    saved_msg = await save_message(conversation_id=conversation_id, user_id=user_id,
                                                   role="assistant", content=new_img_explain_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved_msg['id']})}\n\n"
                yield "data: [DONE]\n\n"

            else:
                # ── PURE IMAGE PATH ───────────────────────────────────────────
                # User just wants to see images — one-line intro + image grid.
                intro_prompt = f"""You are StudyBuddy. The user asked: "{query}"
Google Images results are being displayed directly below your response.
Write ONE short sentence introducing what the user will see (e.g. "Here are some images of photosynthesis:").
Do NOT describe the images. Do NOT list anything. Just one short intro sentence."""

                full_reply = ""
                try:
                    for chunk in _ai_stream(
                        question=query,
                        context_chunks=[],
                        history=[],
                        system_prompt_override=intro_prompt,
                    ):
                        full_reply += chunk
                        yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                        await asyncio.sleep(0)
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                yield f"data: {json.dumps({'type': 'web_search_images', 'data': images})}\n\n"
                await asyncio.sleep(0)

                new_img_pure_content = json.dumps({
                    "__type": "web_search_answer",
                    "query": query,
                    "answer": full_reply,
                    "sources": [],
                    "images": images,
                    "videos": [],
                })
                if update_message_id:
                    await update_message_content(conversation_id=conversation_id, user_id=user_id,
                                                 message_id=update_message_id, new_content=new_img_pure_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': update_message_id})}\n\n"
                else:
                    saved_msg = await save_message(conversation_id=conversation_id, user_id=user_id,
                                                   role="assistant", content=new_img_pure_content)
                    yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved_msg['id']})}\n\n"
                yield "data: [DONE]\n\n"

        else:
            # ── TEXT PATH ─────────────────────────────────────────────────────
            try:
                results = await loop.run_in_executor(None, lambda: web_search(query, num_results=6))
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': f'Web search failed: {str(e)}'})}\n\n"
                yield "data: [DONE]\n\n"
                return

            yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
            await asyncio.sleep(0)

            search_context = build_search_context(results)
            readable_history = []

            system_prompt = f"""You are StudyBuddy, a helpful study assistant answering ONE specific question using live web search results.

CURRENT QUESTION: "{query}"

STRICT RULES:
- Answer ONLY the question above. Do not address any other topics.
- Base your answer exclusively on the search results below — do not use prior conversation context.
- Do NOT add citation numbers like [1], [2], [3] anywhere in your answer. Sources are shown separately.
- Be comprehensive yet concise. Use markdown for formatting where appropriate.

{search_context}"""

            from app.services.ai_service import chat_stream as _ai_stream
            full_reply = ""
            try:
                for chunk in _ai_stream(
                    question=query,
                    context_chunks=[],
                    history=readable_history,
                    system_prompt_override=system_prompt,
                ):
                    full_reply += chunk
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
                    await asyncio.sleep(0)
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                yield "data: [DONE]\n\n"
                return

            yield f"data: {json.dumps({'type': 'web_search_sources', 'data': results})}\n\n"
            await asyncio.sleep(0)

            new_text_content = json.dumps({
                "__type": "web_search_answer",
                "query": query,
                "answer": full_reply,
                "sources": results,
                "images": [],
                "videos": [],
            })
            if update_message_id:
                await update_message_content(conversation_id=conversation_id, user_id=user_id,
                                             message_id=update_message_id, new_content=new_text_content)
                yield f"data: {json.dumps({'type': 'message_saved', 'message_id': update_message_id})}\n\n"
            else:
                saved_msg = await save_message(conversation_id=conversation_id, user_id=user_id,
                                               role="assistant", content=new_text_content)
                yield f"data: {json.dumps({'type': 'message_saved', 'message_id': saved_msg['id']})}\n\n"
            yield "data: [DONE]\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'Web search dispatch failed: {str(e)}'})}\n\n"
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

    # Strip code blocks and math expressions — Azure Speech chokes on both
    clean_text = re.sub(r"```[\s\S]*?```", "", text)   # fenced code
    clean_text = re.sub(r"\\\[[\s\S]*?\\\]", "", clean_text)  # \[...\] display math
    clean_text = re.sub(r"\\\([\s\S]*?\\\)", "", clean_text)  # \(...\) inline math
    clean_text = re.sub(r"\$\$[\s\S]*?\$\$", "", clean_text)    # $$...$$ display math
    clean_text = re.sub(r"\$[^\$\r\n]+\$", "", clean_text)       # $...$ inline math
    clean_text = re.sub(r"\*\*(.*?)\*\*", r"\1", clean_text)
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