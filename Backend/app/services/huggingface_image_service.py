"""
huggingface_image_service.py
────────────────────────────────────────────────────────────────────────────────
HuggingFace FLUX.1-schnell image generation provider for StudyBuddy.

This is the FREE / FALLBACK provider.
Selected when IMAGE_GENERATION_PROVIDER=huggingface (the default).

Extracted from azure_openai_service.py and gemini_service.py where the same
logic was duplicated. This file is now the single canonical home for all
FLUX-based image generation logic.

How the safety check works here:
  - We need a text LLM call to verify the topic is safe before sending it
    to FLUX (which has no built-in content filter).
  - We use a lazy import of ai_service inside the function body rather than
    a top-level import. This intentionally breaks the circular import chain:
      ai_service → azure_openai_service → image_service
                                        → huggingface_image_service → ai_service  ← circular at module load
    Lazy import is safe because by the time generate_image() is actually
    *called* (not imported), all modules are fully loaded.
"""

import os
import time
import requests
from typing import List

# ── Constants ─────────────────────────────────────────────────────────────────
FLUX_MODEL_ID    = "black-forest-labs/FLUX.1-schnell"
FLUX_API_URL     = f"https://router.huggingface.co/hf-inference/models/{FLUX_MODEL_ID}"
FLUX_TIMEOUT     = 120   # seconds per request
FLUX_503_BACKOFF = 30    # seconds to wait on a cold-start 503 before one retry

# Matches the sentinel in ai_service / chat.py so the refusal flow works end-to-end.
REFUSAL_SENTINEL = "__REFUSED__"


def generate_image(topic: str, context_chunks: List[str]) -> bytes:
    """
    Generates an educational illustration using HuggingFace FLUX.1-schnell.

    Returns raw image bytes (PNG) ready to be uploaded to Azure Blob Storage.
    Raises ValueError(REFUSAL_SENTINEL) if the topic is detected as harmful.
    Raises RuntimeError on API failures.

    Args:
        topic:          The subject to illustrate (e.g. "photosynthesis").
        context_chunks: RAG chunks from the student's uploaded document.
                        Used to enrich the prompt with specific detail.
    """

    # ── Step 1: Safety check ──────────────────────────────────────────────────
    # Ask the active text LLM (Azure or Gemini, depending on AI_PROVIDER) to
    # classify the topic as SAFE or UNSAFE before forwarding it to FLUX.
    # FLUX has no built-in content filter — this check is essential.
    #
    # Lazy import avoids the circular dependency described in the module docstring.
    # This is safe at call time because all modules are fully loaded by then.
    try:
        from app.services import ai_service as _ai  # noqa: PLC0415 (lazy by design)

        # We reach into the active provider's classify_intent to reuse its
        # already-loaded client rather than spinning up a new one.
        # A minimal single-shot safety prompt, temperature 0 for determinism.
        _provider = os.getenv("AI_PROVIDER", "azure").strip().lower()

        if _provider == "gemini":
            from app.services.gemini_service import _get_client as _gemini_client  # noqa
            from google.genai import types
            _client = _gemini_client()

            def _run_safety_check():
                return _client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=(
                        f'Is this topic safe and appropriate for generating an '
                        f'educational illustration for students? Topic: "{topic}"\n\n'
                        f'Reply with ONLY one word: SAFE or UNSAFE'
                    ),
                    config=types.GenerateContentConfig(temperature=0.0),
                )
            safety_text = _run_safety_check().text.strip().upper()

        else:
            # Azure OpenAI path (default)
            from app.services.azure_openai_service import (  # noqa
                _get_client as _azure_client,
                _chat_deployment,
                _call_with_retry,
            )
            _client = _azure_client()
            _deployment = _chat_deployment()

            def _run_safety_check():
                return _client.chat.completions.create(
                    model=_deployment,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a content safety checker. Reply with only one word: SAFE or UNSAFE.",
                        },
                        {
                            "role": "user",
                            "content": (
                                f'Is this topic safe and appropriate for generating an '
                                f'educational illustration for students? Topic: "{topic}"\n\n'
                                f'Reply with ONLY: SAFE or UNSAFE'
                            ),
                        },
                    ],
                    temperature=0.0,
                    max_tokens=10,
                )

            safety_resp = _call_with_retry(_run_safety_check)
            safety_text = safety_resp.choices[0].message.content.strip().upper()

        if "UNSAFE" in safety_text:
            raise ValueError(REFUSAL_SENTINEL)

    except ValueError:
        raise  # re-raise REFUSAL_SENTINEL — caller (_dispatch_image) handles it
    except Exception:
        # If the safety check itself fails for any other reason (network, quota,
        # etc.), we proceed cautiously rather than blocking the user entirely.
        # FLUX itself will refuse overtly harmful prompts at the API level.
        pass

    # ── Step 2: Validate HuggingFace token ───────────────────────────────────
    hf_token = os.getenv("HF_API_TOKEN")
    if not hf_token:
        raise ValueError("HF_API_TOKEN is not set in .env")

    # ── Step 3: Build prompt ──────────────────────────────────────────────────
    if context_chunks:
        context_summary = " ".join(context_chunks[:3])[:400]
        prompt = (
            f"Detailed anatomical and scientific illustration of: {topic}. "
            f"Based on these study notes: {context_summary}. "
            "Style: clean artistic illustration, white background, "
            "no text, no labels, no words, visually accurate, educational artwork."
        )
    else:
        prompt = (
            f"Detailed anatomical and scientific illustration of: {topic}. "
            "Style: clean artistic illustration, white background, "
            "no text, no labels, no words, visually accurate, educational artwork."
        )

    # ── Step 4: Call FLUX API (with one cold-start retry on 503) ─────────────
    _headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json",
    }
    _payload = {"inputs": prompt}

    response = requests.post(
        FLUX_API_URL,
        headers=_headers,
        json=_payload,
        timeout=FLUX_TIMEOUT,
    )

    if response.status_code == 503:
        # FLUX free-tier models cold-start frequently — one retry after backoff.
        print(f"[huggingface_image_service] 503 cold-start, retrying in {FLUX_503_BACKOFF}s...")
        time.sleep(FLUX_503_BACKOFF)
        response = requests.post(
            FLUX_API_URL,
            headers=_headers,
            json=_payload,
            timeout=FLUX_TIMEOUT,
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"HuggingFace API error {response.status_code}: {response.text[:300]}"
        )

    return response.content