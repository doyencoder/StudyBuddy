"""
diagrams.py
Handles generation and history of Mermaid-based flowcharts and concept diagrams.

Endpoints:
  POST /diagrams/generate   → generate a Mermaid diagram grounded in uploaded material
  GET  /diagrams/history    → list all diagrams for a user (feeds ImagesPage)
"""

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    DiagramGenerateRequest,
    DiagramGenerateResponse,
    DiagramHistoryResponse,
    DiagramHistoryItem,
    ImageGenerateRequest,
    ImageGenerateResponse,
)
from app.services.gemini_service import embed_query, generate_mermaid, generate_image
from app.services.search_service import retrieve_chunks
from app.services.blob_service import upload_generated_image_to_blob
from app.services.cosmos_service import save_diagram, save_image_diagram, list_diagrams

router = APIRouter(prefix="/diagrams", tags=["diagrams"])

VALID_TYPES = {"flowchart", "diagram"}


@router.post("/generate", response_model=DiagramGenerateResponse)
async def generate_diagram(req: DiagramGenerateRequest):
    """
    Generates a Mermaid flowchart or concept diagram for the given topic.

    If conversation_id is provided:
      - Searches for relevant chunks from that chat's uploaded documents
      - If relevant chunks found → diagram is grounded in those docs
      - If no relevant chunks found (e.g. unrelated topic) → falls back to general knowledge

    If no conversation_id:
      - Skips chunk retrieval entirely → uses Gemini general knowledge
    """

    diagram_type = req.diagram_type.lower()
    if diagram_type not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid diagram_type '{req.diagram_type}'. Must be: {VALID_TYPES}",
        )

    # Step 1 — retrieve relevant chunks only if a conversation exists
    chunks = []
    if req.conversation_id:
        try:
            query_embedding = embed_query(req.topic)
            chunks = retrieve_chunks(
                query_embedding=query_embedding,
                user_id=req.user_id,
                conversation_id=req.conversation_id,
                top_k=8,
                score_threshold=0.5,   # lower threshold = broader coverage
            )
            # chunks will be empty list if no relevant docs found —
            # generate_mermaid handles this by falling back to general knowledge
        except Exception as e:
            # Don't fail the whole request — just proceed without context
            print(f"[Diagrams] Chunk retrieval failed, using general knowledge: {e}")
            chunks = []

    # Step 2 — generate Mermaid syntax via Gemini
    # If chunks is empty (no docs or unrelated docs), Gemini uses general knowledge
    try:
        mermaid_code = generate_mermaid(
            topic=req.topic,
            diagram_type=diagram_type,
            context_chunks=chunks,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diagram generation failed: {str(e)}")

    if not mermaid_code or len(mermaid_code.strip()) < 10:
        raise HTTPException(status_code=500, detail="Gemini returned an empty diagram. Please try again.")

    # Step 3 — save to Cosmos DB (diagrams container, independent of conversation)
    try:
        saved = await save_diagram(
            user_id=req.user_id,
            conversation_id=req.conversation_id or "no-conversation",
            diagram_type=diagram_type,
            topic=req.topic,
            mermaid_code=mermaid_code,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save diagram: {str(e)}")

    return DiagramGenerateResponse(
        diagram_id=saved["diagram_id"],
        type=saved["type"],
        topic=saved["topic"],
        mermaid_code=saved["mermaid_code"],
        created_at=saved["created_at"],
    )


@router.get("/history", response_model=DiagramHistoryResponse)
async def diagram_history(user_id: str = Query(...)):
    """Returns all diagrams for a user, newest first. Used by ImagesPage."""
    try:
        raw = await list_diagrams(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch diagram history: {str(e)}")

    return DiagramHistoryResponse(
        diagrams=[
            DiagramHistoryItem(
                diagram_id=d["diagram_id"],
                type=d["type"],
                topic=d["topic"],
                mermaid_code=d.get("mermaid_code", ""),
                image_url=d.get("image_url"),
                created_at=d["created_at"],
                conversation_id=d["conversation_id"],
            )
            for d in raw
        ]
    )

@router.post("/generate-image", response_model=ImageGenerateResponse)
async def generate_diagram_image(req: ImageGenerateRequest):
    """
    Generates a real AI image for a study topic using Imagen 3.

    If conversation_id is provided:
      - Searches for relevant chunks from uploaded documents
      - If chunks found → image prompt is grounded in that material
      - If no chunks → falls back to Gemini general knowledge

    If no conversation_id:
      - Skips retrieval, generates from general knowledge

    Flow:
      1. Retrieve relevant chunks (optional)
      2. generate_image() → Imagen 3 → raw PNG bytes
      3. upload_generated_image_to_blob() → Azure Blob → 30-day SAS URL
      4. save_image_diagram() → Cosmos diagrams container
      5. Return ImageGenerateResponse with image_url
    """

    # Step 1 — retrieve relevant chunks if conversation exists
    chunks = []
    if req.conversation_id:
        try:
            query_embedding = embed_query(req.topic)
            chunks = retrieve_chunks(
                query_embedding=query_embedding,
                user_id=req.user_id,
                conversation_id=req.conversation_id,
                top_k=3,
                score_threshold=0.5,
            )
        except Exception as e:
            print(f"[DiagramImage] Chunk retrieval failed, using general knowledge: {e}")
            chunks = []

    # Step 2 — generate image bytes via Imagen 3
    try:
        image_bytes = generate_image(topic=req.topic, context_chunks=chunks)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)}")

    # Step 3 — upload to Azure Blob Storage
    try:
        blob_result = upload_generated_image_to_blob(
            image_bytes=image_bytes,
            topic=req.topic,
            user_id=req.user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")

    # Step 4 — save to Cosmos DB
    try:
        saved = await save_image_diagram(
            user_id=req.user_id,
            conversation_id=req.conversation_id or "no-conversation",
            topic=req.topic,
            image_url=blob_result["blob_url"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save image record: {str(e)}")

    return ImageGenerateResponse(
        diagram_id=saved["diagram_id"],
        type="image",
        topic=saved["topic"],
        image_url=saved["image_url"],
        created_at=saved["created_at"],
    )
