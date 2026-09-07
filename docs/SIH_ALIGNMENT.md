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