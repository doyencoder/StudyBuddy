"""
Router: /study_plans
Endpoints for generating study plans via Gemini.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.models import StudyPlanRequest, StudyPlanResponse, WeekPlan
import json
from app.services.study_plan_service import create_study_plan
from app.services.ai_service import parse_study_plan_intent
from app.services.cosmos_service import ensure_conversation, save_message, update_message_json

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

        # Save conversation messages so study plan sessions appear in sidebar + history
        if request.conversation_id:
            try:
                topic_label = request.topic or "Study Plan"
                await ensure_conversation(
                    user_id=request.user_id,
                    conversation_id=request.conversation_id,
                    title=f"Study Plan: {topic_label}",
                )
                user_content = (
                    f"Create Study Plan for: {request.topic} ({request.timeline_weeks} weeks)"
                    if request.topic
                    else f"Create Study Plan ({request.timeline_weeks} weeks)"
                )
                await save_message(
                    conversation_id=request.conversation_id,
                    user_id=request.user_id,
                    role="user",
                    content=user_content,
                )
                plan_payload = json.dumps({
                    "__type": "study_plan",
                    "plan_id": plan["plan_id"],
                    "title": plan.get("title", ""),
                    "start_date": plan.get("start_date", ""),
                    "end_date": plan.get("end_date", ""),
                    "weeks": [
                        {
                            "week_number": w.week_number,
                            "start_date": w.start_date,
                            "end_date": w.end_date,
                            "tasks": w.tasks,
                            "estimate_hours": w.estimate_hours,
                        }
                        for w in weeks
                    ],
                    "summary": plan.get("summary", ""),
                })
                await save_message(
                    conversation_id=request.conversation_id,
                    user_id=request.user_id,
                    role="assistant",
                    content=plan_payload,
                )
            except Exception:
                pass  # Non-critical — don't fail plan generation over this

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


class MarkGoalSavedRequest(BaseModel):
    user_id: str
    plan_id: str
    conversation_id: str


@router.post("/mark_goal_saved")
async def mark_goal_saved(request: MarkGoalSavedRequest):
    """
    Called by the frontend after a study plan is successfully saved as a Goal.
    Updates the conversation history message with goal_saved=True so that when
    the user reopens the chat, the Save as Goal button appears in Saved state.
    """
    try:
        await update_message_json(
            conversation_id=request.conversation_id,
            user_id=request.user_id,
            match_key="plan_id",
            match_value=request.plan_id,
            patch={"goal_saved": True},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True}