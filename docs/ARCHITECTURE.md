# PraxSight — Architecture

## Component map

| Component | File(s) | Responsibility |
|---|---|---|
| DOM perception | `extension/content/perception.js` | Extracts inputs, interactive controls, and visible text into plain-data objects. No PII judgment happens here. **Hardened in Phase 2**: disabled/required/checked state, ARIA metadata, nearest-form association, `inViewport` (distinct from CSS visibility), same-origin iframe perception one level deep, and open-shadow-root traversal. See `docs/PROJECT_STATE.md` for the full field list and what's still out of scope (closed shadow roots — architecturally invisible to any script, not a gap in this code). |
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

## Perception schema (as of Phase 2)

`perception.capturePage()` returns (fields present since Phase 1 in **bold**,
Phase 2 additions plain):

```
{
  schemaVersion: "0.2.0",
  url, title, capturedAt,
  viewport: { width, height, scrollX, scrollY },
  shadowHostCount,
  inputs: [{ **psId, tag, type, name, autocomplete, label, value, bbox**,
              disabled, required, checked, formId, aria, inViewport }],
  interactive: [{ **psId, tag, role, text, bbox**,
                   disabled, aria, inViewport }],
  textNodes: [{ **psId, bbox, text** }],
  iframes: [{ psId, src, bbox, visible, sameOrigin, perceived, note }]
}
```

Every bolded field keeps its exact original name and meaning — `detectors.js`,
`redaction.js`, and the pre-existing test suite all consume these fields and
were re-run unchanged after the Phase 2 hardening to confirm nothing broke.
The new fields are not yet threaded through `redaction.js`'s
`sanitizePerception` into what the server sees (it still whitelists a fixed
field set per element) — that's a natural follow-up (e.g. so an agent can
avoid proposing a click on a `disabled` button) but wasn't required by Phase
2's own scope, which was perception.js's output, not the full pipeline.

`iframes[].perceived` (when `sameOrigin` is true) has the same
`{inputs, interactive, textNodes}` shape one level deep — nested iframes
inside that iframe are not further recursed into, to bound cost.

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
