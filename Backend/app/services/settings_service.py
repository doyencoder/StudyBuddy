"""
Service: Settings
Manages user settings, connectors and billing info in Cosmos DB.
"""

import copy
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List

from azure.cosmos.aio import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from azure.cosmos import PartitionKey
from dotenv import load_dotenv

load_dotenv()

DB_NAME = os.getenv("AZURE_COSMOS_DB_NAME", "studybuddy")
SETTINGS_CONTAINER = "settings"


class _CosmosWrapper:
    __slots__ = ("_client",)
    def __init__(self, client: CosmosClient):
        self._client = client
    async def __aenter__(self) -> CosmosClient:
        return self._client
    async def __aexit__(self, *args):
        pass

_COSMOS_CLIENT: CosmosClient | None = None

def _get_client() -> _CosmosWrapper:
    global _COSMOS_CLIENT
    if _COSMOS_CLIENT is None:
        connection_string = os.getenv("AZURE_COSMOS_CONNECTION_STRING")
        if not connection_string:
            raise ValueError("AZURE_COSMOS_CONNECTION_STRING is not set in .env")
        _COSMOS_CLIENT = CosmosClient.from_connection_string(connection_string)
        print("[settings_service] Singleton CosmosClient created")
    return _CosmosWrapper(_COSMOS_CLIENT)


async def ensure_settings_container():
    """Create the settings container if it doesn't exist."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        try:
            await db.create_container_if_not_exists(
                id=SETTINGS_CONTAINER,
                partition_key=PartitionKey(path="/user_id"),
            )
            print(f"[settings] Container '{SETTINGS_CONTAINER}' ready.")
        except Exception as e:
            print(f"[settings] Container check error (non-fatal): {e}")


# ── User Settings ─────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "profile": {"full_name": "", "display_name": "", "email": ""},
    "notifications": {
        "goal_reminders": False,
        "long_term_goals_reminder": False,
        "study_streak_alerts": False,
        "flashcard_review_reminders": False,
    },
    "ai_preferences": {
        "simplified_explanations": True,
        "auto_generate_flashcards": False,
    },
    "appearance": {
        "color_mode": "auto",
        "chat_font": "default",
        "voice": "buttery",
    },
}

DEFAULT_CONNECTORS = [
    {"id": "onedrive", "name": "Microsoft OneDrive", "icon": "onedrive", "connected": False, "connected_at": None},
    {"id": "outlook", "name": "Microsoft Outlook", "icon": "outlook", "connected": False, "connected_at": None},
    {"id": "teams", "name": "Microsoft Teams", "icon": "teams", "connected": False, "connected_at": None},
    {"id": "onenote", "name": "Microsoft OneNote", "icon": "onenote", "connected": False, "connected_at": None},
]


def _default_settings_doc(user_id: str) -> Dict[str, Any]:
    return {
        "id": user_id,
        "user_id": user_id,
        **copy.deepcopy(DEFAULT_SETTINGS),
        "connectors": [c.copy() for c in DEFAULT_CONNECTORS],
        "current_plan": "free",
    }


def _reconcile_settings_item(item: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    """Merge newly introduced default keys into an existing settings document."""
    changed = False

    for section in ("profile", "notifications", "ai_preferences", "appearance"):
        default_section = copy.deepcopy(DEFAULT_SETTINGS[section])
        current_section = item.get(section)

        if not isinstance(current_section, dict):
            item[section] = default_section
            changed = True
            continue

        merged = {**default_section, **current_section}
        if merged != current_section:
            item[section] = merged
            changed = True

    return item, changed


async def get_settings(user_id: str) -> Dict[str, Any]:
    """Fetch user settings. Returns defaults if not found.

    Always reconciles stored connectors against DEFAULT_CONNECTORS so that
    connector list changes (e.g. switching from Google to Microsoft) take effect
    for existing users without requiring a manual Cosmos DB edit.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SETTINGS_CONTAINER)
        try:
            item = await container.read_item(item=user_id, partition_key=user_id)
            item, changed = _reconcile_settings_item(item)

            # Reconcile connectors: build a fresh list from DEFAULT_CONNECTORS,
            # preserving connected/connected_at for any IDs that still match.
            current_ids = {c["id"] for c in DEFAULT_CONNECTORS}
            stored_map = {c["id"]: c for c in item.get("connectors", [])}
            reconciled = []
            for default_c in DEFAULT_CONNECTORS:
                if default_c["id"] in stored_map:
                    # Preserve connection state for matching IDs
                    merged = default_c.copy()
                    merged["connected"]    = stored_map[default_c["id"]].get("connected", False)
                    merged["connected_at"] = stored_map[default_c["id"]].get("connected_at", None)
                    reconciled.append(merged)
                else:
                    reconciled.append(default_c.copy())

            item["connectors"] = reconciled

            # Persist the reconciled list only if it changed (avoids unnecessary writes)
            stored_ids = [c["id"] for c in stored_map.values()]
            if stored_ids != [c["id"] for c in DEFAULT_CONNECTORS]:
                changed = True

            if changed:
                item["updated_at"] = datetime.now(timezone.utc).isoformat()
                await container.upsert_item(body=item)

            return item
        except CosmosResourceNotFoundError:
            # Return defaults without saving
            default_item = _default_settings_doc(user_id)
            default_item["updated_at"] = None
            return default_item


async def update_settings(user_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    """Merge updates into settings doc. Creates if not exists."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SETTINGS_CONTAINER)

        try:
            item = await container.read_item(item=user_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            item = _default_settings_doc(user_id)

        item, _ = _reconcile_settings_item(item)

        # Merge the four standard nested sections
        for section in ("profile", "notifications", "ai_preferences", "appearance"):
            if section in updates and updates[section] is not None:
                if section in item:
                    item[section].update(updates[section])
                else:
                    item[section] = updates[section]

        # Handle top-level curriculum fields (stored flat on the document, not nested)
        # curriculum_enabled can legitimately be False — use `is not None` not truthiness.
        for field in ("curriculum_board", "curriculum_grade"):
            if field in updates and updates[field] is not None:
                item[field] = updates[field]
        if "curriculum_enabled" in updates and updates["curriculum_enabled"] is not None:
            item["curriculum_enabled"] = updates["curriculum_enabled"]

        item["updated_at"] = datetime.now(timezone.utc).isoformat()
        await container.upsert_item(body=item)
        return item


async def toggle_connector(user_id: str, connector_id: str, action: str) -> Dict[str, Any]:
    """Connect or disconnect a connector for a user."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SETTINGS_CONTAINER)

        try:
            item = await container.read_item(item=user_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            item = {
                "id": user_id,
                "user_id": user_id,
                **DEFAULT_SETTINGS,
                "connectors": [c.copy() for c in DEFAULT_CONNECTORS],
                "current_plan": "free",
            }

        connectors = item.get("connectors", [c.copy() for c in DEFAULT_CONNECTORS])
        for conn in connectors:
            if conn["id"] == connector_id:
                if action == "connect":
                    conn["connected"] = True
                    conn["connected_at"] = datetime.now(timezone.utc).isoformat()
                else:
                    conn["connected"] = False
                    conn["connected_at"] = None
                break

        item["connectors"] = connectors
        item["updated_at"] = datetime.now(timezone.utc).isoformat()
        await container.upsert_item(body=item)
        return item


async def update_plan(user_id: str, plan_id: str) -> Dict[str, Any]:
    """Update the user's billing plan."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SETTINGS_CONTAINER)

        try:
            item = await container.read_item(item=user_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            item = {
                "id": user_id,
                "user_id": user_id,
                **DEFAULT_SETTINGS,
                "connectors": [c.copy() for c in DEFAULT_CONNECTORS],
                "current_plan": "free",
            }

        item["current_plan"] = plan_id
        item["updated_at"] = datetime.now(timezone.utc).isoformat()
        await container.upsert_item(body=item)
        return item

async def record_checkin(user_id: str, daily_goals_total: int, daily_goals_done: int) -> None:
    """Record that a user is active today and their daily goal completion status."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SETTINGS_CONTAINER)
        try:
            item = await container.read_item(item=user_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            item = {
                "id": user_id,
                "user_id": user_id,
                **DEFAULT_SETTINGS,
                "connectors": [c.copy() for c in DEFAULT_CONNECTORS],
                "current_plan": "free",
            }
        item["last_active_date"] = today
        item["daily_goals_total"] = daily_goals_total
        item["daily_goals_done"] = daily_goals_done
        item["updated_at"] = datetime.now(timezone.utc).isoformat()
        await container.upsert_item(body=item)


async def get_all_users_for_notifications() -> list:
    """Return all settings docs that have an email address set."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SETTINGS_CONTAINER)
        query = (
            "SELECT * FROM c WHERE "
            "IS_DEFINED(c.profile) AND "
            "IS_DEFINED(c.profile.email) AND "
            "c.profile.email != ''"
        )
        results = []
        async for item in container.query_items(
            query=query, enable_cross_partition_query=True
        ):
            results.append(item)
        return results