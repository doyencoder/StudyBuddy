"""
translator_service.py
Wraps Azure AI Translator calls for chat message translation.
Uses the REST API directly (simpler than the SDK for single-call translation).

Strategy for code blocks:
  Instead of placeholders (which Azure translates), the message is split into
  alternating segments: [prose, code, prose, code, ...].
  Only prose segments are sent to Azure — in a single batched API call.
  The translated prose segments are then zipped back with the untouched code
  segments to reconstruct the full message.
"""

import os
import re
import requests
import uuid
from dotenv import load_dotenv

load_dotenv()

TRANSLATOR_ENDPOINT = "https://api.cognitive.microsofttranslator.com"

# Map from our LanguageContext codes → Azure Translator language codes
LANGUAGE_CODE_MAP = {
    "en": "en",
    "hi": "hi",
    "mr": "mr",
    "ta": "ta",
    "te": "te",
    "bn": "bn",
    "gu": "gu",
    "kn": "kn",
}

# Matches fenced code blocks, inline code, and all math delimiters.
# Order matters: longer/greedier patterns first.
#   \[...\]   — LaTeX display math
#   \(...\)   — LaTeX inline math
#   $$...$$   — display math
#   $...$     — inline math (single-line only, to avoid false positives)
#   ```...``` — fenced code block
#   `...`     — inline code
_CODE_RE = re.compile(
    r"\\\[[\s\S]*?\\\]"   # \[...\]  display math
    r"|\\\([\s\S]*?\\\)"  # \(...\)  inline math
    r"|\$\$[\s\S]*?\$\$"    # $$...$$  display math
    r"|\$[^\$\r\n]+\$"       # $...$    inline math
    r"|```[\s\S]*?```"          # fenced code block
    r"|`[^`\n]+`",              # inline code
    re.MULTILINE,
)


def _split_segments(text: str) -> tuple[list[str], list[str]]:
    """
    Split *text* into alternating prose / code segments.

    Returns:
        prose_segments  — list of strings that should be translated.
                          Always has exactly one more item than code_segments
                          (the first and last item may be empty strings).
        code_segments   — list of code strings (fenced or inline) to keep verbatim.

    Example for  "Hello `x` world ```cpp\nfoo\n```  bye":
        prose = ["Hello ", " world ", "  bye"]
        code  = ["`x`", "```cpp\nfoo\n```"]
    """
    prose_segments: list[str] = []
    code_segments: list[str] = []

    cursor = 0
    for match in _CODE_RE.finditer(text):
        prose_segments.append(text[cursor : match.start()])
        code_segments.append(match.group(0))
        cursor = match.end()
    prose_segments.append(text[cursor:])  # trailing prose (may be "")

    return prose_segments, code_segments


def _call_azure_translate(
    texts: list[str], azure_lang: str, key: str, region: str
) -> list[str]:
    """
    Send a batch of strings to Azure Translator in a single HTTP call.
    Returns a list of translated strings in the same order.
    """
    url = f"{TRANSLATOR_ENDPOINT}/translate"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Ocp-Apim-Subscription-Region": region,
        "Content-Type": "application/json",
        "X-ClientTraceId": str(uuid.uuid4()),
    }
    params = {"api-version": "3.0", "to": azure_lang}
    body = [{"text": t} for t in texts]

    response = requests.post(url, headers=headers, params=params, json=body, timeout=10)

    if response.status_code != 200:
        raise RuntimeError(
            f"Azure Translator error {response.status_code}: {response.text}"
        )

    return [item["translations"][0]["text"] for item in response.json()]


def translate_text(text: str, target_language: str) -> str:
    """
    Translates text into the target language using Azure Translator.

    Fenced code blocks (``` ... ```) and inline code (`...`) are never sent
    to the translator — they are preserved verbatim in the output.
    All prose segments are translated in a single batched API call.

    Args:
        text: The text to translate (can be any language).
        target_language: One of our LanguageContext codes e.g. "hi", "ta", "en".

    Returns:
        Translated text as a string, with all code blocks preserved unchanged.

    Raises:
        ValueError: If env vars are missing or language code is unsupported.
        RuntimeError: If the Azure API call fails.
    """
    key = os.getenv("AZURE_TRANSLATOR_KEY")
    region = os.getenv("AZURE_TRANSLATOR_REGION")

    if not key or not region:
        raise ValueError(
            "AZURE_TRANSLATOR_KEY and AZURE_TRANSLATOR_REGION must be set in .env"
        )

    azure_lang = LANGUAGE_CODE_MAP.get(target_language)
    if not azure_lang:
        raise ValueError(f"Unsupported target language: '{target_language}'")

    # Split into prose segments (to translate) and code segments (to keep)
    prose_segments, code_segments = _split_segments(text)

    # If there is no code at all, send the whole text as one segment
    if not code_segments:
        translated = _call_azure_translate([text], azure_lang, key, region)
        return translated[0]

    # Collect only the prose segments that actually have content
    non_empty_indices = [i for i, p in enumerate(prose_segments) if p.strip()]

    if non_empty_indices:
        # Batch-translate all non-empty prose segments in ONE API call
        texts_to_translate = [prose_segments[i] for i in non_empty_indices]
        translated_texts = _call_azure_translate(texts_to_translate, azure_lang, key, region)

        # Write translated strings back into their slots
        for idx, translated in zip(non_empty_indices, translated_texts):
            prose_segments[idx] = translated

    # Reassemble: prose[0] + code[0] + prose[1] + code[1] + ... + prose[n]
    result = []
    for i, prose in enumerate(prose_segments):
        result.append(prose)
        if i < len(code_segments):
            result.append(code_segments[i])  # code block verbatim

    return "".join(result)