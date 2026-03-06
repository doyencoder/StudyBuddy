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
DIAGRAMS_CONTAINER = "diagrams"


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


async def ensure_conversation(user_id: str, conversation_id: str, title: str = "") -> None:
    document = {
        "id": conversation_id,
        "conversation_id": conversation_id,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "messages": [],
        "title": title,
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)
        await container.upsert_item(body=document)

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

        query = "SELECT c.conversation_id, c.created_at, c.messages, c.title FROM c WHERE c.user_id = @user_id ORDER BY c.created_at DESC"
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            results.append(item)

        return results
    

# ── Quiz Container ─────────────────────────────────────────────────────────────

QUIZZES_CONTAINER = "quizzes"


async def save_quiz(
    user_id: str,
    quiz_id: str,
    topic: str,
    questions: list,
) -> None:
    """
    Creates a new quiz document in Cosmos DB when a quiz is generated.
    Stores questions with their correct answers (never sent to frontend).
    """
    document = {
        "id": quiz_id,
        "user_id": user_id,
        "topic": topic,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "submitted": False,
        "questions": questions,      # full question data including correct_index
        "score": None,
        "correct_count": None,
        "total_questions": len(questions),
        "weak_areas": [],
        "results": [],
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)
        await container.create_item(body=document)


async def get_quiz(quiz_id: str, user_id: str) -> Dict[str, Any]:
    """
    Fetches a single quiz document by quiz_id.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)
        item = await container.read_item(item=quiz_id, partition_key=user_id)
        return item


async def submit_quiz(
    quiz_id: str,
    user_id: str,
    score: int,
    correct_count: int,
    total_questions: int,
    weak_areas: list,
    results: list,
) -> None:
    """
    Updates the quiz document with the user's submitted answers and results.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)

        item = await container.read_item(item=quiz_id, partition_key=user_id)
        item["submitted"] = True
        item["score"] = score
        item["correct_count"] = correct_count
        item["total_questions"] = total_questions
        item["weak_areas"] = weak_areas
        item["results"] = results

        await container.replace_item(item=quiz_id, body=item)


async def list_quizzes(user_id: str) -> list:
    """
    Returns all submitted quizzes for a user, newest first.
    Used by the My Quizzes page.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)

        query = """
            SELECT * FROM c
            WHERE c.user_id = @user_id
            AND c.submitted = true
            ORDER BY c.created_at DESC
        """
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            results.append(item)

        return results


# ── Diagrams ──────────────────────────────────────────────────────────────────

async def save_diagram(
    user_id: str,
    conversation_id: str,
    diagram_type: str,        # "flowchart" | "diagram"
    topic: str,
    mermaid_code: str,
) -> Dict[str, Any]:
    """
    Saves a generated Mermaid diagram to the diagrams container.
    Stored independently from the conversation so it persists
    in ImagesPage even after the chat session changes.

    diagram_type: "flowchart" or "diagram"
    """
    diagram_id = str(uuid.uuid4())

    document = {
        "id": diagram_id,
        "diagram_id": diagram_id,
        "user_id": user_id,
        "conversation_id": conversation_id,   # which chat it came from (for context)
        "type": diagram_type,
        "topic": topic,
        "mermaid_code": mermaid_code,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(DIAGRAMS_CONTAINER)
        await container.create_item(body=document)

    return document


async def save_image_diagram(
    user_id: str,
    conversation_id: str,
    topic: str,
    image_url: str,
) -> Dict[str, Any]:
    """
    Saves an AI-generated image (from Imagen 3) to the diagrams container.
    Uses type="image" to distinguish from Mermaid-based flowcharts/mindmaps.
    mermaid_code is stored as empty string so existing queries don't break.
    """
    diagram_id = str(uuid.uuid4())

    document = {
        "id": diagram_id,
        "diagram_id": diagram_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "type": "image",
        "topic": topic,
        "mermaid_code": "",          # empty — not applicable for real images
        "image_url": image_url,      # Azure Blob SAS URL
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(DIAGRAMS_CONTAINER)
        await container.create_item(body=document)

    return document


async def list_diagrams(user_id: str) -> List[Dict[str, Any]]:
    """
    Returns all diagrams for a given user, newest first.
    Used by ImagesPage to show the full history across all conversations.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(DIAGRAMS_CONTAINER)

        query = (
            "SELECT c.diagram_id, c.type, c.topic, c.mermaid_code, c.image_url, c.created_at, c.conversation_id "
            "FROM c WHERE c.user_id = @user_id "
            "ORDER BY c.created_at DESC"
        )
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            results.append(item)

        return results