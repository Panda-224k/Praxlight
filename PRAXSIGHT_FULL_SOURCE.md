# PraxSight — full source (single file)

Everything below is the complete PraxSight repository — Manifest V3 extension (frontend), FastAPI backend, structured agent API, demo page, docs and tests — concatenated into one file so it can be dropped into Antigravity (or any agentic IDE/coding assistant) in one shot.

## How to use this in Antigravity

1. Create a new empty workspace/folder.
2. Give the agent this file and this instruction: "Recreate each file at the exact path shown in its `### FILE:` heading below, with exactly the content in the code block under it. Don't modify anything."
3. Once the files exist, run:
   ```bash
   pip install -r server/requirements.txt
   python run.py
   ```
   This starts the backend on http://localhost:8000 and serves the demo page at http://localhost:8000/demo/support-ticket/.
4. Load the extension: chrome://extensions -> Developer mode -> Load unpacked -> select the `extension/` folder.
5. Tests (optional, no extra installs needed beyond pytest):
   ```bash
   node --test tests/test_pii_lib.cjs
   python -m pytest tests/test_validator.py -v
   ```

---

## File tree

```
README.md
docs/AGENT_PROTOCOL.md
docs/ARCHITECTURE.md
docs/CURRENT_IMPLEMENTATION.md
docs/DEMO_GUIDE.md
docs/PRIVACY_MODEL.md
docs/SIH_ALIGNMENT.md
extension/background.js
extension/content/content-script.js
extension/content/perception.js
extension/content/privacy/detectors.js
extension/content/privacy/model-backends.js
extension/content/privacy/policy-engine.js
extension/content/privacy/redaction.js
extension/manifest.json
extension/popup/popup.css
extension/popup/popup.html
extension/popup/popup.js
server/agent.py
server/main.py
server/requirements.txt
server/schemas.py
server/validator.py
run.py
demo/support-ticket/index.html
tests/test_pii_lib.cjs
tests/test_validator.py
.gitignore
```

---

### FILE: README.md

```markdown
# PraxSight

**SIH26171 — On-device Visual Perception for Light-weight Browser Agents**
Organization: ISRO · Category: Software · Theme: Miscellaneous

> See locally. Redact locally. Reason on sanitized context. Act only with a human's OK.

PraxSight is a Manifest V3 browser extension plus a small FastAPI backend. The
extension reads the current page's DOM and text locally, detects PII with
regex + structural rules, replaces it with semantic tokens (`[EMAIL_1]`,
`[PERSON_1]`, `[CARD_REDACTED]`), and only *then* is the sanitized page state
allowed to reach the backend, which proposes one structured, schema-validated
browser action for a human to approve.

## Why this exists (and what it isn't)

This is **not** a PII redactor — Microsoft Presidio, [maskera](https://github.com)
and OSSRedact already do that well for static text before a chat call. None of
them protect a *browser agent mid-action* on a live page. PraxSight's actual
contribution is the layer underneath an agent: DOM-anchored redaction tied to
the actual clickable elements, a structured command protocol the model can't
escape, a validator, and a human approval gate before anything executes. See
[`docs/SIH_ALIGNMENT.md`](docs/SIH_ALIGNMENT.md) for the full prior-art comparison.

## Architecture

```
Page DOM/text
     │
     ▼
Local perception (extension/content/perception.js)         — Phase 1
     │
     ▼
Rules-based PII detection (extension/content/privacy/detectors.js)  — Phase 2
     │
     ▼
Policy engine → redaction / semantic tokens                — Phase 4
     │
     ▼
Residual-PII re-scan (content-script.js)                   — defense in depth #1
     │
     ▼
Hard privacy gate — the ONLY fetch() in the extension       — Phase 5
(extension/background.js: re-checks the manifest + re-scans
 for residual PII before it will call the backend at all)
     │
     ▼
POST /api/agent/act  (server/main.py)                       — Phase 7
  → server independently refuses payloads without a manifest — defense in depth #2
  → model router proposes ONE structured action              (server/agent.py)
  → validator rejects unknown selectors / disabled commands   (server/validator.py)
     │
     ▼
Popup shows the action + reason, human Approves or Rejects   — Phase 8
     │
     ▼
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
3. **Load unpacked** → select the `extension/` folder
4. Open the demo page from step 1, click the PraxSight icon in the toolbar

### 3. Try the flagship flow

1. Click **Scan this page** → watch the Privacy Firewall panel show raw vs.
   sanitized text side by side, with a live entity count.
2. Leave the task as *"Resolve this support ticket"* → click **Send sanitized
   context → run agent**.
3. Watch the agent trace: perceive → detect → redact → gate check → send →
   reason → validate.
4. An approval card appears (clicking "Resolve Ticket" is treated as an
   irreversible action) — **Approve** to actually click the button on the
   live page, or **Reject** to stop there.
5. Check **Network guard** at the bottom of the popup — every request the
   extension made to the backend is logged with its redaction counts,
   payload size, and latency.

## Tests

```bash
# Detection / redaction / policy engine — pure JS, no dependencies
node --test tests/test_pii_lib.cjs

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
      model-backends.js   Gemini Nano / Transformers.js adapter STUBS — not wired in yet
      redaction.js         semantic token redaction (Phase 4)
      policy-engine.js     severity → action, builds the privacy manifest
    content-script.js   orchestrates the scan + executes approved actions
  popup/                Privacy Firewall / agent trace / approval / network guard UI

server/                FastAPI backend
  main.py                /api/agent/act — never receives raw PII
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
honest breakdown — notably: **no vision/OCR model is wired up yet** (DOM +
text only), and the Gemini Nano / Transformers.js model-backed detection
layer is a real interface with no live model behind it yet.
```

### FILE: docs/AGENT_PROTOCOL.md

```markdown
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
```

### FILE: docs/ARCHITECTURE.md

```markdown
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

```
raw DOM/text
  → perception.js            (plain-data snapshot)
  → detectors.js              (Detection[] with type/severity/confidence)
  → policy-engine.js          (Detection[] + action, privacy_manifest)
  → redaction.js               (sanitized snapshot, same shape as perception)
  → content-script.js residual scan   (fail-closed check #1)
  → background.js gate               (fail-closed check #2, only fetch() in the extension)
  → POST /api/agent/act
      → server manifest check         (fail-closed check #3)
      → agent.py reason()             (proposes ONE AgentAction)
      → validator.py validate_action() (schema + target existence + approval flag)
  → popup renders action + reason
  → human Approves / Rejects
  → content-script.js executeAction() (only on the exact validated target)
```

Three independent fail-closed checks sit between "page has PII" and "server
sees anything": the client-side residual scan, the background gate, and the
server's own manifest check. Any one of them tripping blocks the request —
they don't share state, so a bug in one doesn't silently disable another.

## Why background.js, not content-script.js, owns the network call

`manifest.json`'s `host_permissions` only grants network access to the
backend origin at the extension level; content scripts run inside the page's
own security context and are not where the build wants that capability to
live. Structuring it this way means: if someone reads this repo looking for
"where could raw page data leak to the network", there is exactly one
function (`sendSanitizedContext` in `background.js`) to audit, not N call
sites scattered across content scripts that happen to run on every page.

## Honest limitation

`sendSanitizedContext`'s checks are still the extension checking its own
homework — a maliciously modified build of this same extension could skip
them. The sibling Prax AI project's standalone `network_monitor/` process
(independent of the app being demoed) is the right pattern to apply here too:
route demo traffic through a small external logging proxy so the payload
judges see is what the browser's network stack actually sent, not what the
extension claims it sent. Not implemented in this pass — see
`CURRENT_IMPLEMENTATION.md`.
```

### FILE: docs/CURRENT_IMPLEMENTATION.md

```markdown
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
```

### FILE: docs/DEMO_GUIDE.md

```markdown
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
```

### FILE: docs/PRIVACY_MODEL.md

```markdown
# PraxSight — Privacy Model

## What gets detected

| Category | Detector | Signal |
|---|---|---|
| `password` | structural | `input[type=password]` |
| `otp` | structural | label/name/autocomplete matching "otp", "one-time", "verification code" |
| `email` | structural + text | `autocomplete=email`, label text, or regex over visible text |
| `phone` | structural + text | `autocomplete=tel`, label text, or an Indian mobile-number pattern |
| `person_name` | structural | label containing "name" but not "username" |
| `address` | structural | label containing "address", "pincode", "zip code" |
| `account_number` | structural | label containing "account", "iban", "routing" |
| `card_number` | structural + text | label containing "card number"/"cvv", or a 13–19 digit run that passes a Luhn checksum |
| `gov_id_pan` | text | PAN-shaped pattern (`AAAAA9999A`) |
| `gov_id_like` | text | 12-digit grouped pattern, low confidence |
| `date_of_birth` | structural | label containing "dob", "date of birth" |
| `secret_key` | structural | label/name containing "api key", "secret", "access token" |

This is the Phase 2 rules layer only. It is deliberately not exhaustive —
see `CURRENT_IMPLEMENTATION.md` for what a model-backed pass (Phase 3) would
add on top (unlabeled free-text names, ambiguous fields).

## Redaction scheme

Two token shapes, chosen per type in `redaction.js`:

- **Counted, per-task-stable**: `[EMAIL_1]`, `[PERSON_2]`, `[PHONE_1]` — the
  server can still tell "these two mentions are the same person" without
  learning who that person is. Counters reset every scan; nothing persists
  across page loads.
- **Counterless**: `[PASSWORD_REDACTED]`, `[CARD_REDACTED]`,
  `[ACCOUNT_REDACTED]`, `[OTP_REDACTED]`, `[SECRET_REDACTED]`,
  `[GOVID_REDACTED]` — for classes where even distinguishing instance 1 from
  instance 2 leaks more than the task needs.

## Fail-closed, not fail-open

Three independent checks between page and server (see `ARCHITECTURE.md` for
where each lives):

1. **Client residual scan** (`content-script.js`) — re-scans the *sanitized*
   payload's JSON for anything that still looks like an email or a
   Luhn-valid card number. If it finds one, the scan is marked unclean.
2. **Background gate** (`background.js`) — refuses to call `fetch()` at all
   unless `manifest.performed === true` AND `residual.clean === true`.
   Blocked attempts are logged (`status: "BLOCKED"`) in the Network Guard
   panel, not silently dropped.
3. **Server manifest check** (`main.py`) — independently rejects (HTTP 400)
   any request whose `privacy_manifest.performed` is not `true`, regardless
   of what the extension claims elsewhere in the payload.

An unrecognized detection severity defaults to `redact` in the policy engine
(`policy-engine.js`'s `DEFAULT_POLICY` lookup returns `undefined` for
anything not in the map, and `applyPolicy` treats that as `"redact"`) —
the failure mode for "we don't know what this is" is *block it*, not *let it
through*.

## What's NOT covered yet

- **Faces / images / canvas content** — no vision model is wired up (see
  `CURRENT_IMPLEMENTATION.md`). A screenshot is never captured or sent in
  this build; only DOM text and attributes.
- **Free text with no structural signal** — a bare name typed into a
  generic-looking textarea with no label ("just call me Rahul") will not be
  caught by the rules layer. This is exactly the gap Phase 3's model-backed
  detection is meant to close.
- **Non-Indian phone formats** beyond a loose generic international pattern
  used only inside the (currently unused) extended pattern set.

## Privacy manifest shape

Attached to every request the gate allows through:

```json
{
  "performed": true,
  "version": "0.1.0",
  "detectors": ["dom-structural", "rules-text"],
  "entities_detected": 7,
  "entities_redacted": 7,
  "by_type": { "email": 2, "card_number": 1, "phone": 1 },
  "generated_at": "2026-09-04T10:15:00.000Z"
}
```

The server logs this on every accepted request (`main.py`'s `agent_act`) so
`entities_detected`/`entities_redacted` in server logs and the extension's
own Network Guard log should always agree for a healthy run — a useful
sanity check during a demo rehearsal.
```

### FILE: docs/SIH_ALIGNMENT.md

```markdown
# PraxSight — SIH26171 Alignment

## Official requirement mapping

| SIH26171 requirement | Implementation | Status |
|---|---|---|
| Lightweight visual perception runs locally | DOM + text perception (`extension/content/perception.js`) | Done — text/DOM only, no vision/OCR model yet |
| Sensitive/PII content detected before transmission | Rules-based detector (`detectors.js`): structural + regex/checksum | Done for the rules layer |
| Sanitized context may reach a server-side reasoning model | `background.js` gate → `POST /api/agent/act` | Done |
| Server returns commands the agent executes | Structured `AgentAction` protocol, validated (`validator.py`), executed by `content-script.js` after human approval | Done |
| Visual-context accuracy | N/A yet — no vision model | Not measured (honestly, not "0%" — just not built) |
| Sensitive/PII detection precision & recall | Node unit tests cover the rules layer's behavior; no labeled benchmark dataset built yet | Partially done — unit-tested, not yet benchmarked against a labeled set |
| Redaction precision | Covered by unit tests (`tests/test_pii_lib.cjs`) for the token-mapping logic | Partially done |
| Client-side resource utilization | Not instrumented | Not measured |
| End-to-end latency | Network Guard log records real `latencyMs` per request | Partially done — captured per-request, not aggregated/reported |
| Chrome + Firefox target | Chrome (Manifest V3, tested via "Load unpacked") | Chrome only in this pass; Firefox path is the documented Phase 3 fallback, not yet built |

Nothing in this table is marked "Done" unless it was actually run — see the
Test section in the README for the exact commands that produced the passing
results referenced above.

## Prior art — cited explicitly, not hidden

| Project | What it does | How PraxSight differs |
|---|---|---|
| [Microsoft Presidio](https://microsoft.github.io/presidio/) | Server-side PII detection/anonymization framework | Presidio sanitizes text you hand it; it has no concept of a live page, a clickable element, or an agent about to act. PraxSight's redaction is DOM-anchored — every detection carries a `psId` tied to an actual element, not just a text span. |
| maskera | Client-side PII redaction toolkit shipping a browser-ready NER model via Transformers.js | Same idea as PraxSight's planned Phase 3 fallback backend, but maskera stops at "sanitize this text before a chat call." It doesn't gate an agent's *actions*, has no structured command protocol, and has no human-approval step. |
| OSSRedact | Local privacy gateway redacting before a cloud LLM call, rehydrating on the reply | Closest in spirit to PraxSight's privacy gate. Still text-in/text-out around a chat call — no browser action execution, no validator, no approval gate. |
| Chrome Built-in AI / Gemini Nano | On-device model PraxSight is designed to build on top of (Phase 3), not compete with | — |

**One-sentence differentiator for the README:** these protect static text
before a chat call; PraxSight protects a live page an agent is about to act
on, with redaction tied to actionable elements and enforced by a structured
command protocol plus human approval, not just a sanitized prompt.

## What's deliberately deferred (see `CURRENT_IMPLEMENTATION.md` for detail)

- True visual/OCR/vision-model PII detection
- Full Firefox parity (only "the fallback path doesn't crash it" is in
  scope for a future pass — not built yet at all in this one)
- The five-way ablation study from the original 56-phase brief
- The four-page demo suite (banking/HR/login/support) — one page,
  support-ticket, fully working, first
- WebGPU-accelerated inference
```

### FILE: extension/background.js

```javascript
/**
 * PraxSight — Background Service Worker
 *
 * THIS FILE CONTAINS THE ONLY fetch() CALL IN THE ENTIRE EXTENSION THAT
 * TARGETS THE AI BACKEND. Content scripts have no host permission for
 * BACKEND_URL (see manifest.json — host_permissions is scoped to just the
 * backend, and content scripts don't declare it), so structurally, the only
 * way sanitized context reaches the network is through sendSanitizedContext()
 * below. That's the "hard privacy gate" from the build plan (Phase 5).
 *
 * Two independent checks run before any network call:
 *   1. The manifest the content script attached must claim performed=true.
 *   2. A residual-PII re-scan of the sanitized payload (defense-in-depth
 *      pass #2, on top of the one content-script.js already ran) must be
 *      clean.
 * Either failing BLOCKS the request and logs it — this endpoint never
 * silently drops the check.
 *
 * Honesty note (see docs/PRIVACY_MODEL.md "Known limitations"): this proves
 * there is exactly one code path to the network and that it enforces these
 * checks, but it is still the extension checking its own homework. A
 * fully independent proof — e.g. routing through a separate local logging
 * proxy outside this extension's process — is called out as a documented
 * follow-up, following the same lesson the sibling Prax AI project's
 * network-monitor process encodes.
 */

const BACKEND_URL = "http://localhost:8000";
const REQUEST_LOG_KEY = "praxsight_request_log";

async function appendLog(entry) {
  const { [REQUEST_LOG_KEY]: log = [] } = await chrome.storage.local.get(REQUEST_LOG_KEY);
  log.unshift(entry);
  await chrome.storage.local.set({ [REQUEST_LOG_KEY]: log.slice(0, 50) });
}

async function sendSanitizedContext(payload) {
  const manifest = payload && payload.manifest;
  const residual = payload && payload.residual;

  if (!manifest || manifest.performed !== true) {
    const entry = {
      timestamp: new Date().toISOString(),
      status: "BLOCKED",
      reason: "missing_or_invalid_privacy_manifest",
    };
    await appendLog(entry);
    return { ok: false, blocked: true, reason: entry.reason };
  }

  if (!residual || residual.clean !== true) {
    const entry = {
      timestamp: new Date().toISOString(),
      status: "BLOCKED",
      reason: "residual_pii_detected_fail_closed",
    };
    await appendLog(entry);
    return { ok: false, blocked: true, reason: entry.reason };
  }

  const body = JSON.stringify({
    task: payload.task,
    page_url: payload.sanitized.url,
    elements: {
      inputs: payload.sanitized.inputs,
      interactive: payload.sanitized.interactive,
    },
    text_context: payload.sanitized.textNodes.slice(0, 200),
    privacy_manifest: manifest,
  });

  const startedAt = performance.now();
  try {
    const resp = await fetch(`${BACKEND_URL}/api/agent/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const data = await resp.json().catch(() => ({}));

    await appendLog({
      timestamp: new Date().toISOString(),
      status: resp.ok ? "ALLOWED" : "ERROR",
      endpoint: "/api/agent/act",
      payloadBytes: body.length,
      latencyMs,
      entitiesDetected: manifest.entities_detected,
      entitiesRedacted: manifest.entities_redacted,
      httpStatus: resp.status,
    });

    return { ok: resp.ok, data };
  } catch (e) {
    await appendLog({
      timestamp: new Date().toISOString(),
      status: "ERROR",
      reason: String(e && e.message ? e.message : e),
    });
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PRAXSIGHT_SEND_TO_SERVER") {
    sendSanitizedContext(msg.payload).then(sendResponse);
    return true;
  }
  if (msg.type === "PRAXSIGHT_GET_LOG") {
    chrome.storage.local.get(REQUEST_LOG_KEY).then((r) => sendResponse(r[REQUEST_LOG_KEY] || []));
    return true;
  }
  if (msg.type === "PRAXSIGHT_CLEAR_LOG") {
    chrome.storage.local.set({ [REQUEST_LOG_KEY]: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
```

### FILE: extension/content/content-script.js

```javascript
/**
 * PraxSight — Content Script Orchestrator
 *
 * Wires perception → detection → policy → redaction into one scan, and
 * exposes it to the popup via chrome.runtime messaging. This file has DOM
 * access (needed to execute agent actions) but never calls fetch() itself —
 * that chokepoint lives only in background.js (Phase 5 hard gate).
 */
(function () {
  const PraxSight = window.PraxSight;
  let lastScan = null;

  /**
   * Defense-in-depth pass #1 (client side): re-scan the *sanitized* payload
   * for obvious residual PII before it's even offered to background.js.
   * This does not trust the redaction step blindly — if anything still
   * looks like an email/card after redaction, the scan is marked unclean
   * and background.js's gate will refuse to transmit it (fail-closed).
   */
  function residualPiiScan(sanitized) {
    const joined = JSON.stringify(sanitized);
    const emailLeft = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(joined);
    const cardLeft = /\b(?:\d[ -]?){13,19}\b/.test(joined) && PraxSight.detectorInternals.luhnValid(joined.match(/\b(?:\d[ -]?){13,19}\b/)[0]);
    return { clean: !emailLeft && !cardLeft, checkedAt: new Date().toISOString() };
  }

  async function runScan() {
    const perception = PraxSight.perception.capturePage();
    const rawDetections = await PraxSight.detectors.detect(perception);
    const policed = PraxSight.policyEngine.applyPolicy(rawDetections);
    const sanitized = PraxSight.redaction.sanitizePerception(perception, policed);
    const manifest = PraxSight.policyEngine.buildManifest(policed, sanitized);
    const residual = residualPiiScan(sanitized);
    lastScan = { perception, detections: policed, sanitized, manifest, residual };
    return lastScan;
  }

  function findElement(psId) {
    return document.querySelector(`[data-praxsight-id="${CSS.escape(psId)}"]`);
  }

  function executeAction(action) {
    const el = action && action.target && action.target.id ? findElement(action.target.id) : null;
    if (!el && action.action !== "read") return { ok: false, error: "target_not_found" };

    switch (action.action) {
      case "click":
        el.click();
        return { ok: true };
      case "focus":
        el.focus();
        return { ok: true };
      case "scroll":
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return { ok: true };
      case "type":
        // The server-side validator (server/validator.py) refuses to emit a
        // 'type' action unless value_policy === 'user-provided' — the agent
        // is structurally prevented from inventing field values.
        return { ok: false, error: "requires_user_input_not_implemented_in_popup" };
      case "read":
        return el ? { ok: true, text: el.innerText || el.textContent } : { ok: false, error: "target_not_found" };
      default:
        return { ok: false, error: "unsupported_action" };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PRAXSIGHT_SCAN") {
      runScan().then((result) =>
        sendResponse({
          ok: true,
          manifest: result.manifest,
          residual: result.residual,
          counts: {
            inputs: result.perception.inputs.length,
            interactive: result.perception.interactive.length,
            textNodes: result.perception.textNodes.length,
          },
          raw: result.perception,
          sanitized: result.sanitized,
        })
      );
      return true; // async response
    }

    if (msg.type === "PRAXSIGHT_GET_LAST_SCAN") {
      sendResponse({ ok: !!lastScan, scan: lastScan });
      return true;
    }

    if (msg.type === "PRAXSIGHT_EXECUTE_ACTION") {
      sendResponse(executeAction(msg.action));
      return true;
    }
  });
})();
```

### FILE: extension/content/perception.js

```javascript
/**
 * PraxSight — Local DOM Perception Layer (Phase 1)
 *
 * Extracts inputs, interactive elements, and visible text into a plain-data
 * schema with no live DOM references, so everything downstream (detectors,
 * redaction, the background service worker, the server) only ever touches
 * inert JSON — never a live node a bug could accidentally serialize whole.
 *
 * No PII detection happens here. This module only answers "what is on the
 * page and where" — see content/privacy/detectors.js for "what's sensitive".
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (style && (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")) {
      return false;
    }
    return true;
  }

  function bboxOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  let idCounter = 0;
  function elementId(el) {
    if (el.dataset && el.dataset.praxsightId) return el.dataset.praxsightId;
    const gen = `ps_${el.tagName.toLowerCase()}_${idCounter++}`;
    if (el.dataset) el.dataset.praxsightId = gen;
    return gen;
  }

  function nearestLabelText(el) {
    if (el.labels && el.labels.length) {
      return Array.from(el.labels).map((l) => l.textContent.trim()).join(" ");
    }
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
    const prev = el.previousElementSibling;
    if (prev && /^(label|span|div|p)$/i.test(prev.tagName) && prev.textContent.trim().length < 60) {
      return prev.textContent.trim();
    }
    return "";
  }

  function extractInputs() {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    return inputs.filter(isVisible).map((el) => ({
      psId: elementId(el),
      tag: el.tagName.toLowerCase(),
      type: (el.type || "text").toLowerCase(),
      name: el.name || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      label: nearestLabelText(el),
      // Password values are never read into memory at all, not even pre-redaction.
      value: el.type === "password" ? "" : el.value || "",
      bbox: bboxOf(el),
    }));
  }

  function extractInteractive() {
    const els = Array.from(document.querySelectorAll('button, a[href], [role="button"], summary'));
    return els.filter(isVisible).map((el) => ({
      psId: elementId(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || (el.tagName.toLowerCase() === "button" ? "button" : "link"),
      text: (el.innerText || el.textContent || "").trim().slice(0, 120),
      bbox: bboxOf(el),
    }));
  }

  function extractText(maxChars = 20000) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : "";
        if (["script", "style", "noscript", "template"].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && !isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const chunks = [];
    let node;
    let total = 0;
    while ((node = walker.nextNode()) && total < maxChars) {
      const t = node.textContent.trim();
      if (!t) continue;
      chunks.push({ text: t, psId: elementId(node.parentElement), bbox: bboxOf(node.parentElement) });
      total += t.length;
    }
    return chunks;
  }

  function capturePage() {
    return {
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      inputs: extractInputs(),
      interactive: extractInteractive(),
      textNodes: extractText(),
    };
  }

  PraxSight.perception = { capturePage, isVisible, bboxOf };
})(typeof window !== "undefined" ? window : globalThis);
```

### FILE: extension/content/privacy/detectors.js

```javascript
/**
 * PraxSight — Sensitive Data Detection Engine (Phase 2 + Phase 3 interface)
 *
 * Two detection strategies feed a common `Detection` shape:
 *   1. detectStructural  — DOM/field metadata (type=password, autocomplete=email,
 *      label text). Cheap, high-precision, catches most real-world form PII
 *      before any text scanning happens at all.
 *   2. detectInText      — regex + checksum scanning over visible text nodes.
 *
 * This file has NO dependency on `window`/DOM — perception.js already turned
 * the page into plain objects, so this module is pure data-in/data-out and
 * runs identically inside the content script or under plain Node (see
 * tests/test_pii_lib.cjs), no jsdom or bundler required.
 *
 * Detection = {
 *   type, value, psId, bbox, source: string[], confidence: 0..1,
 *   severity: 'low'|'medium'|'high'|'critical'
 * }
 *
 * `detect()` below is the "rules" implementation of the DetectionBackend
 * interface described in the build plan:
 *
 *   interface DetectionBackend {
 *     name: "rules" | "gemini-nano" | "transformers-js-ner";
 *     available(): Promise<boolean>;
 *     detect(perception): Promise<Detection[]>;
 *   }
 *
 * Model-backed backends (Gemini Nano via the Chrome Prompt API, or a
 * Transformers.js NER fallback for Firefox) are intentionally NOT wired up
 * here yet — see docs/CURRENT_IMPLEMENTATION.md for why the rules backend is
 * the only one shipped in this pass, and content/privacy/model-backends.js
 * for the stub adapters left in place for that follow-up.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  const PATTERNS = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone_in: /(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
    card: /\b(?:\d[ -]?){13,19}\b/g,
    pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    aadhaar_like: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
  };

  function luhnValid(numStr) {
    const digits = numStr.replace(/\D/g, "");
    if (digits.length < 12 || digits.length > 19) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function detectInText(text, psId, bbox) {
    const found = [];
    const push = (type, value, confidence, severity) =>
      found.push({ type, value, psId, bbox, source: ["rules-text"], confidence, severity });

    let m;
    PATTERNS.email.lastIndex = 0;
    while ((m = PATTERNS.email.exec(text))) push("email", m[0], 0.97, "high");

    PATTERNS.card.lastIndex = 0;
    while ((m = PATTERNS.card.exec(text))) {
      if (luhnValid(m[0])) push("card_number", m[0], 0.95, "critical");
    }

    PATTERNS.pan.lastIndex = 0;
    while ((m = PATTERNS.pan.exec(text))) push("gov_id_pan", m[0], 0.9, "high");

    PATTERNS.aadhaar_like.lastIndex = 0;
    while ((m = PATTERNS.aadhaar_like.exec(text))) push("gov_id_like", m[0], 0.5, "high");

    PATTERNS.phone_in.lastIndex = 0;
    while ((m = PATTERNS.phone_in.exec(text))) push("phone", m[0], 0.85, "medium");

    return found;
  }

  function detectStructural(inputEl) {
    const found = [];
    const label = (inputEl.label || "").toLowerCase();
    const name = (inputEl.name || "").toLowerCase();
    const auto = (inputEl.autocomplete || "").toLowerCase();
    const type = (inputEl.type || "").toLowerCase();
    const sig = `${label} ${name} ${auto} ${type}`;

    const rule = (test, cat, conf, sev) => {
      if (test) {
        found.push({
          type: cat,
          value: inputEl.value || "[FIELD]",
          psId: inputEl.psId,
          bbox: inputEl.bbox,
          source: ["dom-structural"],
          confidence: conf,
          severity: sev,
        });
      }
    };

    rule(type === "password", "password", 0.99, "critical");
    rule(/otp|one[- ]?time|verification code/.test(sig), "otp", 0.85, "critical");
    rule(auto.includes("email") || /email/.test(sig), "email", 0.9, "high");
    rule(auto.includes("tel") || /phone|mobile|contact number/.test(sig), "phone", 0.85, "medium");
    rule(/\bname\b/.test(sig) && !/username/.test(sig), "person_name", 0.6, "medium");
    rule(/address|pincode|zip code/.test(sig), "address", 0.65, "medium");
    rule(/account(\s?no|\s?number)?\b|iban|routing/.test(sig), "account_number", 0.8, "critical");
    rule(/card number|cvv|expiry/.test(sig), "card_number", 0.85, "critical");
    rule(/dob|date of birth|birthdate/.test(sig), "date_of_birth", 0.75, "medium");
    rule(/api[_ -]?key|secret|access token/.test(sig), "secret_key", 0.9, "critical");

    return found;
  }

  async function detect(perceptionResult) {
    const detections = [];
    for (const el of perceptionResult.inputs || []) {
      detections.push(...detectStructural(el));
    }
    for (const node of perceptionResult.textNodes || []) {
      detections.push(...detectInText(node.text, node.psId, node.bbox));
    }
    return detections;
  }

  const rulesBackend = {
    name: "rules",
    available: async () => true,
    detect,
  };

  PraxSight.detectors = rulesBackend;
  PraxSight.detectorInternals = { luhnValid, detectInText, detectStructural, PATTERNS };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { rulesBackend, luhnValid, detectInText, detectStructural, detect };
  }
})(typeof window !== "undefined" ? window : globalThis);
```

### FILE: extension/content/privacy/model-backends.js

```javascript
/**
 * PraxSight — Model-backed DetectionBackend adapters (Phase 3)
 *
 * STATUS: scaffolded interface only — NOT wired into the live scan pipeline.
 * content-script.js currently only calls PraxSight.detectors (the rules
 * backend). These two adapters exist so the follow-up work is a matter of
 * filling in `classify()` and adding one line to content-script.js, not
 * redesigning the pipeline. See docs/CURRENT_IMPLEMENTATION.md.
 *
 * Both adapters implement the same DetectionBackend shape as the rules
 * backend in detectors.js:
 *   { name, available(): Promise<boolean>, detect(perception): Promise<Detection[]> }
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["person_name", "email", "phone", "address", "other"] },
            text: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["type", "text", "confidence"],
        },
      },
    },
    required: ["entities"],
  };

  // ── Chrome path: Gemini Nano via the on-device Prompt API ──────────────
  const geminiNanoBackend = {
    name: "gemini-nano",
    async available() {
      // Chrome 128+: `LanguageModel` (or the legacy `window.ai.languageModel`
      // origin-trial shape) is only present when the on-device model has
      // been downloaded. Feature-detect rather than assume.
      return typeof root.LanguageModel !== "undefined" || !!(root.ai && root.ai.languageModel);
    },
    async detect(perceptionResult) {
      const ok = await this.available();
      if (!ok) return [];
      // Intentionally unimplemented: would create a session with
      // `responseConstraint: RESPONSE_SCHEMA` and classify free-text spans
      // the rules backend didn't already catch (e.g. a bare name in a
      // paragraph with no surrounding label). Left as a stub so this file
      // is honest about what's shipped vs. planned rather than silently
      // returning fabricated detections.
      return [];
    },
  };

  // ── Firefox / fallback path: Transformers.js NER model ─────────────────
  const transformersNerBackend = {
    name: "transformers-js-ner",
    async available() {
      return false; // no model bundled in this pass — see CURRENT_IMPLEMENTATION.md
    },
    async detect(_perceptionResult) {
      return [];
    },
  };

  PraxSight.modelBackends = { geminiNanoBackend, transformersNerBackend, RESPONSE_SCHEMA };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { geminiNanoBackend, transformersNerBackend, RESPONSE_SCHEMA };
  }
})(typeof window !== "undefined" ? window : globalThis);
```

### FILE: extension/content/privacy/policy-engine.js

```javascript
/**
 * PraxSight — Privacy Policy Engine (Phase 4 → Phase 12 manifest)
 *
 * Decides what happens to each detection (allow / redact) and builds the
 * `privacy_manifest` that travels with every outgoing request. The manifest
 * is what background.js's hard gate (Phase 5) checks before it will call
 * fetch() at all — see extension/background.js.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  // Default policy: only 'low' severity (rare — reserved for future
  // low-confidence heuristics) is allowed through unredacted. Everything
  // else is redacted. This is intentionally fail-closed: an unrecognized
  // severity string is NOT in this map and therefore defaults to 'redact'.
  const DEFAULT_POLICY = {
    critical: "redact",
    high: "redact",
    medium: "redact",
    low: "allow",
  };

  function applyPolicy(detections, policy = DEFAULT_POLICY) {
    return detections.map((d) => ({ ...d, action: policy[d.severity] || "redact" }));
  }

  function buildManifest(policedDetections, sanitized) {
    const redacted = policedDetections.filter((d) => d.action !== "allow");
    const byType = {};
    for (const d of policedDetections) byType[d.type] = (byType[d.type] || 0) + 1;
    return {
      performed: true,
      version: "0.1.0",
      detectors: Array.from(new Set(policedDetections.flatMap((d) => d.source))),
      entities_detected: policedDetections.length,
      entities_redacted: redacted.length,
      by_type: byType,
      generated_at: new Date().toISOString(),
    };
  }

  const api = { applyPolicy, buildManifest, DEFAULT_POLICY };
  PraxSight.policyEngine = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

### FILE: extension/content/privacy/redaction.js

```javascript
/**
 * PraxSight — Semantic Redaction (Phase 4)
 *
 * Turns raw detected values into deterministic semantic tokens so a server
 * can still reason about page *structure* ("there is a person and an email
 * near this button") without ever receiving the actual secret.
 *
 *   "John Smith"           -> "[PERSON_1]"
 *   "john@example.com"     -> "[EMAIL_1]"
 *   "4111 1111 1111 1111"  -> "[CARD_REDACTED]"   (irreversible-class fields
 *                                                    never get a counter —
 *                                                    there is no legitimate
 *                                                    reason the model needs
 *                                                    to distinguish CARD_1
 *                                                    from CARD_2)
 *
 * Tokens are stable only within a single scan/task — this module holds no
 * persistent identity map across page loads, by design.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  // Fields where even a counter-labeled token would leak structure the
  // policy considers too sensitive to distinguish between instances.
  const COUNTERLESS_TYPES = new Set([
    "password",
    "otp",
    "secret_key",
    "card_number",
    "account_number",
    "gov_id_pan",
    "gov_id_like",
  ]);

  const TOKEN_LABELS = {
    email: "EMAIL",
    person_name: "PERSON",
    phone: "PHONE",
    address: "ADDRESS",
    card_number: "CARD",
    account_number: "ACCOUNT",
    gov_id_pan: "GOVID",
    gov_id_like: "GOVID",
    date_of_birth: "DOB",
    otp: "OTP",
    password: "PASSWORD",
    secret_key: "SECRET",
  };

  function dedupe(detections) {
    const seen = new Map();
    for (const d of detections) {
      const key = `${d.type}:${d.value}`;
      const prior = seen.get(key);
      if (!prior || prior.confidence < d.confidence) seen.set(key, d);
    }
    return Array.from(seen.values());
  }

  function buildTokenMap(detections) {
    const counters = {};
    const map = new Map(); // raw value -> token
    for (const d of dedupe(detections)) {
      if (!d.value) continue;
      const label = TOKEN_LABELS[d.type] || d.type.toUpperCase();
      if (map.has(d.value)) continue;
      if (COUNTERLESS_TYPES.has(d.type)) {
        map.set(d.value, `[${label}_REDACTED]`);
      } else {
        counters[label] = (counters[label] || 0) + 1;
        map.set(d.value, `[${label}_${counters[label]}]`);
      }
    }
    return map;
  }

  function redactText(text, tokenMap) {
    if (!text) return text || "";
    let out = text;
    for (const [raw, token] of tokenMap.entries()) {
      if (!raw) continue;
      out = out.split(raw).join(token);
    }
    return out;
  }

  function sanitizePerception(perception, detections) {
    const tokenMap = buildTokenMap(detections);
    const sanitizedTextNodes = (perception.textNodes || []).map((n) => ({
      psId: n.psId,
      bbox: n.bbox,
      text: redactText(n.text, tokenMap),
    }));
    const sanitizedInputs = (perception.inputs || []).map((inp) => ({
      psId: inp.psId,
      tag: inp.tag,
      type: inp.type,
      label: redactText(inp.label, tokenMap),
      value: tokenMap.has(inp.value) ? tokenMap.get(inp.value) : inp.type === "password" ? "[PASSWORD_REDACTED]" : "",
      bbox: inp.bbox,
    }));
    const sanitizedInteractive = (perception.interactive || []).map((el) => ({
      psId: el.psId,
      tag: el.tag,
      role: el.role,
      text: redactText(el.text, tokenMap),
      bbox: el.bbox,
    }));
    return {
      url: perception.url,
      title: perception.title,
      capturedAt: perception.capturedAt,
      inputs: sanitizedInputs,
      interactive: sanitizedInteractive,
      textNodes: sanitizedTextNodes,
      tokenMapSize: tokenMap.size,
    };
  }

  const api = { dedupe, buildTokenMap, redactText, sanitizePerception, COUNTERLESS_TYPES };
  PraxSight.redaction = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

### FILE: extension/manifest.json

```json
{
  "manifest_version": 3,
  "name": "PraxSight — Privacy-Preserving Browser Agent",
  "short_name": "PraxSight",
  "version": "0.1.0",
  "description": "SIH26171: on-device DOM/text perception with a hard privacy gate — no raw PII leaves the browser before an AI agent reasons over the page.",

  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "http://localhost:8000/*",
    "http://127.0.0.1:8000/*"
  ],

  "background": {
    "service_worker": "background.js"
  },

  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "PraxSight — privacy firewall for browser agents"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "run_at": "document_idle",
      "js": [
        "content/perception.js",
        "content/privacy/detectors.js",
        "content/privacy/redaction.js",
        "content/privacy/policy-engine.js",
        "content/content-script.js"
      ]
    }
  ]
}
```

### FILE: extension/popup/popup.css

```css
/*
  Design brief: an instrument console for a privacy gate, not a SaaS
  dashboard. Rows read like telemetry (label ..... value), panels are flat
  and hairline-bordered rather than shadowed cards, and the two accent
  colors carry real meaning (teal = sanitized/safe, amber = needs a human).
*/

:root {
  --bg: #0f1a1c;
  --surface: #15252a;
  --surface-2: #1c3238;
  --border: #2a4247;
  --text: #e8f2f1;
  --text-muted: #8fa8ab;
  --text-faint: #5f7679;

  --safe: #3ddc97;
  --safe-dim: #1f4536;
  --warn: #e8a33d;
  --warn-dim: #4a3a1c;
  --danger: #e8685d;
  --danger-dim: #4a2420;
  --brand: #8b96ff;

  --font-ui: -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
  --font-data: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  width: 400px;
  max-height: 600px;
  overflow-y: auto;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: 1.45;
}

/* ── Rail header ─────────────────────────────────────────────── */
.rail {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-2), var(--surface));
}
.rail-mark {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--brand);
  border-radius: 7px;
  color: var(--brand);
  font-family: var(--font-data);
  font-size: 12px;
  font-weight: 600;
}
.rail-heading { flex: 1; }
.rail-heading h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
.rail-heading p { margin: 1px 0 0; font-size: 11px; color: var(--text-muted); }
.rail-status { display: flex; align-items: center; gap: 6px; font-family: var(--font-data); font-size: 10px; color: var(--text-muted); }
.rail-status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
.rail-status[data-state="ok"] .dot { background: var(--safe); box-shadow: 0 0 6px var(--safe); }
.rail-status[data-state="down"] .dot { background: var(--danger); box-shadow: 0 0 6px var(--danger); }

main { padding: 14px 16px 20px; display: flex; flex-direction: column; gap: 14px; }

/* ── Panels ──────────────────────────────────────────────────── */
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 12px 14px 14px;
}
.panel-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.panel h2 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--text); text-transform: uppercase; letter-spacing: 0.04em; }
.panel h3 { margin: 0 0 6px; font-size: 10.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }

/* ── Readout rows (the "instrument" feel) ───────────────────── */
.readout-grid { display: flex; gap: 8px; }
.readout {
  flex: 1;
  display: flex; flex-direction: column; gap: 3px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  background: var(--bg);
}
.readout-label { font-size: 10px; color: var(--text-muted); }
.readout-value { font-family: var(--font-data); font-size: 17px; font-weight: 600; }
.readout.accent-safe .readout-value { color: var(--safe); }

/* ── Badges ──────────────────────────────────────────────────── */
.badge {
  font-family: var(--font-data);
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 100px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.badge[data-state="pass"] { color: var(--safe); border-color: var(--safe-dim); background: var(--safe-dim); }
.badge[data-state="blocked"] { color: var(--danger); border-color: var(--danger-dim); background: var(--danger-dim); }

/* ── Before / after split ───────────────────────────────────── */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.code-block {
  margin: 0;
  font-family: var(--font-data);
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 130px;
  overflow-y: auto;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
}
.code-block.danger { border-color: var(--danger-dim); }
.code-block.safe { border-color: var(--safe-dim); color: var(--safe); }

/* ── Buttons ─────────────────────────────────────────────────── */
.btn {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid transparent;
  padding: 7px 12px;
  cursor: pointer;
}
.btn-ghost { background: transparent; border-color: var(--border); color: var(--text); }
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }
.btn-small { padding: 4px 9px; font-size: 11px; }
.btn-primary { background: var(--brand); color: #10121f; width: 100%; margin: 10px 0 12px; padding: 9px; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-approve { background: var(--safe); color: #062419; flex: 1; }
.btn-reject { background: transparent; border-color: var(--danger); color: var(--danger); flex: 1; }

textarea {
  width: 100%;
  resize: vertical;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 12px;
  padding: 8px;
}

/* ── Agent trace ─────────────────────────────────────────────── */
.trace { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.trace li {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 11.5px;
  color: var(--text-muted);
  border-left: 2px solid var(--border);
  padding: 2px 0 2px 10px;
}
.trace li[data-status="done"] { color: var(--text); border-left-color: var(--safe); }
.trace li[data-status="running"] { color: var(--text); border-left-color: var(--brand); }
.trace li[data-status="blocked"] { color: var(--danger); border-left-color: var(--danger); }
.trace li .tstep { font-family: var(--font-data); color: var(--text-faint); flex-shrink: 0; }

/* ── Approval ────────────────────────────────────────────────── */
.approval {
  margin-top: 12px;
  border: 1px solid var(--warn-dim);
  background: var(--warn-dim);
  border-radius: 8px;
  padding: 10px 12px;
}
.approval-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--warn); margin-bottom: 4px; }
.approval-reason { margin: 0 0 6px; font-size: 12px; color: var(--text); }
.approval-meta { font-family: var(--font-data); font-size: 10.5px; color: var(--text-muted); margin-bottom: 10px; }
.approval-actions { display: flex; gap: 8px; }

/* ── Network guard log ───────────────────────────────────────── */
.log { display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; }
.log .empty { margin: 0; font-size: 11px; color: var(--text-faint); }
.log-entry {
  display: flex; justify-content: space-between; align-items: center;
  font-family: var(--font-data);
  font-size: 10.5px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.log-entry .status-allowed { color: var(--safe); }
.log-entry .status-blocked { color: var(--danger); }
.log-entry .status-error { color: var(--warn); }
```

### FILE: extension/popup/popup.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PraxSight</title>
<link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header class="rail">
    <div class="rail-mark">PS</div>
    <div class="rail-heading">
      <h1>PraxSight</h1>
      <p>privacy firewall for browser agents</p>
    </div>
    <div class="rail-status" id="backendStatus" data-state="unknown">
      <span class="dot"></span><span class="rail-status-label">backend</span>
    </div>
  </header>

  <main>

    <section class="panel" id="scanPanel">
      <div class="panel-row">
        <h2>1 · Local scan</h2>
        <button class="btn btn-ghost" id="scanBtn">Scan this page</button>
      </div>
      <div class="readout-grid" id="scanCounts">
        <div class="readout"><span class="readout-label">inputs</span><span class="readout-value" id="cInputs">–</span></div>
        <div class="readout"><span class="readout-label">controls</span><span class="readout-value" id="cInteractive">–</span></div>
        <div class="readout"><span class="readout-label">text nodes</span><span class="readout-value" id="cText">–</span></div>
      </div>
    </section>

    <section class="panel" id="firewallPanel">
      <div class="panel-row">
        <h2>Privacy firewall</h2>
        <span class="badge" id="gateBadge" data-state="idle">GATE IDLE</span>
      </div>
      <div class="readout-grid firewall-grid">
        <div class="readout"><span class="readout-label">entities detected</span><span class="readout-value" id="mDetected">0</span></div>
        <div class="readout"><span class="readout-label">entities redacted</span><span class="readout-value" id="mRedacted">0</span></div>
        <div class="readout accent-safe"><span class="readout-label">raw PII sent</span><span class="readout-value" id="mRawSent">0</span></div>
      </div>

      <div class="split">
        <div class="split-col">
          <h3>what's on the page</h3>
          <pre class="code-block danger" id="rawPreview">Run a scan to see this.</pre>
        </div>
        <div class="split-col">
          <h3>what would leave the browser</h3>
          <pre class="code-block safe" id="sanitizedPreview">Run a scan to see this.</pre>
        </div>
      </div>
    </section>

    <section class="panel" id="agentPanel">
      <div class="panel-row">
        <h2>2 · Task</h2>
      </div>
      <textarea id="taskInput" rows="2" placeholder="e.g. Resolve this support ticket">Resolve this support ticket</textarea>
      <button class="btn btn-primary" id="runAgentBtn">Send sanitized context → run agent</button>

      <ol class="trace" id="traceList"></ol>

      <div class="approval" id="approvalBox" hidden>
        <div class="approval-head">Approval required</div>
        <p class="approval-reason" id="approvalReason"></p>
        <div class="approval-meta">
          <span id="approvalAction"></span> · risk <span id="approvalRisk"></span>
        </div>
        <div class="approval-actions">
          <button class="btn btn-approve" id="approveBtn">Approve &amp; execute</button>
          <button class="btn btn-reject" id="rejectBtn">Reject</button>
        </div>
      </div>
    </section>

    <section class="panel" id="networkPanel">
      <div class="panel-row">
        <h2>Network guard</h2>
        <button class="btn btn-ghost btn-small" id="clearLogBtn">Clear</button>
      </div>
      <div class="log" id="logList"><p class="empty">No requests yet.</p></div>
    </section>

  </main>

  <script src="popup.js"></script>
</body>
</html>
```

### FILE: extension/popup/popup.js

```javascript
const $ = (id) => document.getElementById(id);

let activeTabId = null;
let pendingAction = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => chrome.tabs.sendMessage(tabId, message, resolve));
}

function sendToBackground(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function traceStep(label, status) {
  const li = document.createElement("li");
  li.dataset.status = status;
  li.innerHTML = `<span class="tstep">${status === "done" ? "✓" : status === "blocked" ? "✕" : "…"}</span><span>${label}</span>`;
  $("traceList").appendChild(li);
  return li;
}

function resetTrace() {
  $("traceList").innerHTML = "";
}

function previewText(obj) {
  const lines = [];
  for (const inp of obj.inputs || []) {
    if (inp.value) lines.push(`${inp.label || inp.tag}: ${inp.value}`);
  }
  for (const n of (obj.textNodes || []).slice(0, 25)) {
    if (n.text && n.text.length < 140) lines.push(n.text);
  }
  return lines.slice(0, 18).join("\n") || "(nothing visible captured)";
}

async function runScan() {
  const tab = await getActiveTab();
  activeTabId = tab.id;
  $("scanBtn").disabled = true;
  $("scanBtn").textContent = "Scanning…";

  let resp;
  try {
    resp = await sendToTab(tab.id, { type: "PRAXSIGHT_SCAN" });
  } catch (e) {
    resp = null;
  }

  $("scanBtn").disabled = false;
  $("scanBtn").textContent = "Scan this page";

  if (!resp || !resp.ok) {
    $("gateBadge").textContent = "NO CONTENT SCRIPT";
    $("gateBadge").dataset.state = "blocked";
    return null;
  }

  $("cInputs").textContent = resp.counts.inputs;
  $("cInteractive").textContent = resp.counts.interactive;
  $("cText").textContent = resp.counts.textNodes;

  $("mDetected").textContent = resp.manifest.entities_detected;
  $("mRedacted").textContent = resp.manifest.entities_redacted;
  $("mRawSent").textContent = "0";

  $("rawPreview").textContent = previewText(resp.raw);
  $("sanitizedPreview").textContent = previewText(resp.sanitized);

  const clean = resp.residual && resp.residual.clean;
  $("gateBadge").textContent = clean ? "GATE: READY" : "GATE: RESIDUAL PII";
  $("gateBadge").dataset.state = clean ? "pass" : "blocked";

  return resp;
}

async function runAgent() {
  resetTrace();
  $("approvalBox").hidden = true;
  pendingAction = null;

  traceStep("Perceiving page (DOM + text)", "done");
  const scan = await runScan();
  if (!scan) {
    traceStep("Scan failed — no content script on this page", "blocked");
    return;
  }
  traceStep(`Detected ${scan.manifest.entities_detected} sensitive entities`, "done");
  traceStep(`Redacted ${scan.manifest.entities_redacted} entities before transmission`, "done");

  const gateStep = traceStep("Privacy gate check (manifest + residual scan)", "running");

  const task = $("taskInput").value.trim() || "Resolve this support ticket";
  const payload = {
    task,
    manifest: scan.manifest,
    residual: scan.residual,
    sanitized: scan.sanitized,
  };

  const result = await sendToBackground({ type: "PRAXSIGHT_SEND_TO_SERVER", payload });

  if (result.blocked) {
    gateStep.dataset.status = "blocked";
    gateStep.querySelector(".tstep").textContent = "✕";
    traceStep(`Transmission BLOCKED: ${result.reason}`, "blocked");
    await loadLog();
    return;
  }
  gateStep.dataset.status = "done";
  gateStep.querySelector(".tstep").textContent = "✓";
  traceStep("Sanitized context sent to backend", "done");

  if (!result.ok) {
    traceStep(`Server error: ${JSON.stringify(result.data || result.error)}`, "blocked");
    await loadLog();
    return;
  }

  const action = result.data;
  traceStep(`Agent proposed: ${action.action}${action.target ? " → " + action.target.id : ""}`, "done");
  traceStep(action.validated ? "Action passed server-side validation" : "Action NOT validated", action.validated ? "done" : "blocked");

  if (action.requires_approval) {
    pendingAction = action;
    $("approvalReason").textContent = action.reason;
    $("approvalAction").textContent = `${action.action} → ${action.target ? action.target.id : "(none)"}`;
    $("approvalRisk").textContent = action.risk;
    $("approvalBox").hidden = false;
    traceStep("Waiting for human approval (Shift-In-Charge equivalent)", "running");
  } else {
    traceStep("Low risk — no approval required. Executing…", "running");
    await executeAndReport(action);
  }

  await loadLog();
}

async function executeAndReport(action) {
  const exec = await sendToTab(activeTabId, { type: "PRAXSIGHT_EXECUTE_ACTION", action });
  traceStep(exec.ok ? "Action executed and verified" : `Execution failed: ${exec.error}`, exec.ok ? "done" : "blocked");
}

async function loadLog() {
  const log = await sendToBackground({ type: "PRAXSIGHT_GET_LOG" });
  const el = $("logList");
  if (!log || !log.length) {
    el.innerHTML = '<p class="empty">No requests yet.</p>';
    return;
  }
  el.innerHTML = "";
  for (const entry of log) {
    const div = document.createElement("div");
    div.className = "log-entry";
    const statusClass = entry.status === "ALLOWED" ? "status-allowed" : entry.status === "BLOCKED" ? "status-blocked" : "status-error";
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const detail =
      entry.status === "ALLOWED"
        ? `${entry.entitiesRedacted}/${entry.entitiesDetected} redacted · ${entry.payloadBytes}B · ${entry.latencyMs}ms`
        : entry.reason || "";
    div.innerHTML = `<span>${time}</span><span class="${statusClass}">${entry.status}</span><span>${detail}</span>`;
    el.appendChild(div);
  }
}

async function checkBackend() {
  const el = $("backendStatus");
  try {
    const resp = await fetch("http://localhost:8000/api/health", { method: "GET" });
    el.dataset.state = resp.ok ? "ok" : "down";
  } catch {
    el.dataset.state = "down";
  }
}

$("scanBtn").addEventListener("click", runScan);
$("runAgentBtn").addEventListener("click", runAgent);
$("clearLogBtn").addEventListener("click", async () => {
  await sendToBackground({ type: "PRAXSIGHT_CLEAR_LOG" });
  await loadLog();
});
$("approveBtn").addEventListener("click", async () => {
  $("approvalBox").hidden = true;
  if (pendingAction) await executeAndReport(pendingAction);
  pendingAction = null;
});
$("rejectBtn").addEventListener("click", () => {
  $("approvalBox").hidden = true;
  traceStep("Human rejected the proposed action — nothing executed", "blocked");
  pendingAction = null;
});

checkBackend();
loadLog();
```

### FILE: server/agent.py

```python
"""
PraxSight — Model Router (Phase 7 reasoning step)

Mirrors the provider-adapter pattern used by the sibling Prax AI project
(backend/app.py: _openrouter_stream / _gemini_stream / _ollama_stream feeding
one route_stream() dispatcher). Only the deterministic offline reasoner is
wired up by default, so the flagship demo works with zero API keys and zero
network egress from this process. Anyone deploying this for real can add a
real adapter behind the same `reason()` call without touching main.py.

Whatever backend answers, it only ever sees `AgentActRequest` — the already-
sanitized payload. There is no code path in this file that can reach raw
page content, because the server never receives it in the first place.
"""
from __future__ import annotations

import os

from schemas import AgentAction, AgentActRequest, ActionTarget


class ModelRouter:
    def __init__(self) -> None:
        self.has_openrouter = bool(os.getenv("OPENROUTER_API_KEY"))
        self.has_google = bool(os.getenv("GOOGLE_AI_API_KEY"))
        self.has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))

    async def reason(self, req: AgentActRequest) -> AgentAction:
        # A real deployment would branch here on self.has_* the way
        # app.py's route_stream() does. This pass ships only the
        # deterministic fallback: fully offline, fully reproducible for
        # judging, and honest about not calling out to a cloud model.
        return self._deterministic_reason(req)

    def _find_by_keyword(self, req: AgentActRequest, keyword: str):
        for el in req.elements.interactive:
            if keyword in el.text.lower():
                return el
        return None

    def _deterministic_reason(self, req: AgentActRequest) -> AgentAction:
        task = req.task.lower()

        for keyword in ("resolve", "escalate", "reply", "close"):
            if keyword in task:
                target = self._find_by_keyword(req, keyword)
                if target:
                    return AgentAction(
                        action="click",
                        target=ActionTarget(id=target.psId),
                        reason=(
                            f"Task asks to {keyword} the ticket; the control labeled "
                            f"'{target.text}' on the sanitized page matches this request."
                        ),
                        risk="high",
                    )

        return AgentAction(
            action="read",
            target=None,
            reason=(
                "No unambiguous matching control was found on the sanitized page for this "
                "task — returning a read-only response instead of guessing at a selector."
            ),
            risk="low",
        )


router = ModelRouter()
```

### FILE: server/main.py

```python
#!/usr/bin/env python3
"""
PraxSight — Server-side Reasoning + Structured Action API
SIH26171

This process receives ONLY sanitized, redacted context from the browser
extension's privacy gate (extension/background.js). It never sees raw PII
by design — see docs/PRIVACY_MODEL.md for the full data-flow diagram.
"""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from schemas import AgentAction, AgentActRequest
from validator import ValidationError, validate_action
from agent import router as model_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("praxsight")

BASE_DIR = Path(__file__).parent.parent
DEMO_DIR = BASE_DIR / "demo"

app = FastAPI(title="PraxSight Agent API", version="0.1.0", docs_url="/api/docs", redoc_url=None)

# Dev-only: unrestricted CORS so the unpacked extension can call in from any
# extension ID during development. Scope this to chrome-extension://<id> and
# drop the wildcard before shipping anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

if DEMO_DIR.exists():
    app.mount("/demo", StaticFiles(directory=str(DEMO_DIR), html=True), name="demo")


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "praxsight-agent-api", "version": "0.1.0"}


@app.post("/api/agent/act", response_model=AgentAction)
async def agent_act(req: AgentActRequest):
    # ── Server-side privacy gate: defense-in-depth pass #3 ──────────────────
    # Passes #1 and #2 already ran client-side (content-script.js's residual
    # scan, then background.js's gate check) before this request was even
    # sent. This is not redundant paranoia — a compromised or modified
    # extension build could skip its own checks, so the server independently
    # refuses to reason over a payload that doesn't declare sanitization.
    if not req.privacy_manifest.performed:
        raise HTTPException(400, "Payload does not declare a completed privacy scan — refusing to process.")

    log.info(
        "agent_act task=%r entities_detected=%d entities_redacted=%d page=%s",
        req.task,
        req.privacy_manifest.entities_detected,
        req.privacy_manifest.entities_redacted,
        req.page_url,
    )

    action = await model_router.reason(req)

    try:
        action = validate_action(action, req.elements)
    except ValidationError as e:
        log.warning("agent_act validation rejected action: %s", e)
        raise HTTPException(422, str(e))

    return action


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
```

### FILE: server/requirements.txt

```text
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
```

### FILE: server/schemas.py

```python
"""
PraxSight — API schemas (Phase 7: Structured Agent Action Protocol)

The server never accepts raw page content and never returns arbitrary code.
AgentActRequest is what the extension's privacy gate is allowed to send;
AgentAction is the *only* shape the server is allowed to return — see
validator.py for what's enforced on top of this.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class SanitizedInput(BaseModel):
    psId: str
    tag: str
    type: str = "text"
    label: str = ""
    value: str = ""
    bbox: Dict[str, float] = Field(default_factory=dict)


class SanitizedInteractive(BaseModel):
    psId: str
    tag: str
    role: str = "button"
    text: str = ""
    bbox: Dict[str, float] = Field(default_factory=dict)


class SanitizedTextNode(BaseModel):
    psId: str
    text: str = ""
    bbox: Dict[str, float] = Field(default_factory=dict)


class PrivacyManifest(BaseModel):
    performed: bool
    version: str
    detectors: List[str] = Field(default_factory=list)
    entities_detected: int = 0
    entities_redacted: int = 0
    by_type: Dict[str, int] = Field(default_factory=dict)
    generated_at: str


class ElementsPayload(BaseModel):
    inputs: List[SanitizedInput] = Field(default_factory=list)
    interactive: List[SanitizedInteractive] = Field(default_factory=list)


class AgentActRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=2000)
    page_url: str
    elements: ElementsPayload
    text_context: List[SanitizedTextNode] = Field(default_factory=list)
    privacy_manifest: PrivacyManifest


class ActionTarget(BaseModel):
    type: Literal["element_id"] = "element_id"
    id: str


ActionName = Literal["click", "focus", "scroll", "select", "navigate", "read", "wait", "type"]


class AgentAction(BaseModel):
    action: ActionName
    target: Optional[ActionTarget] = None
    value_policy: Optional[Literal["user-provided"]] = None
    reason: str
    risk: Literal["low", "medium", "high"] = "low"
    requires_approval: bool = False
    validated: bool = False
```

### FILE: server/validator.py

```python
"""
PraxSight — Command Validator (Phase 7/8)

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
    return action
```

### FILE: run.py

```python
#!/usr/bin/env python3
"""
PraxSight — One-Command Launcher
Starts the FastAPI backend (which also serves the demo pages) and prints
exactly what to do next to load the extension.
Usage: python run.py
"""
import sys
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).parent
sys.path.insert(0, str(BASE_DIR / "server"))

PORT = 8000
BACKEND_URL = f"http://localhost:{PORT}"
DEMO_URL = f"{BACKEND_URL}/demo/support-ticket/"


def print_banner():
    print()
    print("  +----------------------------------------------------+")
    print("  |   PraxSight  ·  SIH26171  ·  v0.1.0                 |")
    print("  +----------------------------------------------------+")
    print(f"  |  Backend API   -> {BACKEND_URL:<32} |")
    print(f"  |  API docs      -> {BACKEND_URL + '/api/docs':<32} |")
    print(f"  |  Demo page     -> {DEMO_URL:<32} |")
    print("  +----------------------------------------------------+")
    print()
    print("  Next: chrome://extensions -> Developer mode -> Load unpacked")
    print("  -> select the extension/ folder. Then open the demo page above")
    print("  and click the PraxSight toolbar icon.")
    print()


if __name__ == "__main__":
    print_banner()
    try:
        webbrowser.open(DEMO_URL)
    except Exception:
        pass

    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info", app_dir=str(BASE_DIR / "server"))
```

### FILE: demo/support-ticket/index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Orbitel Support Console — Ticket #48213</title>
<style>
  :root {
    --bg: #f4f6f8; --panel: #ffffff; --border: #d9e0e5; --ink: #1b2733;
    --muted: #5c6b78; --accent: #2f6fed; --danger: #d1453b; --warn: #c17d1f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, "Segoe UI", sans-serif; }
  header { background: #101825; color: #fff; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
  header .brand { font-weight: 700; letter-spacing: 0.02em; }
  header .synthetic-note { font-size: 11px; color: #93a4b8; }
  main { max-width: 780px; margin: 24px auto; padding: 0 16px 60px; display: flex; flex-direction: column; gap: 16px; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
  .panel h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .field-row { display: flex; gap: 12px; margin-bottom: 10px; }
  .field { flex: 1; }
  .field label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
  .field input, .field textarea {
    width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
    font-size: 13px; color: var(--ink); background: #fbfcfd;
  }
  .ticket-meta { display: flex; gap: 16px; font-size: 12px; color: var(--muted); margin-bottom: 10px; }
  .complaint { font-size: 13.5px; line-height: 1.6; color: var(--ink); background: #fbfcfd; border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .actions { display: flex; gap: 10px; margin-top: 14px; }
  button {
    font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 7px; cursor: pointer; border: 1px solid transparent;
  }
  #resolveBtn { background: var(--accent); color: #fff; }
  #escalateBtn { background: #fff; color: var(--danger); border-color: var(--danger); }
  #replyBtn { background: #fff; color: var(--ink); border-color: var(--border); }
  .status-line { margin-top: 10px; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>

<header>
  <span class="brand">Orbitel Support Console</span>
  <span class="synthetic-note">All customer data on this page is synthetic — built for the PraxSight SIH26171 demo, not a real person.</span>
</header>

<main>

  <section class="panel">
    <h2>Customer profile</h2>
    <div class="field-row">
      <div class="field">
        <label for="custName">Full name</label>
        <input id="custName" name="full_name" type="text" value="Aarav Menon" autocomplete="name" />
      </div>
      <div class="field">
        <label for="custEmail">Email</label>
        <input id="custEmail" name="email" type="email" value="aarav.menon@example-mail.com" autocomplete="email" />
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="custPhone">Phone</label>
        <input id="custPhone" name="phone" type="tel" value="9845123456" autocomplete="tel" />
      </div>
      <div class="field">
        <label for="custAccount">Account number</label>
        <input id="custAccount" name="account_number" type="text" value="30281147765" />
      </div>
    </div>
  </section>

  <section class="panel">
    <h2>Ticket #48213</h2>
    <div class="ticket-meta">
      <span>Opened 2 hours ago</span>
      <span>Priority: High</span>
      <span>Category: Billing</span>
    </div>
    <p class="complaint">
      Hi team, I was charged twice for my monthly plan this cycle. My card ending in
      the number below was billed on the 1st and again on the 3rd:
      <br /><br />
      4111 1111 1111 1111
      <br /><br />
      Please refund the duplicate charge. You can reach me at
      aarav.menon@example-mail.com or call +91 98451 23456 if you need anything else.
      For identity verification my PAN is ABCDE1234F.
    </p>
  </section>

  <section class="panel">
    <h2>Resolve</h2>
    <div class="field">
      <label for="agentNote">Internal note (optional)</label>
      <textarea id="agentNote" rows="3" placeholder="Add a note before resolving..."></textarea>
    </div>
    <div class="actions">
      <button id="resolveBtn" type="button">Resolve Ticket</button>
      <button id="escalateBtn" type="button">Escalate to Tier 2</button>
      <button id="replyBtn" type="button">Send Reply</button>
    </div>
    <p class="status-line" id="statusLine">No action taken yet.</p>
  </section>

</main>

<script>
  // Purely cosmetic feedback so the demo shows a visible state change when
  // PraxSight's agent (or a human) clicks one of these buttons — none of
  // this logic is part of the privacy/agent architecture being demonstrated.
  const statusLine = document.getElementById("statusLine");
  const wire = (id, label) =>
    document.getElementById(id).addEventListener("click", () => {
      statusLine.textContent = `${label} — clicked at ${new Date().toLocaleTimeString()}`;
    });
  wire("resolveBtn", "Ticket resolved");
  wire("escalateBtn", "Escalated to Tier 2");
  wire("replyBtn", "Reply sent");
</script>

</body>
</html>
```

### FILE: tests/test_pii_lib.cjs

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { luhnValid, detectInText, detectStructural, detect } = require(
  path.join(__dirname, "../extension/content/privacy/detectors.js")
);
const redaction = require(path.join(__dirname, "../extension/content/privacy/redaction.js"));
const policyEngine = require(path.join(__dirname, "../extension/content/privacy/policy-engine.js"));

test("luhnValid accepts a known-valid test card number", () => {
  assert.equal(luhnValid("4111 1111 1111 1111"), true);
});

test("luhnValid rejects a random 16-digit non-card number", () => {
  assert.equal(luhnValid("1234 5678 9012 3457"), false);
});

test("detectInText finds an email and a valid card number, ignores plain digits", () => {
  const text = "Contact aarav.menon@example-mail.com. Card: 4111 1111 1111 1111. Order id: 8839221";
  const found = detectInText(text, "ps_p_0", { x: 0, y: 0, width: 10, height: 10 });
  const types = found.map((d) => d.type);
  assert.ok(types.includes("email"));
  assert.ok(types.includes("card_number"));
  assert.equal(types.includes("random_digits"), false);
});

test("detectStructural flags a password field as critical regardless of label wording", () => {
  const found = detectStructural({ psId: "p1", type: "password", name: "pwd", autocomplete: "", label: "", value: "" });
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "password");
  assert.equal(found[0].severity, "critical");
});

test("detectStructural flags an account-number field from its label even with a generic input type", () => {
  const found = detectStructural({ psId: "p2", type: "text", name: "", autocomplete: "", label: "Account number", value: "30281147765" });
  assert.ok(found.some((d) => d.type === "account_number"));
});

test("detect() end-to-end over a perception object aggregates structural + text detections", async () => {
  const perception = {
    inputs: [
      { psId: "i1", type: "email", name: "email", autocomplete: "email", label: "Email", value: "a@b.com" },
    ],
    textNodes: [
      { psId: "t1", text: "Call me at aarav.menon@example-mail.com", bbox: {} },
    ],
  };
  const found = await detect(perception);
  assert.ok(found.length >= 2);
});

test("redaction assigns stable counter tokens per type and counterless tokens for critical classes", () => {
  const detections = [
    { type: "email", value: "a@b.com", confidence: 0.9 },
    { type: "email", value: "c@d.com", confidence: 0.9 },
    { type: "card_number", value: "4111111111111111", confidence: 0.95 },
  ];
  const map = redaction.buildTokenMap(detections);
  assert.equal(map.get("a@b.com"), "[EMAIL_1]");
  assert.equal(map.get("c@d.com"), "[EMAIL_2]");
  assert.equal(map.get("4111111111111111"), "[CARD_REDACTED]");
});

test("redactText replaces every occurrence of every mapped value", () => {
  const map = new Map([["a@b.com", "[EMAIL_1]"]]);
  const out = redaction.redactText("Reach a@b.com or a@b.com again", map);
  assert.equal(out, "Reach [EMAIL_1] or [EMAIL_1] again");
});

test("sanitizePerception never leaves a raw password value in the sanitized inputs", () => {
  const perception = {
    url: "https://x.test", title: "t", capturedAt: "now",
    inputs: [{ psId: "p1", tag: "input", type: "password", label: "Password", value: "hunter2", bbox: {} }],
    interactive: [], textNodes: [],
  };
  const detections = [{ type: "password", value: "hunter2", severity: "critical", action: "redact", confidence: 0.99 }];
  const sanitized = redaction.sanitizePerception(perception, detections);
  assert.equal(sanitized.inputs[0].value, "[PASSWORD_REDACTED]");
});

test("policy engine default policy redacts every severity except low", () => {
  const detections = [
    { type: "email", severity: "high", source: ["rules-text"] },
    { type: "unknown_future_type", severity: "unrecognized-severity", source: ["rules-text"] },
  ];
  const policed = policyEngine.applyPolicy(detections);
  // Fail-closed: an unrecognized severity must still default to redact.
  assert.equal(policed[1].action, "redact");
});

test("buildManifest reports counts consistent with the detections it was given", () => {
  const detections = [
    { type: "email", severity: "high", source: ["rules-text"], action: "redact" },
    { type: "person_name", severity: "low", source: ["rules-text"], action: "allow" },
  ];
  const manifest = policyEngine.buildManifest(detections, {});
  assert.equal(manifest.entities_detected, 2);
  assert.equal(manifest.entities_redacted, 1);
  assert.equal(manifest.performed, true);
});
```

### FILE: tests/test_validator.py

```python
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
```

### FILE: .gitignore

```text
# Python
__pycache__/
*.pyc
.venv/
venv/

# Node (none needed to run this repo, but just in case someone adds tooling)
node_modules/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
```

