"""
azure_flux_image_service.py
────────────────────────────────────────────────────────────────────────────────
Azure FLUX.2-pro image generation provider for StudyBuddy.

Selected when IMAGE_GENERATION_PROVIDER=azure_flux.

Model  : FLUX.2-pro (Black Forest Labs, hosted on Azure AI Services)
API    : Azure AI Services serverless REST endpoint — NOT the OpenAI SDK.
         Uses a plain requests.post() call with an api-key header, the same
         pattern as huggingface_image_service.py.

How it differs from the other two providers
  - huggingface_image_service : free FLUX.1-schnell, HuggingFace token auth
  - azure_image_service       : gpt-image-1 via the Azure OpenAI SDK
  - THIS FILE                 : FLUX.2-pro via Azure AI Services REST endpoint,
                                separate API key + endpoint env vars

Environment variables required (add to .env):
  AZURE_FLUX_ENDPOINT   The full inference URL including the api-version query
                        parameter.  Example:
                        https://<resource>.services.ai.azure.com/providers/
                        blackforestlabs/v1/flux-2-pro?api-version=preview
  AZURE_FLUX_API_KEY    The Azure AI Services API key for this resource.

Safety check
  Reuses the lazy-import pattern from huggingface_image_service.py to avoid
  the circular import chain that would occur at module load time:
    ai_service → image_service → azure_flux_image_service → ai_service

Response parsing
  Azure AI serverless endpoints can return base64 image data under slightly
  different key paths depending on the API version. The _extract_image_bytes()
  helper tries every known shape in priority order so the code stays correct
  across API version bumps without requiring edits here.

Return contract
  generate_image(topic, context_chunks) → bytes   (raw PNG / JPEG)
  ValueError(REFUSAL_SENTINEL)                     on harmful topic
  RuntimeError                                     on API or parse failure
────────────────────────────────────────────────────────────────────────────────
"""

# import base64
# import os
# import time
# from typing import List

# import requests

# # ── Constants ─────────────────────────────────────────────────────────────────

# # Mirrors the sentinel used in every other service file and in chat.py.
# REFUSAL_SENTINEL = "__REFUSED__"

# # Reasonable limits for a synchronous educational image request.
# REQUEST_TIMEOUT_S  = 120   # total seconds before giving up
# MAX_RETRIES        = 3
# RETRY_DELAY_S      = 5     # seconds between retries on transient errors


# # ── Internal helpers ──────────────────────────────────────────────────────────

# def _get_endpoint() -> str:
#     """
#     Returns the Azure FLUX endpoint URL.
#     Reads from AZURE_FLUX_ENDPOINT at call time (not import time) so
#     tests can patch env vars without restarting the process.
#     """
#     endpoint = os.getenv("AZURE_FLUX_ENDPOINT", "").strip()
#     if not endpoint:
#         raise ValueError(
#             "AZURE_FLUX_ENDPOINT is not set in .env. "
#             "Set it to the full Azure AI Services URL for FLUX.2-pro."
#         )
#     return endpoint


# def _get_api_key() -> str:
#     """Returns the Azure AI Services API key for the FLUX resource."""
#     key = os.getenv("AZURE_FLUX_API_KEY", "").strip()
#     if not key:
#         raise ValueError(
#             "AZURE_FLUX_API_KEY is not set in .env. "
#             "Set it to the API key shown in your Azure AI Services resource."
#         )
#     return key


# def _is_retryable(status_code: int) -> bool:
#     """Returns True for status codes that warrant an automatic retry."""
#     return status_code in (429, 500, 502, 503, 504)


# def _extract_image_bytes(response_json: dict) -> bytes:
#     """
#     Extracts raw image bytes from the Azure FLUX JSON response.

#     Azure AI Services serverless endpoints can return base64 image data under
#     several different key paths depending on the model and api-version. This
#     helper tries every known shape in priority order so we handle API version
#     drift gracefully.

#     Tried in order:
#       1. response["data"][0]["b64_json"]          — OpenAI-style (most common)
#       2. response["images"][0]["b64_json"]         — alternate Azure shape
#       3. response["images"][0]["url"] (data URI)   — data:image/...;base64,...
#       4. response["result"]["sample"]              — some Azure inference APIs
#       5. response["output"]                        — fallback flat key

#     Raises RuntimeError if none of the known shapes match.
#     """
#     # Shape 1 — OpenAI-style: {"data": [{"b64_json": "..."}]}
#     data_list = response_json.get("data")
#     if isinstance(data_list, list) and data_list:
#         b64 = data_list[0].get("b64_json")
#         if b64:
#             return base64.b64decode(b64)
#         # Some endpoints put a data-URI in "url" even when b64 is requested
#         url_val = data_list[0].get("url", "")
#         if url_val.startswith("data:"):
#             _, encoded = url_val.split(",", 1)
#             return base64.b64decode(encoded)

#     # Shape 2 — {"images": [{"b64_json": "..."}]}
#     images_list = response_json.get("images")
#     if isinstance(images_list, list) and images_list:
#         b64 = images_list[0].get("b64_json")
#         if b64:
#             return base64.b64decode(b64)
#         url_val = images_list[0].get("url", "")
#         if url_val.startswith("data:"):
#             _, encoded = url_val.split(",", 1)
#             return base64.b64decode(encoded)

#     # Shape 3 — {"result": {"sample": "..."}}
#     result = response_json.get("result")
#     if isinstance(result, dict):
#         sample = result.get("sample")
#         if sample:
#             return base64.b64decode(sample)

#     # Shape 4 — flat {"output": "..."}
#     output = response_json.get("output")
#     if output:
#         return base64.b64decode(output)

#     raise RuntimeError(
#         f"[azure_flux_image_service] Unrecognised response shape — "
#         f"cannot extract image bytes. Keys present: {list(response_json.keys())}"
#     )


# def _call_with_retry(endpoint: str, headers: dict, payload: dict) -> requests.Response:
#     """
#     POSTs to the Azure FLUX endpoint with automatic retry on transient errors.

#     Retries up to MAX_RETRIES times on 429 / 5xx responses. Content policy
#     rejections (400) are NOT retried — they propagate immediately so the caller
#     can detect them and raise ValueError(REFUSAL_SENTINEL).

#     Returns the final Response object with status_code == 200.
#     Raises RuntimeError if all retries are exhausted.
#     """
#     last_error: Exception | None = None

#     for attempt in range(MAX_RETRIES):
#         try:
#             response = requests.post(
#                 endpoint,
#                 headers=headers,
#                 json=payload,
#                 timeout=REQUEST_TIMEOUT_S,
#             )
#         except requests.exceptions.Timeout as exc:
#             last_error = exc
#             if attempt < MAX_RETRIES - 1:
#                 print(
#                     f"[azure_flux_image_service] Request timed out "
#                     f"(attempt {attempt + 1}/{MAX_RETRIES}), retrying in {RETRY_DELAY_S}s…"
#                 )
#                 time.sleep(RETRY_DELAY_S)
#                 continue
#             break
#         except requests.exceptions.RequestException as exc:
#             # Network-level errors (DNS, connection refused, etc.) — retry once.
#             last_error = exc
#             if attempt < MAX_RETRIES - 1:
#                 print(
#                     f"[azure_flux_image_service] Network error on attempt "
#                     f"{attempt + 1}/{MAX_RETRIES}: {exc}. Retrying in {RETRY_DELAY_S}s…"
#                 )
#                 time.sleep(RETRY_DELAY_S)
#                 continue
#             break

#         if response.status_code == 200:
#             return response  # success — return immediately

#         if response.status_code == 400:
#             # 400 means a content policy rejection or malformed request.
#             # Do NOT retry — surface immediately so the caller can decide.
#             return response

#         if _is_retryable(response.status_code) and attempt < MAX_RETRIES - 1:
#             print(
#                 f"[azure_flux_image_service] HTTP {response.status_code} "
#                 f"(attempt {attempt + 1}/{MAX_RETRIES}), retrying in {RETRY_DELAY_S}s…"
#             )
#             time.sleep(RETRY_DELAY_S)
#             last_error = RuntimeError(
#                 f"Azure FLUX API returned {response.status_code}: {response.text[:300]}"
#             )
#             continue

#         # Non-retryable non-200 — raise immediately.
#         raise RuntimeError(
#             f"Azure FLUX API error {response.status_code}: {response.text[:300]}"
#         )

#     raise RuntimeError(
#         f"Azure FLUX API call failed after {MAX_RETRIES} attempts. "
#         f"Last error: {last_error}"
#     )


# def _is_content_policy_rejection(response: requests.Response) -> bool:
#     """
#     Returns True if a 400 response looks like a content policy block
#     rather than a plain malformed-request error.

#     Azure AI Services endpoints signal content rejections via 400 with a
#     JSON body containing error.code values like "content_filter",
#     "ResponsibleAIPolicyViolation", or similar strings in the message.
#     """
#     if response.status_code != 400:
#         return False
#     try:
#         body = response.json()
#     except Exception:
#         return False

#     # Walk common error-body shapes
#     error_obj = body.get("error", body)
#     code    = str(error_obj.get("code",    "")).lower()
#     message = str(error_obj.get("message", "")).lower()

#     policy_signals = (
#         "content_filter",
#         "responsibleaipolicyviolation",
#         "content policy",
#         "content safety",
#         "harmful",
#         "unsafe",
#     )
#     return any(sig in code or sig in message for sig in policy_signals)


# # ── Main public function ──────────────────────────────────────────────────────

# def generate_image(topic: str, context_chunks: List[str]) -> bytes:
#     """
#     Generates an educational illustration using Azure FLUX.2-pro.

#     Matches the exact signature and return contract of the other two providers
#     so image_service.py can swap this in without any changes to chat.py.

#     Args:
#         topic:          The subject to illustrate (e.g. "mitosis").
#         context_chunks: RAG chunks from the student's uploaded document.
#                         Used to enrich the prompt with document-specific detail.

#     Returns:
#         Raw image bytes (PNG/JPEG) ready to pass to
#         blob_service.upload_generated_image_to_blob().

#     Raises:
#         ValueError(REFUSAL_SENTINEL)  — topic is harmful / blocked by content policy.
#         RuntimeError                  — API or network failure.
#     """

#     # ── Step 1: Safety check ──────────────────────────────────────────────────
#     # FLUX.2-pro on Azure has a built-in content policy, but we pre-screen with
#     # the active text LLM (same as huggingface_image_service.py) so the refusal
#     # reaches the user as a polite StudyBuddy message rather than a raw API error.
#     #
#     # Lazy import pattern (identical to huggingface_image_service.py) to avoid
#     # the circular import:
#     #   ai_service → image_service → azure_flux_image_service → ai_service
#     try:
#         _provider = os.getenv("AI_PROVIDER", "azure").strip().lower()

#         if _provider == "gemini":
#             from app.services.gemini_service import _get_client as _gemini_client  # noqa
#             from google.genai import types
#             _client = _gemini_client()
#             safety_resp = _client.models.generate_content(
#                 model="gemini-2.5-flash",
#                 contents=(
#                     f'Is this topic safe and appropriate for generating an '
#                     f'educational illustration for students? Topic: "{topic}"\n\n'
#                     f'Reply with ONLY one word: SAFE or UNSAFE'
#                 ),
#                 config=types.GenerateContentConfig(temperature=0.0),
#             )
#             safety_text = safety_resp.text.strip().upper()
#         else:
#             # Azure OpenAI path (default)
#             from app.services.azure_openai_service import (  # noqa
#                 _get_client as _azure_client,
#                 _chat_deployment,
#                 _call_with_retry as _azure_retry,
#             )
#             _client     = _azure_client()
#             _deployment = _chat_deployment()

#             def _check():
#                 return _client.chat.completions.create(
#                     model=_deployment,
#                     messages=[
#                         {
#                             "role": "system",
#                             "content": (
#                                 "You are a content safety checker. "
#                                 "Reply with only one word: SAFE or UNSAFE."
#                             ),
#                         },
#                         {
#                             "role": "user",
#                             "content": (
#                                 f'Is this topic safe and appropriate for generating an '
#                                 f'educational illustration for students? Topic: "{topic}"\n\n'
#                                 f'Reply with ONLY: SAFE or UNSAFE'
#                             ),
#                         },
#                     ],
#                     temperature=0.0,
#                     max_tokens=10,
#                 )

#             safety_text = _azure_retry(_check).choices[0].message.content.strip().upper()

#         if "UNSAFE" in safety_text:
#             raise ValueError(REFUSAL_SENTINEL)

#     except ValueError:
#         raise  # re-raise REFUSAL_SENTINEL as-is — _dispatch_image handles it
#     except Exception:
#         # Safety check network/quota failure — proceed rather than blocking the
#         # user; Azure FLUX's own content policy is a second line of defence.
#         pass

#     # ── Step 2: Read credentials ──────────────────────────────────────────────
#     endpoint = _get_endpoint()
#     api_key  = _get_api_key()

#     # ── Step 3: Build prompt ──────────────────────────────────────────────────
#     # FLUX.2-pro follows instructions well — give explicit style guidance so
#     # output is consistently clean and educational rather than photorealistic.
#     if context_chunks:
#         context_summary = " ".join(context_chunks[:3])[:500]
#         prompt = (
#             f"Detailed educational scientific illustration of: {topic}. "
#             f"Incorporate these study concepts: {context_summary}. "
#             "Style: clean diagram, pure white background, accurate structure, "
#             "no text labels, no captions, no watermarks, "
#             "suitable for a student textbook."
#         )
#     else:
#         prompt = (
#             f"Detailed educational scientific illustration of: {topic}. "
#             "Style: clean diagram, pure white background, accurate structure, "
#             "no text labels, no captions, no watermarks, "
#             "suitable for a student textbook."
#         )

#     # ── Step 4: Build request ─────────────────────────────────────────────────
#     # Azure AI Services endpoints authenticate via the "api-key" header.
#     # "Authorization: Bearer ..." also works but "api-key" is the canonical
#     # Azure pattern and matches what the Azure portal shows.
#     headers = {
#         "api-key":       api_key,
#         "Content-Type":  "application/json",
#         "Accept":        "application/json",
#     }

#     # FLUX.2-pro request body. width/height default to 1024 which is the
#     # standard square format used by all other providers in this codebase.
#     payload = {
#         "model": "FLUX.2-pro",
#         "prompt": prompt,
#         "width":  1024,
#         "height": 1024,
#     }

#     # ── Step 5: Call API with retry ───────────────────────────────────────────
#     response = _call_with_retry(endpoint, headers, payload)

#     # ── Step 6: Handle content policy rejection ───────────────────────────────
#     if response.status_code == 400 and _is_content_policy_rejection(response):
#         print(
#             f"[azure_flux_image_service] Azure content policy blocked "
#             f"topic: '{topic}'"
#         )
#         raise ValueError(REFUSAL_SENTINEL)

#     if response.status_code != 200:
#         raise RuntimeError(
#             f"Azure FLUX API error {response.status_code}: "
#             f"{response.text[:300]}"
#         )

#     # ── Step 7: Parse response → raw bytes ───────────────────────────────────
#     try:
#         response_json = response.json()
#     except Exception as exc:
#         raise RuntimeError(
#             f"[azure_flux_image_service] Could not parse API response as JSON: {exc}. "
#             f"Raw response (first 300 chars): {response.text[:300]}"
#         ) from exc

#     return _extract_image_bytes(response_json)


import base64
import logging
import os
import random
import time
from typing import List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

REFUSAL_SENTINEL = "__REFUSED__"

REQUEST_TIMEOUT_S = int(os.getenv("AZURE_FLUX_TIMEOUT_S", "60"))
MAX_RETRIES = int(os.getenv("AZURE_FLUX_MAX_RETRIES", "2"))
BASE_RETRY_DELAY_S = float(os.getenv("AZURE_FLUX_RETRY_DELAY_S", "1.0"))

SESSION = requests.Session()
retry_strategy = Retry(
    total=0,
    connect=0,
    read=0,
    status=0,
    allowed_methods=frozenset(["POST"]),
)
adapter = HTTPAdapter(pool_connections=10, pool_maxsize=10, max_retries=retry_strategy)
SESSION.mount("https://", adapter)
SESSION.mount("http://", adapter)


def _get_env_first(*names: str, required: bool = True, default: str = "") -> str:
    for name in names:
        val = os.getenv(name)
        if val is not None and val.strip():
            return val.strip()
    if required:
        raise ValueError(f"Missing required environment variable. Tried: {', '.join(names)}")
    return default


def _get_endpoint() -> str:
    endpoint = _get_env_first("AZURE_FLUX_ENDPOINT", "azure_flux_endpoint")
    if "?api-version=" not in endpoint:
        raise ValueError(
            "AZURE_FLUX_ENDPOINT must include the full Azure FLUX URL with ?api-version=preview."
        )
    return endpoint


def _get_api_key() -> str:
    return _get_env_first("AZURE_FLUX_API_KEY", "azure_flux_key")


def _is_retryable(status_code: int) -> bool:
    return status_code in (429, 500, 502, 503, 504)


def _format_error(response: requests.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            err = body.get("error", body)
            if isinstance(err, dict):
                code = err.get("code")
                message = err.get("message")
                if code or message:
                    return f"{code or 'Error'}: {message or response.text[:500]}"
        return str(body)
    except Exception:
        return response.text[:500]


def _extract_image_bytes(response_json: dict) -> bytes:
    data_list = response_json.get("data")
    if isinstance(data_list, list) and data_list:
        first = data_list[0] if isinstance(data_list[0], dict) else {}
        b64 = first.get("b64_json")
        if b64:
            return base64.b64decode(b64)
        url_val = first.get("url", "")
        if isinstance(url_val, str) and url_val.startswith("data:"):
            _, encoded = url_val.split(",", 1)
            return base64.b64decode(encoded)

    images_list = response_json.get("images")
    if isinstance(images_list, list) and images_list:
        first = images_list[0] if isinstance(images_list[0], dict) else {}
        b64 = first.get("b64_json")
        if b64:
            return base64.b64decode(b64)
        url_val = first.get("url", "")
        if isinstance(url_val, str) and url_val.startswith("data:"):
            _, encoded = url_val.split(",", 1)
            return base64.b64decode(encoded)

    result = response_json.get("result")
    if isinstance(result, dict):
        sample = result.get("sample")
        if sample:
            return base64.b64decode(sample)

    output = response_json.get("output")
    if output:
        return base64.b64decode(output)

    raise RuntimeError(
        f"Unrecognized Azure FLUX response shape. Keys: {list(response_json.keys())}"
    )


def _build_prompt(topic: str, context_chunks: List[str]) -> str:
    topic = (topic or "").strip()

    context_summary = ""
    if context_chunks:
        cleaned = " ".join(chunk.strip() for chunk in context_chunks if chunk and chunk.strip())
        context_summary = cleaned[:700]

    prompt = (
        f"Create a single clean educational diagram of: {topic}. "
        f"If relevant, incorporate these study concepts: {context_summary}. "
        "Use a pure white background. "
        "Make it look like a high-quality textbook illustration. "
        "Show only the subject itself. "
        "Absolutely no text, no labels, no numbers, no arrows, no captions, "
        "no legends, no callouts, no annotations, no watermark, no signature, "
        "no border, no frame, no extraneous objects. "
        "Use clear shapes, accurate structure, and visually clean composition."
    )
    return prompt


def _call_api(endpoint: str, headers: dict, payload: dict) -> requests.Response:
    last_exc: Optional[Exception] = None

    for attempt in range(MAX_RETRIES):
        try:
            response = SESSION.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT_S,
            )
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                delay = BASE_RETRY_DELAY_S * (2 ** attempt) + random.uniform(0, 0.25)
                logger.warning(
                    "Azure FLUX network error on attempt %s/%s: %s. Retrying in %.2fs",
                    attempt + 1,
                    MAX_RETRIES,
                    exc,
                    delay,
                )
                time.sleep(delay)
                continue
            raise RuntimeError(f"Azure FLUX request failed: {exc}") from exc

        if response.status_code == 200:
            return response

        if response.status_code == 400:
            raise RuntimeError(f"Azure FLUX request rejected: {_format_error(response)}")

        if _is_retryable(response.status_code) and attempt < MAX_RETRIES - 1:
            delay = BASE_RETRY_DELAY_S * (2 ** attempt) + random.uniform(0, 0.25)
            logger.warning(
                "Azure FLUX returned %s on attempt %s/%s. Retrying in %.2fs",
                response.status_code,
                attempt + 1,
                MAX_RETRIES,
                delay,
            )
            time.sleep(delay)
            continue

        raise RuntimeError(
            f"Azure FLUX API error {response.status_code}: {_format_error(response)}"
        )

    raise RuntimeError(f"Azure FLUX API call failed after {MAX_RETRIES} attempts: {last_exc}")


def generate_image(topic: str, context_chunks: List[str]) -> bytes:
    endpoint = _get_endpoint()
    api_key = _get_api_key()

    prompt = _build_prompt(topic, context_chunks)

    headers = {
        "api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    payload = {
        "model": "FLUX.2-pro",
        "prompt": prompt,
        "width": 1024,
        "height": 1024,
        "output_format": "png",
    }

    seed_val = os.getenv("AZURE_FLUX_SEED", "").strip()
    if seed_val:
        try:
            payload["seed"] = int(seed_val)
        except ValueError:
            raise ValueError("AZURE_FLUX_SEED must be an integer")

    safety_tol = os.getenv("AZURE_FLUX_SAFETY_TOLERANCE", "").strip()
    if safety_tol:
        try:
            payload["safety_tolerance"] = int(safety_tol)
        except ValueError:
            raise ValueError("AZURE_FLUX_SAFETY_TOLERANCE must be an integer")

    response = _call_api(endpoint, headers, payload)

    response_json = response.json()
    return _extract_image_bytes(response_json)