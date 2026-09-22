"""
PraxLight — Command Validator (Phase 7/8)

Runs on every AgentAction before it is returned to the extension. The model
router in agent.py never talks to the browser directly — everything it
proposes passes through here first, and this file is where "the model
cannot execute arbitrary code" becomes an actual enforced property rather
than a design intention.
"""
from __future__ import annotations

from schemas import AgentAction, ElementsPayload

ALLOWED_ACTIONS = {"click", "focus", "scroll", "select", "navigate", "read", "wait", "type"}
# Commands that are schema-legal but disabled entirely in this prototype.
DISABLED_ACTIONS = {"navigate"}
IRREVERSIBLE_HINT_WORDS = {"resolve", "submit", "send", "delete", "approve", "pay", "confirm", "escalate"}


class ValidationError(Exception):
    pass


def _known_ids(elements: ElementsPayload) -> set:
    return {el.psId for el in elements.inputs} | {el.psId for el in elements.interactive}


def validate_action(action: AgentAction, elements: ElementsPayload) -> AgentAction:
    if action.action not in ALLOWED_ACTIONS:
        raise ValidationError(f"Unsupported action '{action.action}'")

    if action.action in DISABLED_ACTIONS:
        raise ValidationError(f"Action '{action.action}' is disabled in this prototype (no agent-driven navigation)")

    if action.action in {"click", "focus", "scroll", "select", "type"}:
        if not action.target or action.target.type != "element_id":
            raise ValidationError("This action requires a valid element_id target")
        if action.target.id not in _known_ids(elements):
            raise ValidationError(
                f"Target '{action.target.id}' is not in the sanitized element list the agent "
                "was given — refusing to act on a selector it invented."
            )

    if action.action == "type" and action.value_policy != "user-provided":
        raise ValidationError(
            "type actions must declare value_policy='user-provided' — the agent cannot invent field values"
        )

    risky_words_present = any(w in action.reason.lower() for w in IRREVERSIBLE_HINT_WORDS)
    if action.risk == "high" or risky_words_present:
        action.requires_approval = True

    action.validated = True
    action.status = "PENDING_APPROVAL" if action.requires_approval else "VALIDATED"
    return action
