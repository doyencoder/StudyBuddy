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
        # Backdate start by 5 min to neutralise any server clock-skew
        start=datetime.now(timezone.utc) - timedelta(minutes=5),
        expiry=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    sas_url = f"https://{account_name}.blob.core.windows.net/{container_name}/{blob_name}?{sas_token}"

    return {
        "file_id": file_id,
        "blob_name": blob_name,   # permanent identifier — used by /upload/view-file proxy
        "blob_url": sas_url,      # short-lived SAS — used immediately for Doc Intelligence
    }

def generate_fresh_sas_url(blob_name: str) -> str:
    """
    Generates a brand-new short-lived SAS URL for an existing blob.
    Called on-demand by the /upload/view-file proxy endpoint so that
    stored files can always be opened regardless of when they were uploaded.

    Args:
        blob_name: The permanent blob path (e.g. "student-001/uuid_notes.pdf")

    Returns:
        A fresh SAS URL valid for 1 hour.
    """
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "studybuddy-files")
    service_client = get_blob_client()
    account_name = service_client.account_name
    account_key = service_client.credential.account_key

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        # Backdate start by 5 min to neutralise any server clock-skew
        start=datetime.now(timezone.utc) - timedelta(minutes=5),
        expiry=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    return f"https://{account_name}.blob.core.windows.net/{container_name}/{blob_name}?{sas_token}"


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


def delete_blob_by_url(sas_url: str) -> None:
    """
    Deletes a blob given its SAS URL.
    Parses the blob name out of the URL path and issues a delete.
    Raises on failure — callers should catch and treat as non-fatal.

    Expected URL format:
        https://{account}.blob.core.windows.net/{container}/{blob_name}?{sas_token}
    """
    from urllib.parse import urlparse

    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "studybuddy-files")
    parsed = urlparse(sas_url)
    # parsed.path = "/{container}/{blob_name...}"
    path_without_leading_slash = parsed.path.lstrip("/")
    # Split off the container prefix, keep everything else as the blob name
    parts = path_without_leading_slash.split("/", 1)
    if len(parts) < 2:
        raise ValueError(f"Cannot parse blob name from URL: {sas_url}")
    blob_name = parts[1]

    client = get_blob_client()
    container_client = client.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)
    blob_client.delete_blob()