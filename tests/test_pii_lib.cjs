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