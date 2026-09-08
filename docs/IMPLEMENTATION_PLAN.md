# PraxSight — Implementation Plan (20 phases)

Source: the "PHASE 1 → PHASE 20 MASTER IMPLEMENTATION PROMPT" supplied for
this repository. This file is the tracked, living status of that plan
against `Panda-224k/PraxSlight`. One phase is implemented at a time; this
file is updated at the end of each phase and re-read at the start of the
next one, per the plan's own "context/credit control" rules.

Status values: `NOT STARTED` · `IN PROGRESS` · `COMPLETE` · `BLOCKED`

| Phase | Title | Status | Notes |
|---|---|---|---|
| 1 | Baseline + architecture hardening | **COMPLETE** | This audit. See `docs/HANDOFF_PHASE_1.md`. No code changed — audit only, per the phase's own acceptance criteria. |
| 2 | DOM perception hardening | **COMPLETE** | `perception.js` extended with disabled/required/checked, ARIA metadata, form association, `inViewport`, same-origin iframe perception, open-shadow-root traversal. 13 new jsdom tests. See `docs/HANDOFF_PHASE_2.md`. |
| 3 | Local OCR pipeline | NOT STARTED | No `extension/content/ocr/` directory exists yet. |
| 4 | Actual on-device vision | NOT STARTED | No `extension/content/vision/` directory exists yet. Highest-effort, highest-risk phase per the plan's own framing. |
| 5 | Perception fusion engine | NOT STARTED | Depends on Phases 3–4 existing first; nothing to fuse yet beyond DOM+regex, which already happens inline in `detectors.js`. |
| 6 | Advanced PII/sensitive-data detection | NOT STARTED | Current `detectors.js` covers identity/financial/auth/gov-ID categories at rules-only precision. No NER, no vision-based face/document detection. |
| 7 | Visual + text redaction engine | NOT STARTED | `redaction.js` is text-token-only; no blur/pixelate/mask primitives exist since there's no visual capture to redact yet. |
| 8 | Privacy policy engine 2.0 | NOT STARTED | Current `policy-engine.js` is a flat severity→action map, no per-domain policy, no confidence threshold config. |
| 9 | Hard privacy gate 2.0 (payload hash) | NOT STARTED | Manifest checks exist and are verified working (Phase 1 audit); no canonical-serialization + SHA-256 payload hash yet. |
| 10 | Actual AI model reasoning | NOT STARTED | `agent.py` is a deterministic keyword router by design, documented honestly as such. No real LLM/VLM adapter wired in. |
| 11 | Structured agent planner (multi-step) | NOT STARTED | Current schema is single-action-per-request; no multi-step plan object. |
| 12 | Action execution hardening | PARTIAL | Allowed-action allowlist and target-existence checks already exist and are tested (`validator.py`); `type` already refuses without `value_policy=user-provided`. No new work done this audit. |
| 13 | Observe → verify → replan loop | NOT STARTED | Current execution treats a successful DOM `.click()` as done; no post-action state verification. |
| 14 | Human approval + risk engine | PARTIAL | Approval exists and is policy-driven for `risk=="high"`, but still falls back to reason-text keyword matching as a second trigger — the plan asks for this to move to explicit action risk metadata only. |
| 15 | Performance/resource instrumentation | NOT STARTED | Only per-request `latencyMs` in the Network Guard log exists; no aggregated breakdown, no memory/CPU/WebGPU indicators. |
| 16 | Adaptive perception + ROI optimization | NOT STARTED | No mutation observers, caching, or debouncing exist; every scan re-walks the whole DOM. |
| 17 | Evaluation dataset + benchmark | NOT STARTED | Only one demo page exists; no labeled ground-truth dataset. |
| 18 | SIH metric evaluation + ablation | NOT STARTED | No precision/recall report exists; unit tests check specific known inputs, not a labeled corpus. |
| 19 | Security + privacy attack testing | NOT STARTED | No adversarial test suite (prompt injection, forged manifests, malformed hashes) exists yet beyond the "missing manifest → 400" happy-path-adjacent test. |
| 20 | Final SIH mode + production demo | NOT STARTED | Popup UI is the Phase-1-era version documented in the original build, not the expanded live-metrics dashboard this phase describes. |

## Sequencing notes for whoever runs Phase 2+

- Phases 3 (OCR) and 4 (vision) are independent of each other but Phase 5
  (fusion) needs both to exist to be meaningful — don't build fusion against
  only one of them and call it done.
- Phase 9's payload hash is a natural follow-on to Phase 1's baseline since
  it touches the same three files (`content-script.js`, `background.js`,
  `server/main.py`) already covered in this audit — a reasonable Phase 2
  candidate if the next session wants a small, safe, well-scoped unit
  instead of jumping straight to OCR/vision.
- Phase 10 (real model reasoning) should keep the deterministic fallback
  intact — the plan is explicit about this, and it's also what makes the
  flagship demo reproducible without API keys. Don't let a real adapter
  become the only path.
- Phase 15 (instrumentation) will be much cheaper to do accurately if it's
  done before Phases 3/4/5 add OCR and vision latency to measure — consider
  pulling it earlier than its numeric position if that's an option.
