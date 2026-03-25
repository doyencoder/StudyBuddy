"""
ai_service.py
─────────────────────────────────────────────────────────────────────────────
Central AI provider router for StudyBuddy.

STATIC DEFAULT (server-wide, set in .env):
    AI_PROVIDER=azure   →  Azure OpenAI  (gpt-4o-mini + text-embedding-3-large)
    AI_PROVIDER=gemini  →  Gemini        (gemini-2.5-flash + gemini-embedding-001)

DYNAMIC PER-REQUEST OVERRIDE (runtime model selection):
    Call get_provider(key) with "azure" or "gemini" to obtain the correct
    provider module for a single request.  The returned object exposes the
    same function surface as this module's top-level re-exports, so all
    existing callers that import functions directly from ai_service remain
    completely unchanged and always use the server-wide default.

EMBEDDING NOTE:
    Embeddings are ALWAYS handled by Azure OpenAI (text-embedding-3-large),
    regardless of which LLM provider is selected for a request.  Azure AI
    Search indexes are built with Azure embeddings and the vector dimensions
    must match — mixing providers here would silently break retrieval.

CRITICAL RULES (do not violate):
    • Never import directly from azure_openai_service or gemini_service in
      any router.  Always go through ai_service.get_provider() or the
      module-level re-exports below.
    • Never pass get_provider() keys to embed_text / embed_query — those are
      always Azure regardless of the active LLM provider.
    • Never inject curriculum_context into classify_intent() — see chat.py.
─────────────────────────────────────────────────────────────────────────────
"""

import os
from types import ModuleType
from typing import Literal

# ── Import both provider modules eagerly at startup ───────────────────────────
# Both modules are loaded once when the server boots, paying the import cost
# predictably upfront.  This eliminates cold-start latency when a user
# switches providers mid-session and removes all conditional-import fragility.
import app.services.azure_openai_service as _azure
import app.services.gemini_service as _gemini

# ── Provider registry ─────────────────────────────────────────────────────────
_REGISTRY: dict[str, ModuleType] = {
    "azure": _azure,
    "gemini": _gemini,
}

# Server-wide default — read once at import time from .env.
# get_provider(None) falls back to this value, preserving full backward compat.
_DEFAULT_KEY: str = os.getenv("AI_PROVIDER", "azure").strip().lower()
if _DEFAULT_KEY not in _REGISTRY:
    print(f"[ai_service] WARNING: unknown AI_PROVIDER={_DEFAULT_KEY!r}, falling back to 'azure'")
    _DEFAULT_KEY = "azure"

_DEFAULT_PROVIDER: ModuleType = _REGISTRY[_DEFAULT_KEY]

print(
    "[ai_service] Server-wide default provider: "
    + (
        "AZURE OPENAI (gpt-4o-mini + text-embedding-3-large)"
        if _DEFAULT_KEY == "azure"
        else "GEMINI (gemini-2.5-flash + gemini-embedding-001)"
    )
)
print("[ai_service] Dynamic per-request provider selection: ENABLED")


# ── Public API ────────────────────────────────────────────────────────────────

ProviderKey = Literal["azure", "gemini"]


def get_provider(key: str | None) -> ModuleType:
    """
    Return the provider module for *key*, falling back to the server-wide
    default when key is None, empty, or unrecognised.

    Usage in chat.py (one line at the top of the request handler):
        provider = get_provider(request.model_provider)

    Then call provider-scoped functions directly:
        provider.chat_stream(...)
        provider.classify_intent(...)
        provider.generate_quiz_questions(...)
        ...

    Embedding functions (embed_text, embed_query) are NOT on the provider
    object — always import them directly from this module; they are always
    Azure regardless of the active LLM provider.
    """
    if key and key.strip().lower() in _REGISTRY:
        return _REGISTRY[key.strip().lower()]
    return _DEFAULT_PROVIDER


# ── Module-level re-exports (backward compatibility) ─────────────────────────
# All existing routers that do:
#     from app.services.ai_service import chat_stream, classify_intent, ...
# continue to work exactly as before — they get the server-wide default
# provider's implementations.  No changes required in any other router.

# ── Embeddings — always Azure, never swapped ──────────────────────────────────
from app.services.azure_openai_service import (  # noqa: E402
    embed_text,
    embed_query,
)

# ── LLM functions — from server-wide default provider ────────────────────────
# Start with Azure as the baseline import; overridden below if default is Gemini.
from app.services.azure_openai_service import (  # noqa: E402
    chat_stream,
    classify_intent,
    generate_quiz_questions,
    batch_classify_weak_areas,
    classify_weak_area,
    generate_mermaid,
    generate_image,
    generate_study_plan,
    generate_flashcards,
    parse_study_plan_intent,
    infer_topic_from_messages,
    extract_document_context,
    classify_search_intent,
)

# If the server-wide default is Gemini, override the LLM re-exports.
# embed_text / embed_query are intentionally NOT overridden — always Azure.
if _DEFAULT_KEY == "gemini":
    from app.services.gemini_service import (  # noqa: F811
        chat_stream,
        classify_intent,
        generate_quiz_questions,
        batch_classify_weak_areas,
        classify_weak_area,
        generate_mermaid,
        generate_image,
        generate_study_plan,
        generate_flashcards,
        parse_study_plan_intent,
        infer_topic_from_messages,
        extract_document_context,
        classify_search_intent,
    )