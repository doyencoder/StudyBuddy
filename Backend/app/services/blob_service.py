"""
blob_service.py
Handles uploading files to Azure Blob Storage and returns the blob URL.
"""

import os
import uuid
from datetime import datetime, timezone, timedelta
from azure.storage.blob import BlobServiceClient, ContentSettings, generate_blob_sas, BlobSasPermissions


def get_blob_client() -> BlobServiceClient:
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not connection_string:
        raise ValueError("AZURE_STORAGE_CONNECTION_STRING is not set in .env")
    return BlobServiceClient.from_connection_string(connection_string)


def upload_file_to_blob(file_bytes: bytes, original_filename: str, user_id: str) -> dict:
    """
    Upload a file to Azure Blob Storage.

    Args:
        file_bytes:         Raw bytes of the uploaded file.
        original_filename:  Original file name (e.g. "notes.pdf").
        user_id:            The user who owns the file.

    Returns:
        dict with keys: file_id, blob_name, blob_url
    """
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "studybuddy-files")

    # Unique blob name: user_id/uuid_originalname  (keeps files organised per user)
    file_id = str(uuid.uuid4())
    extension = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "bin"
    blob_name = f"{user_id}/{file_id}_{original_filename}"

    # Determine content type for the blob
    content_type_map = {
        "pdf":  "application/pdf",
        "png":  "image/png",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "tiff": "image/tiff",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    content_type = content_type_map.get(extension, "application/octet-stream")

    client = get_blob_client()
    container_client = client.get_container_client(container_name)

    blob_client = container_client.get_blob_client(blob_name)
    blob_client.upload_blob(
        file_bytes,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )

    # Generate a SAS URL valid for 1 hour so Document Intelligence can download it
    # (needed because anonymous blob access is disabled)
    service_client = get_blob_client()
    account_name = service_client.account_name
    account_key = service_client.credential.account_key

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    sas_url = f"https://{account_name}.blob.core.windows.net/{container_name}/{blob_name}?{sas_token}"

    return {
        "file_id": file_id,
        "blob_name": blob_name,
        "blob_url": sas_url,
    }

def upload_generated_image_to_blob(image_bytes: bytes, topic: str, user_id: str) -> dict:
    """
    Uploads an AI-generated image (PNG bytes) to Azure Blob Storage.
    Uses a 30-day SAS URL so the image stays visible in the UI.
    Unlike document uploads (1hr SAS), generated images need to persist
    for the user to view them in the Images page long-term.

    Returns:
        dict with keys: image_id, blob_name, blob_url
    """
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "studybuddy-files")

    image_id = str(uuid.uuid4())
    safe_topic = topic.replace(" ", "_").replace("/", "-")[:40]
    blob_name = f"{user_id}/generated_images/{image_id}_{safe_topic}.png"

    client = get_blob_client()
    container_client = client.get_container_client(container_name)

    blob_client = container_client.get_blob_client(blob_name)
    blob_client.upload_blob(
        image_bytes,
        overwrite=True,
        content_settings=ContentSettings(content_type="image/png"),
    )

    # 30-day SAS URL — long enough for practical use while still being safe
    service_client = get_blob_client()
    account_name = service_client.account_name
    account_key = service_client.credential.account_key

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(days=30),
    )

    sas_url = f"https://{account_name}.blob.core.windows.net/{container_name}/{blob_name}?{sas_token}"

    return {
        "image_id": image_id,
        "blob_name": blob_name,
        "blob_url": sas_url,
    }
