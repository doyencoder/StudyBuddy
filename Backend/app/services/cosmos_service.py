import os
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any

from azure.cosmos.aio import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from dotenv import load_dotenv

load_dotenv()

# ── Constants ─────────────────────────────────────────────────────────────────

DB_NAME = os.getenv("AZURE_COSMOS_DB_NAME", "studybuddy")
CONVERSATIONS_CONTAINER = "conversations"


# ── Client helper ─────────────────────────────────────────────────────────────

def _get_client() -> CosmosClient:
    """
    Returns an async CosmosClient using the NoSQL connection string.
    The connection string format:
      AccountEndpoint=https://....documents.azure.com:443/;AccountKey=...==;
    """
    connection_string = os.getenv("AZURE_COSMOS_CONNECTION_STRING")
    if not connection_string:
        raise ValueError("AZURE_COSMOS_CONNECTION_STRING is not set in .env")
    return CosmosClient.from_connection_string(connection_string)


# ── Public Functions ──────────────────────────────────────────────────────────

async def create_conversation(user_id: str) -> str:
    """
    Creates a new conversation document in Cosmos DB and returns its ID.
    Called when a user starts a fresh chat (no conversation_id yet).
    """
    conversation_id = str(uuid.uuid4())

    document = {
        "id": conversation_id,
        "conversation_id": conversation_id,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "messages": [],
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)
        await container.create_item(body=document)

    return conversation_id


async def save_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
) -> Dict[str, Any]:
    """
    Appends a single message to an existing conversation document.
    Uses read-then-replace since Cosmos NoSQL doesn't support
    atomic array push like MongoDB does.
    """
    message = {
        "id": str(uuid.uuid4()),
        "role": role,
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        try:
            # Read the existing conversation document
            item = await container.read_item(
                item=conversation_id,
                partition_key=user_id,
            )
            # Append new message and write back
            item["messages"].append(message)
            await container.replace_item(item=conversation_id, body=item)

        except CosmosResourceNotFoundError:
            # Safety net: conversation doc missing — create it now
            new_doc = {
                "id": conversation_id,
                "conversation_id": conversation_id,
                "user_id": user_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "messages": [message],
            }
            await container.create_item(body=new_doc)

    return message


async def get_messages(conversation_id: str) -> List[Dict[str, Any]]:
    """
    Fetches all messages for a given conversation in chronological order.
    Returns an empty list if the conversation does not exist.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        try:
            # Query by conversation_id — we use it as both id and partition key
            query = "SELECT * FROM c WHERE c.conversation_id = @cid"
            parameters = [{"name": "@cid", "value": conversation_id}]

            results = []
            async for item in container.query_items(
                query=query,
                parameters=parameters,
            ):
                results.append(item)

            if not results:
                return []

            messages = results[0].get("messages", [])
            messages.sort(key=lambda m: m.get("timestamp", ""))
            return messages

        except CosmosResourceNotFoundError:
            return []


async def list_conversations(user_id: str) -> List[Dict[str, Any]]:
    """
    Returns all conversations for a given user (lightweight — no messages).
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        query = "SELECT c.conversation_id, c.created_at FROM c WHERE c.user_id = @user_id"
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            results.append(item)

        return results