# PraxSight — Current Implementation Status

Last updated alongside this build. This file exists so nothing here gets
described to judges as done when it isn't — same discipline the sibling Prax
AI project used in its own `ARCHITECTURE.md`.

## Fully implemented

- **DOM perception** — inputs, interactive controls, visible text, with
  bounding boxes and stable `psId`s (`extension/content/perception.js`).
- **Rules-based PII detection** — structural (field type/label/autocomplete)
  and text (regex + Luhn-checked card numbers) detectors
  (`extension/content/privacy/detectors.js`). Covered by 11 passing Node
  unit tests.
- **Policy engine + semantic redaction** — severity → action mapping,
  deterministic per-scan tokens, fail-closed default for unrecognized
  severities (`policy-engine.js`, `redaction.js`).
- **Three-layer fail-closed privacy gate** — client residual scan
  (`content-script.js`) → background chokepoint (`background.js`, the only
  `fetch()` in the extension) → server manifest check (`main.py`). Verified
  by hand: a request with `privacy_manifest.performed: false` is rejected
  with HTTP 400; a valid sanitized request round-trips to a real action.
- **Structured agent action protocol + validator** — `AgentAction` schema,
  `psId`-only targeting, disabled `navigate`, forced `requires_approval` on
  high-risk/irreversible-sounding actions (`schemas.py`, `validator.py`,
  6 passing pytest tests).
- **Deterministic offline model router** — keyword-matches the task against
  the sanitized interactive-element list; needs zero API keys, zero network
  egress, fully reproducible for judging (`server/agent.py`).
- **Human approval gate** — popup shows target + reason + risk before
  execution; Reject is a logged, first-class outcome.
- **Network Guard log** — every gate decision (`ALLOWED`/`BLOCKED`/`ERROR`)
  persisted in `chrome.storage.local` with real payload size and latency,
  rendered in the popup.
- **One flagship demo page** — `demo/support-ticket/`, synthetic customer
  profile + complaint text with PII embedded in both structured fields and
  free text (including a Luhn-valid test card number and a PAN-shaped ID),
  Resolve/Escalate/Reply actions the deterministic router can actually match.

## Partially implemented

- **Latency measurement** — captured per-request in the Network Guard log,
  but not aggregated into the "perception / privacy scan / network / total"
  breakdown the original brief describes.
- **Precision/recall on the detector** — exercised by unit tests with known
  inputs, but no labeled benchmark dataset has been built or run yet, so
  there is no reportable precision/recall number. Don't invent one.

## Not implemented (explicitly deferred, not silently skipped)

- **Vision/OCR/visual perception** — no screenshot is ever captured; nothing
  in this build looks at pixels. `perception.js` is DOM/text only. This was
  the single highest-effort, highest-risk item in the original brief and is
  intentionally out of scope for this pass.
- **Gemini Nano / Transformers.js model-backed detection** — real
  `DetectionBackend`-shaped adapters exist in
  `extension/content/privacy/model-backends.js` with working
  feature-detection, but `detect()` on both returns `[]`. Neither is called
  by `content-script.js`'s live scan pipeline. Wiring the Gemini Nano path
  is the natural next PR: create a session with `responseConstraint:
  RESPONSE_SCHEMA`, classify text spans the rules layer didn't flag.
- **Firefox support** — untested. The architecture doesn't hard-couple to
  Chrome-only APIs anywhere except the (unused) Gemini Nano stub, but "it
  probably works" is not the same claim as "it was tested," so this is
  listed as not done.
- **Independent transmission proof** — the Network Guard log is produced by
  the same extension whose claims it's supposed to be checking. A genuinely
  independent proof (separate local logging proxy, or a `chrome.webRequest`
  listener in a *different* extension) is the honest next step and is not
  built here.
- **WebGPU / ONNX Runtime Web** — not applicable yet since no model runs
  client-side in this pass.
- **Ablation study, five-way redaction-strategy comparison, four-page demo
  suite** — all explicitly cut per `docs/SIH_ALIGNMENT.md`; one demo page
  fully working beats four half-tested ones.
