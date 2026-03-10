"""
upload.py
POST /upload/file  — Full RAG ingestion pipeline:
  1. Upload file to Azure Blob Storage
  2. Extract text via Azure Document Intelligence
  3. Chunk the text (500 words, 50 overlap)
  4. Embed each chunk with Gemini gemini-embedding-001
  5. Store embeddings in Azure AI Search (scoped to conversation_id)
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import RedirectResponse
from app.models import UploadResponse
from app.services.blob_service import upload_file_to_blob, generate_fresh_sas_url
from app.services.doc_intelligence_service import extract_text_from_url
from app.services.gemini_service import embed_text
from app.services.search_service import store_chunks, create_index_if_not_exists
from app.utils.chunking import chunk_text
from app.services.cosmos_service import ensure_conversation, save_message

router = APIRouter(prefix="/upload", tags=["Upload"])


@router.get("/view-file")
async def view_file(blob_name: str = Query(..., description="Permanent blob path stored at upload time")):
    """
    Permanent file-access proxy.

    Generates a fresh 1-hour SAS URL on-demand and redirects the browser to it.
    Because this endpoint URL never changes (only the SAS it generates does),
    files stored in Cosmos DB remain openable forever — no matter how old they are.

    The browser follows the 302 redirect transparently, so the user just sees
    their file open normally.
    """
    try:
        fresh_sas_url = generate_fresh_sas_url(blob_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not generate file URL: {str(e)}")
    return RedirectResponse(url=fresh_sas_url, status_code=302)


@router.post("/blob-only")
async def upload_blob_only(
    file: UploadFile = File(...),
    user_id: str = Form(...),
):
    """
    Lightweight upload — stores file in Azure Blob only.
    Returns blob_url immediately. No text extraction or indexing.
    The full RAG pipeline runs later inside /chat/message when the user sends their query.
    """
    filename = file.filename or "upload"
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '.{extension}' not supported.")

    file_bytes = await file.read()
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail=f"File size {size_mb:.1f} MB exceeds {MAX_FILE_SIZE_MB} MB limit.")

    try:
        blob_info = upload_file_to_blob(file_bytes, filename, user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Blob upload failed: {str(e)}")

    return {
        "blob_url": blob_info["blob_url"],    # short-lived SAS — frontend uses for immediate RAG
        "blob_name": blob_info["blob_name"],  # permanent identifier — frontend uses for proxy URL
        "filename": filename,
    }

ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "webp", "tiff"}
MAX_FILE_SIZE_MB = 20


@router.post("/file", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    conversation_id: str = Form(default="no-conversation"),
):
    """
    Upload a study document and run the full RAG pipeline.

    - Accepts: PDF, PNG, JPG, JPEG, WEBP, TIFF (max 20 MB)
    - conversation_id scopes the stored chunks to this chat session only,
      so files from other chats are never mixed in during retrieval.
    - Returns: file_id, blob_url, number of chunks indexed
    """

    # ── Validate file type ────────────────────────────────────────────────────
    filename = file.filename or "upload"
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{extension}' is not supported. "
                   f"Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # ── Read file bytes ───────────────────────────────────────────────────────
    file_bytes = await file.read()

    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=400,
            detail=f"File size {size_mb:.1f} MB exceeds the {MAX_FILE_SIZE_MB} MB limit.",
        )

    # ── Step 1: Upload to Azure Blob Storage ─────────────────────────────────
    try:
        blob_info = upload_file_to_blob(file_bytes, filename, user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Blob upload failed: {str(e)}")

    blob_url = blob_info["blob_url"]
    file_id  = blob_info["file_id"]

    # ── Step 2: Extract text via Document Intelligence ────────────────────────
    try:
        extracted_text = extract_text_from_url(blob_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text extraction failed: {str(e)}")

    if not extracted_text.strip():
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted from the uploaded file. "
                   "Please check the file is readable.",
        )

    # ── Step 3: Chunk the text ────────────────────────────────────────────────
    chunks = chunk_text(extracted_text)

    # ── Step 4: Embed each chunk with Gemini ─────────────────────────────────
    try:
        embeddings = [embed_text(chunk) for chunk in chunks]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {str(e)}")

    # ── Step 5: Store in Azure AI Search ─────────────────────────────────────
    try:
        create_index_if_not_exists()
        store_chunks(
            chunks=chunks,
            embeddings=embeddings,
            user_id=user_id,
            conversation_id=conversation_id,
            file_id=file_id,
            filename=filename,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search indexing failed: {str(e)}")

    # ── Persist upload confirmation to Cosmos so it survives page refresh ───
    if conversation_id and conversation_id != "no-conversation":
        try:
            await ensure_conversation(
                user_id=user_id,
                conversation_id=conversation_id,
                title="",  # let chat.py title logic use first user message naturally
            )
            await save_message(
                conversation_id=conversation_id,
                user_id=user_id,
                role="assistant",
                content=(
                    f"📎 I\'ve processed **{filename}** ({len(chunks)} chunks indexed). "
                    f"You can now ask me questions about it, or generate a flowchart / diagram from it!"
                ),
            )
        except Exception:
            pass  # Non-critical — don\'t fail the upload over a Cosmos write

    return UploadResponse(
        file_id=file_id,
        filename=filename,
        blob_url=blob_url,
        chunks_stored=len(chunks),
        message=f"Successfully processed \'{filename}\' — {len(chunks)} chunks indexed.",
    )