# PraxLight — Judge Q&A Reference

**Problem Statement:** SIH26171 — "On-device Visual Perception for Light-weight Browser Agents"
**Sponsor:** ISRO (Indian Space Research Organisation)
**Version:** 0.2.0

---

## Technical Architecture Questions

**Q: How is this different from a PII blocker like uBlock Origin?**
A: uBlock blocks page content from loading entirely. PraxLight allows page content to load normally, extracts its structure into a data representation, detects sensitive entities in that representation, redacts them to semantic tokens anchored to specific DOM elements, and then enables a structured AI agent to propose actions on the sanitized page. The agent can resolve tickets, escalate cases, reply to customers — it just cannot see raw PII to do so.

**Q: Why DOM-based perception instead of screenshots?**
A: Screenshots send everything the user sees — card numbers, passwords, government IDs — to a cloud API in a single JPEG. The DOM perception layer produces an inert data object (plain JSON): inputs with their psId/tag/label/value, interactive elements with their text, visible text nodes. PII is detected and redacted in this object before any AI model sees it. Screenshots make redaction after-the-fact and unreliable.

**Q: Can't the extension lie about the manifest?**
A: Yes — this is documented honestly in ARCHITECTURE.md. It's the extension checking its own homework. The fix (an independent network monitor process using Netfilter/WFP) is a named roadmap item. We present three independent checks as defense-in-depth: residual scan in the content script, manifest verification in background.js, and schema + manifest validation in validator.py. None of them trust each other.

**Q: What stops the agent from clicking Delete Account?**
A: validator.py forces requires_approval=True on any action with risk=high, plus any action whose reason text contains irreversible keywords. The popup blocks execution until a human explicitly clicks Approve. The navigate action is disabled entirely in the validator regardless of risk level.

**Q: Why is the server reasoning deterministic offline? Isn't that just regex?**
A: The deterministic router is the fail-safe offline fallback — zero API keys, zero network egress, fully reproducible for judging. The OpenRouter path (Mistral-7B-Instruct:free) is wired and active when the server is running live. Check /api/health for the active backend. Whatever backend answers, it sees only the pre-sanitized AgentActRequest — never raw page content.

**Q: What is psId and why does it matter?**
A: psId is a stable DOM element identifier assigned by perception.js during the scan. Every input, interactive element, and text node gets a unique psId. When the AI agent proposes a click action, it must provide a psId. The command validator (validator.py) checks that the provided psId exists in the elements list the server was given. This structurally prevents the model from hallucinating a DOM selector or targeting an element it was not shown.

---

## Privacy Gate Questions

**Q: Does any raw PII leave the browser?**
A: By design, no. Three independent gates enforce this:
  - Gate 1 (content-script.js): residual scan after redaction; if any raw detected entity survives, returns blocked manifest.
  - Gate 2 (background.js): reads the manifest from the request, checks entities_detected <= entities_redacted, blocks fetch if not.
  - Gate 3 (validator.py): checks privacy_manifest.performed == True and entities_detected - entities_redacted == 0, rejects 403 otherwise.

**Q: Why three gates instead of one?**
A: Defense-in-depth. Any single gate can have a bug. Gate 1 runs in the page context where JS errors could be caught or suppressed. Gate 2 runs in the isolated service worker context. Gate 3 runs in the server which has no access to the raw page at all. A compromise of gate 1 still hits gates 2 and 3.

**Q: What PII types are detected?**
A: Credit/debit card numbers (Luhn-validated), email addresses, Indian mobile numbers, Indian PAN cards, Aadhaar (structural, not stored), passwords (structural detection via input type=password), government IDs (label-based structural signals), account numbers (structural), SSN, Biometric fields (structural). See detectors.js for the full list.

---

## Demo Questions

**Q: What if the internet is down during the demo?**
A: The deterministic offline fallback activates automatically. The three-layer privacy gate, PII detection, semantic redaction, and human approval gate all work with zero network. The only thing that changes is the agent produces keyword-matched actions instead of LLM-reasoned ones.

**Q: How do I reset between demo runs?**
A: Click the "Reset Demo" button in the top right of the dashboard. This calls /api/demo/reset which clears the session state. Then click "Reset Demo" in the extension popup if visible.

**Q: Where are the real numbers in the Network Guard log?**
A: The Network Guard log is populated by background.js writing to chrome.storage.local on every fetch decision. It shows: timestamp, endpoint, gate status (ALLOWED/BLOCKED/ERROR), payload size in bytes, and latency. These are not counters — they are real event log entries.

---

## SIH Requirement Coverage

| Requirement | PraxLight Coverage |
|---|---|
| On-device processing | Full — extension runs entirely local, no network from content-script.js |
| Lightweight ML for page reading | Partial — rules engine (no model weights). Gemini Nano adapter in model-backends.js is wired but not active. |
| PII detected locally | Full — 11 unit-tested detector rules covering 10+ entity types |
| Sensitive data not sent to server | Full — 3-layer fail-closed gate, unit and integration tested |
| Hybrid architecture | Full — local detection + server reasoning on sanitized context |
| Only non-sensitive data to server | Full — semantic token redaction, residual scan, manifest enforcement |
| WebGPU / WASM / ONNX / Transformers.js | Not built — roadmap in model-backends.js |
| Visual perception (screenshot/OCR) | Not built — explicitly documented, not claimed |
| Human-in-the-loop | Full — approval gate in popup, irreversible action detection in validator |
| Measurable accuracy | Partial — 24 unit tests, no labeled benchmark dataset |

**Honest coverage: ~65% of requirements implemented, 35% roadmap-documented.**
