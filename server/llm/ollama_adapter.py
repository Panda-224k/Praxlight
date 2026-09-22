import os
import logging
import httpx
from typing import Optional
from schemas import AgentActRequest, AgentAction
from .provider import LLMProvider
from .utils import SYSTEM_PROMPT, build_user_prompt, parse_llm_action

log = logging.getLogger("praxsight.llm.ollama")

class OllamaAdapter(LLMProvider):
    def __init__(self):
        self._model = os.getenv("OLLAMA_MODEL", "llama3")
        self.endpoint = os.getenv("OLLAMA_ENDPOINT", "http://localhost:11434")

    @property
    def name(self) -> str:
        return "ollama"

    @property
    def available(self) -> bool:
        from .hardware import get_hardware_tier, HardwareTier
        tier = get_hardware_tier()
        # If hardware is LOW, refuse to run local LLM
        if tier == HardwareTier.LOW:
            log.warning("OllamaAdapter disabled: Hardware tier is LOW (insufficient RAM)")
            return False
        return True

    @property
    def model_name(self) -> str:
        from .hardware import get_hardware_tier, resolve_model
        tier = get_hardware_tier()
        return resolve_model(self._model, tier) or self._model

    async def reason(self, req: AgentActRequest) -> Optional[AgentAction]:
        try:
            url = f"{self.endpoint}/api/chat"
            from monitor import instrumented_client
            async with instrumented_client(timeout=30.0) as client:
                model_to_use = self.model_name
                resp = await client.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={
                        "model": model_to_use,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": build_user_prompt(req)},
                        ],
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "num_predict": 200,
                        }
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                raw = data.get("message", {}).get("content", "")
                log.info("Ollama local LLM responded (%d chars)", len(raw))
                return parse_llm_action(raw, req)
        except httpx.ConnectError:
            log.warning("Ollama connection failed (is it running on %s?)", self.endpoint)
            return None
        except Exception as e:
            log.warning("Ollama failure (%s)", e)
            return None
