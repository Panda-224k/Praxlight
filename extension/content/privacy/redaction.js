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
