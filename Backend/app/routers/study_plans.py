"""
Router: /study_plans
Endpoints for generating study plans via Gemini.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.models import StudyPlanRequest, StudyPlanResponse, WeekPlan
from app.services.study_plan_service import create_study_plan
from app.services.gemini_service import parse_study_plan_intent

router = APIRouter(prefix="/study_plans", tags=["Study Plans"])


class ParseIntentRequest(BaseModel):
    raw_input: str


@router.post("/parse_intent")
async def parse_intent(request: ParseIntentRequest):
    """Use Gemini to parse a free-form study plan request into topic, weeks, hours."""
    try:
        result = parse_study_plan_intent(request.raw_input)
        return result
    except Exception as e:
        print(f"[study_plans/parse_intent] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate", response_model=StudyPlanResponse)
async def generate_study_plan(request: StudyPlanRequest):
    """
    Generate a structured study plan.

    - If conversation_id is provided and has uploaded docs, the plan is grounded
      in the material (RAG).
    - Otherwise, generates a general-knowledge plan for the given topic.
    """
    try:
        hours_per_week = 8
        focus_days = None
        if request.preferences:
            hours_per_week = request.preferences.hours_per_week
            focus_days = request.preferences.focus_days

        plan = await create_study_plan(
            user_id=request.user_id,
            conversation_id=request.conversation_id,
            topic=request.topic,
            timeline_weeks=request.timeline_weeks,
            hours_per_week=hours_per_week,
            focus_days=focus_days,
        )

        # Normalise weeks into WeekPlan models
        weeks = []
        for w in plan.get("weeks", []):
            weeks.append(
                WeekPlan(
                    week_number=w.get("week_number", 0),
                    start_date=w.get("start_date", ""),
                    end_date=w.get("end_date", ""),
                    tasks=w.get("tasks", []),
                    estimate_hours=w.get("estimate_hours"),
                )
            )

        return StudyPlanResponse(
            plan_id=plan["plan_id"],
            title=plan.get("title", ""),
            start_date=plan.get("start_date", ""),
            end_date=plan.get("end_date", ""),
            weeks=weeks,
            summary=plan.get("summary", ""),
        )

    except Exception as e:
        print(f"[study_plans/generate] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
