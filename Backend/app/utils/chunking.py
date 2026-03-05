"""
chunking.py
Splits extracted text into overlapping chunks for RAG indexing.
Strategy: 500-word chunks with 50-word overlap.
"""

from typing import List


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """
    Split text into overlapping word-based chunks.

    Args:
        text:       The full extracted text from a document.
        chunk_size: Target number of words per chunk (default 500).
        overlap:    Number of words to repeat at the start of the next chunk (default 50).

    Returns:
        List of text chunk strings.
    """
    if not text or not text.strip():
        return []

    # Normalise whitespace
    words = text.split()

    if len(words) <= chunk_size:
        # Short document — single chunk
        return [" ".join(words)]

    chunks: List[str] = []
    start = 0

    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]
        chunks.append(" ".join(chunk_words))

        # Advance by (chunk_size - overlap) so the next chunk re-uses the last
        # `overlap` words of the current chunk
        start += chunk_size - overlap

        # Stop if the remaining words would form a very small tail chunk
        # (less than 10% of chunk_size) — merge it into the previous chunk instead
        if start < len(words) and len(words) - start < chunk_size * 0.1:
            tail = " ".join(words[start:])
            if chunks:
                chunks[-1] = chunks[-1] + " " + tail
            else:
                chunks.append(tail)
            break

    return chunks