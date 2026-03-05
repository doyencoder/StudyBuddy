import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models import ChatRequest, ChatHistoryResponse, ChatMessage
from app.services.gemini_service import embed_query, chat_stream
from app.services.search_service import retrieve_chunks
from app.services.cosmos_service import (
    create_conversation,
    save_message,
    get_messages,
)

router = APIRouter(prefix="/chat", tags=["Chat"])


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

    # ── Step 1: Resolve conversation ID ──────────────────────────────────────
    conversation_id = request.conversation_id
    if not conversation_id:
        conversation_id = await create_conversation(request.user_id)

    # ── Step 2: Save user message to Cosmos DB ────────────────────────────────
    await save_message(
        conversation_id=conversation_id,
        user_id=request.user_id,
        role="user",
        content=request.message,
    )

    # ── Step 3 & 4: Embed query + retrieve relevant chunks ───────────────────
    # retrieve_chunks filters by BOTH user_id AND conversation_id —
    # this ensures only files uploaded in this specific chat are used.
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

    # ── Step 5 & 6: Stream Gemini reply + save to Cosmos DB ──────────────────
    async def event_stream():
        full_reply = ""

        # Always send conversation_id first so the frontend can track it.
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