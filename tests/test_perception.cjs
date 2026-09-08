/**
 * Tests for extension/content/perception.js using jsdom.
 *
 * jsdom does not perform real layout, so Element.prototype.getBoundingClientRect
 * always returns an all-zero rect by default. This is patched per-test to
 * return controlled, non-zero geometry — a standard, well-understood pattern
 * for testing DOM-geometry-dependent code under jsdom (see e.g. testing-library's
 * own docs on this exact limitation). Nothing here fakes perception.js's own
 * logic — only the browser layout engine jsdom doesn't implement.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const PERCEPTION_PATH = path.join(__dirname, "../extension/content/perception.js");

function rect(x, y, width, height) {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} };
}

// Loads a fresh copy of perception.js against a fresh jsdom document.
// Fresh require() each time so the module's internal `idCounter` closure
// resets, and fresh globals each time so tests can't leak DOM state into
// each other.
function loadPerception(html, { viewport = { width: 1024, height: 768 } } = {}) {
  const dom = new JSDOM(html, { url: "https://example.test/page", pretendToBeVisual: true });
  const { window } = dom;

  // Default: every element reports itself as a reasonably-sized, on-screen
  // box. Individual tests override specific elements' own
  // getBoundingClientRect to test hidden/off-screen/zero-size cases.
  window.Element.prototype.getBoundingClientRect = function () {
    return rect(0, 0, 100, 20);
  };
  Object.defineProperty(window, "innerWidth", { value: viewport.width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: viewport.height, configurable: true });

  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.NodeFilter = window.NodeFilter;

  delete require.cache[require.resolve(PERCEPTION_PATH)];
  const perception = require(PERCEPTION_PATH);
  return { perception, dom, window, document: window.document };
}

test("extractInputs captures disabled, required, and checkbox checked state", () => {
  const { perception, document } = loadPerception(`
    <form id="signup">
      <input id="email" type="email" autocomplete="email" required />
      <input id="promo" type="checkbox" checked />
      <input id="locked" type="text" disabled />
    </form>
  `);
  const inputs = perception.extractInputs(document);
  const byId = Object.fromEntries(inputs.map((i) => [i.name || i.psId, i]));

  const email = inputs.find((i) => i.type === "email");
  assert.equal(email.required, true);
  assert.equal(email.disabled, false);

  const promo = inputs.find((i) => i.type === "checkbox");
  assert.equal(promo.checked, true);

  const locked = inputs.find((i) => i.psId && document.getElementById("locked").dataset.praxsightId === i.psId);
  assert.equal(locked.disabled, true);
});

test("extractInputs resolves the nearest form id via the native .form property", () => {
  const { perception, document } = loadPerception(`
    <form id="checkout"></form>
    <input id="cardNumber" form="checkout" type="text" />
  `);
  const inputs = perception.extractInputs(document);
  const card = inputs.find((i) => document.getElementById("cardNumber").dataset.praxsightId === i.psId);
  assert.equal(card.formId, "checkout");
});

test("extractInputs never reads a password field's value", () => {
  const { perception, document } = loadPerception(`<input id="pw" type="password" value="hunter2" />`);
  const inputs = perception.extractInputs(document);
  assert.equal(inputs[0].value, "");
});

test("ariaMetadata surfaces aria-required, aria-invalid, and resolved aria-describedby text", () => {
  const { perception, document } = loadPerception(`
    <span id="hint">Must be 8+ characters</span>
    <input id="pw" type="password" aria-required="true" aria-invalid="false" aria-describedby="hint" />
  `);
  const meta = perception.ariaMetadata(document.getElementById("pw"));
  assert.equal(meta.ariaRequired, true);
  assert.equal(meta.ariaInvalid, false);
  assert.equal(meta.ariaDescribedBy, "Must be 8+ characters");
});

test("extractInteractive captures disabled buttons including aria-disabled", () => {
  const { perception, document } = loadPerception(`
    <button id="submit">Submit</button>
    <button id="cancel" disabled>Cancel</button>
    <button id="delete" aria-disabled="true">Delete account</button>
  `);
  const interactive = perception.extractInteractive(document);
  const byText = Object.fromEntries(interactive.map((i) => [i.text, i]));
  assert.equal(byText["Submit"].disabled, false);
  assert.equal(byText["Cancel"].disabled, true);
  assert.equal(byText["Delete account"].disabled, true);
});

test("isVisible excludes display:none and zero-size elements, includes normal ones", () => {
  const { perception, document } = loadPerception(`
    <button id="normal">Visible</button>
    <button id="hidden" style="display:none">Hidden</button>
    <button id="zero">Zero size</button>
  `);
  document.getElementById("zero").getBoundingClientRect = () => rect(0, 0, 0, 0);

  assert.equal(perception.isVisible(document.getElementById("normal")), true);
  assert.equal(perception.isVisible(document.getElementById("hidden")), false);
  assert.equal(perception.isVisible(document.getElementById("zero")), false);
});

test("isInViewport distinguishes an on-screen element from one scrolled far off-screen", () => {
  const { perception, document, window } = loadPerception(`<button id="btn">Go</button>`, {
    viewport: { width: 800, height: 600 },
  });
  const onScreen = perception.bboxOf(document.getElementById("btn")); // default rect: 0,0,100,20
  assert.equal(perception.isInViewport(onScreen, window), true);

  document.getElementById("btn").getBoundingClientRect = () => rect(5000, 5000, 100, 20);
  const offScreen = perception.bboxOf(document.getElementById("btn"));
  assert.equal(perception.isInViewport(offScreen, window), false);
});

test("extractText walks visible text and skips script/style content", () => {
  const { perception, document } = loadPerception(`
    <p id="p1">Please refund the duplicate charge.</p>
    <script>var secretlyNotUserFacing = "should not appear";</script>
    <style>.x { color: red; } /* also should not appear */</style>
  `);
  const chunks = perception.extractText(document);
  const allText = chunks.map((c) => c.text).join(" ");
  assert.ok(allText.includes("Please refund the duplicate charge."));
  assert.ok(!allText.includes("secretlyNotUserFacing"));
  assert.ok(!allText.includes("color: red"));
});

test("collectAllRoots descends into an open shadow root", () => {
  const { perception, document } = loadPerception(`<div id="host"></div>`);
  const host = document.getElementById("host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<button id="shadowBtn">Inside shadow DOM</button>`;

  const interactive = perception.extractInteractive(document);
  assert.ok(interactive.some((i) => i.text === "Inside shadow DOM"));

  const roots = perception.collectAllRoots(document);
  assert.equal(roots.length, 2); // document itself + the one open shadow root
});

test("countOpenShadowHosts counts hosts, not shadow-internal elements", () => {
  const { perception, document } = loadPerception(`<div id="hostA"></div><div id="hostB"></div><div id="plain"></div>`);
  document.getElementById("hostA").attachShadow({ mode: "open" }).innerHTML = "<span>a</span>";
  document.getElementById("hostB").attachShadow({ mode: "open" }).innerHTML = "<span>b</span>";
  assert.equal(perception.countOpenShadowHosts(document), 2);
});

test("extractIframes reports a same-origin iframe as perceivable and populates its perception", () => {
  const { perception, document } = loadPerception(`<iframe id="frame"></iframe>`);
  const frame = document.getElementById("frame");
  // A same-document, src-less jsdom iframe gets a real, accessible
  // about:blank document we can legitimately write into — this exercises
  // the actual sameOrigin=true code path, not a mock of it.
  frame.contentDocument.body.innerHTML = '<button id="innerBtn">Inner action</button>';
  // The iframe's contentWindow is its own separate realm in jsdom (as in a
  // real browser) with its own Element class, so the outer window's
  // getBoundingClientRect patch from loadPerception() doesn't apply here —
  // patch this realm's prototype too, for the same reason (jsdom does no
  // real layout).
  frame.contentWindow.Element.prototype.getBoundingClientRect = function () {
    return rect(0, 0, 100, 20);
  };

  const iframes = perception.extractIframes(document);
  assert.equal(iframes.length, 1);
  assert.equal(iframes[0].sameOrigin, true);
  assert.ok(iframes[0].perceived.interactive.some((i) => i.text === "Inner action"));
});

test("extractIframes fails closed to sameOrigin:false when contentDocument access throws", () => {
  const { perception, document } = loadPerception(`<iframe id="frame" src="https://not-our-origin.example/page"></iframe>`);
  const frame = document.getElementById("frame");
  Object.defineProperty(frame, "contentDocument", {
    get() {
      throw new Error("Blocked a frame with origin from accessing a cross-origin frame");
    },
    configurable: true,
  });

  const iframes = perception.extractIframes(document);
  assert.equal(iframes.length, 1);
  assert.equal(iframes[0].sameOrigin, false);
  assert.equal(iframes[0].perceived, null);
  assert.ok(iframes[0].note.includes("cross-origin"));
});

test("capturePage returns the expected top-level shape including the new schemaVersion and viewport fields", () => {
  const { perception, document } = loadPerception(`
    <form><input id="e" type="email" /></form>
    <button id="b">Go</button>
    <p>Some visible text</p>
  `, { viewport: { width: 1280, height: 720 } });

  const page = perception.capturePage();
  assert.equal(page.schemaVersion, "0.2.0");
  assert.equal(page.viewport.width, 1280);
  assert.equal(page.viewport.height, 720);
  assert.equal(typeof page.shadowHostCount, "number");
  assert.ok(Array.isArray(page.inputs));
  assert.ok(Array.isArray(page.interactive));
  assert.ok(Array.isArray(page.textNodes));
  assert.ok(Array.isArray(page.iframes));
});
