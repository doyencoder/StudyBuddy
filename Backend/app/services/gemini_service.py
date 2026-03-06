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

    # ── Script mirroring ──────────────────────────────────────────────────────
    # If the user wrote in Roman/Latin script (e.g. Hinglish: "mujhe batao"),
    # Gemini tends to reply in Devanagari. We explicitly tell it to mirror the
    # user's script so Hinglish input gets a Hinglish response.
    if _is_latin_script(question):
        system_instruction += (
            "\n\nIMPORTANT — Script rule: The user has written in Roman/Latin script. "
            "You MUST respond in Roman/Latin script as well. "
            "Do NOT use Devanagari, Tamil, Telugu, or any other non-Latin script. "
            "If the user is mixing Hindi and English (Hinglish), reply in Hinglish too "
            "(e.g. 'Photosynthesis ek process hai jisme plants sunlight use karte hain'). "
            "Match the user's exact language style."
        )

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


def generate_quiz_questions(context_chunks: List[str], topic: str, num_questions: int = 5) -> list:
    """
    Uses Gemini to generate MCQ quiz questions.
    - If context_chunks provided: generates strictly from the uploaded material.
    - If context_chunks is empty: generates from general knowledge on the topic.
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

Respond ONLY with a valid JSON array. No extra text. No markdown. No code fences.
Each item must have exactly these fields:
{{
  "question": "the question text",
  "options": ["option A", "option B", "option C", "option D"],
  "correct_index": 0,
  "explanation": "why this answer is correct based on the material"
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

Respond ONLY with a valid JSON array. No extra text. No markdown. No code fences.
Each item must have exactly these fields:
{{
  "question": "the question text",
  "options": ["option A", "option B", "option C", "option D"],
  "correct_index": 0,
  "explanation": "why this answer is correct"
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
    questions = json.loads(raw)

    sanitized = []
    for i, q in enumerate(questions[:num_questions]):
        sanitized.append({
            "id": f"q{i + 1}",
            "question": q["question"],
            "options": q["options"],
            "correct_index": int(q["correct_index"]),
            "explanation": q["explanation"],
        })

    return sanitized            


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
            f"Educational diagram or illustration about: {topic}. "
            f"Based on these study notes: {context_summary}. "
            "Style: clean infographic, white background, clearly labelled, educational, suitable for students."
        )
    else:
        prompt = (
            f"Educational diagram or illustration about: {topic}. "
            "Style: clean infographic, white background, clearly labelled, educational, suitable for students."
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
    plan = json.loads(raw)

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
    result = json.loads(raw)

    return {
        "topic": result.get("topic"),
        "timeline_weeks": result.get("timeline_weeks"),
        "hours_per_week": result.get("hours_per_week"),
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