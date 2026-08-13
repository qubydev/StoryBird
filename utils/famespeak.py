"""Server-side client for FameSpeak text-to-speech generations."""

import asyncio
import json
import os
import time
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

load_dotenv()

ORIGIN = "https://famespeak.online"
BASE_PATH = "/api/v1"
BASE_URL = f"{ORIGIN}{BASE_PATH}"
POLL_INTERVAL_SECONDS = float(os.getenv("FAMESPEAK_POLL_INTERVAL_SECONDS", "1.5"))
POLL_TIMEOUT_SECONDS = float(os.getenv("FAMESPEAK_POLL_TIMEOUT_SECONDS", "300"))
RATE_LIMIT_RETRIES = 3
VOICE_PAGE_SIZE = 80  # API maximum
VOICE_MAX_PAGES = 40  # safety cap on catalogue pagination
VOICE_CACHE_SECONDS = float(os.getenv("FAMESPEAK_VOICE_CACHE_SECONDS", "900"))

# (expires_at, catalogue) — the catalogue costs ~13 requests, so avoid refetching
# it every time the voiceover dialog opens.
_voice_cache: tuple[float, list[dict[str, Any]]] | None = None
# famespeak.online sits behind Cloudflare, which rejects the default urllib
# User-Agent with a 1010 "browser signature banned" 403 before the request
# ever reaches the API. A normal browser UA is required.
USER_AGENT = os.getenv(
    "FAMESPEAK_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
)


class FameSpeakError(Exception):
    """A safe error that can be returned to the API client."""

    def __init__(self, message: str, status_code: int = 502, code: str | None = None):
        self.message = message
        self.status_code = status_code
        self.code = code
        super().__init__(message)


def _api_key() -> str:
    key = os.getenv("FAMESPEAK_API_KEY") or os.getenv("FAMESPEAK_API")
    if not key:
        raise FameSpeakError(
            "FameSpeak is not configured. Add FAMESPEAK_API_KEY to the server .env file.",
            503,
        )
    return key


def _resolve(path: str) -> str:
    """Build an absolute URL from an API path or a statusUrl returned by FameSpeak."""
    if path.startswith(("http://", "https://")):
        return path
    if path.startswith(BASE_PATH):
        return f"{ORIGIN}{path}"
    return f"{BASE_URL}{path}"


def _request(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    accept: str = "application/json",
) -> tuple[bytes, str]:
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Accept": accept,
        "User-Agent": USER_AGENT,
    }
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Idempotency-Key"] = str(uuid.uuid4())

    url = _resolve(path)
    for attempt in range(RATE_LIMIT_RETRIES):
        request = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=60) as response:
                return response.read(), response.headers.get_content_type()
        except HTTPError as error:
            detail = code = None
            try:
                parsed = json.loads(error.read().decode("utf-8"))
                detail, code = parsed.get("error"), parsed.get("code")
            except Exception:
                pass

            # Respect Retry-After and back off, as the API documentation requires.
            if error.code == 429 and attempt < RATE_LIMIT_RETRIES - 1:
                try:
                    wait = float(error.headers.get("Retry-After") or 0)
                except (TypeError, ValueError):
                    wait = 0
                time.sleep(min(max(wait, 2 ** attempt), 30))
                continue

            messages = {
                401: "FameSpeak rejected the configured API key.",
                402: detail or "FameSpeak has insufficient credits for this generation.",
                403: detail or "The FameSpeak key does not have access to TTS.",
                410: "The generated audio expired before it could be downloaded. Please generate it again.",
                429: "FameSpeak is rate-limited. Please try again shortly.",
            }
            raise FameSpeakError(
                messages.get(error.code, detail or "FameSpeak could not generate the voiceover."),
                error.code,
                code,
            )
        except URLError as error:
            raise FameSpeakError("Could not reach FameSpeak. Please try again.") from error

    raise FameSpeakError("FameSpeak is rate-limited. Please try again shortly.", 429)


def _download_audio(status_url: str, deadline: float) -> tuple[bytes, str]:
    """Fetch completed audio, tolerating a brief audio_not_ready window."""
    audio_path = f"{status_url.rstrip('/')}/audio"
    while True:
        try:
            return _request(audio_path, accept="audio/*")
        except FameSpeakError as error:
            if error.status_code != 409 or time.monotonic() >= deadline:
                raise
            time.sleep(POLL_INTERVAL_SECONDS)


def _generate_voiceover(text: str, voice: str | None, emotion: str | None, rate: float | None, pitch: float | None, progress_callback=None) -> tuple[bytes, str]:
    payload: dict[str, Any] = {"text": text}
    if voice:
        payload["voice"] = voice
    if emotion:
        payload["emotion"] = emotion
    if rate is not None:
        payload["rate"] = rate
    if pitch is not None:
        payload["pitch"] = pitch

    raw, _ = _request("/tts/generations", method="POST", payload=payload)
    generation = json.loads(raw.decode("utf-8"))
    if progress_callback:
        progress_callback({"status": "queued", "progress": 8, "message": "Voice generation is queued"})
    status_url = generation.get("statusUrl") or (f"/tts/generations/{generation['id']}" if generation.get("id") else None)
    if not status_url:
        raise FameSpeakError("FameSpeak returned an invalid generation response.")

    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        raw, _ = _request(status_url)
        status = json.loads(raw.decode("utf-8"))
        state = str(status.get("status", "")).lower()
        chunks = status.get("chunks") or []
        complete_chunks = sum(1 for chunk in chunks if str(chunk.get("status", "")).lower() == "completed")
        chunk_progress = (complete_chunks / len(chunks) * 80) if chunks else 35
        if progress_callback:
            progress_callback({
                "status": state or "processing",
                "progress": 95 if state == "completed" else min(90, max(15, round(10 + chunk_progress))),
                "message": "Finalizing audio" if state == "completed" else "Generating voiceover",
            })
        if state == "completed":
            return _download_audio(status_url, deadline)
        if state in {"failed", "cancelled"}:
            raise FameSpeakError(status.get("failureMessage") or "FameSpeak could not generate this voiceover.", 502)
        time.sleep(POLL_INTERVAL_SECONDS)

    raise FameSpeakError("Voiceover generation timed out. Please try again.", 504)


async def generate_voiceover(**kwargs: Any) -> tuple[bytes, str]:
    """Create a job, wait for it to finish, and return the audio bytes."""
    return await asyncio.to_thread(_generate_voiceover, **kwargs)


def _page_items(payload: Any) -> list[dict[str, Any]]:
    """The catalogue endpoint returns its array under "items"."""
    if isinstance(payload, list):
        return payload
    return payload.get("items") or payload.get("voices") or []


def _browser_safe(voice: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": voice.get("id"),
        "name": voice.get("displayName") or voice.get("name") or voice.get("id"),
        "language": voice.get("language") or voice.get("locale"),
        "gender": voice.get("gender"),
        "tier": voice.get("tier"),
    }


def _list_voices() -> list[dict[str, Any]]:
    raw, _ = _request(f"/voices?tier=all&limit={VOICE_PAGE_SIZE}&page=1")
    payload = json.loads(raw.decode("utf-8"))
    voices = _page_items(payload)

    total_pages = payload.get("totalPages", 1) if isinstance(payload, dict) else 1
    for page in range(2, min(int(total_pages or 1), VOICE_MAX_PAGES) + 1):
        raw, _ = _request(f"/voices?tier=all&limit={VOICE_PAGE_SIZE}&page={page}")
        page_items = _page_items(json.loads(raw.decode("utf-8")))
        if not page_items:
            break
        voices.extend(page_items)

    seen: set[str] = set()
    catalogue = []
    for voice in voices:
        voice_id = voice.get("id")
        if not voice_id or voice_id in seen:
            continue
        seen.add(voice_id)
        catalogue.append(_browser_safe(voice))
    catalogue.sort(key=lambda voice: ((voice.get("language") or "").lower(), (voice.get("name") or "").lower()))
    return catalogue


async def list_voices() -> list[dict[str, Any]]:
    """Return the full, browser-safe voice catalogue, cached briefly in memory."""
    global _voice_cache

    cached = _voice_cache
    if cached and time.monotonic() < cached[0]:
        return cached[1]

    catalogue = await asyncio.to_thread(_list_voices)
    _voice_cache = (time.monotonic() + VOICE_CACHE_SECONDS, catalogue)
    return catalogue
