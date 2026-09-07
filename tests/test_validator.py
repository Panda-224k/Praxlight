import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "server"))

from schemas import ActionTarget, AgentAction, ElementsPayload, SanitizedInteractive
from validator import ValidationError, validate_action


def make_elements():
    return ElementsPayload(
        interactive=[
            SanitizedInteractive(psId="btn_resolve", tag="button", role="button", text="Resolve Ticket"),
            SanitizedInteractive(psId="btn_escalate", tag="button", role="button", text="Escalate to Tier 2"),
        ]
    )


def test_valid_click_action_passes():
    elements = make_elements()
    action = AgentAction(
        action="click",
        target=ActionTarget(id="btn_resolve"),
        reason="Task asks to resolve the ticket; matching button found.",
        risk="high",
    )
    result = validate_action(action, elements)
    assert result.validated is True
    assert result.requires_approval is True  # risk=high forces approval


def test_unknown_target_id_is_rejected():
    elements = make_elements()
    action = AgentAction(
        action="click",
        target=ActionTarget(id="btn_that_does_not_exist"),
        reason="Clicking something",
        risk="low",
    )
    with pytest.raises(ValidationError):
        validate_action(action, elements)


def test_navigate_is_disabled():
    elements = make_elements()
    action = AgentAction(action="navigate", reason="Go elsewhere", risk="low")
    with pytest.raises(ValidationError):
        validate_action(action, elements)


def test_type_action_requires_user_provided_value_policy():
    elements = make_elements()
    action = AgentAction(
        action="type", target=ActionTarget(id="btn_resolve"), reason="Fill field", risk="low"
    )
    with pytest.raises(ValidationError):
        validate_action(action, elements)


def test_read_action_needs_no_target():
    elements = make_elements()
    action = AgentAction(action="read", target=None, reason="Summarize page", risk="low")
    result = validate_action(action, elements)
    assert result.validated is True
    assert result.requires_approval is False


def test_reason_containing_irreversible_keyword_forces_approval_even_at_low_risk():
    elements = make_elements()
    action = AgentAction(
        action="click",
        target=ActionTarget(id="btn_escalate"),
        reason="Task asks to escalate this ticket to Tier 2.",
        risk="low",
    )
    result = validate_action(action, elements)
    assert result.requires_approval is True