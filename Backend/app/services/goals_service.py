"""
goals_service.py
CRUD operations for goals in the Cosmos DB `goals` container.
"""

import os
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from azure.cosmos.aio import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from dotenv import load_dotenv

load_dotenv()

DB_NAME = os.getenv("AZURE_COSMOS_DB_NAME", "studybuddy")
GOALS_CONTAINER = "goals"


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
        print("[goals_service] Singleton CosmosClient created")
    return _CosmosWrapper(_COSMOS_CLIENT)


async def create_goal(
    user_id: str,
    title: str,
    start_date: str,
    end_date: str,
    weekly_plan: list,
    progress: int = 0,
    reminder: Optional[dict] = None,
    completed_tasks: Optional[dict] = None,
) -> Dict[str, Any]:
    """
    Creates a new goal document in Cosmos DB.
    """
    goal_id = str(uuid.uuid4())

    document = {
        "id": goal_id,
        "goal_id": goal_id,
        "user_id": user_id,
        "title": title,
        "start_date": start_date,
        "end_date": end_date,
        "weekly_plan": weekly_plan,
        "progress": progress,
        "reminder": reminder or {"enabled": False, "type": "weekly"},
        "completed_tasks": completed_tasks or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)
        await container.create_item(body=document)

    return document


async def list_goals(user_id: str) -> List[Dict[str, Any]]:
    """
    Returns all ACTIVE goals for a given user (end_date >= today IST),
    sorted by end_date ascending (nearest first).

    Goals whose end_date has already passed are permanently deleted from
    Cosmos DB at query time so they never appear again.
    """
    from datetime import timedelta
    today_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)

        query = (
            "SELECT * FROM c WHERE c.user_id = @user_id "
            "ORDER BY c.end_date ASC"
        )
        parameters = [{"name": "@user_id", "value": user_id}]

        all_goals = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            all_goals.append(item)

        active_goals = []
        for goal in all_goals:
            end_date = goal.get("end_date", "")
            if end_date and end_date < today_ist:
                # Expired — delete permanently from Cosmos DB
                try:
                    await container.delete_item(
                        item=goal["id"],
                        partition_key=user_id,
                    )
                    print(f"[goals_service] Auto-deleted expired goal '{goal.get('title')}' (end_date={end_date})")
                except Exception as e:
                    print(f"[goals_service] Failed to delete expired goal {goal['id']}: {e}")
            else:
                active_goals.append(goal)

        return active_goals


async def get_goal(goal_id: str, user_id: str) -> Dict[str, Any]:
    """
    Fetches a single goal by ID.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)
        item = await container.read_item(item=goal_id, partition_key=user_id)
        return item


async def update_goal(
    goal_id: str,
    user_id: str,
    updates: dict,
) -> Dict[str, Any]:
    """
    Updates specific fields of a goal document.
    Accepts a dict of fields to update (title, weekly_plan, progress, reminder).
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)

        item = await container.read_item(item=goal_id, partition_key=user_id)

        for key in ["title", "weekly_plan", "progress", "reminder", "completed_tasks"]:
            if key in updates and updates[key] is not None:
                item[key] = updates[key]

        await container.replace_item(item=goal_id, body=item)
        return item


async def delete_goal(goal_id: str, user_id: str) -> None:
    """
    Deletes a goal document.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)
        await container.delete_item(item=goal_id, partition_key=user_id)