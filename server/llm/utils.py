from typing import Optional
import json
import logging
from schemas import AgentAction, AgentActRequest, ActionTarget

log = logging.getLogger("praxsight.llm.utils")

SYSTEM_PROMPT = """You are PraxLight, a privacy-preserving browser agent assistant.

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

def build_user_prompt(req: AgentActRequest) -> str:
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

def parse_llm_action(raw: str, req: AgentActRequest) -> Optional[AgentAction]:
    """Parse LLM JSON response; return None on any error so caller can fall back."""
    try:
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
        # If it starts with anything before the json `{`, strip it
        start_idx = text.find("{")
        end_idx = text.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            text = text[start_idx:end_idx+1]
        
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
