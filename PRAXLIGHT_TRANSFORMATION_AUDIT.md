# PraxLight Transformation — Audit & Decision Record

**Status:** Audit complete. No application code changed. Awaiting decisions before Phase 2+.
**Trigger:** the attached "MASTER PROMPT — PRAXLIGHT SIH 2026 COMPLETE TRANSFORMATION"
**Convention:** this follows the same handoff style as `docs/HANDOFF_PHASE_1.md` / `docs/HANDOFF_PHASE_2.md` already in the repo.

The master prompt's own §39 Phase 1 says: *"Analyze repository completely... Do not modify code yet unless necessary for inspection."* This document is that audit. It is honest by the same standard the repo already holds itself to (`docs/CURRENT_IMPLEMENTATION.md`'s "nothing here gets described to judges as done when it isn't") — nothing below is claimed as built unless it already is.

---

## 1. Headline finding

The master prompt describes a **different product** from what this repo is today: a different SIH problem statement, a different name, and several features (local LLM inference, hardware detection, document RAG, OCR-based KYC) that don't exist in this codebase yet. Before touching code, three things need a decision because they change what "Phase 2" even means:

1. **Identity** — is the repo becoming **PraxLight** (new problem: "LLM-based tool for networks not connected to the internet"), or does **PraxSight** (SIH26171, browser privacy agent) stay the target, absorbing only the offline-capable ideas?
2. **Environment** — this sandbox **cannot run genuine local LLM inference** (details in §4). That caps what can actually be built-and-verified here versus what has to be built-for-your-machine.
3. **Process** — `docs/CURRENT_PHASE.md` is explicit: *"Phase 2 — COMPLETE. Awaiting instruction... do not start Phase 3 automatically."* The master prompt's 11-phase plan is a far bigger unit of work than any single phase run so far. Recommend keeping that same one-phase-at-a-time discipline rather than attempting all 11 phases in one pass.

---

## 2. What this repo verifiably is today

Per its own already-run audits (`docs/HANDOFF_PHASE_1.md`, `docs/HANDOFF_PHASE_2.md`, `docs/TEST_STATUS.md` — real command output, not re-run independently in this pass since the repo wasn't provided as a live checkout here, only as file contents):

| Layer | File(s) | Real? |
|---|---|---|
| DOM/text perception | `extension/content/perception.js` | Yes — 13 jsdom tests passing |
| Rules-based PII detection | `extension/content/privacy/detectors.js` | Yes — pure functions, no DOM dependency, 11 Node tests passing |
| Redaction / policy engine | `redaction.js`, `policy-engine.js` | Yes — fail-closed default, tested |
| Structured action protocol + validator | `server/schemas.py`, `server/validator.py` | Yes — 6 pytest cases passing |
| Model router | `server/agent.py` | Yes, but: OpenRouter + Google AI + a deterministic keyword-matching fallback. **No local-runtime (Ollama) adapter exists.** |
| Human approval gate | popup + validator's `requires_approval` | Yes |
| Dashboard / Network Guard | `dashboard/*`, `extension/background.js` | Yes, scoped to the extension's own `fetch()` calls |
| Vision/OCR | — | **Does not exist.** `docs/CURRENT_IMPLEMENTATION.md` states this outright. |
| RAG / document retrieval | — | **Does not exist.** No ingestion, chunking, embedding, or vector store anywhere in the repo. |
| Hardware-aware routing | — | **Does not exist.** |

---

## 3. Master prompt vs. reality, section by section

| Master prompt ask | Current state |
|---|---|
| §6 Local AI Engine (Ollama, model detection) | Not present. `agent.py`'s adapter pattern is the right shape to extend, but no Ollama adapter exists. |
| §7 Hardware-aware model routing | Not present. |
| §9–10 Connectivity states / zero-network proof | Analogous in spirit to the Network Guard log, but that only logs the extension's *own* requests — there's no OS-level connectivity monitor. |
| §11–12 Safe-Context Engine | **Largely already exists.** `detectors.js` + `redaction.js` + `policy-engine.js` are pure, DOM-free functions by design (see `detectors.js`'s own docstring: "no dependency on `window`/DOM"). This is the strongest reuse candidate in the whole repo. |
| §13–14 Local RAG + knowledge workspace | Not present at all. |
| §15 Multimodal/OCR | Not present — explicitly documented as out of scope so far. |
| §16–17 Controlled agent + human approval | Partially exists. `validator.py` + the popup's approve/reject flow is a real, tested "propose → validate → approve → execute" loop — but scoped to clicking elements on a webpage, not general tool-calling (file reader, calculator, doc search). |
| §18–19 Demos | `support-ticket` and `banking` are static, script-wired mockups — not backed by any offline/RAG feature described in the master prompt. |
| §20 Audit log | Partially exists (`.praxsight-session.json`, Network Guard) but scoped to extension network events, not a general AI decision trail (model used, docs retrieved, validation result). |
| §22 Model abstraction | Already the actual shape of `agent.py` — good foundation to add an Ollama branch to. |
| §23–24 UI redesign | Dashboard shell + `shared/design-tokens.css` are real and reusable for a restyle. |

---

## 4. What this sandbox can and can't actually do

This matters because building something here that can't be verified here would violate the master prompt's own §29 ("No fake features" / "do not claim a capability that doesn't actually work").

- **Network egress is allowlisted to package registries only**: pypi, npm, crates, `github.com`/`codeload.github.com`/`release-assets.githubusercontent.com`, Ubuntu archives. There is **no route to `ollama.ai`'s model registry or `huggingface.co`**.
- The Ollama *binary* is distributed via GitHub Releases, which is reachable — but with no path to pull model weights, nothing would actually run after installing it.
- No GPU exists in this container, so any "hardware-aware router" built and tested here would be routing against sandbox specs, not your real demo machine.
- Long-running background server processes were already flagged as flaky in this exact sandbox (`docs/TEST_STATUS.md`'s "Sandbox note") — a foreground-only pattern would be needed again.

**Net effect:** code that doesn't require an actual model call — the privacy/safe-context pipeline, schemas, validators, RAG chunking/retrieval logic against a stub embedding interface, the agent tool-permission framework, UI — can be written and unit-tested here. The "internet disabled, local inference still answers" moment, real hardware detection, and real document embeddings have to be run and captured on your machine, where Ollama is actually installed.

---

## 5. Decision: how to scope the pivot

| Option | What it means | Trade-off |
|---|---|---|
| **A — Full pivot now** | Rename to PraxLight, retarget SIH problem statement, build the offline-workbench skeleton here (portable pieces only), hand off Ollama/hardware/real-RAG wiring as "run this locally" steps. | Fastest path to the new vision; risks destabilizing the already-working, already-tested PraxSight browser-agent demo before it's clear the new direction is final. |
| **B — Backport ideas, keep identity** | Keep PraxSight/SIH26171 as the target; take only the offline-capable *ideas* (safe-context framing, provider-abstraction pattern) into the existing architecture. | Preserves everything already verified; doesn't deliver the "offline AI workbench" product the master prompt actually asks for. |
| **C — Parallel module** | Build the new offline-workbench pieces in a new area of the repo that *imports* PraxSight's privacy/validator code as a library, so neither demo destabilizes the other before judging. | More scaffolding work upfront; safest for a live SIH deadline since the working demo stays working throughout. |

I don't have enough signal from the conversation to pick one of these for you — it changes the README, the SIH alignment doc, and which demo you'd actually walk a judge through, so it's worth a deliberate answer rather than a default.

---

## 6. If we proceed: re-scoped phase plan

Mapping the master prompt's §39 phases onto what's realistic, with what can happen in this sandbox vs. what needs your machine:

| Phase | Sandbox-doable here | Needs your machine |
|---|---|---|
| 2 — Core offline engine | Provider-adapter code (`OllamaAdapter` class matching `agent.py`'s existing pattern), config/env wiring | Actually calling `ollama serve` + a pulled model |
| 3 — Local RAG | Ingestion/chunking/retrieval logic against a swappable embedding interface, tested with a stub embedder | Real embedding model download + real vector search latency |
| 4 — Privacy/Safe-Context engine | Nearly done already — mostly a porting/renaming exercise from the extension's `detectors.js`/`redaction.js` into a shared or backend-callable form | — |
| 5 — Agent engine (tool permissions) | Schema + permission-checking logic, extending `validator.py`'s pattern | — |
| 6 — Offline monitor | UI + log-shape design | Real "internet disabled" proof, which requires an actual network toggle on a real machine |
| 7 — Hardware-aware router | Router logic + heuristics | Real RAM/GPU detection on your machine |
| 8 — Multimodal/OCR | Pipeline shape + interface | An actual local OCR engine run |
| 9 — UI/UX | Fully doable here | — |
| 10 — Demo | Script/data doable here | The actual disconnected-internet recording |
| 11 — Testing | Unit tests for everything above doable here | End-to-end/offline verification |

---

## 7. What I need from you before starting Phase 2

1. Which identity/scope option (§5: A, B, or C)?
2. For the pieces that need your machine (Ollama, real embeddings, hardware detection, OCR) — do you want me to write the integration code now for you to run locally, or hold off until the scope/identity question is settled?
3. Where should actual coding start?
