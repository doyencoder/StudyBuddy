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
CHAT_MODEL = "gemini-2.5-flash"
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 4

# When the student has uploaded material and chunks were found
SYSTEM_PROMPT_RAG = """You are StudyBuddy, an educational AI assistant.
Answer ONLY based on the context provided from the student's own study material.
If the answer is not in the context, say: I could not find this in your uploaded material.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers clear, structured, and student-friendly."""

# When no uploaded material exists or nothing relevant was found
SYSTEM_PROMPT_GENERAL = """You are StudyBuddy, an educational AI assistant.
Answer the student's question using your general knowledge.
Be accurate, clear, and student-friendly.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers structured and easy to understand."""


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
    client = _get_client()

    if context_chunks:
        context_text = "\n\n---\n\n".join(
            f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
        )
        prompt = f"""Use the following context from the student's study material to answer the question.

CONTEXT:
{context_text}

QUESTION:
{question}
"""
        system_instruction = SYSTEM_PROMPT_RAG
    else:
        prompt = question
        system_instruction = SYSTEM_PROMPT_GENERAL

    def _stream():
        return client.models.generate_content_stream(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=system_instruction),
        )

    response = _call_with_retry(_stream)

    for chunk in response:
        if chunk.text:
            yield chunk.text


def generate_mermaid(
    topic: str,
    diagram_type: str,
    context_chunks: List[str],
) -> str:
    """
    Generates valid Mermaid syntax for a flowchart or concept diagram.
    If context_chunks is empty, falls back to Gemini general knowledge.

    diagram_type:
      "flowchart" -> Mermaid flowchart TD
      "diagram"   -> Mermaid mindmap
    """
    client = _get_client()

    context_text = (
        "\n\n---\n\n".join(f"[Chunk {i+1}]\n{c}" for i, c in enumerate(context_chunks))
        if context_chunks
        else "No specific material uploaded. Use your general knowledge about this topic."
    )

    if diagram_type == "flowchart":
        format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- First line must be exactly: flowchart TD
- Node IDs: single letters or short alphanumeric only e.g. A B C1 D2
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars like & % # quote marks
- If you need parens, rephrase e.g. write -when applicable- instead of -if applicable-
- Maximum 12 nodes total
- No markdown fences, no explanation, no comments. Output ONLY the raw Mermaid code."""
    else:
        format_instructions = """Output ONLY a valid Mermaid mindmap. Rules:
- First line must be exactly: mindmap
- Second line must be indented 2 spaces: root((TopicName))
- Children indented 4 spaces: plain word labels only
- Grandchildren indented 6 spaces: plain word labels only
- CRITICAL: labels must NEVER contain parentheses, brackets, braces, or special chars
- Use plain simple words only in every label
- Maximum 1 root, 5 branches, 3 leaves per branch
- No markdown fences, no explanation, no comments. Output ONLY the raw Mermaid code."""

    prompt = f"""You are a visual learning assistant. Create a {diagram_type} for the topic: "{topic}".

STUDY MATERIAL CONTEXT:
{context_text}

{format_instructions}"""

    def _generate():
        response = client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You output ONLY valid Mermaid diagram syntax. "
                    "No markdown fences, no explanation, no code blocks. "
                    "Start your response directly with flowchart TD or mindmap."
                ),
                temperature=0.3,
            ),
        )
        return response.text

    raw = _call_with_retry(_generate)

    # Strip any accidental markdown fences Gemini might add
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()

    return cleaned