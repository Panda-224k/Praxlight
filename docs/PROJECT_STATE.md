# PraxLight â€” Project State

**Last verified:** Phase 2 (DOM perception hardening), against
`Panda-224k/PraxSlight` after the Phase 1 doc-corruption fix.

This file is regenerated/updated at the end of every phase. It reflects what
was actually run, not what was intended.

## Repository identity

- Remote: `https://github.com/Panda-224k/PraxSlight`
- Base commit at Phase 1: `f4ffc1a Initial PraxSight source import`
- Phase 1 delivered as `PraxSlight-phase1-updates.zip` (5 restored docs + 5
  new project-state docs) for the user to commit â€” this audit assumes that
  landed; if `git log` on the live repo doesn't show it yet, treat
  Phase 1's fixes as pending, not done.

## Runtime requirements (as actually exercised)

| Tool | Version used in this audit |
|---|---|
| Node | v22.22.2 |
| Python | 3.12.3 |
| fastapi | 0.115.0 |
| uvicorn[standard] | 0.30.6 |
| pydantic | 2.9.2 |
| pytest | 9.1.1 (dev/test only) |
| jsdom | 30.0.1 (dev/test only â€” **new in Phase 2**, declared in `package.json`, needed only to run `tests/test_perception.cjs`) |
| httpx | installed ad hoc for Phase 1's `TestClient` checks; not a runtime dep |

Chrome/Firefox: **still not exercised.** jsdom lets perception.js's *logic*
be tested without a browser, but it is not a substitute for actually
loading the extension in Chrome â€” see `TEST_STATUS.md`.

## Bug found and fixed this audit: 5 doc files were silently truncated

`README.md`, `docs/ARCHITECTURE.md`, `docs/AGENT_PROTOCOL.md`,
`docs/DEMO_GUIDE.md`, and `docs/PRIVACY_MODEL.md` were truncated at
materialization time â€” anywhere from 2% to 88% of their intended content
survived, with no error surfaced anywhere. Root cause: the consolidated
`PRAXSIGHT_FULL_SOURCE.md` used triple-backtick fences to wrap every file,
and these five files each contain their own internal triple-backtick code
blocks, which prematurely closed the wrapper fence during extraction. The
two docs with zero internal code fences (`SIH_ALIGNMENT.md`,
`CURRENT_IMPLEMENTATION.md`) were unaffected â€” that's not a coincidence,
it's the actual discriminator. All application code (`extension/`,
`server/`, `tests/`, `demo/`) was unaffected beyond a harmless dropped
trailing newline per file.

**Status: fixed in this checkout.** All 5 files restored to complete
content; the consolidated source file regenerated with a 4-backtick outer
fence (verified collision-free against this file set) so this can't recur.
Full detail in `docs/HANDOFF_PHASE_1.md`.

## Phase 2 update: DOM perception hardening â€” COMPLETE

`extension/content/perception.js` was extended (not replaced â€” every field
that existed before Phase 2 still exists, unchanged) with:

- `disabled` / `required` / `checked` on form fields, `disabled` (including
  `aria-disabled`) on interactive controls
- an `aria` metadata bag (`ariaLabel`, resolved `ariaDescribedBy` text,
  `ariaRequired`/`ariaInvalid`/`ariaExpanded`/`ariaPressed`/`ariaChecked`)
- `formId` â€” nearest containing `<form>`, resolved via the native `.form`
  property so `form="..."` attribute associations work, not just DOM nesting
- `inViewport` â€” deliberately distinct from the existing CSS-visibility
  `isVisible` check; an element can be `display:block` and still be
  scrolled off-screen
- top-level `schemaVersion`, `viewport` (width/height/scroll position), and
  `shadowHostCount` on `capturePage()`'s result
- same-origin iframe perception, one level deep (`extractIframes`) â€”
  cross-origin iframes correctly report `sameOrigin:false` with an
  explanatory note rather than silently returning nothing
- open shadow-root traversal (`collectAllRoots`) for inputs, interactive
  elements, and text â€” closed shadow roots remain genuinely invisible to
  any script by browser design, documented as a platform limit, not papered
  over
- a real bugfix: `isVisible` now resolves computed style via the element's
  *own* window (`el.ownerDocument.defaultView`) rather than always the
  top-level window â€” matters once same-origin iframe content is perceived

**New test file**: `tests/test_perception.cjs`, 13 tests, using jsdom
(declared in the new root `package.json` as a dev-only dependency â€” the
extension and backend themselves still have zero npm dependencies). One
test initially failed for a legitimate reason (the test fixture hadn't
patched `getBoundingClientRect` on the iframe's own separate window realm)
and was fixed properly, not skipped or loosened.

All 11 pre-existing `tests/test_pii_lib.cjs` tests and all 6
`tests/test_validator.py` tests were re-run after this change and still
pass unchanged â€” confirms the additive schema changes didn't disturb
`detectors.js`/`redaction.js`'s consumption of perception's output.

**Known limitation carried forward, not fixed this phase**: the new fields
(`disabled`, `aria`, `formId`, `inViewport`) are not yet threaded through
`redaction.js`'s `sanitizePerception` into what the server/agent actually
sees â€” it still whitelists a fixed field set. An agent that could see
`disabled:true` before proposing a click would be strictly better, but that
touches Phase 7 (redaction) and Phase 11 (planner) territory, out of scope
for a perception-only phase.

## Architecture (confirmed present, matches `docs/ARCHITECTURE.md`)

```
extension/content/perception.js          DOM + text extraction, plain-data output
extension/content/privacy/detectors.js   rules backend (structural + regex/Luhn)
extension/content/privacy/model-backends.js  Gemini Nano / Transformers.js STUBS (detect() -> [])
extension/content/privacy/policy-engine.js   severity -> action, builds privacy_manifest
extension/content/privacy/redaction.js       semantic token redaction
extension/content/content-script.js      orchestrates scan, residual PII re-scan, executes actions
extension/background.js                  the only fetch() in the extension (hard gate)
extension/popup/*                        Privacy Firewall / trace / approval / network guard UI

server/schemas.py                        AgentActRequest / AgentAction Pydantic models
server/validator.py                      psId-existence check, disabled commands, forces approval
server/agent.py                          deterministic keyword-matching router (NOT a real LLM/VLM)
server/main.py                           FastAPI app, server-side manifest re-check, serves /demo

demo/support-ticket/index.html           single flagship demo page, synthetic PII
tests/test_pii_lib.cjs                   11 Node tests over detectors/redaction/policy
tests/test_validator.py                  6 pytest tests over the action validator
```

Three independent fail-closed checks between page and network, as designed:
client residual scan â†’ background manifest+residual gate â†’ server manifest
check. Confirmed working end to end in this audit (see `TEST_STATUS.md`).

## Working features (verified this audit, not assumed)

- DOM/text perception producing plain-data objects (`perception.js`) â€”
  **as of Phase 2, this is now covered by 13 passing jsdom-backed unit
  tests** exercising disabled/required/checked state, ARIA metadata, form
  association, viewport geometry, shadow-DOM traversal, and same-origin vs.
  cross-origin iframe handling. Still not exercised against a real page in
  a real browser (jsdom is not a browser) â€” see `TEST_STATUS.md`.
- Rules-based detection: structural signals + regex + Luhn-checked card
  numbers (`detectors.js`) â€” 11/11 unit tests pass against the actual
  repository file.
- Semantic redaction with counted vs. counterless tokens (`redaction.js`) â€”
  covered by the same test file, passing.
- Policy engine defaulting unrecognized severities to `redact`
  (`policy-engine.js`) â€” covered by a dedicated fail-closed test, passing.
- Structured action schema + validator: unknown `psId` rejected, `navigate`
  disabled, `type` requires `value_policy=user-provided`, high-risk/
  irreversible-sounding reasons force `requires_approval` â€” 6/6 pytest
  tests pass against the actual repository file.
- FastAPI backend: `/api/health`, `/demo/*` static mount, and
  `/api/agent/act` all verified live in this audit via `TestClient` (see
  `TEST_STATUS.md` for the exact request/response pairs) â€” a valid
  sanitized payload correctly returns a validated, approval-required click
  action; a payload with `privacy_manifest.performed=false` correctly
  returns HTTP 400; a task with no matching control correctly falls back to
  a non-approval `read` action instead of guessing a target.
- `extension/manifest.json` is valid JSON; all 8 extension `.js` files
  parse without a syntax error; all 4 server `.py` files compile.

## Known gaps / NOT implemented (per `docs/CURRENT_IMPLEMENTATION.md`, reconfirmed this audit)

- No screenshot capture, OCR, or vision model anywhere in the codebase â€”
  `perception.js` is DOM/text only. This is the single largest gap against
  the SIH26171 problem statement's "visual perception" framing.
- `model-backends.js`'s `detect()` returns `[]` unconditionally for both the
  Gemini Nano and Transformers.js adapters â€” real interfaces, no live model.
- `server/agent.py` is a deterministic keyword matcher against interactive
  element text, not an LLM/VLM call. It is explicitly documented as such in
  its own docstring and in `CURRENT_IMPLEMENTATION.md` â€” no mislabeling
  found in this audit.
- No payload hashing/integrity check between the manifest and the actual
  sanitized payload (Phase 9 in the 20-phase plan calls this out explicitly).
- No performance instrumentation beyond the per-request `latencyMs` already
  captured in the extension's Network Guard log; no aggregated
  perception/privacy/reasoning latency breakdown.
- No labeled benchmark dataset, no precision/recall report, no ablation
  study, no client resource (memory/CPU) metrics.
- No independent (out-of-extension) transmission proof â€” the Network Guard
  log is produced by the same extension whose claims it checks. Documented
  as a known limitation in `ARCHITECTURE.md` already; not fixed in this
  audit.
- Firefox: untested, not just "unlikely to work" â€” genuinely never opened
  in Firefox at any point in this project's history to date.
- Only one demo page exists (`support-ticket`). This is a deliberate,
  documented scope decision, not an oversight.

## Baseline latency (honest caveat)

Measured via FastAPI's `TestClient` (in-process, no real network/socket
overhead â€” this is a lower bound, not a real end-to-end network latency
number):

| Request | Latency |
|---|---|
| `GET /api/health` | 14.0 ms (includes app first-call overhead) |
| `POST /api/agent/act` (valid payload, click action) | 3.8 ms |

Real browser-extension â†’ localhost network latency was not separately
measured in this audit due to sandbox networking constraints (see
`TEST_STATUS.md`). Do not quote the numbers above as "network latency" â€”
they are reasoning+validation compute time only.

