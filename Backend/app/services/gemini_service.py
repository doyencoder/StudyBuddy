"""
gemini_service.py
Wraps all Gemini API calls using the new google.genai SDK:
  - embed_text()   → embed a document chunk
  - embed_query()  → embed a user query
  - chat_stream()  → stream a RAG chat response from Gemini 1.5 Flash
"""

import os
import time
from typing import List, Generator
from google import genai
from google.genai import types

EMBEDDING_MODEL = "gemini-embedding-001"
CHAT_MODEL = "gemini-1.5-flash"
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 4

SYSTEM_PROMPT = """You are StudyBuddy, an educational AI assistant.
Answer ONLY based on the context provided from the student's own study material.
If the answer is not in the context, say: I could not find this in your uploaded material.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers clear, structured, and student-friendly."""


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set in .env")
    return genai.Client(api_key=api_key)


def _call_with_retry(fn, *args, **kwargs):
    """Retry up to MAX_RETRIES times on Gemini rate-limit errors (429)."""
    for attempt in range(MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            error_msg = str(e).lower()
            if "429" in error_msg or "resource exhausted" in error_msg:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
            raise
    raise RuntimeError("Gemini API call failed after max retries")


def embed_text(text: str) -> List[float]:
    """
    Embed a document chunk for storage in Azure AI Search.
    task_type RETRIEVAL_DOCUMENT — optimised for indexing.
    """
    client = _get_client()

    def _embed():
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
        )
        return result.embeddings[0].values

    return _call_with_retry(_embed)


def embed_query(query: str) -> List[float]:
    """
    Embed a user's question for vector search against stored chunks.
    task_type RETRIEVAL_QUERY — optimised for querying.
    """
    client = _get_client()

    def _embed():
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=query,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
        )
        return result.embeddings[0].values

    return _call_with_retry(_embed)


def chat_stream(question: str, context_chunks: List[str]) -> Generator[str, None, None]:
    """
    Stream a Gemini 1.5 Flash response grounded in the retrieved context chunks.

    Yields:
        Text delta strings for SSE streaming to the frontend.
    """
    client = _get_client()

    context_text = "\n\n---\n\n".join(
        f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
    )

    prompt = f"""Use the following context from the student's study material to answer the question.

CONTEXT:
{context_text}

QUESTION:
{question}
"""

    def _stream():
        return client.models.generate_content_stream(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )

    response = _call_with_retry(_stream)

    for chunk in response:
        if chunk.text:
            yield chunk.text