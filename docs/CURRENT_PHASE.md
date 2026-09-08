# PraxSight — Current Phase

**Active phase: Phase 2 — COMPLETE. Awaiting instruction to start Phase 3.**

Per the project's own rules: do not start Phase 3 automatically. Wait for an
explicit "continue" / "next phase" instruction.

## What just happened (Phase 2)

- Hardened `extension/content/perception.js`: disabled/required/checked
  state, ARIA metadata, nearest-form association, `inViewport`, same-origin
  iframe perception (one level deep), open-shadow-root traversal, and a
  real cross-document `isVisible` bugfix. Every Phase-1-era field kept its
  exact name and meaning — purely additive.
- Added `tests/test_perception.cjs` — 13 new jsdom-backed tests. One test
  failure surfaced a real bug in the *test fixture itself* (an unpatched
  iframe-realm `getBoundingClientRect`), fixed properly.
- Declared `jsdom` as a dev-only dependency in a new root `package.json` —
  the extension and backend still ship with zero npm/pip surprises.
- Re-ran all pre-existing tests (11 JS + 6 Python) — unchanged, still
  passing, confirming no regression from the additive schema change.
- Updated `docs/ARCHITECTURE.md` with the full current perception schema
  and `README.md`'s test instructions.

## What Phase 3 will be, when started

**Phase 3 — Local OCR pipeline** (new `extension/content/ocr/` directory):
evaluate a browser-compatible OCR engine (e.g. Tesseract.js) for bundle
size and latency before committing, output `{text, bbox, confidence,
source: "ocr"}` shaped detections, integrate with the existing perception
representation, never send raw screenshots to the server. This is a bigger,
riskier phase than Phase 2 — budget for it accordingly and don't rush
straight into Phase 4 (vision) in the same pass.

## Read this before touching anything

1. `docs/PROJECT_STATE.md` — what's actually true right now
2. `docs/IMPLEMENTATION_PLAN.md` — full 20-phase table + status
3. `docs/HANDOFF_PHASE_2.md` — detailed handoff for this phase
4. `docs/TEST_STATUS.md` — exact commands + exact results
