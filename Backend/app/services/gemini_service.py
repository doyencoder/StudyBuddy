"""
gemini_service.py
Wraps all Gemini API calls using the new google.genai SDK:
  - embed_text()   → embed a document chunk
  - embed_query()  → embed a user query
  - chat_stream()  → stream a RAG chat response from Gemini 1.5 Flash
  - generate_quiz_questions() → generate MCQ quiz
  - generate_mermaid()        → generate Mermaid diagram
  - generate_study_plan()     → generate structured study plan JSON
"""

import os
import json
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
The student has uploaded study material. Relevant excerpts from it are provided as CONTEXT in the user message.
Use that context to enrich and ground your answer where it is relevant to the question.
If the context does not cover the question at all, answer from your general knowledge — do NOT say the answer is not in the uploaded material.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers clear, structured, and student-friendly.

CRITICAL — Answer discipline:
- Answer ONLY what the current question asks. Nothing more.
- Do NOT bring up previous topics, subjects, or quiz content unless the student explicitly asks about them.
- Do NOT add follow-up questions on a different topic than the one being asked.
- Do NOT volunteer information the student did not ask for in this message.

CRITICAL — Conversation memory rule:
The conversation history may contain facts the student has shared (e.g. name, favourite players, preferences).
Treat these as established facts — BUT only recall them when the student is DIRECTLY and EXPLICITLY asking about them.
NEVER proactively mention prior personal facts or prior topics when answering an unrelated question."""

# When no uploaded material exists or nothing relevant was found
SYSTEM_PROMPT_GENERAL = """You are StudyBuddy, an educational AI assistant.
Answer the student's question using your general knowledge.
Be accurate, clear, and student-friendly.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers structured and easy to understand.

CRITICAL — Answer discipline:
- Answer ONLY what the current question asks. Nothing more.
- Do NOT bring up previous topics, subjects, or quiz content unless the student explicitly asks about them.
- Do NOT add follow-up questions on a different topic than the one being asked.
- Do NOT volunteer information the student did not ask for in this message.

CRITICAL — Conversation memory rule:
The conversation history may contain facts the student has shared (e.g. name, favourite players, preferences).
Treat these as established facts — BUT only recall them when the student is DIRECTLY and EXPLICITLY asking about them.
NEVER proactively mention prior personal facts or prior topics when answering an unrelated question."""


def _sanitize_and_parse_json(raw: str) -> any:
    """
    Robustly parses JSON that Gemini may have polluted with:
      - Markdown code fences  (```json ... ```)
      - Invalid control characters inside string values (\x00-\x1f except \t \n \r)
    Falls back to a second pass with aggressive whitespace normalisation.
    """
    import re

    # Strip markdown fences Gemini sometimes adds despite instructions
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    text = re.sub(r"```\s*$", "", text.strip())
    text = text.strip()

    # First attempt — plain parse (fast path, works most of the time)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Second attempt — strip invalid control chars (\x00-\x08, \x0b, \x0c, \x0e-\x1f)
    # We keep \t (\x09), \n (\x0a), \r (\x0d) which are legal in JSON outside strings.
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Third attempt — replace literal newlines/tabs INSIDE string literals only,
    # converting them to their escaped equivalents so the JSON becomes valid.
    def _escape_inner(m):
        s = m.group(0)
        s = s.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
        return s

    # Match JSON string values (simplified — handles the common Gemini output pattern)
    escaped = re.sub(r'"(?:[^"\\]|\\.)*"', _escape_inner, cleaned)
    return json.loads(escaped)


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


def _is_latin_script(text: str) -> bool:
    """
    Returns True if the message is predominantly written in Latin/Roman script
    (i.e. >80% of alphabetic characters are standard ASCII a-z A-Z).
    Used to detect Hinglish (e.g. 'mujhe ek summary do') vs true Devanagari.
    """
    alpha_chars = [c for c in text if c.isalpha()]
    if not alpha_chars:
        return True  # empty or numbers-only → treat as Latin
    latin_count = sum(1 for c in alpha_chars if ord(c) < 128)
    return (latin_count / len(alpha_chars)) > 0.8


def chat_stream(
    question: str,
    context_chunks: List[str],
    history: List[dict] = None,
) -> Generator[str, None, None]:
    """
    Streams a Gemini reply with full multi-turn conversation memory.

    history: list of prior messages [{\"role\": \"user\"|\"assistant\", \"content\": str}]
             fetched from Cosmos BEFORE the current user message was saved.
             If None or empty, behaves exactly as before (single-turn).

    The current user message (question) is always the final turn in the
    contents list so Gemini sees the complete conversation in order.
    """
    client = _get_client()

    # ── Build system prompt ───────────────────────────────────────────────────
    if context_chunks:
        context_text = "\n\n---\n\n".join(
            f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
        )
        # Inject RAG context into the current user turn only
        current_user_text = (
            f"Use the following context from the student's study material to answer the question.\n\n"
            f"CONTEXT:\n{context_text}\n\n"
            f"QUESTION:\n{question}"
        )
        system_instruction = SYSTEM_PROMPT_RAG
    else:
        current_user_text = question
        system_instruction = SYSTEM_PROMPT_GENERAL

    # ── Script mirroring ──────────────────────────────────────────────────────
    if _is_latin_script(question):
        system_instruction += (
            "\n\nIMPORTANT — Script rule: The user has written in Roman/Latin script. "
            "You MUST respond in Roman/Latin script as well. "
            "Do NOT use Devanagari, Tamil, Telugu, or any other non-Latin script. "
            "If the user is mixing Hindi and English (Hinglish), reply in Hinglish too "
            "(e.g. 'Photosynthesis ek process hai jisme plants sunlight use karte hain'). "
            "Match the user's exact language style."
        )

    # ── Build multi-turn contents list ────────────────────────────────────────
    # Strategy: "anchor + recent" windowing to prevent context being lost.
    #
    # LLMs suffer from "lost in the middle" — facts mentioned early in a long
    # conversation get deprioritized once many later messages accumulate.
    # Fix: always send the FIRST 4 messages (where users establish personal
    # context like names, favourite players, preferences) AND the LAST 10
    # messages (recent conversational thread), deduplicating any overlap.
    # This keeps early facts anchored at the top of the history regardless of
    # how long the conversation has grown.
    #
    # Additionally, we skip assistant messages whose content looks like a
    # JSON-embedded rich card (quiz/diagram/study_plan) — these are long
    # structured blobs that waste the context window and confuse the model.

    ANCHOR_COUNT = 4   # always include this many messages from the start
    RECENT_COUNT = 10  # always include this many messages from the end

    def _is_rich_card(msg: dict) -> bool:
        """Returns True for JSON-embedded quiz/diagram/study_plan assistant messages."""
        c = str(msg.get("content", ""))
        return msg.get("role") == "assistant" and c.startswith('{"__type":')

    contents = []

    if history:
        # Filter out rich-card messages entirely — they are not readable prose
        readable = [m for m in history if not _is_rich_card(m)]

        anchor  = readable[:ANCHOR_COUNT]
        recent  = readable[-RECENT_COUNT:] if len(readable) > ANCHOR_COUNT else []

        # Combine, preserving chronological order and deduplicating by index
        anchor_indices = set(range(len(anchor)))
        recent_start   = max(0, len(readable) - RECENT_COUNT)
        seen = set(anchor_indices)
        windowed = list(anchor)
        for i, msg in enumerate(readable[recent_start:], start=recent_start):
            if i not in seen:
                windowed.append(msg)
                seen.add(i)

        for msg in windowed:
            gemini_role = "user" if msg["role"] == "user" else "model"
            contents.append(
                types.Content(
                    role=gemini_role,
                    parts=[types.Part(text=str(msg.get("content", "")))],
                )
            )

    # Append the current user turn (always last)
    contents.append(
        types.Content(
            role="user",
            parts=[types.Part(text=current_user_text)],
        )
    )

    def _stream():
        return client.models.generate_content_stream(
            model=CHAT_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=system_instruction),
        )

    response = _call_with_retry(_stream)

    for chunk in response:
        if chunk.text:
            yield chunk.text


def generate_quiz_questions(context_chunks: List[str], topic: str, num_questions: int = 5) -> dict:
    """
    Uses Gemini to generate MCQ quiz questions plus one fun fact in a single call.
    - If context_chunks provided: generates strictly from the uploaded material.
    - If context_chunks is empty: generates from general knowledge on the topic.

    Returns: { "questions": [...], "fun_fact": "..." }
    """
    client = _get_client()

    if context_chunks:
        # ── Document-based mode ───────────────────────────────────────────────
        context_text = "\n\n---\n\n".join(
            f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
        )
        topic_line = f"Focus specifically on the topic: {topic}" if topic else "Cover the most important concepts from the material."

        prompt = f"""You are a quiz generator for students. Based ONLY on the study material below, generate exactly {num_questions} multiple choice questions.

{topic_line}

STUDY MATERIAL:
{context_text}

STRICT RULES:
- Generate exactly {num_questions} questions
- Each question must have exactly 4 options
- Only one option is correct
- Base every question strictly on the provided material — no outside knowledge
- The explanation must reference the material directly
- NEVER mention chunk numbers in any explanation (do NOT write "Chunk 1", "Chunk 2", "(Chunk 1 and 2)" etc.) — explain the answer in plain language only

Also generate exactly 1 fun_fact: a single interesting, surprising fact related to this topic.
It should be engaging and educational — something a student would find genuinely interesting.

Respond ONLY with a valid JSON object. No extra text. No markdown. No code fences.
The object must have exactly these two fields:
{{
  "questions": [
    {{
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correct_index": 0,
      "explanation": "why this answer is correct based on the material"
    }}
  ],
  "fun_fact": "one interesting fact related to this topic"
}}"""

    else:
        # ── General knowledge mode ────────────────────────────────────────────
        if not topic:
            topic = "general knowledge"

        prompt = f"""You are a quiz generator for students. Generate exactly {num_questions} multiple choice questions about: {topic}

STRICT RULES:
- Generate exactly {num_questions} questions
- Each question must have exactly 4 options
- Only one option is correct
- Questions should be educational and appropriate for students
- Vary the difficulty across questions

Also generate exactly 1 fun_fact: a single interesting, surprising fact related to {topic}.
It should be engaging and educational — something a student would find genuinely interesting.

Respond ONLY with a valid JSON object. No extra text. No markdown. No code fences.
The object must have exactly these two fields:
{{
  "questions": [
    {{
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correct_index": 0,
      "explanation": "why this answer is correct"
    }}
  ],
  "fun_fact": "one interesting fact related to {topic}"
}}"""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.4,
            ),
        )

    response = _call_with_retry(_generate)

    import json
    raw = response.text.strip()
    parsed = _sanitize_and_parse_json(raw)

    # Support both old array format (fallback) and new object format
    if isinstance(parsed, list):
        raw_questions = parsed
        fun_fact = "Did you know? The brain strengthens memories during sleep — a great reason to rest after studying!"
    else:
        raw_questions = parsed.get("questions", [])
        fun_fact = parsed.get("fun_fact") or "Did you know? Spaced repetition is one of the most effective study techniques proven by cognitive science!"

    sanitized = []
    for i, q in enumerate(raw_questions[:num_questions]):
        sanitized.append({
            "id": f"q{i + 1}",
            "question": q["question"],
            "options": q["options"],
            "correct_index": int(q["correct_index"]),
            "explanation": q["explanation"],
        })

    return {"questions": sanitized, "fun_fact": fun_fact}


def batch_classify_weak_areas(questions: list) -> list:
    """
    Sends ALL question texts in a SINGLE Gemini call and returns a label
    for each question in order.

    Used by POST /quiz/preclassify — runs while the student is attempting
    the quiz so labels are already cached in Cosmos by submit time.

    Args:
        questions: list of quiz question dicts (must have "question" key)

    Returns:
        list of short topic label strings, same length as questions.
        Falls back to "General" for any that can't be classified.
    """
    client = _get_client()

    numbered = "\n".join(
        f"{i + 1}. {q['question']}" for i, q in enumerate(questions)
    )

    prompt = f"""You are classifying quiz questions into academic subtopic labels.

For each question below, output a short label (2-5 words) describing the academic subtopic or concept it tests.

QUESTIONS:
{numbered}

Respond ONLY with a valid JSON array of strings, one label per question, in the same order.
No extra text. No markdown. No code fences. Example:
["Cell Division", "Electromagnetic Induction", "Photosynthesis", "General", "Newton's Laws"]"""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )

    try:
        response = _call_with_retry(_generate)
        labels = _sanitize_and_parse_json(response.text.strip())
        if isinstance(labels, list) and len(labels) == len(questions):
            return [str(l).strip() or "General" for l in labels]
        # Wrong length — pad or trim to match
        result = [str(l).strip() or "General" for l in labels]
        while len(result) < len(questions):
            result.append("General")
        return result[:len(questions)]
    except Exception:
        return ["General"] * len(questions)


def infer_topic_from_messages(messages: list) -> str:
    """
    Given a list of recent chat messages [{"role": ..., "content": ...}],
    asks Gemini to extract a clean 3-5 word topic that the student was
    studying. Falls back to "General Topic" if inference fails.

    Called by POST /chat/infer-topic when user requests a diagram
    mid-conversation without specifying a topic.
    """
    client = _get_client()

    # Build a readable conversation summary (cap content length to save tokens)
    conversation_text = "\n".join(
        f"{'Student' if m['role'] == 'user' else 'Assistant'}: {str(m.get('content', ''))[:300]}"
        for m in messages[-8:]   # last 8 messages max
        if m.get("role") in ("user", "assistant")
    )

    prompt = f"""Read this study conversation and extract the main topic being studied.
Return ONLY a short topic name (3-5 words max). No explanation, no punctuation, no quotes.
Examples of good responses: "Photosynthesis", "Newton Laws of Motion", "Cell Division", "Water Cycle"

CONVERSATION:
{conversation_text}

TOPIC:"""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.1),
        )

    response = _call_with_retry(_generate)
    topic = response.text.strip().strip('"').strip("'").strip(".")

    # Sanity check — if Gemini returned something too long or empty, fallback
    if not topic or len(topic) > 60:
        return "General Topic"

    return topic


def generate_image(topic: str, context_chunks: List[str]) -> bytes:
    """
    Generates a real AI image for a study topic using FLUX.1-schnell
    via the Hugging Face Inference API.
    If context_chunks are provided, the prompt is grounded in the student's
    uploaded material. Otherwise falls back to general knowledge.

    Returns raw PNG bytes ready to be uploaded to Azure Blob Storage.
    """
    import requests

    hf_token = os.getenv("HF_API_TOKEN")
    if not hf_token:
        raise ValueError("HF_API_TOKEN is not set in .env")

    if context_chunks:
        context_summary = " ".join(context_chunks[:3])[:400]
        prompt = (
        f"Detailed anatomical and scientific illustration of: {topic}. "
        f"Based on these study notes: {context_summary}. "
        "Style: clean artistic illustration, white background, no text, no labels, no words, visually accurate, educational artwork."
    )
    else:
        prompt = (
            f"Detailed anatomical and scientific illustration of: {topic}. "
            "Style: clean artistic illustration, white background, no text, no labels, no words, visually accurate, educational artwork."
        )

    api_url = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"

    response = requests.post(
        api_url,
        headers={
            "Authorization": f"Bearer {hf_token}",
            "Content-Type": "application/json",
        },
        json={"inputs": prompt},
        timeout=120,  # first request can take 20-30s if model is cold
    )

    if response.status_code == 503:
        # Model is loading — wait and retry once
        import time
        time.sleep(30)
        response = requests.post(
            api_url,
            headers={
                "Authorization": f"Bearer {hf_token}",
                "Content-Type": "application/json",
            },
            json={"inputs": prompt},
            timeout=120,
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Hugging Face API error {response.status_code}: {response.text[:300]}"
        )

    # HF returns raw image bytes directly
    return response.content


def generate_mermaid(
    topic: str,
    diagram_type: str,
    context_chunks: List[str],
    layout_hint: str = None,  # "circular" | "horizontal" | "vertical" | None
) -> str:
    """
    Generates valid Mermaid syntax for a flowchart or concept diagram.
    If context_chunks is empty, falls back to Gemini general knowledge.

    diagram_type:
      "flowchart" -> Mermaid flowchart (direction chosen intelligently)
      "diagram"   -> Mermaid mindmap

    layout_hint (optional, from user's raw message):
      "circular"   -> cyclic layout: last node loops back to first
      "horizontal" -> flowchart LR forced
      "vertical"   -> flowchart TD forced
      None         -> auto-detect from topic and content
    """
    client = _get_client()

    context_text = (
        "\n\n---\n\n".join(f"[Chunk {i+1}]\n{c}" for i, c in enumerate(context_chunks))
        if context_chunks
        else "No specific material uploaded. Use your general knowledge about this topic."
    )

    # ── Auto-detect circular topics when no explicit hint given ───────────────
    # Many scientific/biological processes are inherently cyclic — detect them
    # so the diagram automatically uses a circular layout even without the user
    # typing "circular".
    _CIRCULAR_KEYWORDS = {
        "cycle", "cycling", "circular", "krebs", "calvin", "citric acid",
        "water cycle", "carbon cycle", "nitrogen cycle", "rock cycle",
        "cell cycle", "menstrual cycle", "business cycle", "feedback loop",
        "recurring", "repeating", "continuous process", "closed loop",
        "photosynthesis cycle", "respiration cycle", "hydrological",
    }
    topic_lower = topic.lower()
    auto_circular = any(kw in topic_lower for kw in _CIRCULAR_KEYWORDS)

    effective_hint = layout_hint or ("circular" if auto_circular else None)

    if diagram_type == "flowchart":
        if effective_hint == "circular":
            format_instructions = """Output ONLY a valid Mermaid flowchart that represents a CIRCULAR / CYCLIC process. Rules:
- First line must be exactly: flowchart LR
- Represent the cycle by connecting the LAST node back to the FIRST node with an arrow, forming a closed loop.
- Use 4 to 8 nodes that represent the key stages of the cycle in order.
- Node IDs: single letters or short alphanumeric only e.g. A B C1 D2
- Node shapes: rounded A(Label) for all cycle stages  — rounded shapes look best in cycles
- Arrows: A --> B  and the last node must have an arrow pointing back to A to close the loop
- CRITICAL: node labels must NEVER contain parentheses or special chars like & % # quote marks
- Keep labels short: 2-4 words maximum per node
- No markdown fences, no explanation, no comments. Output ONLY the raw Mermaid code.
EXAMPLE STRUCTURE (Calvin Cycle):
flowchart LR
    A(CO2 Fixation) --> B(3-PGA Produced)
    B --> C(ATP and NADPH Used)
    C --> D(G3P Formed)
    D --> E(RuBP Regenerated)
    E --> A"""

        elif effective_hint == "horizontal":
            format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- First line must be exactly: flowchart LR
- Node IDs: single letters or short alphanumeric only e.g. A B C1 D2
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars like & % # quote marks
- Maximum 10 nodes total — group related steps into one node to stay concise
- No markdown fences, no explanation, no comments. Output ONLY the raw Mermaid code."""

        elif effective_hint == "vertical":
            format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- First line must be exactly: flowchart TD
- Node IDs: single letters or short alphanumeric only e.g. A B C1 D2
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars like & % # quote marks
- Maximum 8 nodes total to keep height manageable
- No markdown fences, no explanation, no comments. Output ONLY the raw Mermaid code."""

        else:
            # Auto mode — Gemini picks the best direction based on content
            format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- DIRECTION: Intelligently pick the best layout for this specific topic:
  * "flowchart LR" (left-to-right) — use for linear sequential processes with 5+ steps and few/no decision branches. DEFAULT choice for most topics.
  * "flowchart TD" (top-down) — use ONLY when there are 2+ major Yes/No decision branches that fan out wide. Hard cap: 8 nodes max in TD mode.
  * Do NOT default to TD just because it is familiar — LR is almost always more readable.
- First line must be exactly: flowchart LR   OR   flowchart TD
- Node IDs: single letters or short alphanumeric only e.g. A B C1 D2
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars like & % # quote marks
- If you need parens, rephrase e.g. write -when applicable- instead of -if applicable-
- Maximum 10 nodes total — group related steps into one node to keep it concise
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

    layout_desc = effective_hint or "auto"
    prompt = f"""You are a visual learning assistant. Create a {diagram_type} for the topic: "{topic}".
Layout mode: {layout_desc}

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
                    "Start your response directly with 'flowchart' or 'mindmap'."
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


def generate_study_plan(
    topic: str,
    timeline_weeks: int,
    start_date: str,
    context_chunks: List[str],
    hours_per_week: int = 8,
    focus_days: List[str] = None,
) -> dict:
    """
    Generates a structured study plan as JSON using Gemini.
    If context_chunks provided: grounds the plan in uploaded material.
    If empty: uses general knowledge.
    Returns parsed dict with title, start_date, end_date, weeks[], summary.
    """
    client = _get_client()

    focus_str = ""
    if focus_days:
        focus_str = f"\nThe student prefers to study on: {', '.join(focus_days)}."

    if context_chunks:
        context_text = "\n\n---\n\n".join(
            f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
        )
        topic_line = f'Topic: "{topic}"' if topic else "Cover all key topics from the material."
        source_instruction = f"""The student has uploaded study material. Base the plan strictly on this material.

STUDY MATERIAL:
{context_text}

{topic_line}"""
    else:
        topic_line = f'Topic: "{topic}"' if topic else 'Topic: "General study skills and learning techniques"'
        source_instruction = f"""Use your general knowledge to create the study plan.

{topic_line}"""

    prompt = f"""Create a detailed study plan with exactly {timeline_weeks} weeks.
Start date: {start_date}
Hours per week budget: {hours_per_week}{focus_str}

{source_instruction}

STRICT OUTPUT RULES:
- Output a single JSON object with these exact fields:
  "title": a short descriptive title for the plan - NO special characters like parentheses brackets or braces
  "start_date": "{start_date}"
  "end_date": the calculated end date in YYYY-MM-DD format
  "weeks": an array of exactly {timeline_weeks} week objects each with:
    "week_number": integer starting from 1
    "start_date": YYYY-MM-DD
    "end_date": YYYY-MM-DD
    "tasks": array of 3-6 actionable task strings like Read chapter 2 or Solve 10 MCQs or Make flashcards for topic X
    "estimate_hours": integer estimate of hours for this week
  "summary": a 2-3 sentence summary of the overall plan

- Tasks must be actionable and specific
- Each week should build on the previous week
- Distribute the hours_per_week budget across tasks
- If grounded in material, reference specific topics from the material in task descriptions
- Do NOT include raw chunk text - only paraphrased task descriptions
- Keep the title under 60 characters with no special characters"""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.4,
            ),
        )

    response = _call_with_retry(_generate)
    raw = response.text.strip()
    plan = _sanitize_and_parse_json(raw)

    return plan


def parse_study_plan_intent(raw_input: str) -> dict:
    """
    Uses Gemini to parse a free-form study plan request into structured fields.
    Returns {"topic": str|null, "timeline_weeks": int|null, "hours_per_week": int|null}.
    Handles inputs like "7", "machine learning for 6 weeks", "3 months of calculus", etc.
    """
    client = _get_client()

    prompt = f"""You are a parser assistant. Extract structured study plan parameters from the user's input.

User input: "{raw_input}"

Extract the following fields:
- "topic": the subject or topic to study. If the user only provides a number or duration, set to null.
- "timeline_weeks": the number of weeks for the study plan. If the user says months, convert to weeks (1 month = 4 weeks). If the user provides just a number (like "7"), interpret it as weeks. If no duration is found, set to null.
- "hours_per_week": if mentioned, the study hours per week. Otherwise null.

STRICT RULES:
- Output ONLY a JSON object with these three fields.
- If a field cannot be determined, set it to null.
- "timeline_weeks" must be a positive integer or null.
- "hours_per_week" must be a positive integer or null.
- "topic" must be a string or null. Do not include duration words in the topic.
- A standalone number like "7" or "10" means timeline_weeks, not a topic.
- Input like "7 weeks" means timeline_weeks=7, topic=null.
- Input like "machine learning" means topic="machine learning", timeline_weeks=null.
- Input like "machine learning for 6 weeks" means topic="machine learning", timeline_weeks=6.
- Input like "3 months of calculus 5 hours per week" means topic="calculus", timeline_weeks=12, hours_per_week=5."""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )

    response = _call_with_retry(_generate)
    raw = response.text.strip()
    result = _sanitize_and_parse_json(raw)

    return {
        "topic": result.get("topic"),
        "timeline_weeks": result.get("timeline_weeks"),
        "hours_per_week": result.get("hours_per_week"),
    }


def classify_intent(
    message: str,
    intent_hint: str | None,
    conversation_history: list,
    attached_filename: str | None = None,
    pending_intent: str | None = None,
) -> dict:
    """
    Single Gemini call that classifies the user's intent and extracts all
    parameters needed to dispatch to the right service.

    intent_hint  : set when user explicitly clicked a tile chip ("quiz",
                   "flowchart", "mindmap", "study_plan", "image")
    pending_intent: set in Cosmos when the previous turn ended with a
                   clarification question — auto-inherited as intent.

    Returns:
    {
        "intent": "chat|quiz|flowchart|mindmap|study_plan|image",
        "topic":  str | "[from_document]" | None,
        "topic_source": "message|filename|history|document|null",
        "num_questions": 5,
        "timeline_weeks": None,
        "hours_per_week": None,
        "needs_clarification": False,
        "clarification_question": None,
    }
    """
    client = _get_client()

    # Build a readable history summary (skip rich-card JSON blobs)
    readable = [
        m for m in (conversation_history or [])[-6:]
        if m.get("role") in ("user", "assistant")
        and not str(m.get("content", "")).startswith('{"__type":')
    ]
    history_text = "\n".join(
        f"{'Student' if m['role'] == 'user' else 'Assistant'}: {str(m.get('content', ''))[:250]}"
        for m in readable
    ) or "(no prior messages)"

    intent_hint_line = (
        f'intent_hint (user clicked tile): "{intent_hint}"'
        if intent_hint else
        "intent_hint: null"
    )
    filename_line = (
        f'Attached file in this message: "{attached_filename}"'
        if attached_filename else
        "Attached file: none"
    )
    pending_line = (
        f'pending_intent from previous clarification turn: "{pending_intent}"'
        if pending_intent else
        "pending_intent: null"
    )

    prompt = f"""You are an intent classifier for a student study app. Return ONLY valid JSON — no markdown, no explanation.

CONTEXT:
- {intent_hint_line}
- {filename_line}
- {pending_line}
- Conversation history (last 6 messages):
{history_text}
- Current user message: "{message}"

INTENT OPTIONS: chat | quiz | flowchart | mindmap | study_plan | image

CLASSIFICATION RULES:
1. If intent_hint is set → use it as the intent. NEVER override intent_hint.
2. If pending_intent is set AND the current message looks like a direct reply to a clarification question (e.g. a topic name, a number of weeks) → inherit that as the intent.
3. Otherwise classify from the message text using natural language.
4. "image" = AI-generated concept picture (e.g. "show me an image of the heart", "generate a picture of mitosis").
5. "flowchart" = step-by-step process diagram. "mindmap" = concept/topic overview diagram.
6. "quiz" = test/MCQ request ("quiz me", "make a quiz", "10 questions on").
7. Default to "chat" when no feature-specific intent is detectable.

TOPIC EXTRACTION (priority order):
1. Explicit topic in the current message (highest priority).
2. Filename of the attached file (if no explicit topic in message).
3. Recent conversation history — what subject was being discussed.
4. If docs are known to be uploaded but topic is unspecified → topic = "[from_document]".
5. If none of the above → topic = null → needs_clarification = true.

STUDY PLAN RULES:
- Extract timeline_weeks if mentioned (e.g. "4 weeks", "2 months" = 8 weeks, "a month" = 4 weeks). If not mentioned, default to 4.
- NEVER set needs_clarification = true because of a missing timeline_weeks. Always use 4 as the default.
- Only set needs_clarification = true if the topic is missing.
- Extract hours_per_week if mentioned (default null).

QUIZ RULES:
- Extract num_questions from message (e.g. "10 questions", "5 question quiz"). Default 5.
- Cap at 20.
- Extract timer_seconds if user mentions a time limit (e.g. "30 seconds" = 30, "1 minute" = 60, "2 mins" = 120, "timed quiz of 45 seconds" = 45). Default null (no timer).

CLARIFICATION RULES:
- needs_clarification = true when: intent is not "chat" but topic cannot be determined AND no docs in conversation AND no filename.
- For study_plan: needs_clarification = true only if topic is missing. A missing timeline_weeks is NOT a reason to ask — default it to 4.
- If message is vague (".", "ok", "yes", "sure") with no context → needs_clarification = true.
- Write clarification_question as a friendly, specific question (e.g. "What topic would you like a quiz on?").

Return EXACTLY this JSON — all fields required:
{{
  "intent": "...",
  "topic": "...",
  "topic_source": "message|filename|history|document|null",
  "num_questions": 5,
  "timeline_weeks": null,
  "hours_per_week": null,
  "timer_seconds": null,
  "needs_clarification": false,
  "clarification_question": null
}}"""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )

    try:
        response = _call_with_retry(_generate)
        result = _sanitize_and_parse_json(response.text.strip())
        return {
            "intent":               result.get("intent", "chat"),
            "topic":                result.get("topic"),
            "topic_source":         result.get("topic_source"),
            "num_questions":        int(result.get("num_questions") or 5),
            "timeline_weeks":       result.get("timeline_weeks"),
            "hours_per_week":       result.get("hours_per_week"),
            "timer_seconds":        result.get("timer_seconds"),
            "needs_clarification":  bool(result.get("needs_clarification", False)),
            "clarification_question": result.get("clarification_question"),
        }
    except Exception as e:
        print(f"[classify_intent] Failed ({e}), falling back to chat.")
        return {
            "intent": "chat", "topic": None, "topic_source": None,
            "num_questions": 5, "timeline_weeks": None, "hours_per_week": None,
            "timer_seconds": None,
            "needs_clarification": False, "clarification_question": None,
        }


def classify_weak_area(question: str) -> str:
    """
    Uses Gemini to classify a wrong quiz question into a short
    academic subtopic label e.g. 'Electromagnetic Induction', 'Cell Division'.
    Falls back to 'General' if classification fails.
    """
    client = _get_client()

    prompt = f"""A student answered this quiz question incorrectly:
"{question}"

What single academic subtopic or concept does this question test?
Reply with ONLY 2-5 words. No explanation. No punctuation. Just the topic name."""

    def _generate():
        return client.models.generate_content(
            model=CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.1),
        )

    try:
        response = _call_with_retry(_generate)
        label = response.text.strip().strip(".,!?\"'")
        return label if label else "General"
    except Exception:
        return "General"