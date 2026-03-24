from typing import Any, Dict, List

from app.services.ai_service import generate_flashcards
from app.services.cosmos_service import get_conversation_full, save_flashcard_deck
from app.services.search_service import retrieve_all_chunks_ordered

FLASHCARD_TITLE_MAX_CHARS = 90
FLASHCARD_DESCRIPTION_MAX_CHARS = 140


def _extract_text_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    cleaned: List[Dict[str, str]] = []
    for message in messages:
        role = str(message.get("role", "")).strip().lower()
        raw = str(message.get("content", "") or "").strip()
        if not raw:
            continue

        # Skip structured assistant payloads such as quiz/diagram cards.
        if raw.startswith('{"__type":'):
            continue

        cleaned.append({"role": role or "assistant", "content": raw})
    return cleaned


def estimate_flashcard_count(messages: List[Dict[str, Any]]) -> int:
    """
    Scales deck size with chat length using the user-approved thresholds:
      very short -> 2
      short-medium -> 4
      medium -> 6
      long -> 7
      hard cap -> 10
    """
    cleaned = _extract_text_messages(messages)
    total_chars = sum(len(message["content"]) for message in cleaned)
    total_messages = len(cleaned)
    signal = total_chars + (total_messages * 120)

    if signal < 700:
        return 2
    if signal < 2200:
        return 4
    if signal < 5000:
        return 6
    if signal < 8500:
        return 7
    return 10


def _derive_conversation_title(
    stored_title: str,
    cleaned_messages: List[Dict[str, str]],
) -> str:
    title = (stored_title or "").strip()
    if title:
        return title

    first_user_message = next(
        (message["content"] for message in cleaned_messages if message["role"] == "user"),
        "",
    ).strip()
    if not first_user_message:
        return "Flashcards"

    compact = " ".join(first_user_message.split())
    return compact[:60].rstrip() or "Flashcards"


def _format_chat_history(cleaned_messages: List[Dict[str, str]], max_chars: int = 12000) -> str:
    lines = [f"{message['role'].capitalize()}: {message['content']}" for message in cleaned_messages]
    combined = "\n\n".join(lines)
    if len(combined) <= max_chars:
        return combined
    return combined[-max_chars:]


def _format_document_context(chunks: List[tuple], max_chars: int = 14000) -> str:
    if not chunks:
        return ""

    parts: List[str] = []
    current_size = 0
    for chunk_text, page_number, filename in chunks:
        label = f"[File: {filename or 'Unknown'} | Page {page_number}]"
        piece = f"{label}\n{chunk_text.strip()}".strip()
        if not piece:
            continue
        projected = current_size + len(piece) + 4
        if projected > max_chars:
            break
        parts.append(piece)
        current_size = projected

    return "\n\n---\n\n".join(parts)


def _truncate_for_card(text: str, max_chars: int) -> str:
    normalized = " ".join(str(text or "").split()).strip()
    if len(normalized) <= max_chars:
        return normalized

    truncated = normalized[:max_chars].rstrip()
    if " " in truncated:
        truncated = truncated.rsplit(" ", 1)[0].rstrip()
    return truncated


def _sanitize_cards(raw_cards: Any, requested_count: int) -> List[Dict[str, str]]:
    if not isinstance(raw_cards, list):
        return []

    sanitized: List[Dict[str, str]] = []
    for index, card in enumerate(raw_cards[:requested_count]):
        if not isinstance(card, dict):
            continue
        title = str(card.get("title", "")).strip()
        description = str(card.get("description", "")).strip()
        if not title or not description:
            continue
        sanitized.append(
            {
                "id": f"card_{index + 1}",
                "title": _truncate_for_card(title, FLASHCARD_TITLE_MAX_CHARS),
                "description": _truncate_for_card(
                    description,
                    FLASHCARD_DESCRIPTION_MAX_CHARS,
                ),
            }
        )
    return sanitized


async def generate_and_save_flashcards(user_id: str, conversation_id: str) -> Dict[str, Any]:
    conversation = await get_conversation_full(conversation_id)
    messages = conversation.get("messages", [])
    cleaned_messages = _extract_text_messages(messages)
    if not cleaned_messages:
        raise ValueError("Conversation has no usable messages for flashcard generation.")

    requested_count = estimate_flashcard_count(messages)
    chat_history = _format_chat_history(cleaned_messages)

    try:
        document_chunks = retrieve_all_chunks_ordered(user_id=user_id, conversation_id=conversation_id)
    except Exception as exc:
        print(f"[flashcards] Document retrieval failed, continuing with chat-only context: {exc}")
        document_chunks = []

    document_context = _format_document_context(document_chunks)
    conversation_title = _derive_conversation_title(
        stored_title=str(conversation.get("title", "") or ""),
        cleaned_messages=cleaned_messages,
    )

    result = generate_flashcards(
        conversation_title=conversation_title,
        chat_history=chat_history,
        document_context=document_context,
        num_cards=requested_count,
    )

    if result.get("__refused__"):
        return {"__refused__": True}

    cards = _sanitize_cards(result.get("cards", []), requested_count=requested_count)
    if not cards:
        raise ValueError("Flashcard generation returned no usable cards.")

    return await save_flashcard_deck(
        user_id=user_id,
        conversation_id=conversation_id,
        conversation_title=conversation_title,
        cards=cards,
    )
