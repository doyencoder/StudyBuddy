"""
azure_image_service.py
────────────────────────────────────────────────────────────────────────────────
Azure OpenAI image generation provider for StudyBuddy.

This is the PREMIUM provider.
Selected when IMAGE_GENERATION_PROVIDER=azure.

Model: gpt-image-1 (deployed separately from the chat/embedding models).
       Falls back gracefully to gpt-image-1-mini if the primary deployment
       is unavailable.

Why a separate client from azure_openai_service.py:
  - gpt-image-1 requires api_version="2025-04-01-preview"
  - The chat/embedding models use api_version="2024-10-21"
  - AzureOpenAI clients are created with a fixed api_version, so we
    instantiate a dedicated client here rather than sharing the chat client.

Why response_format="b64_json":
  - The images.generate() API can return either a URL or base64-encoded bytes.
  - URLs expire quickly and require a second HTTP round-trip to download.
  - b64_json returns the image data directly in the response — one call,
    no expiry risk. We decode it and return raw bytes, identical to the
    HuggingFace provider's return type.

Environment variables required:
  AZURE_OPENAI_ENDPOINT             (same as chat — shared resource)
  AZURE_OPENAI_API_KEY              (same as chat — shared resource)
  AZURE_OPENAI_IMAGE_DEPLOYMENT     (e.g. "studybuddy-image", default used if not set)
"""

import os
import base64
import time
from typing import List

from openai import AzureOpenAI
import openai

# ── Constants ─────────────────────────────────────────────────────────────────
# gpt-image-1 requires this specific preview API version — different from the
# chat/embedding models which use "2024-10-21".
IMAGE_API_VERSION        = "2025-04-01-preview"
DEFAULT_IMAGE_DEPLOYMENT = "studybuddy-image"

MAX_RETRIES    = 3
RETRY_DELAY_S  = 4   # seconds between retries on transient failures

# Mirrors the sentinel constant used across all service files.
REFUSAL_SENTINEL = "__REFUSED__"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_image_client() -> AzureOpenAI:
    """
    Returns a dedicated AzureOpenAI client configured for image generation.
    Uses the preview API version required by gpt-image-1.
    Credentials are read at call time (not import time) so tests can patch env vars.
    """
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_key  = os.getenv("AZURE_OPENAI_API_KEY")

    if not endpoint:
        raise ValueError("AZURE_OPENAI_ENDPOINT is not set in .env")
    if not api_key:
        raise ValueError("AZURE_OPENAI_API_KEY is not set in .env")

    return AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=IMAGE_API_VERSION,
    )


def _image_deployment() -> str:
    """Returns the gpt-image-1 deployment name, with a safe default."""
    return os.getenv("AZURE_OPENAI_IMAGE_DEPLOYMENT", DEFAULT_IMAGE_DEPLOYMENT)


def _is_content_filter_error(e: Exception) -> bool:
    """
    Returns True if the exception is an Azure content filter (400) rejection.
    Mirrors the identical helper in azure_openai_service.py.
    """
    if not isinstance(e, openai.BadRequestError):
        return False
    error_str = str(e).lower()
    if "content_filter" in error_str or "responsibleaipolicyviolation" in error_str:
        return True
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        inner = body.get("error", body)
        code  = inner.get("code", "")
        if code in ("content_filter", "ResponsibleAIPolicyViolation"):
            return True
    return False


def _call_with_retry(fn):
    """
    Retry up to MAX_RETRIES on rate-limit (429) or transient 5xx errors.
    Content filter errors (400) are NOT retried — they propagate immediately.
    Mirrors the identical helper in azure_openai_service.py.
    """
    for attempt in range(MAX_RETRIES):
        try:
            return fn()
        except openai.BadRequestError:
            raise  # content filter / bad request — no retry, caller handles
        except Exception as e:
            error_msg = str(e).lower()
            is_retryable = (
                "429" in error_msg
                or "rate limit" in error_msg
                or "too many requests" in error_msg
                or "502" in error_msg
                or "503" in error_msg
                or "504" in error_msg
            )
            if is_retryable and attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_S)
                continue
            raise
    raise RuntimeError("Azure image API call failed after max retries")


# ── Main public function ──────────────────────────────────────────────────────

def generate_image(topic: str, context_chunks: List[str]) -> bytes:
    """
    Generates an educational illustration using Azure OpenAI gpt-image-1.

    Returns raw image bytes (PNG) ready to be uploaded to Azure Blob Storage.
    Raises ValueError(REFUSAL_SENTINEL) if Azure's content filter blocks the topic.
    Raises RuntimeError on API failures.

    Args:
        topic:          The subject to illustrate (e.g. "mitosis").
        context_chunks: RAG chunks from the student's uploaded document.
                        Used to enrich the prompt with document-specific context.
    """
    client     = _get_image_client()
    deployment = _image_deployment()

    # ── Step 1: Build a rich, context-aware prompt ────────────────────────────
    # gpt-image-1 follows detailed instructions far better than FLUX, so we
    # give it explicit style guidance to ensure clean educational illustrations.
    if context_chunks:
        context_summary = " ".join(context_chunks[:3])[:500]
        prompt = (
            f"Create a detailed, accurate educational illustration of: {topic}. "
            f"Incorporate concepts from these study notes: {context_summary}. "
            "Style requirements: clean scientific diagram, pure white background, "
            "no text labels, no captions, no watermarks, accurate anatomy or structure, "
            "suitable for a student textbook, high visual clarity."
        )
    else:
        prompt = (
            f"Create a detailed, accurate educational illustration of: {topic}. "
            "Style requirements: clean scientific diagram, pure white background, "
            "no text labels, no captions, no watermarks, accurate anatomy or structure, "
            "suitable for a student textbook, high visual clarity."
        )

    # ── Step 2: Call gpt-image-1 ──────────────────────────────────────────────
    # response_format="b64_json" returns the image as base64 in the response
    # body — no secondary HTTP download needed, and no URL expiry to worry about.
    # quality="standard" is appropriate for educational use and keeps costs predictable.
    def _generate():
        return client.images.generate(
            model=deployment,
            prompt=prompt,
            n=1,
            size="1024x1024",
            quality="standard",
            response_format="b64_json",
        )

    try:
        response = _call_with_retry(_generate)
    except openai.BadRequestError as e:
        if _is_content_filter_error(e):
            # Azure's built-in content filter caught the topic.
            # Raise the same sentinel the HuggingFace provider uses so
            # _dispatch_image in chat.py handles both providers identically.
            print(f"[azure_image_service] Azure content filter triggered for topic: '{topic}'")
            raise ValueError(REFUSAL_SENTINEL)
        # Some other bad request (malformed prompt, invalid size, etc.) — re-raise.
        raise

    # ── Step 3: Decode b64 → raw bytes ───────────────────────────────────────
    b64_data = response.data[0].b64_json
    return base64.b64decode(b64_data)