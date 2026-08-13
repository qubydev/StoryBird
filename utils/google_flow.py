import base64
import binascii
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
import logging
from urllib.parse import urlparse
from pathlib import Path
from typing import Iterable

from fastapi import status


FLOW_URL = "https://labs.google/fx/tools/flow"
FLOW_IMAGE_URL_PATTERN = re.compile(r"(?:flow-content\.google/image/|media\.getMediaUrlRedirect\?name=)", re.IGNORECASE)
FLOW_PROFILE_DIR = Path(os.getenv("FLOW_PROFILE_DIR", str(Path.home() / ".anim-board-flow-profile")))
_flow_profile_process: subprocess.Popen | None = None
logger = logging.getLogger(__name__)


class GoogleFlowError(Exception):
    def __init__(self, status_code: int, message: str, refresh: bool = False, errors=None):
        self.status_code = status_code
        self.message = message
        self.refresh = refresh
        self.errors = errors
        super().__init__(message)


def open_flow_profile() -> bool:
    """Open a persistent, visible Flow profile so the user can sign in."""
    global _flow_profile_process
    if _flow_profile_process is not None and _flow_profile_process.poll() is None:
        return False

    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    _flow_profile_process = subprocess.Popen(
        [sys.executable, "-m", "utils.flow_profile"],
        creationflags=creation_flags,
    )
    return True


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


async def _collect_image_urls(page) -> set[str]:
    urls = await page.locator("img").evaluate_all("elements => elements.map(element => element.src)")
    return {url for url in urls if FLOW_IMAGE_URL_PATTERN.search(url)}


async def _open_composer(page):
    """Open Flow's signed-in composer from its public landing page."""
    editor_selector = '[contenteditable="true"], textarea:not(.g-recaptcha-response):not([name="g-recaptcha-response"])'

    async def visible_editor():
        editors = page.locator(editor_selector)
        for index in range(await editors.count()):
            candidate = editors.nth(index)
            if await candidate.is_visible():
                return candidate
        return None

    editor = await visible_editor()
    if editor is not None:
        return editor

    launcher_pattern = re.compile(
        r"(?:create|try|start).*google flow|new (?:project|flow)|get started|open flow",
        re.I,
    )
    launchers = [
        page.get_by_role("button", name=launcher_pattern),
        page.get_by_role("link", name=launcher_pattern),
        page.get_by_text(launcher_pattern),
    ]
    launcher = None
    for candidates in launchers:
        for index in range(await candidates.count()):
            candidate = candidates.nth(index)
            if await candidate.is_visible():
                launcher = candidate
                break
        if launcher is not None:
            break

    if launcher is None:
        visible_text = " ".join((await page.locator("body").inner_text()).split())[:220]
        raise GoogleFlowError(
            status.HTTP_502_BAD_GATEWAY,
            "Google Flow's composer launcher was not found. "
            f"Current Flow page: {visible_text or 'no readable content'}",
        )

    await launcher.click(timeout=15_000)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if "accounts.google.com" in page.url:
            raise GoogleFlowError(
                status.HTTP_401_UNAUTHORIZED,
                "Google Flow requires a fresh signed-in session. Re-export your complete Google cookies from a browser where Flow opens successfully, then paste them in Global Settings.",
                refresh=True,
            )
        editor = await visible_editor()
        if editor is not None:
            return editor
        await page.wait_for_timeout(500)

    raise GoogleFlowError(
        status.HTTP_502_BAD_GATEWAY,
        "Google Flow opened but its composer was not ready. Google may have changed the Flow interface.",
    )


async def _download_image_as_base64(page, url: str) -> str:
    try:
        response = await page.context.request.get(url, max_redirects=5, timeout=30_000)
        if response.ok:
            return base64.b64encode(await response.body()).decode("ascii")
    except Exception:
        pass
    try:
        return await page.evaluate("""async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Image download failed (${response.status})`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        }""", url)
    except Exception as exc:
        raise GoogleFlowError(status.HTTP_502_BAD_GATEWAY, f"Flow generated an image that could not be downloaded: {exc}") from exc


# The settings control is labelled with the model currently selected, so it
# cannot be found by one fixed name once the user starts switching models.
MODEL_BUTTON_HINT = re.compile(r"nano banana|imagen|veo|gemini|model", re.I)


async def _settings_button(page):
    """Find Flow's model/settings control despite its label changing with the model."""
    menus = page.locator('button[aria-haspopup="menu"]')
    labelled = menus.filter(has_text=MODEL_BUTTON_HINT)
    for candidate in (labelled.last, menus.last):
        try:
            if await candidate.count() and await candidate.is_visible(timeout=3_000):
                return candidate
        except Exception:
            continue
    return None


async def _select_model(page, model: str) -> bool:
    """Choose a named image model inside the open settings menu.

    Flow names and arranges its models however it likes, so match on the visible
    label and report whether anything was clicked. A miss is not an error: the
    caller keeps Flow's current default rather than failing the generation.
    """
    pattern = re.compile(re.escape(model), re.I)
    candidates = [
        page.locator('[role="menu"] [role="menuitemradio"]').filter(has_text=pattern),
        page.locator('[role="menu"] [role="menuitem"]').filter(has_text=pattern),
        page.locator('[role="menu"] [role="option"]').filter(has_text=pattern),
        page.locator('[role="menu"] button').filter(has_text=pattern),
    ]
    for option in candidates:
        try:
            if not await option.count():
                continue
            target = option.first
            if not await target.is_visible(timeout=2_000):
                continue
            await target.click(timeout=10_000)
            logger.info("Google Flow model set to %r", model)
            return True
        except Exception:
            continue

    logger.warning("Google Flow model %r was not offered; keeping Flow's default", model)
    return False


async def _configure_flow(page, aspect_ratio: str, model: str | None = None) -> None:
    # Flow regularly changes the model/settings control. Both the model and the
    # aspect ratio are preferences, so don't fail an image generation when that
    # optional UI is absent; Flow will use its current defaults instead.
    settings = await _settings_button(page)
    if settings is None:
        if model:
            logger.warning("Google Flow settings menu was not found; cannot select model %r", model)
        return

    try:
        await settings.click(timeout=10_000)
        if model:
            await _select_model(page, model)
            # Selecting a model can close the menu, so reopen it before the
            # aspect ratio tabs are needed.
            if not await page.locator('[role="menu"]').count():
                reopened = await _settings_button(page)
                if reopened is None:
                    return
                await reopened.click(timeout=10_000)

        tabs = page.locator('[role="menu"] [role="tab"]')
        if await tabs.count() <= _aspect_tab_index(aspect_ratio):
            return
        await tabs.nth(0).click(timeout=10_000)
        await tabs.nth(_aspect_tab_index(aspect_ratio)).click(timeout=10_000)
    except Exception:
        return
    finally:
        await page.keyboard.press("Escape")


async def _attach_references(page, reference_paths: Iterable[str]) -> None:
    paths = list(reference_paths)
    if not paths:
        return
    await page.locator('button[aria-haspopup="dialog"]').filter(has_text=re.compile("add", re.I)).last.click(timeout=15_000)
    await page.get_by_role("button", name=re.compile("upload media", re.I)).click(timeout=10_000)
    await page.locator('input[type="file"][accept*="image"]').last.set_input_files(paths, timeout=15_000)
    await page.get_by_role("button", name=re.compile("add to prompt", re.I)).click(timeout=15_000)


async def _click_create(page) -> None:
    create = page.get_by_role("button", name=re.compile("create|arrow_forward", re.I)).last
    if await create.get_attribute("aria-disabled") == "true":
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Flow's Create button is disabled")
    await create.click(timeout=15_000)


def _flow_project_url(project_url: str | None) -> str:
    """Accept only a Flow URL saved by this application."""
    if not project_url:
        return FLOW_URL
    parsed = urlparse(project_url)
    if parsed.scheme == "https" and parsed.netloc == "labs.google" and parsed.path.startswith("/fx/tools/flow"):
        return project_url
    raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Invalid Google Flow project URL")


async def generate_image(prompt: str, aspect_ratio: str = "IMAGE_ASPECT_RATIO_LANDSCAPE", session_token: str | None = None, references: list[dict] | None = None, project_url: str | None = None, model: str | None = None) -> dict:
    """Generate one Flow image and preserve the legacy response shape used by the UI."""
    if not prompt or not prompt.strip():
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Prompt is required")
    # A profile directory is created as soon as the user opens the sign-in
    # helper, even if they never sign in there. Previously its mere existence
    # made us ignore cookies pasted in Global Settings, causing confusing 401s
    # from that unsigned profile. Explicitly supplied cookies always win.
    use_persistent_profile = not bool(session_token and session_token.strip()) and FLOW_PROFILE_DIR.exists()
    cookies = [] if use_persistent_profile else _parse_cookies(session_token or "")
    logger.info(
        "Google Flow authentication mode: %s",
        "persistent profile" if use_persistent_profile else "saved cookies",
    )
    try:
        from patchright.async_api import async_playwright
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

        async with async_playwright() as playwright:
            browser = None
            if use_persistent_profile:
                context = await playwright.chromium.launch_persistent_context(
                    str(FLOW_PROFILE_DIR),
                    headless=True,
                )
            else:
                browser = await playwright.chromium.launch(headless=True)
                context = await browser.new_context()
            try:
                if cookies:
                    await context.add_cookies(cookies)
                page = await context.new_page()
                await page.goto(_flow_project_url(project_url), wait_until="domcontentloaded", timeout=60_000)
                await page.wait_for_timeout(3_000)
                if "accounts.google.com" in page.url:
                    raise GoogleFlowError(status.HTTP_401_UNAUTHORIZED, "Google Flow session has expired", refresh=True)
                editor = await _open_composer(page)
                # Let the project's existing image panels finish loading before
                # recording the baseline. Without this, an old lazy-loaded
                # image can appear after Create and be mistaken for the result
                # of the new prompt.
                try:
                    await page.wait_for_load_state("networkidle", timeout=10_000)
                except Exception:
                    pass
                existing_urls = await _collect_image_urls(page)
                await editor.click(timeout=20_000)
                if await editor.get_attribute("contenteditable") == "true":
                    await page.keyboard.insert_text(prompt)
                else:
                    await editor.fill(prompt)
                await _configure_flow(page, aspect_ratio, model)
                await _attach_references(page, reference_paths)
                captured_urls = []

                def capture_response(response):
                    if FLOW_IMAGE_URL_PATTERN.search(response.url) and response.headers.get("content-type", "").startswith("image/"):
                        captured_urls.append(response.url)

                page.on("response", capture_response)
                await _click_create(page)
                deadline = time.monotonic() + 300
                generated_urls = set()
                while time.monotonic() < deadline:
                    if "accounts.google.com" in page.url:
                        raise GoogleFlowError(status.HTTP_401_UNAUTHORIZED, "Google Flow session has expired", refresh=True)
                    # A response observed after clicking Create is the reliable
                    # signal. Only use the DOM as a fallback, because Flow may
                    # lazy-load older project images into the page.
                    if captured_urls:
                        # A set's iteration order is arbitrary. Flow can load
                        # several image variants, so use the newest response
                        # rather than accidentally returning an older panel.
                        generated_urls = {captured_urls[-1]}
                        break
                    dom_new_urls = await _collect_image_urls(page) - existing_urls
                    if dom_new_urls:
                        generated_urls = dom_new_urls
                        break
                    await page.wait_for_timeout(5_000)
                if not generated_urls:
                    raise GoogleFlowError(status.HTTP_504_GATEWAY_TIMEOUT, "Flow generation timed out without returning an image")
                image_base64 = await _download_image_as_base64(page, next(iter(generated_urls)))
                # Once Flow has opened its composer, the URL identifies the
                # Flow project. Returning it lets the storyboard reuse it.
                return {
                    "imagePanels": [{"generatedImages": [{"encodedImage": image_base64}]}],
                    "flow_project_url": page.url,
                }
            except GoogleFlowError:
                raise
            except Exception as exc:
                raise GoogleFlowError(
                    status.HTTP_502_BAD_GATEWAY,
                    f"Google Flow automation failed: {type(exc).__name__}: {exc}",
                ) from exc
            finally:
                await context.close()
                if browser is not None:
                    await browser.close()


def upload_image(raw_bytes: str, session_token: str) -> dict:
    """Validate Flow cookies; references are attached only when a Flow job is generated."""
    if not raw_bytes:
        raise GoogleFlowError(status.HTTP_400_BAD_REQUEST, "Raw bytes are required to upload image")
    if session_token and session_token.strip():
        validate_session_cookies(session_token)
    elif not FLOW_PROFILE_DIR.exists():
        validate_session_cookies(session_token)
    return {"uploadMediaGenerationId": f"flow-reference-{uuid.uuid4()}"}
