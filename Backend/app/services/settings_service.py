"""
Service: Settings
Manages user settings, connectors and billing info in Cosmos DB.
"""

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


def _get_client() -> CosmosClient:
    connection_string = os.getenv("AZURE_COSMOS_CONNECTION_STRING")
    if not connection_string:
        raise ValueError("AZURE_COSMOS_CONNECTION_STRING is not set in .env")
    return CosmosClient.from_connection_string(connection_string)


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
    "profile": {"full_name": "", "display_name": ""},
    "notifications": {
        "goal_reminders": False,
        "quiz_reminders": False,
        "study_streak_alerts": False,
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
                item["updated_at"] = datetime.now(timezone.utc).isoformat()
                await container.upsert_item(body=item)

            return item
        except CosmosResourceNotFoundError:
            # Return defaults without saving
            return {
                "id": user_id,
                "user_id": user_id,
                **DEFAULT_SETTINGS,
                "connectors": [c.copy() for c in DEFAULT_CONNECTORS],
                "current_plan": "free",
                "updated_at": None,
            }


async def update_settings(user_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    """Merge updates into settings doc. Creates if not exists."""
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

        # Merge provided sections
        for section in ("profile", "notifications", "ai_preferences", "appearance"):
            if section in updates and updates[section] is not None:
                if section in item:
                    item[section].update(updates[section])
                else:
                    item[section] = updates[section]

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