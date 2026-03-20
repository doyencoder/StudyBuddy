"""
Service: Sessions
Tracks study time via 60-second heartbeat pings stored in Cosmos DB.

Document shape (one per user per day):
{
  "id": "student-001_2026-03-20",
  "user_id": "student-001",
  "date": "2026-03-20",
  "minutes": 42          ← incremented by 1 each heartbeat (1 ping = 1 min)
}
"""

import os
from datetime import datetime, timezone, timedelta
from azure.cosmos.aio import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from azure.cosmos import PartitionKey
from dotenv import load_dotenv

load_dotenv()

DB_NAME         = os.getenv("AZURE_COSMOS_DB_NAME", "studybuddy")
SESSIONS_CONTAINER = "sessions"


def _get_client() -> CosmosClient:
    conn = os.getenv("AZURE_COSMOS_CONNECTION_STRING")
    if not conn:
        raise ValueError("AZURE_COSMOS_CONNECTION_STRING is not set")
    return CosmosClient.from_connection_string(conn)


async def ensure_sessions_container():
    """Create the sessions container if it doesn't exist. Called on startup."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        try:
            await db.create_container_if_not_exists(
                id=SESSIONS_CONTAINER,
                partition_key=PartitionKey(path="/user_id"),
            )
            print(f"[sessions] Container '{SESSIONS_CONTAINER}' ready.")
        except Exception as e:
            print(f"[sessions] Container check error (non-fatal): {e}")


async def record_heartbeat(user_id: str) -> int:
    """
    Increments today's minute counter for the user by 1.
    Returns the new total minutes for today.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    doc_id = f"{user_id}_{today}"

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SESSIONS_CONTAINER)

        try:
            doc = await container.read_item(item=doc_id, partition_key=user_id)
            doc["minutes"] = doc.get("minutes", 0) + 1
            await container.replace_item(item=doc_id, body=doc)
            return doc["minutes"]
        except CosmosResourceNotFoundError:
            # First heartbeat of the day — create the document
            new_doc = {
                "id": doc_id,
                "user_id": user_id,
                "date": today,
                "minutes": 1,
            }
            await container.create_item(body=new_doc)
            return 1


async def get_weekly_minutes(user_id: str) -> dict:
    """
    Returns total study minutes and a per-day breakdown for the last 7 days.
    """
    today = datetime.now(timezone.utc)
    # Build the list of last 7 days as strings
    days = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(SESSIONS_CONTAINER)

        daily = []
        total = 0

        for day in days:
            doc_id = f"{user_id}_{day}"
            try:
                doc = await container.read_item(item=doc_id, partition_key=user_id)
                mins = doc.get("minutes", 0)
            except CosmosResourceNotFoundError:
                mins = 0

            total += mins
            daily.append({"date": day, "minutes": mins})

        return {
            "total_minutes": total,
            "total_hours": round(total / 60, 1),
            "daily": daily,
        }