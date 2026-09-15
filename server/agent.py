"""
PraxSight — Model Router (Phase 4 upgraded: real LLM backends + deterministic fallback)

Supports three backends in priority order:
  1. OpenRouter  — if OPENROUTER_API_KEY is present (Mistral-7B-Instruct:free by default)
  2. Google AI   — if GOOGLE_AI_API_KEY is present (gemini-2.0-flash by default)
  3. Deterministic offline reasoner — always available, zero API keys needed

Whatever backend answers, it only ever sees `AgentActRequest` — the already-
sanitized payload. There is no code path that can reach raw page content.

Mirrors the provider-adapter pattern from the sibling Prax AI project.
"""
from __future__ import annotations

import json
import logging
import os

import httpx

from schemas import AgentAction, AgentActRequest, ActionTarget

log = logging.getLogger("praxsight.agent")

_SYSTEM_PROMPT = """You are PraxSight, a privacy-preserving browser agent assistant.

You receive a sanitized snapshot of a web page — all PII has been replaced with
semantic tokens like [EMAIL_1], [CARD_REDACTED], [PERSON_1]. You never see raw
personal data by design.

Given a task and the sanitized page elements, propose exactly ONE action.
Respond ONLY with valid JSON matching this exact schema:
{
  "action": "click" | "focus" | "scroll" | "read" | "wait",
  "target_id": "<psId of the element, or null for read/wait>",
  "reason": "<one sentence explanation>",
  "risk": "low" | "medium" | "high"
}

Rules:
- Only target elements from the provided interactive list
- If no element clearly matches, use action="read" with target_id=null
- "navigate" is DISABLED — never use it
- For irreversible actions (resolve, submit, delete, escalate), set risk="high"
- Be concise. Reason must be one sentence only."""


def _build_user_prompt(req: AgentActRequest) -> str:
    interactive = [
        {"id": el.psId, "text": el.text, "tag": el.tag}
        for el in req.elements.interactive
    ]
    inputs = [
        {"id": el.psId, "label": el.label, "type": el.type, "value": el.value}
        for el in req.elements.inputs
    ]
    text_preview = " | ".join(
        n.text for n in req.text_context[:20] if n.text
    )[:600]
    return (
        f"TASK: {req.task}\n\n"
        f"PAGE: {req.page_url}\n\n"
        f"INTERACTIVE ELEMENTS: {json.dumps(interactive, ensure_ascii=False)}\n\n"
        f"INPUT FIELDS: {json.dumps(inputs, ensure_ascii=False)}\n\n"
        f"VISIBLE TEXT (truncated): {text_preview}"
    )


def _parse_llm_action(raw: str, req: AgentActRequest) -> AgentAction | None:
    """Parse LLM JSON response; return None on any error so caller can fall back."""
    try:
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
        data = json.loads(text)
        action_name = data.get("action", "read")
        target_id = data.get("target_id")
        reason = str(data.get("reason", "Agent proposed this action."))[:500]
        risk = data.get("risk", "low")
        if risk not in ("low", "medium", "high"):
            risk = "medium"
        target = ActionTarget(id=target_id) if target_id else None
        return AgentAction(action=action_name, target=target, reason=reason, risk=risk)
    except Exception as e:
        log.warning("LLM parse failed (%s) — falling back to deterministic. Raw: %.200s", e, raw)
        return None


class ModelRouter:
    def __init__(self) -> None:
        self.has_openrouter = bool(os.getenv("OPENROUTER_API_KEY"))
        self.has_google = bool(os.getenv("GOOGLE_AI_API_KEY"))
        self.openrouter_model = os.getenv("OPENROUTER_MODEL", "mistralai/mistral-7b-instruct:free")
        self.google_model = os.getenv("GOOGLE_AI_MODEL", "gemini-2.0-flash")

        backends = []
        if self.has_openrouter:
            backends.append(f"openrouter({self.openrouter_model})")
        if self.has_google:
            backends.append(f"google({self.google_model})")
        backends.append("deterministic-offline")
        log.info("ModelRouter initialised. Priority: %s", " → ".join(backends))

    def status(self) -> dict:
        """Expose router state to /api/health."""
        return {
            "openrouter": {"available": self.has_openrouter, "model": self.openrouter_model if self.has_openrouter else None},
            "google": {"available": self.has_google, "model": self.google_model if self.has_google else None},
            "deterministic": {"available": True},
            "active": (
                "openrouter" if self.has_openrouter
                else "google" if self.has_google
                else "deterministic"
            ),
        }

    async def reason(self, req: AgentActRequest) -> AgentAction:
        if self.has_openrouter:
            result = await self._openrouter_reason(req)
            if result:
                return result
        if self.has_google:
            result = await self._google_reason(req)
            if result:
                return result
        return self._deterministic_reason(req)

    async def _openrouter_reason(self, req: AgentActRequest) -> AgentAction | None:
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            return None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:8000",
                        "X-Title": "PraxSight SIH26171",
                    },
                    json={
                        "model": self.openrouter_model,
                        "messages": [
                            {"role": "system", "content": _SYSTEM_PROMPT},
                            {"role": "user", "content": _build_user_prompt(req)},
                        ],
                        "max_tokens": 200,
                        "temperature": 0.1,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                raw = data["choices"][0]["message"]["content"]
                log.info("OpenRouter responded (%d chars)", len(raw))
                return _parse_llm_action(raw, req)
        except Exception as e:
            log.warning("OpenRouter failed (%s)", e)
            return None

    async def _google_reason(self, req: AgentActRequest) -> AgentAction | None:
        api_key = os.getenv("GOOGLE_AI_API_KEY")
        if not api_key:
            return None
        try:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{self.google_model}:generateContent?key={api_key}"
            )
            user_content = _SYSTEM_PROMPT + "\n\n" + _build_user_prompt(req)
            async with httpx.AsyncClient(timeout=15.0) as client:
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
                return _parse_llm_action(raw, req)
        except Exception as e:
            log.warning("Google AI failed (%s)", e)
            return None

    def _find_by_keyword(self, req: AgentActRequest, keyword: str):
        for el in req.elements.interactive:
            if keyword in el.text.lower():
                return el
        return None

    def _deterministic_reason(self, req: AgentActRequest) -> AgentAction:
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


router = ModelRouter()
