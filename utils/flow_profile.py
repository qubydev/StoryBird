"""Launch a persistent, visible browser profile for Google Flow sign-in."""

import asyncio

from patchright.async_api import async_playwright

from utils.google_flow import FLOW_PROFILE_DIR, FLOW_URL


async def main() -> None:
    FLOW_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(FLOW_PROFILE_DIR),
            headless=False,
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(FLOW_URL, wait_until="domcontentloaded", timeout=60_000)
        await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
