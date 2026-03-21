"""
document_resolver.py
Utility to detect which uploaded file a user is referring to
when they say "document 2", "file 1", "second pdf" etc.
Used by study_plan, quiz, diagram, and regenerate services.
"""

def resolve_document_filter(topic: str, filenames: list) -> str | None:
    """
    Given a topic string and a list of filenames in the conversation,
    returns the filename the user is referring to, or None if no match.

    Examples:
        "study plan for document 2" + ["EC342.pdf", "mse1.pdf"] → "mse1.pdf"
        "quiz me on file 1"         + ["EC342.pdf", "mse1.pdf"] → "EC342.pdf"
        "flowchart of photosynthesis" + [...]                   → None
    """
    if not filenames or not topic:
        return None

    topic_lower = topic.lower()

    ordinal_map = {
        "first": 0, "1st": 0, "1": 0,
        "second": 1, "2nd": 1, "2": 1,
        "third": 2, "3rd": 2, "3": 2,
        "fourth": 3, "4th": 3, "4": 3,
    }

    trigger_words = ("document", "doc", "file", "pdf", "upload")

    # Check if topic contains any trigger word + ordinal combo
    for trigger in trigger_words:
        if trigger in topic_lower:
            for word, idx in ordinal_map.items():
                if word in topic_lower and len(filenames) > idx:
                    return filenames[idx]

    return None