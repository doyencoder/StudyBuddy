"""
tts_service.py
Wraps the Azure Speech Service REST API for Text-to-Speech.

Returns raw MP3 bytes that the frontend plays via the Web Audio API.
This replaces browser window.speechSynthesis which has no reliable support
for Indian-language voices and silently fails on non-Latin scripts (Devanagari,
Tamil, Telugu, etc.) after translation.

Azure Neural voices used:
  en  → en-US-JennyNeural
  hi  → hi-IN-SwaraNeural
  mr  → mr-IN-AarohiNeural
  ta  → ta-IN-PallaviNeural
  te  → te-IN-ShrutiNeural
  bn  → bn-IN-TanishaaNeural
  gu  → gu-IN-DhwaniNeural
  kn  → kn-IN-SapnaNeural
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

# Azure Speech endpoint pattern
TTS_ENDPOINT_TEMPLATE = "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"

# Map our LanguageContext codes → Azure Neural voice names
VOICE_MAP: dict[str, str] = {
    "en": "en-US-JennyNeural",
    "hi": "hi-IN-SwaraNeural",
    "mr": "mr-IN-AarohiNeural",
    "ta": "ta-IN-PallaviNeural",
    "te": "te-IN-ShrutiNeural",
    "bn": "bn-IN-TanishaaNeural",
    "gu": "gu-IN-DhwaniNeural",
    "kn": "kn-IN-SapnaNeural",
}

# Locale codes that match each voice (required in SSML)
LOCALE_MAP: dict[str, str] = {
    "en": "en-US",
    "hi": "hi-IN",
    "mr": "mr-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "bn": "bn-IN",
    "gu": "gu-IN",
    "kn": "kn-IN",
}


def synthesize_speech(text: str, language: str) -> bytes:
    """
    Converts text to speech using Azure Neural TTS.

    Args:
        text:     The plain text to speak. Markdown symbols should be stripped
                  before calling this (the router does that).
        language: One of our LanguageContext codes: en, hi, mr, ta, te, bn, gu, kn.

    Returns:
        Raw MP3 bytes ready to stream back to the browser.

    Raises:
        ValueError:  Missing env vars or unsupported language code.
        RuntimeError: Azure API returned a non-200 status.
    """
    key    = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION")

    if not key or not region:
        raise ValueError(
            "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set in .env"
        )

    voice  = VOICE_MAP.get(language)
    locale = LOCALE_MAP.get(language)

    if not voice or not locale:
        raise ValueError(f"Unsupported language code: '{language}'")

    endpoint = TTS_ENDPOINT_TEMPLATE.format(region=region)

    # SSML payload — wraps the text with the selected Neural voice
    ssml = f"""<speak version='1.0' xml:lang='{locale}'>
  <voice xml:lang='{locale}' name='{voice}'>
    {text}
  </voice>
</speak>"""

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        # 48 kbps mono MP3 — small payload, universally supported in browsers
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "Content-Type": "application/ssml+xml",
    }

    response = requests.post(
        endpoint,
        headers=headers,
        data=ssml.encode("utf-8"),
        timeout=15,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"Azure Speech error {response.status_code}: {response.text}"
        )

    return response.content   # raw MP3 bytes