# PraxSight — Demo Guide

## Setup (do this before judges arrive)

```bash
pip install -r server/requirements.txt
python run.py
```

Load the extension once via `chrome://extensions` → Developer mode → Load
unpacked → `extension/`. Pin the PraxSight icon to the toolbar so it's one
click away.

Open `http://localhost:8000/demo/support-ticket/` and confirm the ticket
page renders with the customer profile, the complaint text, and the three
action buttons.

## The flow (≈2 minutes)

1. **Frame the problem in one sentence**: "This support console has a name,
   an email, a phone number, a card number and a government ID sitting in
   plain text and form fields. An AI agent that reads this page to help
   resolve the ticket should not need to see any of that to do its job."

2. Click the PraxSight icon → **Scan this page**.
   - Point at the counts: inputs / controls / text nodes found.
   - Point at the **before / after split**: the left panel is literally
     what's on the page right now; the right panel is what would leave the
     browser. Entities detected vs. redacted should match exactly.

3. Leave the task as *"Resolve this support ticket"* → **Send sanitized
   context → run agent**.
   - Narrate the trace as it fills in: perceive → detect → redact → gate
     check → sent → agent proposed `click → btn_resolve` → validated.
   - Say explicitly: *"the server never received the customer's name,
     email, card number, or PAN — only `[PERSON_1]`, `[EMAIL_1]`,
     `[CARD_REDACTED]`, `[GOVID_REDACTED]` and the button labels."*

4. The **approval card** appears because clicking "Resolve Ticket" is
   treated as irreversible. Click **Approve & execute** — the actual button
   on the live page reacts (status line updates).

5. Scroll to **Network Guard** — show the real logged request: entities
   redacted, payload size in bytes, latency in ms. This is not a mocked
   counter; it's the same log `background.js` writes on every gate decision.

## Fallback demo (if live conditions are difficult)

Run the same flow once beforehand and screen-record it. Also keep this
terminal snippet ready — it exercises the exact same backend logic without
the extension, in case Chrome extension loading has any last-minute issue in
the demo room:

```bash
curl -s -X POST http://localhost:8000/api/agent/act \
  -H "Content-Type: application/json" -d '{
  "task": "Resolve this support ticket",
  "page_url": "http://localhost:8000/demo/support-ticket/",
  "elements": {
    "inputs": [],
    "interactive": [
      {"psId": "btn_resolve", "tag": "button", "role": "button", "text": "Resolve Ticket", "bbox": {}},
      {"psId": "btn_escalate", "tag": "button", "role": "button", "text": "Escalate to Tier 2", "bbox": {}}
    ]
  },
  "text_context": [],
  "privacy_manifest": {"performed": true, "version": "0.1.0", "detectors": ["rules-text"], "entities_detected": 4, "entities_redacted": 4, "by_type": {"email": 2}, "generated_at": "2026-09-04T00:00:00Z"}
}'
```

## Anticipated judge questions

- **"Why not send a screenshot and use a vision model?"** — that's the
  actual Phase-3+ plan (Gemini Nano is text-only; a real visual pass would
  need OCR or a VLM). We chose DOM+text first because it alone covers most
  real-world form PII with no model dependency at all, and it's easier to
  reason about correctness for a judged prototype than a vision pipeline we
  couldn't fully validate in the time available. See `CURRENT_IMPLEMENTATION.md`.
- **"How do I know the redaction actually ran, and isn't just a UI claim?"**
  — three independent checks block the request otherwise: the residual
  client scan, the background gate, and the server's own manifest check
  (try sending `performed: false` — it's a hard 400, not a warning).
- **"What stops the model from clicking 'Delete Account' on its own?"** —
  the validator forces `requires_approval=true` on high risk or any
  irreversible-sounding reason text, and the popup blocks execution until a
  human clicks Approve. `navigate` is disabled outright regardless of risk.
- **"Could the extension itself lie about the manifest?"** — yes, in
  principle, since it's checking its own homework; that's called out
  explicitly in `ARCHITECTURE.md`'s honest-limitation section, with the
  sibling project's independent network-monitor pattern named as the fix.
