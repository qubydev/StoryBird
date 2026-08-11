import base64
import binascii
import json
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Iterable

from fastapi import status


FLOW_URL = "https://labs.google/fx/tools/flow"
FLOW_IMAGE_URL_PATTERN = re.compile(r"(?:flow-content\.google/image/|media\.getMediaUrlRedirect\?name=)", re.IGNORECASE)


class GoogleFlowError(Exception):
    def __init__(self, status_code: int, message: str, refresh: bool = False, errors=None):
        self.status_code = status_code
        self.message = message
        self.refresh = refresh
        self.errors = errors
        super().__init__(message)


def _parse_cookies(session_token: str) -> list[dict]:
    """Accept a browser-exported Google cookie JSON array for a Flow session."""
    if not session_token:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Google Flow cookies are required")
    try:
        raw_cookies = json.loads(session_token)
    except json.JSONDecodeError as exc:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Google Flow cookies must be a JSON array exported from your signed-in browser") from exc
    if not isinstance(raw_cookies, list) or not raw_cookies:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Google Flow cookies must be a non-empty JSON array")

    cookies = []
    for cookie in raw_cookies:
        if not isinstance(cookie, dict) or not cookie.get("name") or "value" not in cookie:
            continue
        normalized = {"name": str(cookie["name"]), "value": str(cookie["value"]), "path": cookie.get("path") or "/"}
        if cookie.get("domain"):
            normalized["domain"] = cookie["domain"]
        else:
            normalized["url"] = "https://labs.google/fx"
        expires = cookie.get("expires", cookie.get("expirationDate", -1))
        if expires not in (None, -1, 0):
            normalized["expires"] = float(expires)
        if "httpOnly" in cookie:
            normalized["httpOnly"] = bool(cookie["httpOnly"])
        if "secure" in cookie:
            normalized["secure"] = bool(cookie["secure"])
        same_site = cookie.get("sameSite")
        if same_site in {"Strict", "Lax", "None"}:
            normalized["sameSite"] = same_site
        elif same_site in {"no_restriction", "unspecified"}:
            normalized["sameSite"] = "None"
        cookies.append(normalized)
    if not cookies:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "No usable cookies were found in the JSON array")
    return cookies


def validate_session_cookies(session_token: str) -> None:
    _parse_cookies(session_token)


def _aspect_tab_index(aspect_ratio: str) -> int:
    return {"IMAGE_ASPECT_RATIO_LANDSCAPE": 2, "IMAGE_ASPECT_RATIO_SQUARE": 4, "IMAGE_ASPECT_RATIO_PORTRAIT": 6}.get(aspect_ratio, 2)


def _reference_file_data(reference: dict, index: int) -> tuple[str, bytes] | None:
    image = reference.get("image") if isinstance(reference, dict) else None
    if not image:
        return None
    try:
        if image.startswith("data:"):
            header, payload = image.split(",", 1)
            mime_match = re.match(r"data:image/([a-zA-Z0-9.+-]+);base64", header)
            extension = mime_match.group(1) if mime_match else "png"
        else:
            payload, extension = image, "png"
        return f"reference_{index}.{extension}", base64.b64decode(payload)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "A character reference image is invalid") from exc


def _collect_image_urls(page) -> set[str]:
    urls = page.locator("img").evaluate_all("elements => elements.map(element => element.src)")
    return {url for url in urls if FLOW_IMAGE_URL_PATTERN.search(url)}


def _open_composer(page):
    """Open Flow's signed-in composer from its public landing page."""
    editor_selector = '[contenteditable="true"], textarea:not(.g-recaptcha-response):not([name="g-recaptcha-response"])'

    def visible_editor():
        editors = page.locator(editor_selector)
        for index in range(editors.count()):
            candidate = editors.nth(index)
            if candidate.is_visible():
                return candidate
        return None

    editor = visible_editor()
    if editor is not None:
        return editor

    launchers = page.get_by_text(re.compile(r"^Create with Google Flow$", re.I))
    if launchers.count():
        launchers.first.click(timeout=15_000)
        page.wait_for_timeout(3_000)

    editor = visible_editor()
    if editor is None:
        raise GoogleFlowError(
            status.HTTP_401_UNAUTHORIZED,
            "Google Flow did not open its composer. Your Flow cookies are expired, incomplete, or do not have Flow access.",
            refresh=True,
        )
    return editor


def _download_image_as_base64(page, url: str) -> str:
    try:
        response = page.context.request.get(url, max_redirects=5, timeout=30_000)
        if response.ok:
            return base64.b64encode(response.body()).decode("ascii")
    except Exception:
        pass
    try:
        return page.evaluate("""async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Image download failed (${response.status})`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        }""", url)
    except Exception as exc:
        raise GoogleFlowError(status.HTTP_502_BAD_GATEWAY, f"Flow generated an image that could not be downloaded: {exc}") from exc


def _configure_flow(page, aspect_ratio: str) -> None:
    settings = page.locator('button[aria-haspopup="menu"]').filter(has_text="Nano Banana").last
    settings.click(timeout=15_000)
    tabs = page.locator('[role="menu"] [role="tab"]')
    tabs.nth(0).click(timeout=10_000)
    tabs.nth(_aspect_tab_index(aspect_ratio)).click(timeout=10_000)
    page.keyboard.press("Escape")


def _attach_references(page, reference_paths: Iterable[str]) -> None:
    paths = list(reference_paths)
    if not paths:
        return
    page.locator('button[aria-haspopup="dialog"]').filter(has_text=re.compile("add", re.I)).last.click(timeout=15_000)
    page.get_by_role("button", name=re.compile("upload media", re.I)).click(timeout=10_000)
    page.locator('input[type="file"][accept*="image"]').last.set_input_files(paths, timeout=15_000)
    page.get_by_role("button", name=re.compile("add to prompt", re.I)).click(timeout=15_000)


def _click_create(page) -> None:
    create = page.get_by_role("button", name=re.compile("create|arrow_forward", re.I)).last
    if create.get_attribute("aria-disabled") == "true":
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Flow's Create button is disabled")
    create.click(timeout=15_000)


def generate_image(prompt: str, aspect_ratio: str = "IMAGE_ASPECT_RATIO_LANDSCAPE", session_token: str | None = None, references: list[dict] | None = None) -> dict:
    """Generate one Flow image and preserve the legacy response shape used by the UI."""
    if not prompt or not prompt.strip():
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Prompt is required")
    cookies = _parse_cookies(session_token or "")
    try:
        from patchright.sync_api import sync_playwright
    except ImportError as exc:
        raise GoogleFlowError(status.HTTP_500_INTERNAL_SERVER_ERROR, "Patchright is not installed. Run `pip install -r requirements.txt` and `patchright install chromium`.") from exc

    with tempfile.TemporaryDirectory() as temp_dir:
        reference_paths = []
        for index, reference in enumerate(references or []):
            file_data = _reference_file_data(reference, index)
            if file_data is not None:
                filename, contents = file_data
                path = Path(temp_dir) / filename
                path.write_bytes(contents)
                reference_paths.append(str(path))

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            try:
                context.add_cookies(cookies)
                page = context.new_page()
                page.goto(FLOW_URL, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_timeout(3_000)
                if "accounts.google.com" in page.url:
                    raise GoogleFlowError(status.HTTP_401_UNAUTHORIZED, "Google Flow session has expired", refresh=True)
                editor = _open_composer(page)
                existing_urls = _collect_image_urls(page)
                editor.click(timeout=20_000)
                if editor.get_attribute("contenteditable") == "true":
                    page.keyboard.insert_text(prompt)
                else:
                    editor.fill(prompt)
                _configure_flow(page, aspect_ratio)
                _attach_references(page, reference_paths)
                captured_urls = set()

                def capture_response(response):
                    if FLOW_IMAGE_URL_PATTERN.search(response.url) and response.headers.get("content-type", "").startswith("image/"):
                        captured_urls.add(response.url)

                page.on("response", capture_response)
                _click_create(page)
                deadline = time.monotonic() + 300
                generated_urls = set()
                while time.monotonic() < deadline:
                    if "accounts.google.com" in page.url:
                        raise GoogleFlowError(status.HTTP_401_UNAUTHORIZED, "Google Flow session has expired", refresh=True)
                    generated_urls.update(captured_urls)
                    generated_urls.update(_collect_image_urls(page) - existing_urls)
                    if generated_urls:
                        break
                    page.wait_for_timeout(5_000)
                if not generated_urls:
                    raise GoogleFlowError(status.HTTP_504_GATEWAY_TIMEOUT, "Flow generation timed out without returning an image")
                image_base64 = _download_image_as_base64(page, next(iter(generated_urls)))
                return {"imagePanels": [{"generatedImages": [{"encodedImage": image_base64}]}]}
            except GoogleFlowError:
                raise
            except Exception as exc:
                raise GoogleFlowError(
                    status.HTTP_502_BAD_GATEWAY,
                    f"Google Flow automation failed: {type(exc).__name__}: {exc}",
                ) from exc
            finally:
                context.close()
                browser.close()


def upload_image(raw_bytes: str, session_token: str) -> dict:
    """Validate Flow cookies; references are attached only when a Flow job is generated."""
    if not raw_bytes:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Raw bytes are required to upload image")
    validate_session_cookies(session_token)
    return {"uploadMediaGenerationId": f"flow-reference-{uuid.uuid4()}"}
