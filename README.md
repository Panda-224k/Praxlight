# PraxLight

**SIH26171 â€” On-device Visual Perception for Light-weight Browser Agents**
Organization: ISRO Â· Category: Software Â· Theme: Miscellaneous

> See locally. Redact locally. Reason on sanitized context. Act only with a human's OK.

PraxLight is a Manifest V3 browser extension plus a small FastAPI backend. The
extension reads the current page's DOM and text locally, detects PII with
regex + structural rules, replaces it with semantic tokens (`[EMAIL_1]`,
`[PERSON_1]`, `[CARD_REDACTED]`), and only *then* is the sanitized page state
allowed to reach the backend, which proposes one structured, schema-validated
browser action for a human to approve.

## Why this exists (and what it isn't)

This is **not** a PII redactor â€” Microsoft Presidio, [maskera](https://github.com)
and OSSRedact already do that well for static text before a chat call. None of
them protect a *browser agent mid-action* on a live page. PraxLight's actual
contribution is the layer underneath an agent: DOM-anchored redaction tied to
the actual clickable elements, a structured command protocol the model can't
escape, a validator, and a human approval gate before anything executes. See
[`docs/SIH_ALIGNMENT.md`](docs/SIH_ALIGNMENT.md) for the full prior-art comparison.

## Architecture

```
Page DOM/text
     â”‚
     â–¼
Local perception (extension/content/perception.js)         â€” Phase 1
     â”‚
     â–¼
Rules-based PII detection (extension/content/privacy/detectors.js)  â€” Phase 2
     â”‚
     â–¼
Policy engine â†’ redaction / semantic tokens                â€” Phase 4
     â”‚
     â–¼
Residual-PII re-scan (content-script.js)                   â€” defense in depth #1
     â”‚
     â–¼
Hard privacy gate â€” the ONLY fetch() in the extension       â€” Phase 5
(extension/background.js: re-checks the manifest + re-scans
 for residual PII before it will call the backend at all)
     â”‚
     â–¼
POST /api/agent/act  (server/main.py)                       â€” Phase 7
  â†’ server independently refuses payloads without a manifest â€” defense in depth #2
  â†’ model router proposes ONE structured action              (server/agent.py)
  â†’ validator rejects unknown selectors / disabled commands   (server/validator.py)
     â”‚
     â–¼
Popup shows the action + reason, human Approves or Rejects   â€” Phase 8
     â”‚
     â–¼
content-script.js executes ONLY that exact action on that exact element
```

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/PRIVACY_MODEL.md`](docs/PRIVACY_MODEL.md),
[`docs/AGENT_PROTOCOL.md`](docs/AGENT_PROTOCOL.md).

## Run it

### 1. Backend (also serves the demo page)

```bash
pip install -r server/requirements.txt
python run.py
```

This starts the API at `http://localhost:8000` and opens the flagship demo
page at `http://localhost:8000/demo/support-ticket/`.

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** â†’ select the `extension/` folder
4. Open the demo page from step 1, click the PraxLight icon in the toolbar

### 3. Try the flagship flow

1. Click **Scan this page** â†’ watch the Privacy Firewall panel show raw vs.
   sanitized text side by side, with a live entity count.
2. Leave the task as *"Resolve this support ticket"* â†’ click **Send sanitized
   context â†’ run agent**.
3. Watch the agent trace: perceive â†’ detect â†’ redact â†’ gate check â†’ send â†’
   reason â†’ validate.
4. An approval card appears (clicking "Resolve Ticket" is treated as an
   irreversible action) â€” **Approve** to actually click the button on the
   live page, or **Reject** to stop there.
5. Check **Network guard** at the bottom of the popup â€” every request the
   extension made to the backend is logged with its redaction counts,
   payload size, and latency.

## Tests

```bash
# One-time setup for the JS test suite (jsdom is dev-only â€” the extension
# itself has no build step and no npm dependency at all)
npm install

# Detection / redaction / policy engine â€” pure JS
node --test tests/test_pii_lib.cjs

# DOM perception (jsdom-backed â€” added in Phase 2)
node --test tests/test_perception.cjs

# Structured-action validator
pip install pytest
python -m pytest tests/test_validator.py -v
```

## Repository layout

```
extension/            Manifest V3 browser extension
  background.js        the single fetch() chokepoint (hard privacy gate)
  content/
    perception.js       DOM extraction (Phase 1)
    privacy/
      detectors.js        rules-based PII detection (Phase 2) + DetectionBackend interface (Phase 3)
      model-backends.js   Gemini Nano / Transformers.js adapter STUBS â€” not wired in yet
      redaction.js         semantic token redaction (Phase 4)
      policy-engine.js     severity â†’ action, builds the privacy manifest
    content-script.js   orchestrates the scan + executes approved actions
  popup/                Privacy Firewall / agent trace / approval / network guard UI

server/                FastAPI backend
  main.py                /api/agent/act â€” never receives raw PII
  schemas.py             sanitized-payload + structured-action Pydantic models
  validator.py            rejects unknown selectors, disabled commands, unapproved risk
  agent.py                deterministic offline model router (Phase 7)

demo/support-ticket/    the one flagship demo page (synthetic data only)
docs/                   architecture, privacy model, agent protocol, SIH alignment, current-implementation honesty doc
tests/                  Node + pytest unit tests
```

## What's real vs. deferred

This build follows the *scoped* plan (nine phases, one flagship demo, done
properly) rather than the full 56-phase vision in the original brief. See
[`docs/CURRENT_IMPLEMENTATION.md`](docs/CURRENT_IMPLEMENTATION.md) for the
honest breakdown â€” notably: **no vision/OCR model is wired up yet** (DOM +
text only), and the Gemini Nano / Transformers.js model-backed detection
layer is a real interface with no live model behind it yet.

