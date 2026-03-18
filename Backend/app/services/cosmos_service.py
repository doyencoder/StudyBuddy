import json as _json
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

_PENDING_UNSET = object()  # sentinel — means "don't touch pending_intent field"


async def save_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    pending_intent_update=_PENDING_UNSET,
) -> Dict[str, Any]:
    """
    Appends a single message to an existing conversation document.
    Uses read-then-replace since Cosmos NoSQL doesn't support atomic array push.

    pending_intent_update:
        _PENDING_UNSET (default) → do not touch the pending_intent field
        None                     → clear the pending_intent field
        str                      → set the pending_intent field to that value
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
            item = await container.read_item(
                item=conversation_id,
                partition_key=user_id,
            )
            item["messages"].append(message)
            # Update pending_intent only when explicitly requested
            if pending_intent_update is not _PENDING_UNSET:
                if pending_intent_update is None:
                    item.pop("pending_intent", None)
                else:
                    item["pending_intent"] = pending_intent_update
            await container.replace_item(item=conversation_id, body=item)

        except CosmosResourceNotFoundError:
            new_doc = {
                "id": conversation_id,
                "conversation_id": conversation_id,
                "user_id": user_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "messages": [message],
            }
            if pending_intent_update is not _PENDING_UNSET and pending_intent_update is not None:
                new_doc["pending_intent"] = pending_intent_update
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


async def get_conversation_full(conversation_id: str) -> Dict[str, Any]:
    """
    Fetches the full conversation document returning both messages and metadata.
    Returns {"messages": [...], "pending_intent": str|None} — no extra Cosmos
    round trip vs get_messages() since it reuses the same query.
    Returns safe defaults if the conversation does not exist yet.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        try:
            query = "SELECT * FROM c WHERE c.conversation_id = @cid"
            parameters = [{"name": "@cid", "value": conversation_id}]
            results = []
            async for item in container.query_items(query=query, parameters=parameters):
                results.append(item)

            if not results:
                return {"messages": [], "pending_intent": None}

            doc = results[0]
            messages = doc.get("messages", [])
            messages.sort(key=lambda m: m.get("timestamp", ""))
            return {"messages": messages, "pending_intent": doc.get("pending_intent")}

        except CosmosResourceNotFoundError:
            return {"messages": [], "pending_intent": None}


async def update_message_content(
    conversation_id: str,
    user_id: str,
    message_id: str,
    new_content: str,
) -> bool:
    """
    Replaces the content (and refreshes the timestamp) of a specific message
    identified by its message_id within the conversation's messages array.

    Used by POST /chat/regenerate so that regenerating an assistant message
    UPDATES the existing Cosmos entry instead of appending a duplicate.
    Returns True if the message was found and updated, False otherwise.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        try:
            item = await container.read_item(item=conversation_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            return False

        updated = False
        for msg in item.get("messages", []):
            if msg.get("id") == message_id:
                msg["content"] = new_content
                msg["timestamp"] = datetime.now(timezone.utc).isoformat()
                updated = True
                break

        if updated:
            await container.replace_item(item=conversation_id, body=item)

        return updated


async def update_message_json(
    conversation_id: str,
    user_id: str,
    match_key: str,
    match_value: str,
    patch: Dict[str, Any],
) -> bool:
    """
    Finds the first assistant message in the conversation whose content is JSON
    containing match_key == match_value, merges patch into it, and saves back.
    Returns True if a message was found and updated, False otherwise.
    Used to persist quiz submission results and study plan goal-saved state.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        try:
            item = await container.read_item(item=conversation_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            return False

        updated = False
        for msg in item.get("messages", []):
            if msg.get("role") != "assistant":
                continue
            raw = msg.get("content", "")
            if not raw.startswith('{"__type":'):
                continue
            try:
                parsed = _json.loads(raw)
            except Exception:
                continue
            if str(parsed.get(match_key)) == str(match_value):
                parsed.update(patch)
                msg["content"] = _json.dumps(parsed)
                updated = True
                break

        if updated:
            await container.replace_item(item=conversation_id, body=item)

        return updated


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
    conversation_id: str = "",
    fun_fact: str = "",
) -> None:
    """
    Creates a new quiz document in Cosmos DB when a quiz is generated.
    Stores questions with their correct answers (never sent to frontend).
    fun_fact is stored here and returned to frontend at generate time.
    weak_area_labels is pre-populated as None per question — filled by
    POST /quiz/preclassify while the student is attempting the quiz.
    conversation_id is stored so the submit endpoint can update the
    conversation history message with the final submitted state.
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
        "conversation_id": conversation_id,
        "fun_fact": fun_fact,
        "weak_area_labels": None,    # filled by /quiz/preclassify
    }

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)
        await container.create_item(body=document)


async def patch_weak_area_labels(quiz_id: str, user_id: str, labels: list) -> None:
    """
    Stores pre-classified weak area labels for all questions.
    Called by POST /quiz/preclassify while the student is taking the quiz.
    Submit will use these cached labels instead of calling Gemini per question.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)
        item = await container.read_item(item=quiz_id, partition_key=user_id)
        item["weak_area_labels"] = labels
        await container.replace_item(item=quiz_id, body=item)


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
            SELECT c.id, c.user_id, c.topic, c.created_at,
                   c.submitted, c.score, c.correct_count,
                   c.total_questions, c.weak_areas
            FROM c
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