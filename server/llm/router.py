import logging
from typing import List
from schemas import AgentActRequest, AgentAction
from .provider import LLMProvider
from .remote_adapters import OpenRouterAdapter, GoogleAIAdapter
from .ollama_adapter import OllamaAdapter
from .deterministic_adapter import DeterministicAdapter

log = logging.getLogger("praxsight.llm.router")

class ModelRouter:
    """
    Hardware-aware routing logic (Phase 7 foundation).
    Tries configured backends in priority order, falling back
    to local models (Ollama) or deterministic logic if offline.
    """
    def __init__(self) -> None:
        self.providers: List[LLMProvider] = [
            OpenRouterAdapter(),
            GoogleAIAdapter(),
            OllamaAdapter(),
            DeterministicAdapter()
        ]
        
        active_names = [p.name for p in self.providers if p.available]
        log.info("ModelRouter initialised. Priority: %s", " → ".join(active_names))

    def status(self) -> dict:
        """Expose router state to /api/health."""
        state = {}
        first_active = None
        for p in self.providers:
            if p.name == "deterministic-offline":
                state["deterministic"] = {"available": True}
                if not first_active:
                    first_active = "deterministic"
            else:
                state[p.name] = {
                    "available": p.available,
                    "model": p.model_name if p.available else None
                }
                if p.available and not first_active:
                    first_active = p.name
        state["active"] = first_active
        return state

    async def reason(self, req: AgentActRequest) -> AgentAction:
        """Query providers in order until one succeeds."""
        for provider in self.providers:
            if not provider.available:
                continue
            
            result = await provider.reason(req)
            if result:
                log.info(f"Action provided by {provider.name}")
                return result
                
        # The DeterministicAdapter always succeeds, so we theoretically never reach here,
        # but just in case, return a safe read action.
        return AgentAction(
            action="read",
            target=None,
            reason="All routing backends failed completely.",
            risk="low"
        )

router = ModelRouter()
