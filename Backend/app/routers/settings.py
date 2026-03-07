"""
Router: /settings
Endpoints for user settings, account info, billing, and connectors.
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.models import (
    UserSettings,
    SettingsUpdateRequest,
    AccountInfo,
    ActiveSession,
    ConnectorsResponse,
    ConnectorItem,
    ConnectorToggleRequest,
    BillingResponse,
    BillingPlan,
)
from app.services.settings_service import (
    get_settings,
    update_settings,
    toggle_connector,
    update_plan,
)

router = APIRouter(prefix="/settings", tags=["Settings"])


# ── Billing Plans Definition ──────────────────────────────────────────────────

PLANS = [
    BillingPlan(
        id="free",
        name="Free",
        tagline="Get started with Study Buddy",
        price="$0",
        period="",
        features=[
            "5 AI chat messages per day",
            "3 quiz generations per day",
            "Basic diagram generation",
            "Upload up to 5 files",
            "Community support",
        ],
        is_current=False,
    ),
    BillingPlan(
        id="pro",
        name="Pro",
        tagline="For serious students",
        price="$12",
        period="USD/month",
        features=[
            "Everything in Free and:",
            "Unlimited AI chat messages",
            "Unlimited quiz generations",
            "Advanced diagram generation",
            "Upload up to 50 files",
            "Priority support",
            "Study plan generation",
            "Voice input & output",
            "Translation to 8 languages",
        ],
        is_current=False,
    ),
    BillingPlan(
        id="max",
        name="Max",
        tagline="For power users & teams",
        price="From $30",
        period="USD/month",
        features=[
            "Everything in Pro, plus:",
            "Unlimited file uploads",
            "Custom AI model tuning",
            "Team collaboration",
            "API access",
            "Dedicated support",
            "Advanced analytics",
            "Custom integrations",
        ],
        is_current=False,
    ),
]


# ── GET /settings ─────────────────────────────────────────────────────────────

@router.get("/")
async def get_user_settings(user_id: str = Query(...)):
    """Fetch all settings for a user."""
    try:
        settings = await get_settings(user_id)
        return settings
    except Exception as e:
        print(f"[settings/get] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── PUT /settings ─────────────────────────────────────────────────────────────

@router.put("/")
async def update_user_settings(
    request: SettingsUpdateRequest,
    user_id: str = Query(...),
):
    """Update user settings (partial merge)."""
    try:
        updates = {}
        if request.profile is not None:
            updates["profile"] = request.profile.model_dump()
        if request.notifications is not None:
            updates["notifications"] = request.notifications.model_dump()
        if request.ai_preferences is not None:
            updates["ai_preferences"] = request.ai_preferences.model_dump()
        if request.appearance is not None:
            updates["appearance"] = request.appearance.model_dump()

        result = await update_settings(user_id, updates)
        return result
    except Exception as e:
        print(f"[settings/update] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /settings/account ────────────────────────────────────────────────────

@router.get("/account", response_model=AccountInfo)
async def get_account_info(user_id: str = Query(...)):
    """
    Returns account information.
    Since auth is not implemented, this returns placeholder data.
    """
    org_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, user_id))

    sessions = [
        ActiveSession(
            device="Chrome (Linux)",
            location="Local Development",
            created=datetime.now(timezone.utc).strftime("%b %d, %Y, %I:%M %p"),
            updated=datetime.now(timezone.utc).strftime("%b %d, %Y, %I:%M %p"),
            is_current=True,
        ),
    ]

    return AccountInfo(
        user_id=user_id,
        organization_id=org_id,
        sessions=sessions,
    )


# ── POST /settings/account/logout ────────────────────────────────────────────

@router.post("/account/logout")
async def logout_account(user_id: str = Query(...)):
    """
    Placeholder logout endpoint.
    Since no auth is implemented, just returns success.
    """
    return {"message": "Logged out successfully", "user_id": user_id}


# ── DELETE /settings/account ─────────────────────────────────────────────────

@router.delete("/account")
async def delete_account(user_id: str = Query(...)):
    """
    Placeholder delete account endpoint.
    Since no auth is implemented, just returns success.
    """
    return {"message": "Account deletion requested", "user_id": user_id}


# ── GET /settings/billing ────────────────────────────────────────────────────

@router.get("/billing", response_model=BillingResponse)
async def get_billing(user_id: str = Query(...)):
    """Returns billing plans with the user's current plan marked."""
    try:
        settings = await get_settings(user_id)
        current_plan = settings.get("current_plan", "free")

        plans_with_current = []
        for plan in PLANS:
            plan_copy = plan.model_copy()
            plan_copy.is_current = (plan.id == current_plan)
            plans_with_current.append(plan_copy)

        return BillingResponse(
            current_plan=current_plan,
            plans=plans_with_current,
        )
    except Exception as e:
        print(f"[settings/billing] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /settings/billing/upgrade ──────────────────────────────────────────

class UpgradePlanRequest(BaseModel):
    plan_id: str


@router.post("/billing/upgrade")
async def upgrade_plan(
    request: UpgradePlanRequest,
    user_id: str = Query(...),
):
    """Simulate upgrading to a new plan."""
    valid_ids = {p.id for p in PLANS}
    if request.plan_id not in valid_ids:
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    try:
        result = await update_plan(user_id, request.plan_id)
        plan_name = next(p.name for p in PLANS if p.id == request.plan_id)
        return {"message": f"Upgraded to {plan_name} plan", "current_plan": request.plan_id}
    except Exception as e:
        print(f"[settings/billing/upgrade] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /settings/connectors ────────────────────────────────────────────────

@router.get("/connectors", response_model=ConnectorsResponse)
async def get_connectors(user_id: str = Query(...)):
    """Returns all connectors with their connection status."""
    try:
        settings = await get_settings(user_id)
        connectors = settings.get("connectors", [])
        return ConnectorsResponse(
            connectors=[ConnectorItem(**c) for c in connectors],
        )
    except Exception as e:
        print(f"[settings/connectors] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /settings/connectors/toggle ────────────────────────────────────────

@router.post("/connectors/toggle")
async def toggle_connector_endpoint(
    request: ConnectorToggleRequest,
    user_id: str = Query(...),
):
    """Connect or disconnect a connector."""
    try:
        result = await toggle_connector(user_id, request.connector_id, request.action)
        connectors = result.get("connectors", [])
        target = next((c for c in connectors if c["id"] == request.connector_id), None)
        status = "connected" if target and target.get("connected") else "disconnected"
        return {
            "message": f"{request.connector_id} {status}",
            "connector": target,
        }
    except Exception as e:
        print(f"[settings/connectors/toggle] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
