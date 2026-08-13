"""Client for the local chatgpt-Api Playwright wrapper.

The wrapper is deliberately used only by the backend.  Browser credentials and
the wrapper URL must never be exposed to the React application.
"""

from __future__ import annotations

import json
import re
from typing import TypeVar
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic import BaseModel, ValidationError


T = TypeVar("T", bound=BaseModel)


class ChatGPTWrapperError(RuntimeError):
    """The local wrapper could not produce a valid response."""


class ChatGPTWrapperClient:
    def __init__(self, base_url: str, timeout_seconds: int = 120):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def complete_structured(
        self,
        schema: type[T],
        system_prompt: str,
        user_prompt: str,
    ) -> T:
        schema_json = json.dumps(schema.model_json_schema(), separators=(",", ":"))
        prompt = (
            f"{system_prompt}\n\n"
            f"{user_prompt}\n\n"
            "Return ONLY a valid JSON object. Do not use Markdown or add an explanation. "
            f"It must validate against this JSON Schema:\n{schema_json}"
        )
        response_text = self._complete(prompt)
        try:
            return schema.model_validate(self._parse_json(response_text))
        except (ValidationError, ValueError, json.JSONDecodeError) as error:
            raise ChatGPTWrapperError(
                f"ChatGPT wrapper returned invalid structured output: {error}"
            ) from error

    def _complete(self, prompt: str) -> str:
        query = urlencode({"q": prompt})
        request = Request(
            f"{self.base_url}/chat?{query}",
            method="POST",
            headers={"Accept": "application/json"},
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ChatGPTWrapperError(f"ChatGPT wrapper request failed: {error}") from error

        text = payload.get("response") if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip() or text == "No Response":
            raise ChatGPTWrapperError("ChatGPT wrapper returned no response")
        return text.strip()

    @staticmethod
    def _parse_json(text: str):
        # ChatGPT can still wrap a requested JSON reply in a Markdown fence.
        fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
        return json.loads(fenced.group(1) if fenced else text)
