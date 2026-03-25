"""
notifications.py
───────────────────────────────────────────────────────────────────
POST  /notifications/checkin     – frontend heartbeat (active today + daily goals status)
GET   /notifications/status      – debug endpoint showing next scheduled runs
POST  /notifications/test-email  – manual trigger for dev/demo testing

Background scheduler (APScheduler AsyncIOScheduler, IST timezone):
  • 9 PM IST daily  → send_daily_reminders()
      - goal_reminders ON + daily goals not complete  → daily goals reminder email
      - study_streak_alerts ON + not active today     → streak alert email
  • 12 PM IST daily → send_flashcard_review_reminders()
      - flashcard_review_reminders ON + has flashcards → flashcard review reminder email
  • Every Sunday 9 AM IST → send_weekly_longterm_reminders()
      - long_term_goals_reminder ON                   → weekly goal summary email
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False
    print("[notifications] APScheduler not installed — scheduler disabled. Add apscheduler to requirements.txt")

from app.services.settings_service import record_checkin, get_all_users_for_notifications
from app.services.goals_service import list_goals
from app.services.cosmos_service import has_flashcard_decks
from app.services.email_service import (
    send_daily_goals_reminder,
    send_flashcard_review_reminder,
    send_weekly_all_goals_summary,
    send_streak_alert,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])

# ── Scheduler singleton ────────────────────────────────────────────────────────

_scheduler: Optional["AsyncIOScheduler"] = None


def get_scheduler():
    global _scheduler
    if not HAS_APSCHEDULER:
        return None
    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
    return _scheduler


# ── Scheduler jobs ─────────────────────────────────────────────────────────────

async def send_daily_reminders():
    """Runs at 9 PM IST. Sends goal reminder + streak alert emails."""
    print("[notifications] Running daily reminder job...")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        users = await get_all_users_for_notifications()
    except Exception as e:
        print(f"[notifications] Failed to fetch users: {e}")
        return

    for user in users:
        email        = user.get("profile", {}).get("email", "")
        display_name = user.get("profile", {}).get("display_name") or user.get("profile", {}).get("full_name", "")
        notifs       = user.get("notifications", {})

        if not email:
            continue

        # ── Daily goals reminder ──────────────────────────────────────────────
        if notifs.get("goal_reminders", False):
            total = user.get("daily_goals_total", 0)
            done  = user.get("daily_goals_done", 0)
            if total > 0 and done < total:
                try:
                    send_daily_goals_reminder(
                        to_email=email,
                        display_name=display_name,
                        goals_done=done,
                        goals_total=total,
                    )
                except Exception as e:
                    print(f"[notifications] Daily goals email failed for {email}: {e}")

        # ── Study streak alert ───────────────────────────────────────────────
        if notifs.get("study_streak_alerts", False):
            last_active = user.get("last_active_date", "")
            if last_active != today:
                try:
                    send_streak_alert(to_email=email, display_name=display_name)
                except Exception as e:
                    print(f"[notifications] Streak alert failed for {email}: {e}")

    print(f"[notifications] Daily reminder job done — processed {len(users)} users.")


async def send_flashcard_review_reminders():
    """Runs at 12 PM IST. Sends flashcard revision reminders."""
    print("[notifications] Running flashcard review reminder job...")

    try:
        users = await get_all_users_for_notifications()
    except Exception as e:
        print(f"[notifications] Failed to fetch users: {e}")
        return

    for user in users:
        email        = user.get("profile", {}).get("email", "")
        display_name = user.get("profile", {}).get("display_name") or user.get("profile", {}).get("full_name", "")
        notifs       = user.get("notifications", {})
        user_id      = user.get("user_id", "")

        if not email or not notifs.get("flashcard_review_reminders", False):
            continue

        try:
            if not await has_flashcard_decks(user_id):
                continue
        except Exception as e:
            print(f"[notifications] Failed to inspect flashcards for {user_id}: {e}")
            continue

        try:
            send_flashcard_review_reminder(to_email=email, display_name=display_name)
        except Exception as e:
            print(f"[notifications] Flashcard reminder failed for {email}: {e}")

    print(f"[notifications] Flashcard review reminder job done — processed {len(users)} users.")


async def send_weekly_longterm_reminders():
    """Runs every Sunday at 9 AM IST. Sends ONE digest email per user with ALL active goals."""
    print("[notifications] Running weekly long-term reminders job...")

    try:
        users = await get_all_users_for_notifications()
    except Exception as e:
        print(f"[notifications] Failed to fetch users: {e}")
        return

    today = datetime.now(timezone.utc).date()

    for user in users:
        email        = user.get("profile", {}).get("email", "")
        display_name = user.get("profile", {}).get("display_name") or user.get("profile", {}).get("full_name", "")
        notifs       = user.get("notifications", {})
        user_id      = user.get("user_id", "")

        if not email or not notifs.get("long_term_goals_reminder", False):
            continue

        try:
            goals = await list_goals(user_id=user_id)
        except Exception as e:
            print(f"[notifications] Failed to fetch goals for {user_id}: {e}")
            continue

        # Collect data for all active goals into one list
        goals_data = []
        for goal in goals:
            try:
                start = datetime.fromisoformat(goal["start_date"]).date()
                end   = datetime.fromisoformat(goal["end_date"]).date()
                if end < today:
                    continue  # skip expired goals

                total_weeks      = max(1, (end - start).days // 7)
                elapsed          = max(0, (today - start).days // 7)
                remaining        = max(0, total_weeks - elapsed)
                current_week_idx = elapsed
                weekly_plan      = goal.get("weekly_plan", [])
                completed_tasks  = goal.get("completed_tasks", {}) or {}

                tasks_done, tasks_pending = [], []
                if current_week_idx < len(weekly_plan):
                    for ti, task in enumerate(weekly_plan[current_week_idx].get("tasks", [])):
                        key  = f"{current_week_idx}-{ti}"
                        key2 = f"{current_week_idx + 1}-{ti}"
                        is_done = completed_tasks.get(key) or completed_tasks.get(key2) or False
                        (tasks_done if is_done else tasks_pending).append(task)

                goals_data.append({
                    "goal_title":              goal.get("title", "Study goal"),
                    "weeks_elapsed":           elapsed,
                    "weeks_total":             total_weeks,
                    "weeks_remaining":         remaining,
                    "tasks_done_this_week":    tasks_done,
                    "tasks_pending_this_week": tasks_pending,
                    "overall_progress":        goal.get("progress", 0),
                })
            except Exception as e:
                print(f"[notifications] Skipped goal '{goal.get('title')}': {e}")

        if not goals_data:
            continue

        # Send ONE digest email covering all goals
        try:
            send_weekly_all_goals_summary(
                to_email=email,
                display_name=display_name,
                goals_data=goals_data,
            )
        except Exception as e:
            print(f"[notifications] Weekly digest failed for {email}: {e}")

    print("[notifications] Weekly long-term reminders job done.")


# ── Scheduler lifecycle ────────────────────────────────────────────────────────

def start_scheduler():
    """Called from main.py on_startup. Registers cron jobs and starts the scheduler."""
    sched = get_scheduler()
    if not sched:
        print("[notifications] Scheduler not started (APScheduler not available).")
        return

    if sched.running:
        return

    try:
        import pytz
        IST = pytz.timezone("Asia/Kolkata")
    except ImportError:
        # Fallback: UTC offset for IST (+5:30 = +330 min)
        IST = timezone(timedelta(hours=5, minutes=30))

    # 9 PM IST daily
    sched.add_job(
        send_daily_reminders,
        CronTrigger(hour=21, minute=0, timezone=IST),
        id="daily_reminders",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # 12 PM IST daily
    sched.add_job(
        send_flashcard_review_reminders,
        CronTrigger(hour=12, minute=0, timezone=IST),
        id="flashcard_review_reminders",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # Every Sunday 9 AM IST
    sched.add_job(
        send_weekly_longterm_reminders,
        CronTrigger(day_of_week="sun", hour=9, minute=0, timezone=IST),
        id="weekly_longterm",
        replace_existing=True,
        misfire_grace_time=600,
    )

    sched.start()
    print("[notifications] Scheduler started.")
    print("[notifications]   daily_reminders  → 9 PM IST daily  (daily goals reminder + study streak alert)")
    print("[notifications]   flashcard_review_reminders → 12 PM IST daily (flashcard review reminder)")
    print("[notifications]   weekly_longterm  → Sunday 9 AM IST (long-term goals progress email)")


def stop_scheduler():
    """Called from main.py on_shutdown."""
    sched = get_scheduler()
    if sched and sched.running:
        sched.shutdown(wait=False)
        print("[notifications] Scheduler stopped.")


# ── REST endpoints ─────────────────────────────────────────────────────────────

class CheckinRequest(BaseModel):
    user_id: str
    daily_goals_total: int = 0
    daily_goals_done: int = 0


@router.post("/checkin")
async def checkin(request: CheckinRequest):
    """
    Frontend calls this whenever the GoalsPage loads or goals change.
    Records that the user is active today + their daily goals completion status.
    Used by the 9 PM scheduler to decide whether to send reminders.
    """
    try:
        await record_checkin(
            user_id=request.user_id,
            daily_goals_total=request.daily_goals_total,
            daily_goals_done=request.daily_goals_done,
        )
        return {"status": "ok"}
    except Exception as e:
        print(f"[notifications/checkin] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class TestEmailRequest(BaseModel):
    user_id: str
    type: str  # "daily_goals" | "weekly_goals" | "streak" | "flashcards"


@router.post("/test-email")
async def test_email(request: TestEmailRequest):
    """Dev helper — manually triggers an email for a given user and type."""
    try:
        from app.services.settings_service import get_settings
        settings = await get_settings(request.user_id)
        email = settings.get("profile", {}).get("email", "")
        display_name = settings.get("profile", {}).get("display_name") or \
                       settings.get("profile", {}).get("full_name", "")

        if not email:
            raise HTTPException(status_code=400, detail="No email address found in profile settings.")

        if request.type == "daily_goals":
            total = settings.get("daily_goals_total", 4)
            done  = settings.get("daily_goals_done", 1)
            # Ensure there's something to show (demo defaults if no goals recorded yet)
            if total == 0:
                total, done = 4, 2
            send_daily_goals_reminder(email, display_name, done, total)

        elif request.type == "streak":
            # FIX: Always send in test mode — don't check last_active_date
            send_streak_alert(email, display_name)

        elif request.type == "weekly_goals":
            goals = await list_goals(user_id=request.user_id)
            if not goals:
                raise HTTPException(status_code=400, detail="No long-term goals found.")

            today = datetime.now(timezone.utc).date()
            goals_data = []
            for g in goals:
                try:
                    start        = datetime.fromisoformat(g["start_date"]).date()
                    end          = datetime.fromisoformat(g["end_date"]).date()
                    total_weeks  = max(1, (end - start).days // 7)
                    elapsed      = max(0, (today - start).days // 7)
                    remaining    = max(0, total_weeks - elapsed)
                    current_week = elapsed
                    weekly_plan      = g.get("weekly_plan", [])
                    completed_tasks  = g.get("completed_tasks", {}) or {}
                    tasks_done, tasks_pending = [], []
                    if current_week < len(weekly_plan):
                        for ti, task in enumerate(weekly_plan[current_week].get("tasks", [])):
                            key = f"{current_week}-{ti}"
                            (tasks_done if completed_tasks.get(key) else tasks_pending).append(task)
                    goals_data.append({
                        "goal_title":              g.get("title", "Study goal"),
                        "weeks_elapsed":           elapsed,
                        "weeks_total":             total_weeks,
                        "weeks_remaining":         remaining,
                        "tasks_done_this_week":    tasks_done,
                        "tasks_pending_this_week": tasks_pending,
                        "overall_progress":        g.get("progress", 0),
                    })
                except Exception as e:
                    print(f"[notifications/test-email] Skipped goal: {e}")

            # Send ONE digest email with all goals
            send_weekly_all_goals_summary(
                to_email=email,
                display_name=display_name,
                goals_data=goals_data,
            )
            return {"status": "sent", "to": email, "type": request.type, "goals_in_email": len(goals_data)}
        elif request.type == "flashcards":
            if not await has_flashcard_decks(request.user_id):
                raise HTTPException(status_code=400, detail="No flashcard decks found.")
            send_flashcard_review_reminder(email, display_name)
        else:
            raise HTTPException(status_code=400, detail="type must be 'daily_goals', 'weekly_goals', 'streak', or 'flashcards'")

        return {"status": "sent", "to": email, "type": request.type}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def scheduler_status():
    """Debug: shows scheduler status and next run times."""
    sched = get_scheduler()
    if not sched or not sched.running:
        return {"running": False, "jobs": []}

    jobs = []
    for job in sched.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": str(job.next_run_time) if job.next_run_time else None,
        })
    return {"running": True, "jobs": jobs}
