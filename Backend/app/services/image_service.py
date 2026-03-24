"""
image_service.py
────────────────────────────────────────────────────────────────────────────────
Central image generation provider router for StudyBuddy.

Controls which image generation backend is used across the entire application
via a single environment variable — completely independent of AI_PROVIDER:

    IMAGE_GENERATION_PROVIDER=huggingface  →  huggingface_image_service.py
                                               FLUX.1-schnell — free, default.

    IMAGE_GENERATION_PROVIDER=azure        →  azure_image_service.py
                                               gpt-image-1 — premium Azure OpenAI.
                                               Requires limited-access approval +
                                               AZURE_OPENAI_IMAGE_DEPLOYMENT set.

    IMAGE_GENERATION_PROVIDER=azure_flux   →  azure_flux_image_service.py
                                               FLUX.2-pro (Black Forest Labs) —
                                               hosted on Azure AI Services.
                                               Requires AZURE_FLUX_ENDPOINT +
                                               AZURE_FLUX_API_KEY set.

HOW TO SWITCH PROVIDERS:
  1. In your local .env file, set IMAGE_GENERATION_PROVIDER to one of the
     three values above (case-insensitive — "Azure_Flux", "AZURE_FLUX", etc. all work).
  2. In the Render dashboard, update IMAGE_GENERATION_PROVIDER in the
     Environment tab and redeploy.
  3. No code changes are required anywhere else in the codebase.
  4. Restart the server after changing the variable.

WHY THIS IS SEPARATE FROM AI_PROVIDER:
  - AI_PROVIDER controls text models: chat, classify, embed, quiz, mermaid.
  - IMAGE_GENERATION_PROVIDER controls ONLY image generation.
  - They are orthogonal. Valid combinations include:
      AI_PROVIDER=azure   + IMAGE_GENERATION_PROVIDER=azure_flux
      AI_PROVIDER=gemini  + IMAGE_GENERATION_PROVIDER=huggingface
      AI_PROVIDER=azure   + IMAGE_GENERATION_PROVIDER=azure

On startup, look for exactly one of these log lines:

  [image_service] Provider: HUGGINGFACE FLUX (black-forest-labs/FLUX.1-schnell)
  [image_service] Provider: AZURE GPT-IMAGE-1 (gpt-image-1)
  [image_service] Provider: AZURE FLUX.2-PRO (blackforestlabs/flux-2-pro)

ALL CALLERS import from here — never directly from a provider file:
    from app.services.image_service import generate_image
────────────────────────────────────────────────────────────────────────────────
"""

import os

# ── Read the provider setting once at import time ─────────────────────────────
# strip() + lower() makes the comparison case-insensitive and whitespace-safe.
# Defaults to "huggingface" so existing deployments continue working with zero
# config changes.
_PROVIDER = os.getenv("IMAGE_GENERATION_PROVIDER", "huggingface").strip().lower()

if _PROVIDER == "azure_flux":
    # ── Azure FLUX.2-pro (Black Forest Labs on Azure AI Services) ─────────────
    # Requires AZURE_FLUX_ENDPOINT + AZURE_FLUX_API_KEY in .env.
    from app.services.azure_flux_image_service import generate_image  # noqa: F401
    print("[image_service] Provider: AZURE FLUX.2-PRO (blackforestlabs/flux-2-pro)")

elif _PROVIDER == "azure":
    # ── Azure OpenAI gpt-image-1 (premium) ───────────────────────────────────
    # Requires AZURE_OPENAI_IMAGE_DEPLOYMENT in .env + limited-access approval.
    from app.services.azure_image_service import generate_image  # noqa: F401
    print("[image_service] Provider: AZURE GPT-IMAGE-1 (gpt-image-1)")

else:
    # ── HuggingFace FLUX.1-schnell (free / fallback) ──────────────────────────
    # Handles "huggingface", any unknown value, or a missing env var safely.
    # This is the safe default — no Azure credits consumed.
    from app.services.huggingface_image_service import generate_image  # noqa: F401
    print("[image_service] Provider: HUGGINGFACE FLUX (black-forest-labs/FLUX.1-schnell)")