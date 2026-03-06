import io
import json
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from app.models import ChatRequest, ChatHistoryResponse, ChatMessage
from app.services.gemini_service import embed_query, chat_stream, infer_topic_from_messages
from app.services.search_service import retrieve_chunks
from app.services.cosmos_service import (
    create_conversation,
    save_message,
    get_messages,
)
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

    await save_message(
        conversation_id=conversation_id,
        user_id=request.user_id,
        role="user",
        content=request.message,
    )

    try:
        query_embedding = embed_query(request.message)
        context_chunks = retrieve_chunks(
            query_embedding=query_embedding,
            user_id=request.user_id,
            conversation_id=conversation_id,
            top_k=5,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"RAG retrieval failed: {str(e)}",
        )

    async def event_stream():
        full_reply = ""

        meta = json.dumps({"type": "meta", "conversation_id": conversation_id})
        yield f"data: {meta}\n\n"

        try:
            for chunk in chat_stream(
                question=request.message,
                context_chunks=context_chunks,
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
        mp3_bytes = synthesize_speech(text=clean_text, language=request.language)
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