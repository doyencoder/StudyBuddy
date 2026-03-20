"""
azure_openai_service.py
Drop-in replacement for gemini_service.py using Azure OpenAI.
Every public function has an IDENTICAL signature and return type to its
Gemini counterpart so that ai_service.py can swap between them transparently.

Models:
  - Chat / generation : gpt-4o-mini  (deployment: AZURE_OPENAI_CHAT_DEPLOYMENT)
  - Embeddings        : text-embedding-3-large (deployment: AZURE_OPENAI_EMBEDDING_DEPLOYMENT)

Image generation (generate_image) stays on HuggingFace/FLUX — not migrated.
"""

import os
import json
import time
import re
from typing import List, Generator
from openai import AzureOpenAI

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 4

# FIX: Use stable GA API version instead of preview
AZURE_API_VERSION = "2024-10-21"

# ── System prompts (copied verbatim from gemini_service.py) ───────────────────

SYSTEM_PROMPT_RAG = """You are StudyBuddy, an educational AI assistant.
The student has uploaded study material. Relevant excerpts from it are provided as CONTEXT in the user message.
Use that context to enrich and ground your answer where it is relevant to the question.
If the context does not cover the question at all, answer from your general knowledge — do NOT say the answer is not in the uploaded material.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers clear, structured, and student-friendly.

FORMATTING RULES — follow these exactly:
- When the question asks to compare, contrast, or show differences/similarities between TWO OR MORE things, ALWAYS respond with a properly formatted markdown table. Use this exact format:
  | Feature | Item A | Item B |
  |---------|--------|--------|
  | Row 1   | ...    | ...    |
- Do NOT use numbered lists or bullet points for comparison/difference questions — use a table instead.
- For non-comparison questions, use headings (#, ##, ###), bullet points, or numbered lists as appropriate.
- Use **bold** for key terms inline.
- Use `code` for inline code snippets, variable names, or technical syntax.
- When writing any code block (functions, programs, scripts, algorithms), ALWAYS wrap it in triple-backtick fences with the correct language tag. Examples: ```python, ```cpp, ```javascript, ```java, ```bash. NEVER write multi-line code as plain text without fences.

CRITICAL — Answer discipline:
- Answer ONLY what the current question asks. Nothing more.
- Do NOT bring up previous topics, subjects, or quiz content unless the student explicitly asks about them.
- Do NOT add follow-up questions on a different topic than the one being asked.
- Do NOT volunteer information the student did not ask for in this message.

CRITICAL — Conversation memory rule:
The conversation history may contain facts the student has shared (e.g. name, favourite players, preferences).
Treat these as established facts — BUT only recall them when the student is DIRECTLY and EXPLICITLY asking about them.
NEVER proactively mention prior personal facts or prior topics when answering an unrelated question.

CRITICAL — Page references:
Each context excerpt is labelled with [Page N]. When referring to document content, always say "Page N" not "Chunk N".
Never use the word "chunk" in your response."""

SYSTEM_PROMPT_GENERAL = """You are StudyBuddy, an educational AI assistant.
Answer the student's question using your general knowledge.
Be accurate, clear, and student-friendly.
If the question is ambiguous, ask ONE clarifying question before answering.
Never fabricate facts, formulas, dates, or citations.
Keep answers structured and easy to understand.

FORMATTING RULES — follow these exactly:
- When the question asks to compare, contrast, or show differences/similarities between TWO OR MORE things, ALWAYS respond with a properly formatted markdown table. Use this exact format:
  | Feature | Item A | Item B |
  |---------|--------|--------|
  | Row 1   | ...    | ...    |
- Do NOT use numbered lists or bullet points for comparison/difference questions — use a table instead.
- For non-comparison questions, use headings (#, ##, ###), bullet points, or numbered lists as appropriate.
- Use **bold** for key terms inline.
- Use `code` for inline code snippets, variable names, or technical syntax.
- When writing any code block (functions, programs, scripts, algorithms), ALWAYS wrap it in triple-backtick fences with the correct language tag. Examples: ```python, ```cpp, ```javascript, ```java, ```bash. NEVER write multi-line code as plain text without fences.

CRITICAL — Answer discipline:
- Answer ONLY what the current question asks. Nothing more.
- Do NOT bring up previous topics, subjects, or quiz content unless the student explicitly asks about them.
- Do NOT add follow-up questions on a different topic than the one being asked.
- Do NOT volunteer information the student did not ask for in this message.

CRITICAL — Conversation memory rule:
The conversation history may contain facts the student has shared (e.g. name, favourite players, preferences).
Treat these as established facts — BUT only recall them when the student is DIRECTLY and EXPLICITLY asking about them.
NEVER proactively mention prior personal facts or prior topics when answering an unrelated question."""


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_client() -> AzureOpenAI:
    """Returns a configured AzureOpenAI client, reading credentials at call time."""
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_key  = os.getenv("AZURE_OPENAI_API_KEY")
    if not endpoint:
        raise ValueError("AZURE_OPENAI_ENDPOINT is not set in .env")
    if not api_key:
        raise ValueError("AZURE_OPENAI_API_KEY is not set in .env")
    return AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=AZURE_API_VERSION,
    )


def _chat_deployment() -> str:
    return os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "studybuddy-chat")


def _embedding_deployment() -> str:
    return os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "studybuddy-embeddings")


def _call_with_retry(fn, *args, **kwargs):
    """Retry up to MAX_RETRIES on rate-limit (429) or transient 5xx errors."""
    for attempt in range(MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            error_msg = str(e).lower()
            is_retryable = (
                "429" in error_msg
                or "rate limit" in error_msg
                or "too many requests" in error_msg
                or "502" in error_msg
                or "503" in error_msg
                or "504" in error_msg
            )
            if is_retryable and attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            raise
    raise RuntimeError("Azure OpenAI API call failed after max retries")


def _sanitize_and_parse_json(raw: str):
    """
    Robustly parses JSON that the model may have wrapped in markdown fences
    or polluted with invalid control characters.
    Identical logic to gemini_service.py.
    """
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    text = re.sub(r"```\s*$", "", text.strip()).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    def _escape_inner(m):
        s = m.group(0)
        return s.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")

    escaped = re.sub(r'"(?:[^"\\]|\\.)*"', _escape_inner, cleaned)
    return json.loads(escaped)


# Common romanized Hindi function words / particles that strongly signal Hinglish.
# Keeping the list short and high-precision to avoid false positives on English.
_HINGLISH_MARKERS = {
    "kya", "hai", "hain", "ho", "tha", "thi", "the", "mein", "mujhe",
    "hum", "tum", "aap", "yeh", "woh", "kaise", "kyun", "kyunki",
    "lekin", "aur", "ya", "se", "ke", "ki", "ka", "ko", "ne",
    "nahi", "nahin", "matlab", "bata", "batao", "samajh", "seekh",
    "padhna", "likhna", "bolna", "achha", "theek", "sahi", "galat",
    "pls", "plz", "bhai", "yaar", "dost",
}

def _detect_language(text: str) -> str:
    """
    Classify the user's message into one of three categories:

    - "english"   : Pure English (Latin script, no Hindi markers).
    - "hinglish"  : Romanized Hindi/Hinglish (Latin script + Hindi markers).
    - "non_latin" : A non-Latin script language (Hindi in Devanagari, Tamil, etc.).

    Returns one of the three string literals above.
    """
    alpha_chars = [c for c in text if c.isalpha()]
    if not alpha_chars:
        return "english"

    latin_count = sum(1 for c in alpha_chars if ord(c) < 128)
    latin_ratio = latin_count / len(alpha_chars)

    # Non-Latin script (Devanagari, Tamil, Telugu, etc.)
    if latin_ratio <= 0.8:
        return "non_latin"

    # Latin script — distinguish English from Hinglish by looking for Hindi markers
    words = set(re.sub(r"[^a-zA-Z\s]", "", text).lower().split())
    hinglish_hits = words & _HINGLISH_MARKERS
    # Require at least 2 marker hits to confidently call it Hinglish,
    # so a single word like "the" never triggers a false positive.
    if len(hinglish_hits) >= 2:
        return "hinglish"

    return "english"


# Keep old name as a thin wrapper so nothing else in the file breaks.
def _is_latin_script(text: str) -> bool:
    """Returns True if message is predominantly Latin/Roman script (Hinglish detection)."""
    alpha_chars = [c for c in text if c.isalpha()]
    if not alpha_chars:
        return True
    latin_count = sum(1 for c in alpha_chars if ord(c) < 128)
    return (latin_count / len(alpha_chars)) > 0.8


# ── Embeddings ────────────────────────────────────────────────────────────────

def embed_text(text: str) -> List[float]:
    """
    Embed a document chunk for storage in Azure AI Search.
    text-embedding-3-large returns 3072-dim vectors — same as gemini-embedding-001.
    Azure AI Search index schema requires NO changes.
    """
    client = _get_client()
    deployment = _embedding_deployment()

    def _embed():
        response = client.embeddings.create(model=deployment, input=text)
        return response.data[0].embedding

    return _call_with_retry(_embed)


def embed_query(query: str) -> List[float]:
    """
    Embed a user question for vector search.
    Azure OpenAI uses the same model for both document and query embeddings.
    """
    client = _get_client()
    deployment = _embedding_deployment()

    def _embed():
        response = client.embeddings.create(model=deployment, input=query)
        return response.data[0].embedding

    return _call_with_retry(_embed)


# ── Chat streaming ────────────────────────────────────────────────────────────

def chat_stream(
    question: str,
    context_chunks: List[str],
    history: List[dict] = None,
    system_prompt_override: str = None,
    response_format: str = "paragraph",
    detail_level: str = "detailed",
    language_style: str = "formal",
) -> Generator[str, None, None]:
    """
    Streams a gpt-4o-mini reply with full multi-turn conversation memory.
    Identical signature to gemini_service.chat_stream().
    context_chunks: list of pre-tagged strings like "[Page N]\\nchunk text..."
    history:        list of prior messages [{"role": "user"|"assistant", "content": str}]
    system_prompt_override: when set, replaces all system-prompt building logic.
                            Used by web search, image search, and video search paths.
    """
    client = _get_client()
    deployment = _chat_deployment()

    # ── Build system prompt ────────────────────────────────────────────────
    # If override is provided (web/image/video search paths), use it directly.
    if system_prompt_override:
        system_instruction = system_prompt_override
        current_user_text = question
    elif context_chunks:
        context_text = "\n\n---\n\n".join(context_chunks)
        current_user_text = (
            f"Use the following context from the student's study material to answer the question.\n\n"
            f"CONTEXT:\n{context_text}\n\n"
            f"QUESTION:\n{question}"
        )
        system_instruction = SYSTEM_PROMPT_RAG
    else:
        current_user_text = question
        system_instruction = SYSTEM_PROMPT_GENERAL

    # ── Strict language-mirroring rule ────────────────────────────────────────
    # Detect the user's language and inject an unambiguous directive so the
    # model never drifts into a different language (e.g. Hinglish for English).
    if not system_prompt_override:
        _lang = _detect_language(question)
        if _lang == "english":
            system_instruction += (
                "\n\nCRITICAL — Language rule: The user's message is in English. "
                "You MUST respond ONLY in English. "
                "Do NOT use any Hindi, Hinglish, or any other language. "
                "Every word of your response must be English."
            )
        elif _lang == "hinglish":
            system_instruction += (
                "\n\nIMPORTANT — Language rule: The user is writing in Hinglish "
                "(a mix of Hindi and English in Roman script). "
                "Reply in Hinglish too — match their exact mix of Hindi and English words. "
                "Do NOT switch to pure Hindi or Devanagari script."
            )
        else:  # non_latin — respect whatever script they used
            system_instruction += (
                "\n\nIMPORTANT — Language rule: Respond in the same language and script "
                "as the user's message. Do NOT switch to English or any other language."
            )

    # Response format injection — identical to gemini_service.py
    if not system_prompt_override:
        format_map = {
            "bullet":      "Respond using bullet points.",
            "steps":       "Respond as numbered steps.",
            "table":       "Respond using a markdown table where appropriate.",
            "formula":     "Focus on formulas and equations. Use LaTeX notation.",
            "short_notes": "Respond as concise short notes with headers.",
            "paragraph":   "Respond in clear paragraphs.",
        }
        detail_map = {
            "brief":    "Keep the response short and to the point.",
            "detailed": "Give a thorough and complete explanation.",
            "eli5":     "Explain simply as if to a beginner with no prior knowledge.",
        }
        lang_map = {
            "hinglish": "The student is writing in Hinglish (Hindi+English mix). Reply in Hinglish too.",
            "casual":   "Use a casual, friendly tone.",
            "formal":   "",
        }
        extra = " ".join(filter(None, [
            format_map.get(response_format, ""),
            detail_map.get(detail_level, ""),
            lang_map.get(language_style, ""),
        ]))
        if extra:
            system_instruction += f"\n\nRESPONSE STYLE: {extra}"

    # ── Build messages with anchor+recent windowing ───────────────────────────
    ANCHOR_COUNT = 4
    RECENT_COUNT = 10

    def _is_rich_card(msg: dict) -> bool:
        c = str(msg.get("content", ""))
        return msg.get("role") == "assistant" and c.startswith('{"__type":')

    messages = [{"role": "system", "content": system_instruction}]

    if history:
        readable = [m for m in history if not _is_rich_card(m)]
        anchor = readable[:ANCHOR_COUNT]
        recent_start = max(0, len(readable) - RECENT_COUNT)
        seen = set(range(len(anchor)))
        windowed = list(anchor)
        for i, msg in enumerate(readable[recent_start:], start=recent_start):
            if i not in seen:
                windowed.append(msg)
                seen.add(i)

        for msg in windowed:
            role = "assistant" if msg["role"] == "assistant" else "user"
            messages.append({"role": role, "content": str(msg.get("content", ""))})

    messages.append({"role": "user", "content": current_user_text})

    # ── Stream ────────────────────────────────────────────────────────────────
    def _stream():
        return client.chat.completions.create(
            model=deployment,
            messages=messages,
            stream=True,
            temperature=0.7,
        )

    response = _call_with_retry(_stream)

    for chunk in response:
        # FIX: Guard against empty choices list — Azure sends these on role delta
        # and on the final [DONE] chunk. All four conditions must be true.
        if (
            chunk.choices
            and len(chunk.choices) > 0
            and chunk.choices[0].delta is not None
            and chunk.choices[0].delta.content is not None
        ):
            yield chunk.choices[0].delta.content


# ── Quiz generation ───────────────────────────────────────────────────────────

def generate_quiz_questions(
    context_chunks: List[str],
    topic: str,
    num_questions: int = 5,
) -> dict:
    """
    Generates MCQ quiz questions + one fun fact using gpt-4o-mini.
    Returns: { "questions": [...], "fun_fact": "..." }
    """
    client = _get_client()
    deployment = _chat_deployment()

    if context_chunks:
        context_text = "\n\n---\n\n".join(
            f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
        )
        topic_line = (
            f"Focus specifically on the topic: {topic}"
            if topic else
            "Cover the most important concepts from the material."
        )
        user_prompt = f"""You are a quiz generator for students. Based ONLY on the study material below, generate exactly {num_questions} multiple choice questions.

{topic_line}

STUDY MATERIAL:
{context_text}

STRICT RULES:
- Generate exactly {num_questions} questions
- Each question must have exactly 4 options
- Only one option is correct
- Base every question strictly on the provided material
- The explanation must reference the material directly
- NEVER mention chunk numbers in any explanation

Also generate exactly 1 fun_fact: a single interesting, surprising fact related to this topic.

Respond ONLY with a valid JSON object. No markdown. No code fences.
{{
  "questions": [
    {{
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correct_index": 0,
      "explanation": "why this answer is correct"
    }}
  ],
  "fun_fact": "one interesting fact"
}}"""
    else:
        if not topic:
            topic = "general knowledge"
        user_prompt = f"""You are a quiz generator for students. Generate exactly {num_questions} multiple choice questions about: {topic}

STRICT RULES:
- Generate exactly {num_questions} questions
- Each question must have exactly 4 options
- Only one option is correct
- Questions should be educational and vary in difficulty

Also generate exactly 1 fun_fact about {topic}.

Respond ONLY with a valid JSON object. No markdown. No code fences.
{{
  "questions": [
    {{
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correct_index": 0,
      "explanation": "why this answer is correct"
    }}
  ],
  "fun_fact": "one interesting fact"
}}"""

    def _generate():
        return client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": "You are a quiz generator. Always respond with valid JSON only. No markdown, no code fences."},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            # FIX: explicit max_tokens prevents JSON truncation on large quizzes
            max_tokens=4096,
        )

    response = _call_with_retry(_generate)
    raw = response.choices[0].message.content.strip()
    parsed = _sanitize_and_parse_json(raw)

    if isinstance(parsed, list):
        raw_questions = parsed
        fun_fact = "Did you know? The brain strengthens memories during sleep — a great reason to rest after studying!"
    else:
        raw_questions = parsed.get("questions", [])
        fun_fact = (
            parsed.get("fun_fact") or
            "Did you know? Spaced repetition is one of the most effective study techniques proven by cognitive science!"
        )

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


# ── Weak area classification ──────────────────────────────────────────────────

def batch_classify_weak_areas(questions: list) -> list:
    """
    Sends ALL question texts in a SINGLE API call and returns a subtopic
    label for each question in order.
    """
    client = _get_client()
    deployment = _chat_deployment()

    numbered = "\n".join(
        f"{i + 1}. {q['question']}" for i, q in enumerate(questions)
    )

    # FIX: json_object mode requires a JSON object (not a bare array).
    # Wrap labels in {"labels": [...]} and unwrap after parsing.
    user_prompt = f"""Classify each quiz question below into a short academic subtopic label (2-5 words).

QUESTIONS:
{numbered}

Respond ONLY with a JSON object in this exact format:
{{"labels": ["label for question 1", "label for question 2", ...]}}

One label per question, in the same order. No extra text."""

    try:
        def _generate():
            return client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": "You classify quiz questions into academic subtopics. Respond with valid JSON only."},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=512,
            )

        response = _call_with_retry(_generate)
        raw = response.choices[0].message.content.strip()
        parsed = _sanitize_and_parse_json(raw)

        # Unwrap {"labels": [...]}
        labels = parsed.get("labels", []) if isinstance(parsed, dict) else parsed

        result = [str(l).strip() or "General" for l in labels]
        # Pad or trim to match question count exactly
        while len(result) < len(questions):
            result.append("General")
        return result[:len(questions)]

    except Exception:
        return ["General"] * len(questions)


def classify_weak_area(question: str) -> str:
    """Classify a single wrong quiz question into a short academic subtopic label."""
    client = _get_client()
    deployment = _chat_deployment()

    user_prompt = f"""A student answered this quiz question incorrectly:
"{question}"

What single academic subtopic or concept does this question test?
Reply with ONLY 2-5 words. No explanation. No punctuation."""

    try:
        def _generate():
            return client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": "You classify quiz questions into academic subtopics. Reply with 2-5 words only."},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=20,
            )

        response = _call_with_retry(_generate)
        label = response.choices[0].message.content.strip().strip(".,!?\"'")
        return label if label else "General"
    except Exception:
        return "General"


# ── Topic inference ───────────────────────────────────────────────────────────

def infer_topic_from_messages(messages: list) -> str:
    """Extract a clean 3-5 word study topic from recent conversation messages."""
    client = _get_client()
    deployment = _chat_deployment()

    conversation_text = "\n".join(
        f"{'Student' if m['role'] == 'user' else 'Assistant'}: {str(m.get('content', ''))[:300]}"
        for m in messages[-8:]
        if m.get("role") in ("user", "assistant")
    )

    user_prompt = f"""Read this study conversation and extract the main topic being studied.
Return ONLY a short topic name (3-5 words max). No explanation, no punctuation, no quotes.
Examples: Photosynthesis, Newton Laws of Motion, Cell Division, Water Cycle

CONVERSATION:
{conversation_text}

TOPIC:"""

    try:
        def _generate():
            return client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": "You extract study topics from conversations. Reply with 3-5 words only."},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=20,
            )

        response = _call_with_retry(_generate)
        topic = response.choices[0].message.content.strip().strip("\"'.")
        if not topic or len(topic) > 60:
            return "General Topic"
        return topic
    except Exception:
        return "General Topic"


# ── Mermaid diagram generation ────────────────────────────────────────────────

def generate_mermaid(
    topic: str,
    diagram_type: str,
    context_chunks: List[str],
    layout_hint: str = None,
) -> str:
    """
    Generates valid Mermaid syntax for a flowchart or mind map.
    Identical signature to gemini_service.generate_mermaid().
    """
    client = _get_client()
    deployment = _chat_deployment()

    context_text = (
        "\n\n---\n\n".join(f"[Chunk {i+1}]\n{c}" for i, c in enumerate(context_chunks))
        if context_chunks
        else "No specific material uploaded. Use your general knowledge about this topic."
    )

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
- Connect the LAST node back to the FIRST node to form a closed loop.
- Use 4 to 8 nodes representing key stages in order.
- Node IDs: single letters or short alphanumeric only e.g. A B C1 D2
- Node shapes: rounded A(Label) for all cycle stages
- Arrows: A --> B  and last node must loop back to A
- CRITICAL: node labels must NEVER contain parentheses or special chars like & % # quote marks
- Keep labels short: 2-4 words maximum
- No markdown fences, no explanation. Output ONLY raw Mermaid code.
EXAMPLE (Calvin Cycle):
flowchart LR
    A(CO2 Fixation) --> B(3-PGA Produced)
    B --> C(ATP and NADPH Used)
    C --> D(G3P Formed)
    D --> E(RuBP Regenerated)
    E --> A"""

        elif effective_hint == "horizontal":
            format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- First line must be exactly: flowchart LR
- Node IDs: single letters or short alphanumeric only
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars
- Maximum 10 nodes total
- No markdown fences, no explanation. Output ONLY raw Mermaid code."""

        elif effective_hint == "vertical":
            format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- First line must be exactly: flowchart TD
- Node IDs: single letters or short alphanumeric only
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars
- Maximum 8 nodes total
- No markdown fences, no explanation. Output ONLY raw Mermaid code."""

        else:
            format_instructions = """Output ONLY a valid Mermaid flowchart. Rules:
- DIRECTION: Pick intelligently:
  * "flowchart LR" for linear sequential processes with 5+ steps — DEFAULT
  * "flowchart TD" ONLY when there are 2+ Yes/No decision branches. Hard cap: 8 nodes in TD mode.
- First line must be exactly: flowchart LR   OR   flowchart TD
- Node IDs: single letters or short alphanumeric only
- Node shapes: rectangle A[Label]  decision A{Label}  rounded A(Label)
- Arrows: A --> B   or   A -->|Yes| B   or   A -->|No| B
- CRITICAL: node labels must NEVER contain parentheses or special chars
- Maximum 10 nodes total
- No markdown fences, no explanation. Output ONLY raw Mermaid code."""

    else:  # mindmap
        format_instructions = """Output ONLY a valid Mermaid mindmap. Rules:
- First line must be exactly: mindmap
- Second line indented 2 spaces: root((TopicName))
- Children indented 4 spaces: plain word labels only
- Grandchildren indented 6 spaces: plain word labels only
- CRITICAL: labels must NEVER contain parentheses, brackets, braces, or special chars
- Maximum 1 root, 5 branches, 3 leaves per branch
- No markdown fences, no explanation. Output ONLY raw Mermaid code."""

    layout_desc = effective_hint or "auto"
    user_prompt = f"""Create a {diagram_type} diagram for the topic: "{topic}".
Layout mode: {layout_desc}

STUDY MATERIAL CONTEXT:
{context_text}

{format_instructions}"""

    def _generate():
        return client.chat.completions.create(
            model=deployment,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You output ONLY valid Mermaid diagram syntax. "
                        "No markdown fences, no explanation, no code blocks. "
                        "Start your response directly with 'flowchart' or 'mindmap'."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=1024,
        )

    response = _call_with_retry(_generate)
    cleaned = response.choices[0].message.content.strip()

    # Strip markdown fences the model may add despite instructions
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()

    return cleaned


# ── Study plan generation ─────────────────────────────────────────────────────

def generate_study_plan(
    topic: str,
    timeline_weeks: int,
    start_date: str,
    context_chunks: List[str],
    hours_per_week: int = 8,
    focus_days: List[str] = None,
) -> dict:
    """Generates a structured study plan as JSON using gpt-4o-mini."""
    client = _get_client()
    deployment = _chat_deployment()

    focus_str = ""
    if focus_days:
        focus_str = f"\nThe student prefers to study on: {', '.join(focus_days)}."

    if context_chunks:
        context_text = "\n\n---\n\n".join(
            f"[Chunk {i + 1}]\n{chunk}" for i, chunk in enumerate(context_chunks)
        )
        topic_line = f'Topic: "{topic}"' if topic else "Cover all key topics from the material."
        source_instruction = f"""Base the plan on this uploaded study material.

STUDY MATERIAL:
{context_text}

{topic_line}"""
    else:
        topic_line = f'Topic: "{topic}"' if topic else 'Topic: "General study skills"'
        source_instruction = f"Use your general knowledge.\n\n{topic_line}"

    user_prompt = f"""Create a detailed study plan with exactly {timeline_weeks} weeks.
Start date: {start_date}
Hours per week: {hours_per_week}{focus_str}

{source_instruction}

Output a single JSON object with these exact fields:
{{
  "title": "short plan title under 60 chars, no special characters",
  "start_date": "{start_date}",
  "end_date": "YYYY-MM-DD",
  "weeks": [
    {{
      "week_number": 1,
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "tasks": ["task 1", "task 2", "task 3"],
      "estimate_hours": 8
    }}
  ],
  "summary": "2-3 sentence overview of the plan"
}}

Rules:
- Exactly {timeline_weeks} week objects in the array
- 3-6 actionable tasks per week
- Tasks must be specific and build week over week
- No raw chunk text in tasks"""

    def _generate():
        return client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": "You are a study plan generator. Always respond with valid JSON only."},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            # FIX: multi-week plans can be long — prevent truncation
            max_tokens=4096,
        )

    response = _call_with_retry(_generate)
    raw = response.choices[0].message.content.strip()
    return _sanitize_and_parse_json(raw)


def parse_study_plan_intent(raw_input: str) -> dict:
    """Parse a free-form study plan request into structured fields."""
    client = _get_client()
    deployment = _chat_deployment()

    user_prompt = f"""Extract structured study plan parameters from this input:
"{raw_input}"

Return a JSON object with exactly these three fields:
{{
  "topic": "the subject to study, or null if not specified",
  "timeline_weeks": integer number of weeks or null,
  "hours_per_week": integer hours per week or null
}}

Rules:
- Convert months to weeks (1 month = 4 weeks)
- A standalone number like "7" means timeline_weeks=7
- "machine learning for 6 weeks" means topic="machine learning", timeline_weeks=6
- If a field cannot be determined, set it to null"""

    def _generate():
        return client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": "You parse user inputs into structured JSON. Always respond with valid JSON only."},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=128,
        )

    response = _call_with_retry(_generate)
    raw = response.choices[0].message.content.strip()
    result = _sanitize_and_parse_json(raw)

    return {
        "topic": result.get("topic"),
        "timeline_weeks": result.get("timeline_weeks"),
        "hours_per_week": result.get("hours_per_week"),
    }


# ── Intent classification ─────────────────────────────────────────────────────

def classify_intent(
    message: str,
    intent_hint: str | None,
    conversation_history: list,
    attached_filename: str | None = None,
    pending_intent: str | None = None,
) -> dict:
    """
    Single gpt-4o-mini call returning 22 structured classification fields.
    Identical signature and return shape to gemini_service.classify_intent().
    """
    client = _get_client()
    deployment = _chat_deployment()

    readable = [
        m for m in (conversation_history or [])[-6:]
        if m.get("role") in ("user", "assistant")
        and not str(m.get("content", "")).startswith('{"__type":')
    ]
    history_text = "\n".join(
        f"{'Student' if m['role'] == 'user' else 'Assistant'}: {str(m.get('content', ''))[:250]}"
        for m in readable
    ) or "(no prior messages)"

    intent_hint_line = f'intent_hint: "{intent_hint}"' if intent_hint else "intent_hint: null"
    filename_line = f'Attached file: "{attached_filename}"' if attached_filename else "Attached file: none"
    pending_line = f'pending_intent: "{pending_intent}"' if pending_intent else "pending_intent: null"

    user_prompt = f"""You are an intent classifier for a student study app. Return ONLY valid JSON — no markdown, no explanation.

CONTEXT:
- {intent_hint_line}
- {filename_line}
- {pending_line}
- Conversation history (last 6 messages):
{history_text}
- Current user message: "{message}"

INTENT OPTIONS: chat | quiz | flowchart | mindmap | study_plan | image

CLASSIFICATION RULES:
1. If intent_hint is set, use it as the intent. NEVER override intent_hint.
2. If pending_intent is set AND message looks like a reply to a clarification, inherit that intent.
3. Otherwise classify from message text.
4. "image" = AI-generated concept picture.
5. "flowchart" = step-by-step process diagram. "mindmap" = concept overview.
6. "quiz" = test/MCQ request.
7. Default to "chat" when no feature intent is detectable.

TOPIC EXTRACTION (priority order):
1. Explicit topic in current message.
2. Attached filename.
3. Recent conversation history.
4. If docs uploaded but topic unspecified, topic = "[from_document]".
5. If none, topic = null and needs_clarification = true.

STUDY PLAN: Default timeline_weeks to 4 if not mentioned. NEVER ask for clarification about missing weeks.
QUIZ: Extract num_questions (default 5, cap 20). Extract timer_seconds if time limit mentioned (default null).

Return EXACTLY this JSON with all fields present:
{{
  "intent": "chat",
  "topic": null,
  "topic_source": "message|filename|history|document|null",
  "num_questions": 5,
  "timeline_weeks": null,
  "hours_per_week": null,
  "timer_seconds": null,
  "needs_clarification": false,
  "clarification_question": null,
  "page_numbers": [],
  "keywords": [],
  "query_type": "broad",
  "top_k_hint": "medium",
  "scope": "topic",
  "response_format": "paragraph",
  "detail_level": "detailed",
  "language_style": "formal",
  "is_comparison": false,
  "entities": [],
  "needs_document": true,
  "is_followup": false,
  "refers_to_previous": false
}}

FIELD RULES:
- page_numbers: integers if user mentions page numbers, else []
- keywords: exact technical terms from message, else []
- query_type: specific|broad|page|formula|definition|comparison|list|summary
- top_k_hint: low (1-3 chunks)|medium (4-7)|high (8-15)
- scope: page|topic|document|general
- response_format: paragraph|bullet|steps|table|formula|short_notes
- detail_level: brief|detailed|eli5
- language_style: formal|casual|hinglish
- needs_document: false if answerable from general knowledge without the document"""

    try:
        def _generate():
            return client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": "You are an intent classifier. Always respond with valid JSON only."},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
                max_tokens=512,
            )

        response = _call_with_retry(_generate)
        result = _sanitize_and_parse_json(response.choices[0].message.content.strip())

        return {
            "intent":                 result.get("intent", "chat"),
            "topic":                  result.get("topic"),
            "topic_source":           result.get("topic_source"),
            "num_questions":          int(result.get("num_questions") or 5),
            "timeline_weeks":         result.get("timeline_weeks"),
            "hours_per_week":         result.get("hours_per_week"),
            "timer_seconds":          result.get("timer_seconds"),
            "needs_clarification":    bool(result.get("needs_clarification", False)),
            "clarification_question": result.get("clarification_question"),
            "page_numbers":           result.get("page_numbers") or [],
            "keywords":               result.get("keywords") or [],
            "query_type":             result.get("query_type") or "broad",
            "top_k_hint":             result.get("top_k_hint") or "medium",
            "scope":                  result.get("scope") or "topic",
            "response_format":        result.get("response_format") or "paragraph",
            "detail_level":           result.get("detail_level") or "detailed",
            "language_style":         result.get("language_style") or "formal",
            "is_comparison":          bool(result.get("is_comparison", False)),
            "entities":               result.get("entities") or [],
            "needs_document":         bool(result.get("needs_document", True)),
            "is_followup":            bool(result.get("is_followup", False)),
            "refers_to_previous":     bool(result.get("refers_to_previous", False)),
        }

    except Exception as e:
        print(f"[classify_intent] Azure OpenAI failed ({e}), falling back to chat.")
        return {
            "intent": "chat", "topic": None, "topic_source": None,
            "num_questions": 5, "timeline_weeks": None, "hours_per_week": None,
            "timer_seconds": None, "needs_clarification": False,
            "clarification_question": None, "page_numbers": [], "keywords": [],
            "query_type": "broad", "top_k_hint": "medium", "scope": "topic",
            "response_format": "paragraph", "detail_level": "detailed",
            "language_style": "formal", "is_comparison": False,
            "entities": [], "needs_document": True,
            "is_followup": False, "refers_to_previous": False,
        }


# ── Image generation — stays on HuggingFace ──────────────────────────────────

def generate_image(topic: str, context_chunks: List[str]) -> bytes:
    """
    Generates AI image via HuggingFace FLUX.1-schnell.
    IDENTICAL to gemini_service.generate_image() — not migrated to Azure OpenAI.
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
            "Style: clean artistic illustration, white background, no text, no labels, visually accurate, educational artwork."
        )
    else:
        prompt = (
            f"Detailed anatomical and scientific illustration of: {topic}. "
            "Style: clean artistic illustration, white background, no text, no labels, visually accurate, educational artwork."
        )

    api_url = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"

    response = requests.post(
        api_url,
        headers={"Authorization": f"Bearer {hf_token}", "Content-Type": "application/json"},
        json={"inputs": prompt},
        timeout=120,
    )

    if response.status_code == 503:
        time.sleep(30)
        response = requests.post(
            api_url,
            headers={"Authorization": f"Bearer {hf_token}", "Content-Type": "application/json"},
            json={"inputs": prompt},
            timeout=120,
        )

    if response.status_code != 200:
        raise RuntimeError(f"HuggingFace API error {response.status_code}: {response.text[:300]}")

    return response.content