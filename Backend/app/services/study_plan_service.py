"""
study_plan_service.py
Orchestrates study plan generation:
  - Checks for uploaded documents via search_service
  - Retrieves relevant chunks if available
  - Calls gemini_service.generate_study_plan()
  - Returns structured plan response
"""

import uuid
from datetime import date, timedelta

from app.services.gemini_service import embed_query, generate_study_plan
from app.services.search_service import retrieve_chunks, conversation_has_documents


async def create_study_plan(
    user_id: str,
    conversation_id: str | None,
    topic: str | None,
    timeline_weeks: int = 4,
    hours_per_week: int = 8,
    focus_days: list[str] | None = None,
) -> dict:
    """
    Generates a structured study plan using Gemini.

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

    if conversation_id:
        try:
            has_docs = conversation_has_documents(
                user_id=user_id,
                conversation_id=conversation_id,
            )
        except Exception:
            has_docs = False

        if has_docs:
            try:
                query_text = topic or "key concepts and important topics"
                query_embedding = embed_query(query_text)
                context_chunks = retrieve_chunks(
                    query_embedding=query_embedding,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    top_k=10,
                    score_threshold=0.5,
                )
                print(f"[StudyPlan] Retrieved {len(context_chunks)} chunks for plan")
            except Exception as e:
                print(f"[StudyPlan] Chunk retrieval failed: {e}")
                context_chunks = []

    # ── Call Gemini to generate the plan ───────────────────────────────────────
    plan = generate_study_plan(
        topic=topic or "",
        timeline_weeks=timeline_weeks,
        start_date=start_date,
        context_chunks=context_chunks,
        hours_per_week=hours_per_week,
        focus_days=focus_days,
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