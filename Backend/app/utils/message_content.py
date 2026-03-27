import json
from typing import Any, Optional


_TEXT_PAYLOAD_TYPES = {
    "user_with_attachments",
    "user_with_intent",
    "user_with_intent_and_attachments",
}


def parse_structured_message(raw: Any) -> Optional[dict]:
    """Parse stored JSON chat payloads, returning None for plain-text messages."""
    if not isinstance(raw, str):
        return None

    stripped = raw.strip()
    if not stripped.startswith('{"__type":'):
        return None

    try:
        parsed = json.loads(stripped)
    except Exception:
        return None

    return parsed if isinstance(parsed, dict) else None


def extract_message_text_content(raw: Any) -> str:
    """
    Returns the readable text portion of a stored chat message.

    Plain strings are returned unchanged.
    Structured cards that do not represent readable transcript text return "".
    """
    if raw is None:
        return ""

    if not isinstance(raw, str):
        raw = str(raw)

    stripped = raw.strip()
    if not stripped:
        return ""

    parsed = parse_structured_message(stripped)
    if not parsed:
        return stripped

    payload_type = str(parsed.get("__type", "") or "").strip()
    if payload_type in _TEXT_PAYLOAD_TYPES:
        return str(parsed.get("text", "") or "").strip()

    if payload_type == "regen_text_answer":
        return str(parsed.get("content", "") or "").strip()

    return ""
