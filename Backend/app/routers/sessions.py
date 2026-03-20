"""
Router: /sessions
Tracks how long a user studies via 60-second heartbeat pings from the frontend.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.sessions_service import record_heartbeat, get_weekly_minutes

router = APIRouter(prefix="/sessions", tags=["Sessions"])


class HeartbeatRequest(BaseModel):
    user_id: str


# ── POST /sessions/heartbeat ──────────────────────────────────────────────────

@router.post("/heartbeat")
async def heartbeat(request: HeartbeatRequest):
    """
    Called every 60 seconds by the frontend while the tab is active and focused.
    Increments today's minute counter by 1 for the given user.
    """
    try:
        minutes_today = await record_heartbeat(request.user_id)
        return {"ok": True, "minutes_today": minutes_today}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /sessions/weekly ──────────────────────────────────────────────────────

@router.get("/weekly")
async def weekly_stats(user_id: str):
    """
    Returns total study minutes + per-day breakdown for the last 7 days.
    Used by the Dashboard to display time studied.
    """
    try:
        return await get_weekly_minutes(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))