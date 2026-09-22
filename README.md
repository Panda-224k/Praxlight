# PraxLight - Smart India Hackathon (SIH) 2026

PraxLight is a privacy-first browser agent framework for safely reasoning over live web pages without exposing raw personal data. The project combines a Chrome extension, a local perception layer, a deterministic policy engine, and a FastAPI backend that only sees sanitized context and validated actions.

> See locally. Redact locally. Reason on sanitized context. Act only with a human's OK.

## What it does

PraxLight runs in a browser extension and performs four core steps:

1. Inspect the current page's DOM and visible text locally.
2. Detect sensitive entities such as emails, phone numbers, PANs, names, account data, and card information.
3. Replace them with semantic tokens such as `[EMAIL_1]`, `[PERSON_1]`, and `[CARD_REDACTED]` before any network transmission.
4. Send only a sanitized payload and a privacy manifest to the backend, which proposes a single structured action for human review.

This is designed for a browser agent workflow where the agent may act on the page, but only after a privacy gate and approval step.

## Why this project exists

This is not a generic PII redaction library. It is a control plane for browser agents.

Existing tools like Presidio or text sanitizers are usually designed for static documents or chat inputs. They do not protect agent actions in real time against a live page, DOM-linked elements, and irreversible UI actions.

PraxLight focuses on:

- DOM-anchored redaction tied to actual page elements
- a fail-closed privacy manifest
- a structured action format the agent cannot invent arbitrarily
- a human approval gate before execution
- server-side validation against known page elements only

See [`docs/SIH_ALIGNMENT.md`](docs/SIH_ALIGNMENT.md) and [`docs/PRIVACY_MODEL.md`](docs/PRIVACY_MODEL.md) for the broader comparison and threat model.

## Current implementation status

This is a working prototype with the following real capabilities:

- local page perception and extraction of visible text, inputs, and interactive elements
- local PII detection and semantic redaction
- residual PII re-scan before any outbound request
- hard privacy gate in the extension background worker
- FastAPI backend receiving only sanitized context
- deterministic fallback model router and action validation
- demo support-ticket flow with human approval before executing an action

The project is intentionally honest about limits:

- OCR is not fully wired for live production use in this repo
- model-backed detection adapters exist as stubs/interfaces, not as a fully live inference stack
- the UI is demo-oriented and designed for local validation rather than production deployment

See [`docs/CURRENT_IMPLEMENTATION.md`](docs/CURRENT_IMPLEMENTATION.md) for a more explicit breakdown.

## High-level architecture

```mermaid
flowchart TD
    Start([Page DOM & Visible Text]) --> Perception[Local Perception<br/><code>extension/content/perception.js</code>]
    Perception --> Detection[Rules-based PII Detection<br/><code>extension/content/privacy/detectors.js</code>]
    Detection --> Policy[Policy Engine & Redaction<br/><code>policy-engine.js</code> & <code>redaction.js</code>]
    Policy --> Rescan[Residual-PII Re-scan<br/><code>content-script.js</code><br/><i>Defense in Depth #1</i>]
    Rescan --> Gate[Hard Privacy Gate<br/><code>extension/background.js</code><br/><i>Only outbound fetch() path</i>]
    
    Gate -- Sanitized Payload --> Backend[FastAPI Backend<br/><code>server/main.py</code><br/><i>Policy checks, Model router, Validation</i>]
    
    Backend -- Proposed Action --> Popup[Popup / Approval UI<br/><i>Shows action + reason</i>]
    Popup --> Human{Human<br/>Approves?}
    
    Human -- Yes --> Execute([Execute Exact Validated DOM Action])
    Human -- No --> Reject([Action Rejected])
```

## How the data flow works

1. The extension inspects the page and creates a local structured snapshot.
2. Detection rules scan the page text and metadata for sensitive patterns.
3. The policy engine classifies each detection and decides whether it should be redacted or allowed.
4. Redaction replaces sensitive values with semantic placeholders while preserving structure.
5. The content script performs a second residual scan to ensure nothing obvious remains.
6. Only then does the background service worker send data to the backend.
7. The server validates that the request includes a privacy manifest and that the proposed action is within known elements.
8. A deterministic model/router proposes one structured action, and the validator enforces action safety.
9. A popup presents the action plus reason for human approval.
10. The browser executes only the approved action, and only on the validated target.

## Run locally

### 1) Install Python dependencies

```bash
cd praxsight
pip install -r server/requirements.txt
```

### 2) Start the app

```bash
python run.py
```

This starts the backend and serves:

- API: http://localhost:8000
- API docs: http://localhost:8000/api/docs
- Dashboard: http://localhost:8000/dashboard/
- Demo: http://localhost:8000/demo/support-ticket/

### 3) Load the extension

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Click Load unpacked
4. Select the `extension/` folder
5. Open the demo page and click the PraxLight extension icon

### 4) Run the demo

1. Click Scan this page
2. Use the task input or leave the default support-ticket task
3. Click Send sanitized context → run agent
4. Review the approval card
5. Approve or reject the action

## Project structure

```text
praxsight/
  README.md
  run.py
  package.json
  extension/
    manifest.json
    background.js
    content/
      perception.js
      content-script.js
      privacy/
        detectors.js
        model-backends.js
        policy-engine.js
        redaction.js
      ocr/
    popup/
  server/
    main.py
    agent.py
    agent_engine.py
    schemas.py
    validator.py
    llm/
    monitor/
    ocr/
    privacy/
    rag/
  dashboard/
  demo/
  docs/
  tests/
```

## Tests and validation

```bash
# JS tests
npm install
node --test tests/test_pii_lib.cjs
node --test tests/test_perception.cjs

# Python tests
pip install pytest
python -m pytest tests/test_validator.py -v
```

## Security model

The core rule is simple: raw page data stays in the browser unless a user explicitly approves a sanitized action.

The implementation enforces this through multiple layers:

- local detection and redaction in the page context
- a residual scan after sanitization
- a background worker gate before any outbound network call
- server-side validation for all action payloads
- a human approval decision before execution

This reduces the risk of the model seeing unredacted sensitive data and helps keep the browser action protocol scoped to exactly what the user approves.

## Important limitations

PraxLight is a focused prototype, not a fully production-hardened browser-agent platform. Current limits include:

- no full production OCR pipeline
- no production-grade model provider integration for every backend
- evaluation is demo-focused rather than large-scale benchmarked
- browser extension code is designed for local demos and controlled validation scenarios

## Related docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PRIVACY_MODEL.md`](docs/PRIVACY_MODEL.md)
- [`docs/AGENT_PROTOCOL.md`](docs/AGENT_PROTOCOL.md)
- [`docs/CURRENT_IMPLEMENTATION.md`](docs/CURRENT_IMPLEMENTATION.md)
- [`docs/SIH_ALIGNMENT.md`](docs/SIH_ALIGNMENT.md)


