import json as _json
import os
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any

from azure.cosmos.aio import CosmosClient
from azure.cosmos import PartitionKey
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from dotenv import load_dotenv

load_dotenv()

# ── Constants ─────────────────────────────────────────────────────────────────

DB_NAME = os.getenv("AZURE_COSMOS_DB_NAME", "studybuddy")
CONVERSATIONS_CONTAINER = "conversations"
DIAGRAMS_CONTAINER = "diagrams"
FLASHCARDS_CONTAINER = "flashcards"


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


async def ensure_flashcards_container() -> None:
    """Create the flashcards container if it does not already exist."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        try:
            await db.create_container_if_not_exists(
                id=FLASHCARDS_CONTAINER,
                partition_key=PartitionKey(path="/user_id"),
            )
            print(f"[flashcards] Container '{FLASHCARDS_CONTAINER}' ready.")
        except Exception as e:
            print(f"[flashcards] Container check error (non-fatal): {e}")


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
        "updated_at": datetime.now(timezone.utc).isoformat(),
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
        "updated_at": datetime.now(timezone.utc).isoformat(),
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
    now_iso = datetime.now(timezone.utc).isoformat()

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        try:
            item = await container.read_item(
                item=conversation_id,
                partition_key=user_id,
            )
            item["messages"].append(message)
            item["updated_at"] = now_iso
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
                "created_at": now_iso,
                "updated_at": now_iso,
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
                return {
                    "conversation_id": conversation_id,
                    "title": "",
                    "messages": [],
                    "pending_intent": None,
                }

            doc = results[0]
            messages = doc.get("messages", [])
            messages.sort(key=lambda m: m.get("timestamp", ""))
            return {
                "conversation_id": doc.get("conversation_id", conversation_id),
                "title": doc.get("title", ""),
                "messages": messages,
                "pending_intent": doc.get("pending_intent"),
                # Dynamic model selection — None means "use server default"
                "model_provider": doc.get("model_provider"),
            }

        except CosmosResourceNotFoundError:
            return {
                "conversation_id": conversation_id,
                "title": "",
                "messages": [],
                "pending_intent": None,
            }


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


async def update_message_content(
    conversation_id: str,
    user_id: str,
    message_id: str,
    new_content: str,
) -> bool:
    """
    Updates the content field of a specific message in a conversation by message_id.
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
                updated = True
                break

        if updated:
            await container.replace_item(item=conversation_id, body=item)

        return updated


async def list_conversations(user_id: str) -> List[Dict[str, Any]]:
    """
    Returns all conversations for a given user (lightweight — no messages).
    Includes starred field so the frontend can sort starred chats to the top.
    Ordered by latest activity so an old chat bumps to the top after new prompts.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)

        query = (
            "SELECT c.conversation_id, c.created_at, c.updated_at, c.messages, c.title, c.starred "
            "FROM c WHERE c.user_id = @user_id"
        )
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(
            query=query,
            parameters=parameters,
        ):
            results.append(item)

        # Keep newest activity first, while handling legacy docs with no updated_at.
        results.sort(
            key=lambda c: c.get("updated_at") or c.get("created_at") or "",
            reverse=True,
        )

        return results


async def rename_conversation(conversation_id: str, user_id: str, new_title: str) -> bool:
    """
    Sets the title field of a conversation document to new_title.
    Returns True if updated, False if not found.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)
        try:
            item = await container.read_item(item=conversation_id, partition_key=user_id)
            item["title"] = new_title.strip()
            await container.replace_item(item=conversation_id, body=item)
            return True
        except CosmosResourceNotFoundError:
            return False


async def delete_conversation(conversation_id: str, user_id: str) -> bool:
    """
    Hard-deletes a conversation document from Cosmos DB.
    Returns True if deleted, False if not found.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)
        try:
            await container.delete_item(item=conversation_id, partition_key=user_id)
            return True
        except CosmosResourceNotFoundError:
            return False


async def star_conversation(conversation_id: str, user_id: str, starred: bool) -> bool:
    """
    Sets or clears the starred flag on a conversation document.
    Returns True if updated, False if not found.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)
        try:
            item = await container.read_item(item=conversation_id, partition_key=user_id)
            item["starred"] = starred
            await container.replace_item(item=conversation_id, body=item)
            return True
        except CosmosResourceNotFoundError:
            return False


async def set_conversation_provider(
    conversation_id: str,
    user_id: str,
    model_provider: str,
) -> bool:
    """
    Persists the model provider selection ("azure" | "gemini") to the
    conversation document so the choice survives page refreshes.

    Called once per conversation the first time the frontend sends a provider
    key that differs from what is already stored.  The read-then-replace is
    cheap because it always hits the Cosmos point-read path (partition key
    supplied).

    Returns True if updated, False if not found (safe to ignore — the
    frontend still has the correct value in local state).
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(CONVERSATIONS_CONTAINER)
        try:
            item = await container.read_item(
                item=conversation_id, partition_key=user_id
            )
            # Only write if the value actually changed — avoids a pointless
            # Cosmos RU charge when the user has not switched providers.
            if item.get("model_provider") == model_provider:
                return True
            item["model_provider"] = model_provider
            await container.replace_item(item=conversation_id, body=item)
            return True
        except CosmosResourceNotFoundError:
            return False


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
    unanswered_indices: list = [],
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
        item["unanswered_indices"] = unanswered_indices

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


async def delete_quiz(quiz_id: str, user_id: str) -> bool:
    """
    Hard-deletes a quiz document from Cosmos DB.
    Returns True if deleted, False if not found.
    The quiz is permanently removed — no soft-delete.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(QUIZZES_CONTAINER)
        try:
            await container.delete_item(item=quiz_id, partition_key=user_id)
            return True
        except CosmosResourceNotFoundError:
            return False


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


async def get_diagram(diagram_id: str, user_id: str) -> Dict[str, Any]:
    """
    Fetches a single diagram document by diagram_id including mermaid_code.
    Called lazily by GET /diagrams/{diagram_id} when the user opens the modal.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(DIAGRAMS_CONTAINER)
        item = await container.read_item(item=diagram_id, partition_key=user_id)
        return item


async def delete_diagram(diagram_id: str, user_id: str) -> None:
    """
    Deletes a single diagram document from Cosmos DB.
    Called by DELETE /diagrams/{diagram_id}.
    """
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(DIAGRAMS_CONTAINER)
        await container.delete_item(item=diagram_id, partition_key=user_id)


async def save_flashcard_deck(
    user_id: str,
    conversation_id: str,
    conversation_title: str,
    cards: list,
) -> Dict[str, Any]:
    """
    Upserts one flashcard deck per conversation.
    Regenerating flashcards for the same chat replaces the prior deck.
    """
    deck_id = f"flashcards::{conversation_id}"
    now_iso = datetime.now(timezone.utc).isoformat()

    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(FLASHCARDS_CONTAINER)

        created_at = now_iso
        try:
            existing = await container.read_item(item=deck_id, partition_key=user_id)
            created_at = existing.get("created_at", now_iso)
        except CosmosResourceNotFoundError:
            pass

        document = {
            "id": deck_id,
            "deck_id": deck_id,
            "user_id": user_id,
            "conversation_id": conversation_id,
            "conversation_title": conversation_title,
            "created_at": created_at,
            "updated_at": now_iso,
            "card_count": len(cards),
            "cards": cards,
        }

        await container.upsert_item(body=document)
        return document


async def list_flashcard_decks(user_id: str) -> List[Dict[str, Any]]:
    """Returns all flashcard decks for a user, newest first."""
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(FLASHCARDS_CONTAINER)

        query = (
            "SELECT c.deck_id, c.conversation_id, c.conversation_title, c.card_count, "
            "c.created_at, c.updated_at, c.cards "
            "FROM c WHERE c.user_id = @user_id "
            "ORDER BY c.updated_at DESC"
        )
        parameters = [{"name": "@user_id", "value": user_id}]

        results = []
        async for item in container.query_items(query=query, parameters=parameters):
            results.append(item)

        return results


async def get_flashcard_deck(user_id: str, conversation_id: str) -> Dict[str, Any]:
    """Fetches the flashcard deck for a conversation."""
    deck_id = f"flashcards::{conversation_id}"
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(FLASHCARDS_CONTAINER)
        return await container.read_item(item=deck_id, partition_key=user_id)


async def delete_flashcard_deck(user_id: str, conversation_id: str) -> bool:
    """Deletes the saved flashcards for a conversation."""
    deck_id = f"flashcards::{conversation_id}"
    async with _get_client() as client:
        db = client.get_database_client(DB_NAME)
        container = db.get_container_client(FLASHCARDS_CONTAINER)
        try:
            await container.delete_item(item=deck_id, partition_key=user_id)
            return True
        except CosmosResourceNotFoundError:
            return False