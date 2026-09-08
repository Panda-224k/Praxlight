# PraxSight — Structured Agent Action Protocol

The server never returns arbitrary JavaScript or a free-text plan. It
returns exactly one `AgentAction` (`server/schemas.py`), and that action only
reaches the page after `server/validator.py` has checked it.

## Request: `AgentActRequest`

```json
{
  "task": "Resolve this support ticket",
  "page_url": "http://localhost:8000/demo/support-ticket/",
  "elements": {
    "inputs": [ { "psId": "ps_input_0", "tag": "input", "type": "email", "label": "[EMAIL_1]", "value": "[EMAIL_1]", "bbox": {} } ],
    "interactive": [ { "psId": "ps_button_2", "tag": "button", "role": "button", "text": "Resolve Ticket", "bbox": {} } ]
  },
  "text_context": [ { "psId": "ps_p_5", "text": "Please refund the duplicate charge...", "bbox": {} } ],
  "privacy_manifest": { "performed": true, "version": "0.1.0", "...": "..." }
}
```

`psId`s are the *only* way an action can reference a page element — never a
CSS selector, never raw text matching. This means the model (or, in this
build, the deterministic router) can only ever point at something the
privacy gate already saw and sanitized; it cannot invent a target.

## Response: `AgentAction`

```json
{
  "action": "click",
  "target": { "type": "element_id", "id": "ps_button_2" },
  "value_policy": null,
  "reason": "Task asks to resolve the ticket; the control labeled 'Resolve Ticket' on the sanitized page matches this request.",
  "risk": "high",
  "requires_approval": true,
  "validated": true
}
```

### Allowed actions

`click`, `focus`, `scroll`, `select`, `read`, `wait`, `type` — `navigate` is
schema-legal but hard-disabled in `validator.py` (`DISABLED_ACTIONS`) for
this prototype: no agent-driven cross-page navigation.

### Validator checks (`server/validator.py`)

1. `action` must be one of the allowed literals.
2. `action` must not be in `DISABLED_ACTIONS`.
3. `click` / `focus` / `scroll` / `select` / `type` must carry a
   `target.id` that exists in the `elements` the request actually sent —
   an action targeting an unknown `psId` is rejected outright (HTTP 422),
   not silently dropped or corrected.
4. `type` must declare `value_policy: "user-provided"` — the agent is
   structurally prevented from inventing a value to type into a field.
   (The extension's `executeAction` in `content-script.js` currently
   returns `requires_user_input_not_implemented_in_popup` for any `type`
   action reaching it — wiring an actual "ask the human for this value"
   prompt is a documented follow-up, not silently faked.)
5. `risk == "high"`, or the `reason` text containing an irreversible-hint
   word (`resolve`, `submit`, `send`, `delete`, `approve`, `pay`, `confirm`,
   `escalate`), forces `requires_approval = true` — the server does not
   trust the model's own risk self-assessment as the only signal.

Only after all of the above does `validated` get set to `true`. The popup
will happily render an *unvalidated* action too (so a broken validator run
is visible, not hidden), but `content-script.js`'s `executeAction` has no
special-case bypass for `validated` — approval flow always runs through the
popup regardless.

## Human-in-the-loop

Any action with `requires_approval: true` stops in the popup with the
target, the reason, and the risk level shown — see the "Approval required"
card in `popup.html`. Nothing executes until a human clicks **Approve**, and
**Reject** is a first-class outcome that's logged in the agent trace, not
just a UI dead end.
