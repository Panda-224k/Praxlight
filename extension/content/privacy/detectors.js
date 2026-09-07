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