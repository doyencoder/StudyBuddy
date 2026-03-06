"""
Router: /goals
CRUD endpoints for study goals.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.models import (
    GoalCreateRequest,
    GoalUpdateRequest,
    GoalItem,
    GoalsListResponse,
    WeekPlan,
)
from app.services.goals_service import (
    create_goal,
    list_goals,
    get_goal,
    update_goal,
    delete_goal,
)
from app.services.email_service import send_reminder_email

router = APIRouter(prefix="/goals", tags=["Goals"])


# ── POST /goals ──────────────────────────────────────────────────────────────

@router.post("/", response_model=GoalItem, status_code=201)
async def create_new_goal(request: GoalCreateRequest):
    """Create a new goal (typically from a saved study plan)."""
    try:
        reminder_dict = request.reminder.model_dump() if request.reminder else None
        weekly_plan_dicts = [w.model_dump() for w in request.weekly_plan]

        doc = await create_goal(
            user_id=request.user_id,
            title=request.title,
            start_date=request.start_date,
            end_date=request.end_date,
            weekly_plan=weekly_plan_dicts,
            progress=request.progress,
            reminder=reminder_dict,
            completed_tasks=dict(request.completed_tasks) if request.completed_tasks else None,
        )

        return GoalItem(
            goal_id=doc["id"],
            user_id=doc["user_id"],
            title=doc["title"],
            start_date=doc["start_date"],
            end_date=doc["end_date"],
            weekly_plan=[WeekPlan(**w) for w in doc.get("weekly_plan", [])],
            progress=doc.get("progress", 0),
            reminder=doc.get("reminder"),
            completed_tasks=doc.get("completed_tasks", {}),
            created_at=doc["created_at"],
        )
    except Exception as e:
        print(f"[goals/create] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /goals ───────────────────────────────────────────────────────────────

@router.get("/", response_model=GoalsListResponse)
async def list_user_goals(user_id: str = Query(...)):
    """List all goals for a user, ordered by end_date ASC."""
    try:
        docs = await list_goals(user_id=user_id)
        goals = []
        for doc in docs:
            goals.append(
                GoalItem(
                    goal_id=doc["id"],
                    user_id=doc["user_id"],
                    title=doc["title"],
                    start_date=doc["start_date"],
                    end_date=doc["end_date"],
                    weekly_plan=[WeekPlan(**w) for w in doc.get("weekly_plan", [])],
                    progress=doc.get("progress", 0),
                    reminder=doc.get("reminder"),
                    completed_tasks=doc.get("completed_tasks", {}),
                    created_at=doc["created_at"],
                )
            )
        return GoalsListResponse(goals=goals)
    except Exception as e:
        print(f"[goals/list] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /goals/{goal_id} ─────────────────────────────────────────────────────

@router.get("/{goal_id}", response_model=GoalItem)
async def get_single_goal(goal_id: str, user_id: str = Query(...)):
    """Get a single goal by ID."""
    try:
        doc = await get_goal(goal_id=goal_id, user_id=user_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Goal not found")
        return GoalItem(
            goal_id=doc["id"],
            user_id=doc["user_id"],
            title=doc["title"],
            start_date=doc["start_date"],
            end_date=doc["end_date"],
            weekly_plan=[WeekPlan(**w) for w in doc.get("weekly_plan", [])],
            progress=doc.get("progress", 0),
            reminder=doc.get("reminder"),
            completed_tasks=doc.get("completed_tasks", {}),
            created_at=doc["created_at"],
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[goals/get] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── PUT /goals/{goal_id} ─────────────────────────────────────────────────────

@router.put("/{goal_id}", response_model=GoalItem)
async def update_existing_goal(
    goal_id: str,
    request: GoalUpdateRequest,
    user_id: str = Query(...),
):
    """Update fields of an existing goal."""
    try:
        updates = {}
        if request.title is not None:
            updates["title"] = request.title
        if request.weekly_plan is not None:
            updates["weekly_plan"] = [w.model_dump() for w in request.weekly_plan]
        if request.progress is not None:
            updates["progress"] = request.progress
        if request.reminder is not None:
            updates["reminder"] = request.reminder.model_dump()
        if request.completed_tasks is not None:
            updates["completed_tasks"] = dict(request.completed_tasks)

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        doc = await update_goal(goal_id=goal_id, user_id=user_id, updates=updates)
        if not doc:
            raise HTTPException(status_code=404, detail="Goal not found")

        return GoalItem(
            goal_id=doc["id"],
            user_id=doc["user_id"],
            title=doc["title"],
            start_date=doc["start_date"],
            end_date=doc["end_date"],
            weekly_plan=[WeekPlan(**w) for w in doc.get("weekly_plan", [])],
            progress=doc.get("progress", 0),
            reminder=doc.get("reminder"),
            completed_tasks=doc.get("completed_tasks", {}),
            created_at=doc["created_at"],
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[goals/update] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /goals/{goal_id}/send_reminder ──────────────────────────────────────

class SendReminderRequest(BaseModel):
    email: str


@router.post("/{goal_id}/send_reminder")
async def send_goal_reminder(goal_id: str, request: SendReminderRequest, user_id: str = Query(...)):
    """Send a one-time reminder email for a goal."""
    try:
        doc = await get_goal(goal_id=goal_id, user_id=user_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Goal not found")

        # Gather this week's tasks (or first week tasks)
        weekly_plan = doc.get("weekly_plan", [])
        tasks = weekly_plan[0].get("tasks", []) if weekly_plan else []

        success = send_reminder_email(
            to_email=request.email,
            goal_title=doc["title"],
            progress=doc.get("progress", 0),
            tasks=tasks,
        )

        if success:
            return {"status": "sent", "message": f"Reminder email sent to {request.email}"}
        else:
            raise HTTPException(status_code=500, detail="Failed to send email")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[goals/send_reminder] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── DELETE /goals/{goal_id} ──────────────────────────────────────────────────

@router.delete("/{goal_id}", status_code=204)
async def delete_existing_goal(goal_id: str, user_id: str = Query(...)):
    """Delete a goal."""
    try:
        await delete_goal(goal_id=goal_id, user_id=user_id)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[goals/delete] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
