"""
ai_service.py
─────────────────────────────────────────────────────────────────────────────
Central AI provider router for StudyBuddy.

Controls which AI backend is used across the entire application via a single
environment variable:

    AI_PROVIDER=azure   →  uses azure_openai_service.py  (gpt-4o-mini + text-embedding-3-large)
    AI_PROVIDER=gemini  →  uses gemini_service.py         (gemini-2.5-flash + gemini-embedding-001)

HOW TO SWITCH PROVIDERS:
  - In your local .env file, change AI_PROVIDER= to either "azure" or "gemini"
  - In Render dashboard, update the AI_PROVIDER environment variable
  - No code changes required anywhere else — all routers import from this file

ALL ROUTERS import from here instead of directly from gemini_service.py:
    from app.services.ai_service import (
        chat_stream, classify_intent, embed_text, embed_query,
        generate_quiz_questions, batch_classify_weak_areas, classify_weak_area,
        generate_mermaid, generate_image, generate_study_plan,
        parse_study_plan_intent, infer_topic_from_messages,
    )
─────────────────────────────────────────────────────────────────────────────
"""

import os

# ── Read the provider setting once at import time ────────────────────────────
# Defaults to "azure" so production always uses Azure OpenAI unless explicitly
# overridden. Change to "gemini" in .env to fall back to Gemini API.
_PROVIDER = os.getenv("AI_PROVIDER", "azure").strip().lower()

if _PROVIDER == "gemini":
    # ── Gemini provider (portfolio / fallback mode) ───────────────────────
    from app.services.gemini_service import (
        chat_stream,
        classify_intent,
        embed_text,
        embed_query,
        generate_quiz_questions,
        batch_classify_weak_areas,
        classify_weak_area,
        generate_mermaid,
        generate_image,
        generate_study_plan,
        parse_study_plan_intent,
        infer_topic_from_messages,
        extract_document_context,
    )
    print(f"[ai_service] Provider: GEMINI (gemini-2.5-flash + gemini-embedding-001)")

else:
    # ── Azure OpenAI provider (competition / default mode) ────────────────
    # Also handles any unknown/misspelled AI_PROVIDER value safely.
    from app.services.azure_openai_service import (
        chat_stream,
        classify_intent,
        embed_text,
        embed_query,
        generate_quiz_questions,
        batch_classify_weak_areas,
        classify_weak_area,
        generate_mermaid,
        generate_image,
        generate_study_plan,
        parse_study_plan_intent,
        infer_topic_from_messages,
        extract_document_context,
    )
    print(f"[ai_service] Provider: AZURE OPENAI (gpt-4o-mini + text-embedding-3-large)")