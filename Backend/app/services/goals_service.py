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


def _get_client() -> CosmosClient:
    connection_string = os.getenv("AZURE_COSMOS_CONNECTION_STRING")
    if not connection_string:
        raise ValueError("AZURE_COSMOS_CONNECTION_STRING is not set in .env")
    return CosmosClient.from_connection_string(connection_string)


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
    Returns all goals for a given user, sorted by end_date ascending (nearest first).
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)

        query = (
            "SELECT * FROM c WHERE c.user_id = @user_id "
            "ORDER BY c.end_date ASC"
        )
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            results.append(item)

        return results


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

        await container.replace_item(item=goal_id, body=item, partition_key=user_id)
        return item


async def delete_goal(goal_id: str, user_id: str) -> None:
    """
    Deletes a goal document.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(GOALS_CONTAINER)
        await container.delete_item(item=goal_id, partition_key=user_id)
