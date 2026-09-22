import logging
from typing import Optional
from schemas import AgentActRequest, AgentAction, ActionTarget
from .provider import LLMProvider

class DeterministicAdapter(LLMProvider):
    @property
    def name(self) -> str:
        return "deterministic-offline"

    @property
    def available(self) -> bool:
        return True

    @property
    def model_name(self) -> Optional[str]:
        return None

    def _find_by_keyword(self, req: AgentActRequest, keyword: str):
        for el in req.elements.interactive:
            if keyword in el.text.lower():
                return el
        return None

    async def reason(self, req: AgentActRequest) -> Optional[AgentAction]:
        task = req.task.lower()
        for keyword in ("resolve", "escalate", "reply", "close", "submit", "confirm", "approve"):
            if keyword in task:
                target = self._find_by_keyword(req, keyword)
                if target:
                    return AgentAction(
                        action="click",
                        target=ActionTarget(id=target.psId),
                        reason=(
                            f"Task asks to {keyword}; the control labeled "
                            f"'{target.text}' on the sanitized page matches this request."
                        ),
                        risk="high",
                    )
        return AgentAction(
            action="read",
            target=None,
            reason=(
                "No unambiguous matching control found on the sanitized page — "
                "returning read-only instead of guessing at a selector."
            ),
            risk="low",
        )
