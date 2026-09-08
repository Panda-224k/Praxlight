"""
PraxSight — Model Router (Phase 7 reasoning step)

Mirrors the provider-adapter pattern used by the sibling Prax AI project
(backend/app.py: _openrouter_stream / _gemini_stream / _ollama_stream feeding
one route_stream() dispatcher). Only the deterministic offline reasoner is
wired up by default, so the flagship demo works with zero API keys and zero
network egress from this process. Anyone deploying this for real can add a
real adapter behind the same `reason()` call without touching main.py.

Whatever backend answers, it only ever sees `AgentActRequest` — the already-
sanitized payload. There is no code path in this file that can reach raw
page content, because the server never receives it in the first place.
"""
from __future__ import annotations

import os

from schemas import AgentAction, AgentActRequest, ActionTarget


class ModelRouter:
    def __init__(self) -> None:
        self.has_openrouter = bool(os.getenv("OPENROUTER_API_KEY"))
        self.has_google = bool(os.getenv("GOOGLE_AI_API_KEY"))
        self.has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))

    async def reason(self, req: AgentActRequest) -> AgentAction:
        # A real deployment would branch here on self.has_* the way
        # app.py's route_stream() does. This pass ships only the
        # deterministic fallback: fully offline, fully reproducible for
        # judging, and honest about not calling out to a cloud model.
        return self._deterministic_reason(req)

    def _find_by_keyword(self, req: AgentActRequest, keyword: str):
        for el in req.elements.interactive:
            if keyword in el.text.lower():
                return el
        return None

    def _deterministic_reason(self, req: AgentActRequest) -> AgentAction:
        task = req.task.lower()

        for keyword in ("resolve", "escalate", "reply", "close"):
            if keyword in task:
                target = self._find_by_keyword(req, keyword)
                if target:
                    return AgentAction(
                        action="click",
                        target=ActionTarget(id=target.psId),
                        reason=(
                            f"Task asks to {keyword} the ticket; the control labeled "
                            f"'{target.text}' on the sanitized page matches this request."
                        ),
                        risk="high",
                    )

        return AgentAction(
            action="read",
            target=None,
            reason=(
                "No unambiguous matching control was found on the sanitized page for this "
                "task — returning a read-only response instead of guessing at a selector."
            ),
            risk="low",
        )


router = ModelRouter()
