"""
web_search_service.py
---------------------
Provides web search results via SerpAPI (Google engine).

Environment variable required:
    SERP_API_KEY  — from https://serpapi.com (free tier: 100 searches/month)

Each result returned is a dict with:
    title    : page title
    url      : canonical URL
    snippet  : 2-3 sentence excerpt shown in Google results
    favicon  : small icon URL (from Google's favicon service)
    source   : domain name (e.g. "wikipedia.org")
"""

import os
import re
from typing import List, Dict
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

load_dotenv()

SERP_API_KEY = os.getenv("SERP_API_KEY", "")
SERP_API_URL = "https://serpapi.com/search.json"

# Keywords that indicate the user wants to see images rather than text answers
_IMAGE_QUERY_PATTERN = re.compile(
    r'\b(show|display|picture|pictures|photo|photos|image|images|diagram|diagrams|'
    r'illustration|illustrations|visual|visuals|what does .+ look like|how does .+ look)\b',
    re.IGNORECASE,
)


def is_image_query(query: str) -> bool:
    """Returns True if the query is asking for images/pictures."""
    return bool(_IMAGE_QUERY_PATTERN.search(query))


def _extract_domain(url: str) -> str:
    """Returns bare domain, e.g. 'en.wikipedia.org' → 'wikipedia.org'."""
    try:
        host = urlparse(url).hostname or ""
        parts = host.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else host
    except Exception:
        return url


def web_search(query: str, num_results: int = 6) -> List[Dict]:
    """
    Searches Google via SerpAPI and returns the top organic results.

    Args:
        query       : the search query string
        num_results : how many results to return (max 10 for free tier)

    Returns:
        List of dicts: [{title, url, snippet, favicon, source}, ...]

    Raises:
        ValueError  : if SERP_API_KEY is not configured
        RuntimeError: if the SerpAPI request fails
    """
    if not SERP_API_KEY:
        raise ValueError(
            "SERP_API_KEY is not set. Add it to Backend/.env — get a free key at https://serpapi.com"
        )

    params = {
        "q": query,
        "api_key": SERP_API_KEY,
        "num": min(num_results, 10),
        "engine": "google",
        "gl": "us",
        "hl": "en",
        "safe": "active",
    }

    try:
        resp = requests.get(SERP_API_URL, params=params, timeout=12)
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        raise RuntimeError("Web search timed out. Please try again.")
    except requests.exceptions.HTTPError as e:
        raise RuntimeError(f"SerpAPI returned an error: {e}")
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Web search request failed: {e}")

    data = resp.json()

    # SerpAPI returns an error field when something goes wrong (e.g. invalid key)
    if "error" in data:
        raise RuntimeError(f"SerpAPI error: {data['error']}")

    results = []
    for r in data.get("organic_results", [])[:num_results]:
        url = r.get("link", "")
        domain = _extract_domain(url)
        results.append({
            "title":   r.get("title", ""),
            "url":     url,
            "snippet": r.get("snippet", ""),
            "favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
            "source":  domain,
        })

    return results


def image_search(query: str, num_results: int = 8) -> List[Dict]:
    """
    Searches Google Images via SerpAPI and returns image results.

    Args:
        query       : the image search query
        num_results : how many images to return (capped at 10)

    Returns:
        List of dicts: [{thumbnail, original, title, source, link}, ...]

    Raises:
        ValueError  : if SERP_API_KEY is not configured
        RuntimeError: if the SerpAPI request fails
    """
    if not SERP_API_KEY:
        raise ValueError(
            "SERP_API_KEY is not set. Add it to Backend/.env — get a free key at https://serpapi.com"
        )

    params = {
        "q": query,
        "api_key": SERP_API_KEY,
        "engine": "google_images",
        "gl": "us",
        "hl": "en",
        "safe": "active",
        "num": min(num_results, 10),
    }

    try:
        resp = requests.get(SERP_API_URL, params=params, timeout=12)
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        raise RuntimeError("Image search timed out. Please try again.")
    except requests.exceptions.HTTPError as e:
        raise RuntimeError(f"SerpAPI image search error: {e}")
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Image search request failed: {e}")

    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"SerpAPI error: {data['error']}")

    results = []
    for r in data.get("images_results", [])[:num_results]:
        thumbnail = r.get("thumbnail", "")
        original  = r.get("original", thumbnail)   # fall back to thumbnail if no original
        if not thumbnail:
            continue                                 # skip entries with no usable image
        results.append({
            "thumbnail": thumbnail,
            "original":  original,
            "title":     r.get("title", ""),
            "source":    _extract_domain(r.get("link", "")),
            "link":      r.get("link", ""),
        })

    return results


def build_search_context(results: List[Dict]) -> str:
    """
    Converts search results into a plain-text context block suitable for
    injection into a Gemini system prompt.
    """
    if not results:
        return "(No web results found)"

    lines = ["WEB SEARCH RESULTS (use these as your primary source of truth):\n"]
    for i, r in enumerate(results, 1):
        lines.append(f"[{i}] {r['title']}")
        lines.append(f"    URL: {r['url']}")
        lines.append(f"    {r['snippet']}")
        lines.append("")

    lines.append(
        "INSTRUCTIONS: Answer ONLY the current question using the results above. "
        "Do not bring in any prior conversation context. "
        "Do NOT add citation numbers like [1], [2] in your answer — sources are displayed separately. "
        "If the results do not answer the question, say so clearly."
    )
    return "\n".join(lines)


# Keywords that indicate the user wants YouTube videos
_VIDEO_QUERY_PATTERN = re.compile(
    r'\b(youtube|video|videos|watch|tutorial|tutorials|how to video|lecture|clip|clips|documentary)\b',
    re.IGNORECASE,
)


def is_video_query(query: str) -> bool:
    """Returns True if the query is asking for YouTube videos."""
    return bool(_VIDEO_QUERY_PATTERN.search(query))


def youtube_search(query: str, num_results: int = 6) -> list:
    """
    Searches YouTube via SerpAPI and returns video results.

    Returns:
        List of dicts: [{thumbnail, title, channel, duration, views, url, published}, ...]
    """
    if not SERP_API_KEY:
        raise ValueError("SERP_API_KEY is not set.")

    # Strip "youtube" keyword from query for cleaner search
    clean_query = re.sub(r'\byoutube\b', '', query, flags=re.IGNORECASE).strip()

    params = {
        "q": clean_query or query,
        "api_key": SERP_API_KEY,
        "engine": "youtube",
        "gl": "us",
        "hl": "en",
    }

    try:
        resp = requests.get(SERP_API_URL, params=params, timeout=12)
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        raise RuntimeError("YouTube search timed out. Please try again.")
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"YouTube search failed: {e}")

    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"SerpAPI error: {data['error']}")

    results = []
    for r in data.get("video_results", [])[:num_results]:
        thumbnail = ""
        thumbs = r.get("thumbnails", [])
        if thumbs:
            thumbnail = thumbs[-1].get("static", "") or thumbs[0].get("static", "")

        link = r.get("link", "")
        if not link:
            vid_id = r.get("id", "")
            link = f"https://www.youtube.com/watch?v={vid_id}" if vid_id else ""

        results.append({
            "thumbnail": thumbnail,
            "title":     r.get("title", ""),
            "channel":   r.get("channel", {}).get("name", ""),
            "duration":  r.get("length", ""),
            "views":     r.get("views", ""),
            "published": r.get("published_date", ""),
            "url":       link,
        })

    return results