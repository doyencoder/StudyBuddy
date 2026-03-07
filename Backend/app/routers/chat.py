import io
import json
import re
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from app.models import ChatRequest, ChatHistoryResponse, ChatMessage
from app.services.gemini_service import embed_query, chat_stream, infer_topic_from_messages, embed_text
from app.services.search_service import retrieve_chunks, store_chunks, create_index_if_not_exists
from app.services.doc_intelligence_service import extract_text_from_url
from app.utils.chunking import chunk_text
from app.services.cosmos_service import (
    create_conversation,
    save_message,
    get_messages,
    list_conversations,
)
import uuid
from app.services.translator_service import translate_text
from app.services.tts_service import synthesize_speech
router = APIRouter(prefix="/chat", tags=["Chat"])


# ── Request models ────────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text: str
    target_language: str   # one of: en, hi, mr, ta, te, bn, gu, kn


class TTSRequest(BaseModel):
    text: str
    language: str          # one of: en, hi, mr, ta, te, bn, gu, kn
    voice_style: str = "buttery"  # one of: buttery, airy, mellow, glassy, rounded


class InferTopicRequest(BaseModel):
    messages: List[dict]   # [{"role": "user"|"assistant", "content": "..."}]


# ── POST /chat/message ────────────────────────────────────────────────────────

@router.post("/message")
async def chat_message(request: ChatRequest):
    """
    Main chat endpoint. Accepts a user message and streams back the AI reply.

    Flow:
      1. Create a new conversation if none exists yet.
      2. Save the user's message to Cosmos DB.
      3. Embed the user's question using Gemini.
      4. Retrieve the top-5 relevant chunks from Azure AI Search,
         scoped strictly to this conversation_id so files from other
         chats are never mixed in.
      5. Stream Gemini's reply back to the frontend as SSE.
      6. Once streaming is complete, save the full AI reply to Cosmos DB.

    Returns:
        A Server-Sent Events stream (text/event-stream).
        Each event is:  data: {"type": "text", "content": "..."}
        Final event is: data: [DONE]
        On error:       data: {"type": "error", "content": "..."}
    """

    conversation_id = request.conversation_id
    if not conversation_id:
        conversation_id = await create_conversation(request.user_id)

    # Fetch prior history BEFORE saving the new user message so the history
    # list contains only the previous turns — the current question is passed
    # separately as `question` and appended last inside chat_stream().
    prior_messages = await get_messages(conversation_id)

    # If attachments are present, persist them as JSON so history can restore them
    if request.attachments:
        user_content = json.dumps({
            "__type": "user_with_attachments",
            "text": request.message,
            "attachments": [
                {"name": a.name, "blob_url": a.blob_url, "file_type": a.file_type}
                for a in request.attachments
            ]
        })
    else:
        user_content = request.message

    await save_message(
        conversation_id=conversation_id,
        user_id=request.user_id,
        role="user",
        content=user_content,
    )

    try:
        query_embedding = embed_query(request.message)
        context_chunks = retrieve_chunks(
            query_embedding=query_embedding,
            user_id=request.user_id,
            conversation_id=conversation_id,
            top_k=5,
        )
        # If the strict 0.75 search found nothing, retry with a more lenient
        # 0.5 threshold. This handles vague questions like "what are the main
        # topics?" whose embeddings don't score high against specific document
        # content. Safe to always attempt because conversation_id scoping
        # ensures we only ever search this conversation's own uploaded files —
        # if no files were uploaded both searches return empty anyway.
        if not context_chunks:
            context_chunks = retrieve_chunks(
                query_embedding=query_embedding,
                user_id=request.user_id,
                conversation_id=conversation_id,
                top_k=5,
                score_threshold=0.5,
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"RAG retrieval failed: {str(e)}",
        )

    async def event_stream():
        full_reply = ""
        active_context_chunks = context_chunks

        meta = json.dumps({"type": "meta", "conversation_id": conversation_id})
        yield f"data: {meta}\n\n"

        # ── If a blob_url is attached, run full RAG pipeline now ─────────────
        if request.blob_url and request.filename:
            try:
                yield f"data: {json.dumps({'type': 'status', 'content': 'reading_document'})}\n\n"

                extracted_text = extract_text_from_url(request.blob_url)
                if extracted_text.strip():
                    chunks = chunk_text(extracted_text)
                    embeddings = [embed_text(chunk) for chunk in chunks]
                    create_index_if_not_exists()
                    file_id = str(uuid.uuid4())
                    store_chunks(
                        chunks=chunks,
                        embeddings=embeddings,
                        user_id=request.user_id,
                        conversation_id=conversation_id,
                        file_id=file_id,
                        filename=request.filename,
                    )
                    # Re-retrieve now that chunks are indexed
                    q_emb = embed_query(request.message)
                    active_context_chunks = retrieve_chunks(q_emb, request.user_id, conversation_id, top_k=5)
                    if not active_context_chunks:
                        active_context_chunks = retrieve_chunks(q_emb, request.user_id, conversation_id, top_k=5, score_threshold=0.5)

                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'status', 'content': 'done'})}\n\n"

        try:
            for chunk in chat_stream(
                question=request.message,
                context_chunks=active_context_chunks,
                history=prior_messages,
            ):
                full_reply += chunk
                payload = json.dumps({"type": "text", "content": chunk})
                yield f"data: {payload}\n\n"

        except Exception as e:
            error_payload = json.dumps({"type": "error", "content": str(e)})
            yield f"data: {error_payload}\n\n"
            return

        await save_message(
            conversation_id=conversation_id,
            user_id=request.user_id,
            role="assistant",
            content=full_reply,
        )

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── GET /chat/history/{conversation_id} ───────────────────────────────────────

@router.get("/history/{conversation_id}", response_model=ChatHistoryResponse)
async def chat_history(conversation_id: str):
    """
    Returns the full message history for a given conversation.
    """
    try:
        raw_messages = await get_messages(conversation_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch chat history: {str(e)}",
        )

    if not raw_messages:
        raise HTTPException(
            status_code=404,
            detail=f"No conversation found with id '{conversation_id}'.",
        )

    messages = [
        ChatMessage(
            id=m["id"],
            role=m["role"],
            content=m["content"],
            timestamp=m["timestamp"],
        )
        for m in raw_messages
    ]

    return ChatHistoryResponse(
        conversation_id=conversation_id,
        messages=messages,
    )



# ── GET /chat/conversations ───────────────────────────────────────────────────

@router.get("/conversations")
async def get_conversations(user_id: str = Query(...)):
    """
    Returns all conversations for a user, newest first.
    Uses the first user message as the conversation title.
    """
    try:
        raw = await list_conversations(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch conversations: {str(e)}")

    conversations = []
    for conv in raw:
        messages = conv.get("messages", [])
        # Find the first message sent by the user
        first_user_msg = next(
            (m for m in messages if m.get("role") == "user"), None
        )
        # Use first 45 chars of that message as the title
        if first_user_msg:
            raw_title = first_user_msg.get("content", "Untitled Chat")
            # If content is a user_with_attachments JSON, extract just the text
            try:
                if '"__type"' in raw_title and '"user_with_attachments"' in raw_title:
                    parsed = json.loads(raw_title)
                    raw_title = parsed.get("text", "") or parsed.get("attachments", [{}])[0].get("name", "Untitled Chat")
            except Exception:
                pass
            title = raw_title[:45] + ("..." if len(raw_title) > 45 else "")
        elif conv.get("title"):
            title = conv["title"]
        else:
            title = "New Conversation"

        conversations.append({
            "conversation_id": conv.get("conversation_id"),
            "title": title,
            "created_at": conv.get("created_at", ""),
        })

    return {"conversations": conversations}


# ── POST /chat/translate ───────────────────────────────────────────────────────

@router.post("/translate")
async def translate_message(request: TranslateRequest):
    """
    Translates a chat message into the requested language using Azure Translator.
    Fast, non-streaming — returns immediately.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    try:
        translated = translate_text(
            text=request.text,
            target_language=request.target_language,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {"translated_text": translated, "target_language": request.target_language}


# ── POST /chat/tts ────────────────────────────────────────────────────────────

@router.post("/tts")
async def text_to_speech(request: TTSRequest):
    """
    Converts text to speech using Azure Neural TTS and returns raw MP3 bytes.

    Why this exists instead of using the browser's Web Speech API:
      - window.speechSynthesis has NO reliable Indian-language voices on most
        desktops/laptops. When a user translates a message to Hindi/Tamil/etc.
        and then clicks Audio, the browser silently fails — it gets Devanagari
        or Tamil script but has no voice that can pronounce it.
      - Azure Neural TTS has dedicated high-quality voices for all 8 languages
        we support. Audio is always generated server-side and returned as MP3,
        which every browser can play via new Audio(objectURL).

    The frontend strips markdown before calling this endpoint.
    Returns: audio/mpeg stream (MP3 bytes).
    """
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    # Extra safety: strip any residual markdown that slipped through
    clean_text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)       # **bold**
    clean_text = re.sub(r"\*(.*?)\*",     r"\1", clean_text)  # *italic*
    clean_text = re.sub(r"`(.*?)`",       r"\1", clean_text)  # `code`
    clean_text = re.sub(r"#{1,6}\s",      "",    clean_text)  # headings
    clean_text = re.sub(r"[-*]\s",        "",    clean_text)  # list bullets
    clean_text = clean_text.strip()

    if not clean_text:
        raise HTTPException(status_code=400, detail="No speakable text after cleaning.")

    try:
        mp3_bytes = synthesize_speech(
            text=clean_text,
            language=request.language,
            voice_style=request.voice_style,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return StreamingResponse(
        io.BytesIO(mp3_bytes),
        media_type="audio/mpeg",
        headers={
            # Tell the browser it can play immediately without waiting for full download
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        },
    )


# ── POST /chat/infer-topic ────────────────────────────────────────────────────

@router.post("/infer-topic")
async def infer_topic(request: InferTopicRequest):
    """
    Given recent conversation messages, asks Gemini to extract a clean
    3-5 word topic that best describes what the student was studying.
    Used by the frontend when the user triggers diagram generation
    mid-conversation without specifying a topic.
    """
    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages provided.")

    try:
        topic = infer_topic_from_messages(request.messages)
        return {"topic": topic}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Topic inference failed: {str(e)}")