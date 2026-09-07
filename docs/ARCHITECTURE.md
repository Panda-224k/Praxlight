# PraxSight — Architecture

## Component map

| Component | File(s) | Responsibility |
|---|---|---|
| DOM perception | `extension/content/perception.js` | Extracts inputs, interactive controls, and visible text into plain-data objects. No PII judgment happens here. |
| Detection engine | `extension/content/privacy/detectors.js` | Structural rules (field type/label/autocomplete) + regex/checksum text scanning. Pure functions — no DOM, no `window` — so it's directly unit-testable under Node. |
| Model-backed detection (stub) | `extension/content/privacy/model-backends.js` | `DetectionBackend`-shaped adapters for Gemini Nano (Chrome Prompt API) and a Transformers.js NER fallback. Feature-detected, **not called by the live pipeline yet** — see `CURRENT_IMPLEMENTATION.md`. |
| Policy engine | `extension/content/privacy/policy-engine.js` | Maps detection severity → action (`redact`/`allow`), builds the `privacy_manifest` attached to every request. Fail-closed: an unrecognized severity defaults to `redact`. |
| Redaction | `extension/content/privacy/redaction.js` | Deterministic semantic tokens (`[EMAIL_1]`, `[PERSON_1]`) for identity fields; counterless `[X_REDACTED]` tokens for fields where even distinguishing "PASSWORD_1" from "PASSWORD_2" would leak structure. |
| Orchestrator | `extension/content/content-script.js` | Wires the above into one scan, runs a residual-PII re-scan of its own output, executes agent actions on the live DOM. No network access. |
| Hard privacy gate | `extension/background.js` | The **only** code path with `fetch()` capability toward the backend. Independently re-checks the manifest and residual-scan result before it will call out. |
| Structured action API | `server/main.py`, `server/schemas.py` | Receives sanitized context only; rejects payloads without a completed privacy manifest (defense-in-depth pass #3). |
| Model router | `server/agent.py` | Mirrors the sibling Prax AI project's provider-adapter pattern (`route_stream()` → per-provider streams). Ships with a deterministic offline reasoner so the demo needs zero API keys. |
| Command validator | `server/validator.py` | Schema + target-existence + disabled-command checks; force-sets `requires_approval` on high-risk or irreversible-sounding actions. |
| Popup UI | `extension/popup/*` | Privacy Firewall panel (live counts + before/after preview), agent trace, approval gate, Network Guard request log. |

## Data flow
