"""
image_service.py
────────────────────────────────────────────────────────────────────────────────
Central image generation provider router for StudyBuddy.

Controls which image generation backend is used across the entire application
via a single environment variable — completely independent of AI_PROVIDER:

    IMAGE_GENERATION_PROVIDER=huggingface  →  uses huggingface_image_service.py
                                               (FLUX.1-schnell — free, default)

    IMAGE_GENERATION_PROVIDER=azure        →  uses azure_image_service.py
                                               (gpt-image-1 — premium, requires
                                                Azure limited-access approval +
                                                AZURE_OPENAI_IMAGE_DEPLOYMENT set)

HOW TO SWITCH PROVIDERS:
  - In your local .env file, set IMAGE_GENERATION_PROVIDER=azure (or huggingface)
  - In Render dashboard, update IMAGE_GENERATION_PROVIDER in the Environment tab
  - No code changes required anywhere else
  - Restart the server after changing the variable

WHY THIS IS SEPARATE FROM AI_PROVIDER:
  - AI_PROVIDER controls text models: chat, classify, embed, quiz, mermaid
  - IMAGE_GENERATION_PROVIDER controls ONLY image generation
  - They are orthogonal: you can run AI_PROVIDER=gemini + IMAGE_GENERATION_PROVIDER=azure,
    or AI_PROVIDER=azure + IMAGE_GENERATION_PROVIDER=huggingface, in any combination

On startup, look for this log line:
  [image_service] Provider: AZURE GPT-IMAGE-1 (gpt-image-1)
  or
  [image_service] Provider: HUGGINGFACE FLUX (black-forest-labs/FLUX.1-schnell)

ALL CALLERS import from here instead of directly from either provider file:
    from app.services.image_service import generate_image
────────────────────────────────────────────────────────────────────────────────
"""

import os

# ── Read the provider setting once at import time ─────────────────────────────
# Defaults to "huggingface" so existing deployments keep working with zero
# config changes. Switch to "azure" once your gpt-image-1 deployment is live.
_PROVIDER = os.getenv("IMAGE_GENERATION_PROVIDER", "huggingface").strip().lower()

if _PROVIDER == "azure":
    # ── Azure OpenAI gpt-image-1 (premium) ───────────────────────────────────
    from app.services.azure_image_service import generate_image  # noqa: F401
    print("[image_service] Provider: AZURE GPT-IMAGE-1 (gpt-image-1)")

else:
    # ── HuggingFace FLUX.1-schnell (free / fallback) ──────────────────────────
    # Also handles any unknown/misspelled IMAGE_GENERATION_PROVIDER value safely.
    from app.services.huggingface_image_service import generate_image  # noqa: F401
    print("[image_service] Provider: HUGGINGFACE FLUX (black-forest-labs/FLUX.1-schnell)")