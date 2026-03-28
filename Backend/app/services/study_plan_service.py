"""
study_plan_service.py
Orchestrates study plan generation:
  - Checks for uploaded documents via search_service
  - Retrieves relevant chunks if available
  - Calls ai_service.generate_study_plan() (respects AI_PROVIDER toggle)
  - Returns structured plan response

FIX: Changed import from gemini_service to ai_service so the AI_PROVIDER
toggle works correctly for study plans.
"""

import uuid
from datetime import date, timedelta

# FIX: was "from app.services.gemini_service import ..." which bypassed the
# AI_PROVIDER toggle entirely. Now correctly routes through ai_service.
from app.services.ai_service import embed_query, generate_study_plan, get_provider
# Add these two imports
from app.services.search_service import retrieve_chunks_smart, conversation_has_documents, get_conversation_filenames
from app.utils.document_resolver import resolve_document_filter


async def create_study_plan(
    user_id: str,
    conversation_id: str | None,
    topic: str | None,
    timeline_weeks: int = 4,
    hours_per_week: int = 8,
    focus_days: list[str] | None = None,
    page_numbers=None, scope=None,
    curriculum_context: str = None,
    model_provider: str | None = None,
    filename_hint: str | None = None,
) -> dict:
    """
    Generates a structured study plan.

    If conversation_id points to a chat with uploaded docs:
      - Retrieves relevant chunks and grounds the plan in the material.
    Otherwise:
      - Generates a general knowledge plan for the given topic.

    Returns the plan dict with a generated plan_id.
    """

    # ── Determine start_date ──────────────────────────────────────────────────
    start_date = date.today().isoformat()

    # ── Attempt to retrieve context chunks ────────────────────────────────────
    context_chunks = []

    # ── Relevance threshold for scope=topic with a specific topic ─────────
    # Study plan uses pure vector search → cosine score range 0.0-1.0.
    # Adjust this value if filtering is too aggressive or too loose.
    _COSINE_THRESHOLD = 0.65

    if conversation_id and scope != "general":
        # scope=="general" means the topic is answerable from general knowledge
        # (e.g. "study plan for photosynthesis" when antenna notes are uploaded).
        # Skip document retrieval entirely in that case.
        try:
            has_docs = conversation_has_documents(
                user_id=user_id,
                conversation_id=conversation_id,
            )
        except Exception:
            has_docs = False

        if has_docs:
            if scope in ("document", "page"):
                # User explicitly asked for document content or specific pages —
                # always retrieve, no score check.
                try:
                    query_text = topic or "key concepts and important topics"
                    query_embedding = embed_query(query_text)

                    filenames = get_conversation_filenames(user_id=user_id, conversation_id=conversation_id)
                    filename_filter = filename_hint or resolve_document_filter(topic or "", filenames)
                    if filename_filter:
                        print(f"[StudyPlan] Filtering to file: {filename_filter}")

                    if scope == "document":
                        from app.services.search_service import retrieve_all_chunks_ordered
                        raw_chunks = retrieve_all_chunks_ordered(
                            user_id=user_id,
                            conversation_id=conversation_id,
                            filename_filter=filename_filter,
                        )
                    else:
                        raw_chunks = retrieve_chunks_smart(
                            query_embedding=query_embedding,
                            user_id=user_id,
                            conversation_id=conversation_id,
                            top_k=10,
                            filename_filter=filename_filter,
                            page_numbers=page_numbers if page_numbers else None,
                        )
                    context_chunks = [text for text, *_ in raw_chunks]
                    print(f"[StudyPlan] Retrieved {len(context_chunks)} chunks for plan")
                except Exception as e:
                    print(f"[StudyPlan] Chunk retrieval failed: {e}")
                    context_chunks = []
            else:
                # scope == "topic" (or None/unknown)
                try:
                    query_text = topic or "key concepts and important topics"
                    query_embedding = embed_query(query_text)

                    filenames = get_conversation_filenames(user_id=user_id, conversation_id=conversation_id)
                    filename_filter = filename_hint or resolve_document_filter(topic or "", filenames)
                    if filename_filter:
                        print(f"[StudyPlan] Filtering to file: {filename_filter}")

                    raw_chunks = retrieve_chunks_smart(
                        query_embedding=query_embedding,
                        user_id=user_id,
                        conversation_id=conversation_id,
                        top_k=10,
                        filename_filter=filename_filter,
                        page_numbers=page_numbers if page_numbers else None,
                    )

                    if topic:
                        # Specific topic — check if doc content is relevant.
                        relevant = [r for r in raw_chunks if r[3] >= _COSINE_THRESHOLD]
                        if relevant:
                            context_chunks = [text for text, *_ in relevant]
                        else:
                            print(f"[StudyPlan] All chunk scores below {_COSINE_THRESHOLD} for topic '{topic}' — falling back to general knowledge")
                            # context_chunks stays []
                    else:
                        # No specific topic — user wants plan from doc content.
                        context_chunks = [text for text, *_ in raw_chunks]

                    if context_chunks:
                        print(f"[StudyPlan] Retrieved {len(context_chunks)} chunks for plan")
                except Exception as e:
                    print(f"[StudyPlan] Chunk retrieval failed: {e}")
                    context_chunks = []

    # ── Generate the plan via the request-scoped AI provider ─────────────────
    # get_provider() falls back to the server default when model_provider is None.
    _provider = get_provider(model_provider)
    plan = _provider.generate_study_plan(
        topic=topic or "",
        timeline_weeks=timeline_weeks,
        start_date=start_date,
        context_chunks=context_chunks,
        hours_per_week=hours_per_week,
        focus_days=focus_days,
        curriculum_context=curriculum_context,
    )

    # ── Attach a plan_id ──────────────────────────────────────────────────────
    plan["plan_id"] = str(uuid.uuid4())

    # ── Ensure required fields exist with fallbacks ───────────────────────────
    if "start_date" not in plan:
        plan["start_date"] = start_date
    if "end_date" not in plan:
        end = date.today() + timedelta(weeks=timeline_weeks)
        plan["end_date"] = end.isoformat()
    if "title" not in plan:
        plan["title"] = f"Study Plan - {topic or 'General'}"
    if "summary" not in plan:
        plan["summary"] = ""
    if "weeks" not in plan:
        plan["weeks"] = []

    return plan