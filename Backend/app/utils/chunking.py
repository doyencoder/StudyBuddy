"""
chunking.py
Splits extracted text into chunks for RAG indexing.

Two strategies:
  - chunk_text()            : legacy 500-word overlapping chunks (kept for backward compat)
  - chunk_by_paragraphs()   : paragraph + page-boundary aware chunking (preferred)
"""

from typing import List


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """
    Split text into overlapping word-based chunks.
    Legacy function — use chunk_by_paragraphs() for new uploads.

    Args:
        text:       The full extracted text from a document.
        chunk_size: Target number of words per chunk (default 500).
        overlap:    Number of words to repeat at the start of the next chunk (default 50).

    Returns:
        List of text chunk strings.
    """
    if not text or not text.strip():
        return []

    words = text.split()

    if len(words) <= chunk_size:
        return [" ".join(words)]

    chunks: List[str] = []
    start = 0

    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]
        chunks.append(" ".join(chunk_words))

        start += chunk_size - overlap

        if start < len(words) and len(words) - start < chunk_size * 0.1:
            tail = " ".join(words[start:])
            if chunks:
                chunks[-1] = chunks[-1] + " " + tail
            else:
                chunks.append(tail)
            break

    return chunks


def chunk_by_paragraphs(
    pages: list,
    min_words: int = 50,
    max_words: int = 400,
) -> list:
    """
    Chunk text by paragraph boundaries, strictly respecting page borders.
    A chunk never crosses a page boundary — page 1 content always stays
    in page 1 chunks.

    Args:
        pages:     List of {"page_number": int, "text": str} from extract_pages_from_url()
        min_words: Paragraphs shorter than this get merged with the next one
        max_words: Paragraphs longer than this get split by sentences

    Returns:
        List of {"text": str, "page_number": int}
    """
    chunks = []

    for page in pages:
        page_number = page["page_number"]
        raw_paragraphs = [p.strip() for p in page["text"].split("\n\n") if p.strip()]

        # ── Merge short paragraphs ────────────────────────────────────────────
        merged = []
        buffer = ""
        for para in raw_paragraphs:
            combined = (buffer + " " + para).strip() if buffer else para
            word_count = len(combined.split())
            if word_count < min_words:
                buffer = combined  # too short, keep accumulating
            else:
                merged.append(combined)
                buffer = ""
        if buffer:  # flush remaining buffer
            if merged:
                merged[-1] = merged[-1] + " " + buffer
            else:
                merged.append(buffer)

        # ── Split long paragraphs by sentence ────────────────────────────────
        for para in merged:
            words = para.split()
            if len(words) <= max_words:
                chunks.append({"text": para, "page_number": page_number})
            else:
                sentences = [
                    s.strip()
                    for s in para.replace("? ", "?|").replace("! ", "!|").replace(". ", ".|").split("|")
                    if s.strip()
                ]
                current = ""
                for sentence in sentences:
                    candidate = (current + " " + sentence).strip()
                    if len(candidate.split()) <= max_words:
                        current = candidate
                    else:
                        if current:
                            chunks.append({"text": current, "page_number": page_number})
                        current = sentence
                if current:
                    chunks.append({"text": current, "page_number": page_number})

    return chunks