from abc import ABC, abstractmethod
from typing import Optional
from schemas import AgentAction, AgentActRequest

class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """The identifier of the provider (e.g. 'openrouter', 'ollama')."""
        pass

    @property
    @abstractmethod
    def available(self) -> bool:
        """True if the provider is configured and available for use."""
        pass

    @property
    @abstractmethod
    def model_name(self) -> Optional[str]:
        """The active model name being used by this provider."""
        pass

    @abstractmethod
    async def reason(self, req: AgentActRequest) -> Optional[AgentAction]:
        """
        Process the sanitized page payload and return an Action.
        Should return None if the backend fails or parsing fails,
        allowing the router to fall back to the next provider.
        """
        pass
