import os
import logging
import httpx
from typing import Optional
from schemas import AgentActRequest, AgentAction, ActionTarget
from .provider import LLMProvider
from .utils import SYSTEM_PROMPT, build_user_prompt, parse_llm_action

log = logging.getLogger("praxsight.llm.remote")

class OpenRouterAdapter(LLMProvider):
    def __init__(self):
        self._model = os.getenv("OPENROUTER_MODEL", "mistralai/mistral-7b-instruct:free")
        self.api_key = os.getenv("OPENROUTER_API_KEY")

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @property
    def model_name(self) -> str:
        return self._model

    async def reason(self, req: AgentActRequest) -> Optional[AgentAction]:
        if not self.available:
            return None

        try:
            from monitor import instrumented_client
            async with instrumented_client(timeout=10.0) as client:
                resp = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:8000",
                        "X-Title": "PraxSight SIH26171",
                    },
                    json={
                        "model": self._model,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": build_user_prompt(req)},
                        ],
                        "max_tokens": 200,
                        "temperature": 0.1,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                raw = data["choices"][0]["message"]["content"]
                log.info("OpenRouter responded (%d chars)", len(raw))
                return parse_llm_action(raw, req)
        except Exception as e:
            log.warning("OpenRouter failed (%s)", e)
            return None


class GoogleAIAdapter(LLMProvider):
    def __init__(self):
        self._model = os.getenv("GOOGLE_AI_MODEL", "gemini-2.0-flash")
        self.api_key = os.getenv("GOOGLE_AI_API_KEY")

    @property
    def name(self) -> str:
        return "google"

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @property
    def model_name(self) -> str:
        return self._model

    async def reason(self, req: AgentActRequest) -> Optional[AgentAction]:
        if not self.available:
            return None
        try:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{self._model}:generateContent?key={self.api_key}"
            )
            user_content = SYSTEM_PROMPT + "\n\n" + build_user_prompt(req)
            from monitor import instrumented_client
            async with instrumented_client(timeout=15.0) as client:
                resp = await client.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={
                        "contents": [{"parts": [{"text": user_content}]}],
                        "generationConfig": {"maxOutputTokens": 200, "temperature": 0.1},
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                raw = data["candidates"][0]["content"]["parts"][0]["text"]
                log.info("Google AI responded (%d chars)", len(raw))
                return parse_llm_action(raw, req)
        except Exception as e:
            log.warning("Google AI failed (%s)", e)
            return None
