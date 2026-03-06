"""
translator_service.py
Wraps Azure AI Translator calls for chat message translation.
Uses the REST API directly (simpler than the SDK for single-call translation).
"""

import os
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


def translate_text(text: str, target_language: str) -> str:
    """
    Translates text into the target language using Azure Translator.

    Args:
        text: The text to translate (can be any language).
        target_language: One of our LanguageContext codes e.g. "hi", "ta", "en".

    Returns:
        Translated text as a string.

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

    url = f"{TRANSLATOR_ENDPOINT}/translate"

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Ocp-Apim-Subscription-Region": region,
        "Content-Type": "application/json",
        "X-ClientTraceId": str(uuid.uuid4()),
    }

    params = {
        "api-version": "3.0",
        "to": azure_lang,
    }

    body = [{"text": text}]

    response = requests.post(url, headers=headers, params=params, json=body, timeout=10)

    if response.status_code != 200:
        raise RuntimeError(
            f"Azure Translator error {response.status_code}: {response.text}"
        )

    result = response.json()
    translated = result[0]["translations"][0]["text"]
    return translated