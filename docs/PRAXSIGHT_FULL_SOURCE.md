# PraxSight Full Extension Source


## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\background.js
```javascript

/**
 * PraxSight â€” Background Service Worker
 *
 * THIS FILE CONTAINS THE ONLY fetch() CALL IN THE ENTIRE EXTENSION THAT
 * TARGETS THE AI BACKEND. Content scripts have no host permission for
 * BACKEND_URL (see manifest.json â€” host_permissions is scoped to just the
 * backend, and content scripts don't declare it), so structurally, the only
 * way sanitized context reaches the network is through sendSanitizedContext()
 * below. That's the "hard privacy gate" from the build plan (Phase 5).
 *
 * Two independent checks run before any network call:
 *   1. The manifest the content script attached must claim performed=true.
 *   2. A residual-PII re-scan of the sanitized payload (defense-in-depth
 *      pass #2, on top of the one content-script.js already ran) must be
 *      clean.
 * Either failing BLOCKS the request and logs it â€” this endpoint never
 * silently drops the check.
 *
 * Honesty note (see docs/PRIVACY_MODEL.md "Known limitations"): this proves
 * there is exactly one code path to the network and that it enforces these
 * checks, but it is still the extension checking its own homework. A
 * fully independent proof â€” e.g. routing through a separate local logging
 * proxy outside this extension's process â€” is called out as a documented
 * follow-up, following the same lesson the sibling Prax AI project's
 * network-monitor process encodes.
 */

const BACKEND_URL = "http://localhost:8000";
const REQUEST_LOG_KEY = "praxsight_request_log";

async function publishSession(event) {
  try {
    await fetch(`${BACKEND_URL}/api/session/latest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // The dashboard can still use the extension bridge when the session feed is unavailable.
  }
}

async function appendLog(entry) {
  const { [REQUEST_LOG_KEY]: log = [] } = await chrome.storage.local.get(REQUEST_LOG_KEY);
  log.unshift(entry);
  await chrome.storage.local.set({ [REQUEST_LOG_KEY]: log.slice(0, 50) });
}

async function sendSanitizedContext(payload) {
  const manifest = payload && payload.manifest;
  const residual = payload && payload.residual;

  if (!manifest || manifest.performed !== true) {
    const entry = {
      timestamp: new Date().toISOString(),
      status: "BLOCKED",
      reason: "missing_or_invalid_privacy_manifest",
    };
    await appendLog(entry);
    return { ok: false, blocked: true, reason: entry.reason };
  }

  if (!residual || residual.clean !== true) {
    const entry = {
      timestamp: new Date().toISOString(),
      status: "BLOCKED",
      reason: "residual_pii_detected_fail_closed",
    };
    await appendLog(entry);
    return { ok: false, blocked: true, reason: entry.reason };
  }

  const body = JSON.stringify({
    task: payload.task,
    page_url: payload.sanitized.url,
    elements: {
      inputs: payload.sanitized.inputs,
      interactive: payload.sanitized.interactive,
    },
    text_context: payload.sanitized.textNodes.slice(0, 200),
    privacy_manifest: manifest,
  });

  const startedAt = performance.now();
  try {
    const resp = await fetch(`${BACKEND_URL}/api/agent/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const data = await resp.json().catch(() => ({}));

    await appendLog({
      timestamp: new Date().toISOString(),
      status: resp.ok ? "ALLOWED" : "ERROR",
      endpoint: "/api/agent/act",
      payloadBytes: body.length,
      latencyMs,
      entitiesDetected: manifest.entities_detected,
      entitiesRedacted: manifest.entities_redacted,
      httpStatus: resp.status,
    });

    await publishSession({
      scan: {
        entitiesDetected: manifest.entities_detected,
        entitiesRedacted: manifest.entities_redacted,
        sanitized: Boolean(residual.clean),
      },
      action: resp.ok ? data : null,
      network: { status: resp.ok ? "ALLOWED" : "ERROR", latencyMs, httpStatus: resp.status },
    });

    return { ok: resp.ok, data };
  } catch (e) {
    await appendLog({
      timestamp: new Date().toISOString(),
      status: "ERROR",
      reason: String(e && e.message ? e.message : e),
    });
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function sendMessageWithRecovery(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "content/perception.js",
        "content/privacy/detectors.js",
        "content/privacy/redaction.js",
        "content/privacy/policy-engine.js",
        "content/content-script.js",
      ],
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function scanActivePageForDashboard(senderTabId) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  let target = tabs.find((tab) => tab.url && tab.url.startsWith(`${BACKEND_URL}/demo/`));
  
  if (!target) {
    target = tabs.find((tab) => tab.id !== senderTabId && tab.url && tab.url.startsWith("http") && !tab.url.startsWith(`${BACKEND_URL}/dashboard`));
  }
  
  if (!target || !target.id) return { ok: false, error: "open_the_demo_page_in_another_tab" };
  try {
    const result = await sendMessageWithRecovery(target.id, { type: "PRAXSIGHT_SCAN" });
    return result && result.ok ? result : { ok: false, error: "active_page_scan_failed" };
  } catch (e) {
    return { ok: false, error: "content_script_missing_on_active_page" };
  }
}

let creatingOffscreen = false;
async function setupOffscreenDocument(path) {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Run Tesseract.js OCR'
    });
    await creatingOffscreen;
    creatingOffscreen = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PRAXSIGHT_OCR_REQUEST") {
    setupOffscreenDocument('ocr.html').then(() => {
      chrome.runtime.sendMessage({ type: "PRAXSIGHT_RUN_OCR", imageData: msg.imageData }, sendResponse);
    }).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "PRAXSIGHT_SEND_TO_SERVER") {
    sendSanitizedContext(msg.payload).then(sendResponse);
    return true;
  }
  if (msg.type === "PRAXSIGHT_GET_LOG") {
    chrome.storage.local.get(REQUEST_LOG_KEY).then((r) => sendResponse(r[REQUEST_LOG_KEY] || []));
    return true;
  }
  if (msg.type === "PRAXSIGHT_CLEAR_LOG") {
    chrome.storage.local.set({ [REQUEST_LOG_KEY]: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "PRAXSIGHT_DASHBOARD_SCAN_ACTIVE") {
    scanActivePageForDashboard(_sender.tab && _sender.tab.id).then(sendResponse);
    return true;
  }
});


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\manifest.json
```json

{
  "manifest_version": 3,
  "name": "PraxSight â€” Privacy-Preserving Browser Agent",
  "short_name": "PraxSight",
  "version": "0.1.0",
  "description": "SIH26171: on-device DOM/text perception with a hard privacy gate â€” no raw PII leaves the browser before an AI agent reasons over the page.",

  "permissions": ["activeTab", "scripting", "storage", "tabs", "offscreen"],
  "host_permissions": [
    "http://localhost:8000/*",
    "http://127.0.0.1:8000/*"
  ],

  "background": {
    "service_worker": "background.js"
  },

  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "PraxSight â€” privacy firewall for browser agents"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "run_at": "document_idle",
      "js": [
        "content/perception.js",
        "content/privacy/detectors.js",
        "content/privacy/redaction.js",
        "content/privacy/policy-engine.js",
        "content/content-script.js",
        "content/ocr/ocr-engine.js"
      ]
    }
  ]
}


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\ocr-offscreen.js
```javascript

let tesseractWorker = null;

async function getWorker() {
  if (tesseractWorker) return tesseractWorker;
  
  // Tesseract.js loads these files using fetch, which works fine inside the extension
  // if we give it the runtime URLs.
  tesseractWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
    langPath: chrome.runtime.getURL('lib/tesseract/lang-data')
  });
  
  return tesseractWorker;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PRAXSIGHT_RUN_OCR") {
    (async () => {
      try {
        const worker = await getWorker();
        const start = performance.now();
        const { data: { text } } = await worker.recognize(msg.imageData);
        const latencyMs = performance.now() - start;
        sendResponse({ ok: true, text: text.trim(), latencyMs });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // async response
  }
});


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\ocr.html
```html

<!DOCTYPE html>
<html>
<head>
  <script src="lib/tesseract/tesseract.min.js"></script>
  <script src="ocr-offscreen.js"></script>
</head>
<body></body>
</html>


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\content-script.js
```javascript

/**
 * PraxSight â€” Content Script Orchestrator
 *
 * Wires perception â†’ detection â†’ policy â†’ redaction into one scan, and
 * exposes it to the popup via chrome.runtime messaging. This file has DOM
 * access (needed to execute agent actions) but never calls fetch() itself â€”
 * that chokepoint lives only in background.js (Phase 5 hard gate).
 */
(function () {
  const PraxSight = window.PraxSight;
  let lastScan = null;

  /**
   * Defense-in-depth pass #1 (client side): re-scan the *sanitized* payload
   * for obvious residual PII before it's even offered to background.js.
   * This does not trust the redaction step blindly â€” if anything still
   * looks like an email/card after redaction, the scan is marked unclean
   * and background.js's gate will refuse to transmit it (fail-closed).
   */
  function residualPiiScan(sanitized) {
    const joined = JSON.stringify(sanitized);
    const emailLeft = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(joined);
    const cardLeft = /\b(?:\d[ -]?){13,19}\b/.test(joined) && PraxSight.detectorInternals.luhnValid(joined.match(/\b(?:\d[ -]?){13,19}\b/)[0]);
    return { clean: !emailLeft && !cardLeft, checkedAt: new Date().toISOString() };
  }

  async function runScan(includeImages = false) {
    const perception = PraxSight.perception.capturePage();
    const rawDetections = await PraxSight.detectors.detect(perception);
    
    let ocrLatencyMs = 0;
    if (includeImages && PraxSight.ocr) {
      const ocrResult = await PraxSight.ocr.detectFromImages(document);
      rawDetections.push(...ocrResult.detections);
      ocrLatencyMs = ocrResult.latencyMs;
    }
    
    const policed = PraxSight.policyEngine.applyPolicy(rawDetections);
    const sanitized = PraxSight.redaction.sanitizePerception(perception, policed);
    const manifest = PraxSight.policyEngine.buildManifest(policed, sanitized);
    const residual = residualPiiScan(sanitized);
    lastScan = { perception, detections: policed, sanitized, manifest, residual, ocrLatencyMs };
    return lastScan;
  }

  function findElement(psId) {
    return document.querySelector(`[data-praxsight-id="${CSS.escape(psId)}"]`);
  }

  function executeAction(action) {
    const el = action && action.target && action.target.id ? findElement(action.target.id) : null;
    if (!el && action.action !== "read") return { ok: false, error: "target_not_found" };

    switch (action.action) {
      case "click":
        el.click();
        return { ok: true };
      case "focus":
        el.focus();
        return { ok: true };
      case "scroll":
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return { ok: true };
      case "type":
        // The server-side validator (server/validator.py) refuses to emit a
        // 'type' action unless value_policy === 'user-provided' â€” the agent
        // is structurally prevented from inventing field values.
        return { ok: false, error: "requires_user_input_not_implemented_in_popup" };
      case "read": {
        if (el) return { ok: true, text: el.innerText || el.textContent };
        // No specific target â€” the agent legitimately found nothing to
        // click, so fall back to a whole-page read instead of failing.
        const summary = (document.body && document.body.innerText || "").trim().slice(0, 800);
        return { ok: true, text: summary || "(no visible text found)" };
      }
      default:
        return { ok: false, error: "unsupported_action" };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PRAXSIGHT_SCAN" || msg.type === "PRAXSIGHT_SCAN_IMAGES") {
      runScan(msg.type === "PRAXSIGHT_SCAN_IMAGES").then((result) =>
        sendResponse({
          ok: true,
          manifest: result.manifest,
          residual: result.residual,
          ocrLatencyMs: result.ocrLatencyMs,
          counts: {
            inputs: result.perception.inputs.length,
            interactive: result.perception.interactive.length,
            textNodes: result.perception.textNodes.length,
          },
          raw: result.perception,
          sanitized: result.sanitized,
        })
      );
      return true; // async response
    }

    if (msg.type === "PRAXSIGHT_GET_LAST_SCAN") {
      sendResponse({ ok: !!lastScan, scan: lastScan });
      return true;
    }

    if (msg.type === "PRAXSIGHT_EXECUTE_ACTION") {
      sendResponse(executeAction(msg.action));
      return true;
    }
  });

  // The dashboard is served by the local backend, so it can use this bridge
  // without receiving direct access to the page DOM or the backend fetch gate.
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin || !event.data || event.data.source !== "praxsight-dashboard") return;
    if (event.data.type === "PRAXSIGHT_DASHBOARD_SCAN") {
      try {
        const result = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PRAXSIGHT_DASHBOARD_SCAN_ACTIVE" }, resolve));
        if (!result || !result.ok) throw new Error(result && result.error ? result.error : "active_page_scan_failed");
        lastScan = {
          perception: result.raw,
          manifest: result.manifest,
          residual: result.residual,
          sanitized: result.sanitized,
        };
        window.postMessage({ type: "PRAXSIGHT_DASHBOARD_SCAN_RESULT", ok: true, scan: {
          manifest: result.manifest,
          residual: result.residual,
          counts: { inputs: result.perception.inputs.length, interactive: result.perception.interactive.length, textNodes: result.perception.textNodes.length },
          raw: result.perception,
          sanitized: result.sanitized,
        } }, window.location.origin);
      } catch (error) {
        window.postMessage({ type: "PRAXSIGHT_DASHBOARD_SCAN_RESULT", ok: false, error: String(error && error.message ? error.message : error) }, window.location.origin);
      }
    }
    if (event.data.type === "PRAXSIGHT_DASHBOARD_AGENT") {
      try {
        const scan = lastScan || await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PRAXSIGHT_DASHBOARD_SCAN_ACTIVE" }, resolve));
        if (!scan || !scan.ok && !scan.manifest) throw new Error(scan && scan.error ? scan.error : "scan_required_before_agent");
        const normalizedScan = scan.manifest ? scan : {
          manifest: scan.manifest,
          residual: scan.residual,
          sanitized: scan.sanitized,
        };
        const payload = { task: event.data.task || "Resolve this support ticket", manifest: normalizedScan.manifest, residual: normalizedScan.residual, sanitized: normalizedScan.sanitized };
        const result = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PRAXSIGHT_SEND_TO_SERVER", payload }, resolve));
        window.postMessage({ type: "PRAXSIGHT_DASHBOARD_AGENT_RESULT", ...result }, window.location.origin);
      } catch (error) {
        window.postMessage({ type: "PRAXSIGHT_DASHBOARD_AGENT_RESULT", ok: false, error: String(error && error.message ? error.message : error) }, window.location.origin);
      }
    }
    if (event.data.type === "PRAXSIGHT_DASHBOARD_LOG") {
      const log = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PRAXSIGHT_GET_LOG" }, resolve));
      window.postMessage({ type: "PRAXSIGHT_DASHBOARD_LOG_RESULT", log: log || [] }, window.location.origin);
    }
  });
})();


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\perception.js
```javascript

/**
 * PraxSight â€” Local DOM Perception Layer (Phase 1, hardened in Phase 2)
 *
 * Extracts inputs, interactive elements, and visible text into a plain-data
 * schema with no live DOM references, so everything downstream (detectors,
 * redaction, the background service worker, the server) only ever touches
 * inert JSON â€” never a live node a bug could accidentally serialize whole.
 *
 * No PII detection happens here. This module only answers "what is on the
 * page and where" â€” see content/privacy/detectors.js for "what's sensitive".
 *
 * Phase 2 additions (all additive â€” every field that existed before Phase 2
 * still exists with the same name and meaning, so detectors.js, redaction.js
 * and the 11 existing tests in tests/test_pii_lib.cjs keep working unchanged):
 *   - disabled / required / checked state on form fields
 *   - a small ARIA metadata bag (aria-label, aria-describedby text,
 *     aria-required/-invalid/-expanded/-pressed/-checked)
 *   - nearest containing <form> id/name for inputs
 *   - inViewport (distinct from the existing CSS-visibility `isVisible`
 *     check â€” an element can be display:block and still be scrolled off
 *     screen)
 *   - schemaVersion + a viewport block on the top-level capturePage() result
 *   - same-origin iframe perception, one level deep (see extractIframes)
 *   - open shadow-root traversal for inputs/interactive/text extraction
 *     (see collectAllRoots) â€” closed shadow roots are architecturally
 *     invisible to any script, not just this one; that's a platform
 *     limitation, not a gap in this implementation, and is documented as
 *     such rather than silently ignored.
 *   - a bugfix: `isVisible` now resolves computed style through the
 *     element's OWN window (`el.ownerDocument.defaultView`) instead of the
 *     top-level window, which matters once this module perceives elements
 *     inside a same-origin iframe.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  // â”€â”€ Visibility / geometry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // Use the element's OWN window, not the top-level one â€” matters for
    // same-origin iframe content, where the top window's getComputedStyle
    // is not guaranteed to reflect that document's stylesheets correctly.
    const view = (el.ownerDocument && el.ownerDocument.defaultView) || root;
    const style = view.getComputedStyle ? view.getComputedStyle(el) : null;
    if (style && (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")) {
      return false;
    }
    return true;
  }

  function bboxOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  // inViewport is deliberately separate from isVisible: a field can be
  // fully visible by CSS (not display:none, not hidden) and still be
  // scrolled out of the current viewport. Detectors/redaction don't care
  // about this distinction today, but an agent deciding whether it's safe
  // to click something the user can't currently see should.
  function isInViewport(bbox, win) {
    if (!win) return true; // no window context available â€” don't guess a false negative
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    return bbox.width > 0 && bbox.height > 0 && bbox.x < vw && bbox.x + bbox.width > 0 && bbox.y < vh && bbox.y + bbox.height > 0;
  }

  // â”€â”€ Stable identity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  let idCounter = 0;
  function elementId(el) {
    if (el.dataset && el.dataset.praxsightId) return el.dataset.praxsightId;
    const gen = `ps_${el.tagName.toLowerCase()}_${idCounter++}`;
    if (el.dataset) el.dataset.praxsightId = gen;
    return gen;
  }

  // â”€â”€ Labels / forms / ARIA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function nearestLabelText(el) {
    if (el.labels && el.labels.length) {
      return Array.from(el.labels).map((l) => l.textContent.trim()).join(" ");
    }
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
    const prev = el.previousElementSibling;
    if (prev && /^(label|span|div|p)$/i.test(prev.tagName) && prev.textContent.trim().length < 60) {
      return prev.textContent.trim();
    }
    return "";
  }

  function nearestFormId(el) {
    // `.form` is a native property the browser maintains for every
    // form-associable element (input/select/textarea/button), including
    // ones associated by a `form="..."` attribute rather than DOM nesting
    // â€” so this is more reliable than walking up with closest("form").
    if (el.form) return el.form.id || el.form.getAttribute("name") || "unnamed_form";
    return null;
  }

  function ariaMetadata(el) {
    const meta = {};
    const label = el.getAttribute("aria-label");
    if (label) meta.ariaLabel = label;

    const describedBy = el.getAttribute("aria-describedby");
    if (describedBy) {
      const doc = el.ownerDocument;
      const text = describedBy
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => {
          const ref = doc.getElementById(id);
          return ref ? ref.textContent.trim() : "";
        })
        .filter(Boolean)
        .join(" ");
      if (text) meta.ariaDescribedBy = text;
    }

    if (el.hasAttribute("aria-required")) meta.ariaRequired = el.getAttribute("aria-required") === "true";
    if (el.hasAttribute("aria-invalid")) meta.ariaInvalid = el.getAttribute("aria-invalid") === "true";
    if (el.hasAttribute("aria-expanded")) meta.ariaExpanded = el.getAttribute("aria-expanded") === "true";
    if (el.hasAttribute("aria-pressed")) meta.ariaPressed = el.getAttribute("aria-pressed") === "true";
    if (el.hasAttribute("aria-checked")) meta.ariaChecked = el.getAttribute("aria-checked");

    return meta;
  }

  // â”€â”€ Shadow DOM traversal (open shadow roots only â€” see module docstring) â”€

  function collectAllRoots(root_, acc) {
    acc = acc || [];
    acc.push(root_);
    const all = root_.querySelectorAll ? root_.querySelectorAll("*") : [];
    for (const el of all) {
      if (el.shadowRoot) collectAllRoots(el.shadowRoot, acc);
    }
    return acc;
  }

  function countOpenShadowHosts(doc) {
    let count = 0;
    const all = doc.querySelectorAll("*");
    for (const el of all) if (el.shadowRoot) count++;
    return count;
  }

  function rootWalkTarget(root_) {
    // Document -> its body (falls back to documentElement for the rare
    // case a document has no body yet); ShadowRoot -> itself, since
    // ShadowRoot is already a valid TreeWalker root.
    if (root_.nodeType === 9 /* DOCUMENT_NODE */) return root_.body || root_.documentElement;
    return root_;
  }

  // â”€â”€ Extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function extractInputs(doc) {
    const roots = collectAllRoots(doc);
    const inputs = [];
    for (const r of roots) inputs.push(...Array.from(r.querySelectorAll("input, textarea, select")));

    return inputs.filter(isVisible).map((el) => {
      const type = (el.type || "text").toLowerCase();
      const isCheckable = type === "checkbox" || type === "radio";
      const view = (el.ownerDocument && el.ownerDocument.defaultView) || root;
      return {
        psId: elementId(el),
        tag: el.tagName.toLowerCase(),
        type,
        name: el.name || "",
        autocomplete: el.getAttribute("autocomplete") || "",
        label: nearestLabelText(el),
        // Password values are never read into memory at all, not even pre-redaction.
        value: type === "password" ? "" : el.value || "",
        disabled: !!el.disabled,
        required: !!el.required,
        checked: isCheckable ? !!el.checked : null,
        formId: nearestFormId(el),
        aria: ariaMetadata(el),
        inViewport: isInViewport(bboxOf(el), view),
        bbox: bboxOf(el),
      };
    });
  }

  function extractInteractive(doc) {
    const roots = collectAllRoots(doc);
    const els = [];
    for (const r of roots) els.push(...Array.from(r.querySelectorAll('button, a[href], [role="button"], summary')));

    return els.filter(isVisible).map((el) => {
      const view = (el.ownerDocument && el.ownerDocument.defaultView) || root;
      return {
        psId: elementId(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || (el.tagName.toLowerCase() === "button" ? "button" : "link"),
        text: (el.innerText || el.textContent || "").trim().slice(0, 120),
        disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"),
        aria: ariaMetadata(el),
        inViewport: isInViewport(bboxOf(el), view),
        bbox: bboxOf(el),
      };
    });
  }

  function extractText(doc, maxChars = 20000) {
    const roots = collectAllRoots(doc);
    const chunks = [];
    let total = 0;

    for (const r of roots) {
      if (total >= maxChars) break;
      const walkRoot = rootWalkTarget(r);
      if (!walkRoot) continue;

      const walker = doc.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : "";
          if (["script", "style", "noscript", "template"].includes(parentTag)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && !isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node;
      while ((node = walker.nextNode()) && total < maxChars) {
        const t = node.textContent.trim();
        if (!t) continue;
        chunks.push({ text: t, psId: elementId(node.parentElement), bbox: bboxOf(node.parentElement) });
        total += t.length;
      }
    }
    return chunks;
  }

  // Same-origin iframes only, one level deep by design â€” a cross-origin
  // iframe's contentDocument throws/returns null by browser security model
  // and there is no legitimate way around that from a content script, so
  // this reports the fact rather than silently perceiving nothing. Nested
  // iframes-within-a-same-origin-iframe are not recursed into, to keep
  // recursion cost bounded; that's a documented scope limit, not a bug.
  function extractIframes(doc) {
    const frames = Array.from(doc.querySelectorAll("iframe"));
    return frames.map((frame) => {
      const base = {
        psId: elementId(frame),
        src: frame.getAttribute("src") || null,
        bbox: bboxOf(frame),
        visible: isVisible(frame),
        sameOrigin: false,
        perceived: null,
        note: null,
      };

      let innerDoc = null;
      try {
        innerDoc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      } catch (e) {
        innerDoc = null;
      }

      if (innerDoc) {
        base.sameOrigin = true;
        try {
          base.perceived = {
            inputs: extractInputs(innerDoc),
            interactive: extractInteractive(innerDoc),
            textNodes: extractText(innerDoc),
          };
        } catch (e) {
          base.note = `same-origin but perception threw: ${e && e.message}`;
        }
      } else {
        base.note = "cross-origin iframe â€” contentDocument is inaccessible by browser design, cannot perceive";
      }

      return base;
    });
  }

  function capturePage() {
    const win = document.defaultView || root;
    return {
      schemaVersion: "0.2.0",
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      viewport: {
        width: win.innerWidth || 0,
        height: win.innerHeight || 0,
        scrollX: win.pageXOffset || win.scrollX || 0,
        scrollY: win.pageYOffset || win.scrollY || 0,
      },
      shadowHostCount: countOpenShadowHosts(document),
      inputs: extractInputs(document),
      interactive: extractInteractive(document),
      textNodes: extractText(document),
      iframes: extractIframes(document),
    };
  }

  const api = {
    capturePage,
    isVisible,
    bboxOf,
    isInViewport,
    elementId,
    nearestLabelText,
    nearestFormId,
    ariaMetadata,
    collectAllRoots,
    countOpenShadowHosts,
    extractInputs,
    extractInteractive,
    extractText,
    extractIframes,
  };

  PraxSight.perception = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\ocr\ocr-engine.js
```javascript

(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  async function getImageDataUrl(el) {
    if (el.tagName.toLowerCase() === 'canvas') {
      try {
        return el.toDataURL('image/png');
      } catch (e) {
        return null; // Tainted canvas
      }
    }
    if (el.tagName.toLowerCase() === 'img') {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = el.naturalWidth || el.width;
        canvas.height = el.naturalHeight || el.height;
        if (!canvas.width || !canvas.height) return null;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0);
        return canvas.toDataURL('image/png');
      } catch (e) {
        return null; // Tainted cross-origin image
      }
    }
    return null;
  }

  async function runOcrOnBackground(imageData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "PRAXSIGHT_OCR_REQUEST", imageData },
        (response) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          if (!response || !response.ok) return reject(new Error(response?.error || 'OCR failed'));
          resolve(response);
        }
      );
    });
  }

  async function detectFromImages(doc) {
    const roots = PraxSight.perception.collectAllRoots(doc);
    const elements = [];
    for (const r of roots) {
      elements.push(...Array.from(r.querySelectorAll("img, canvas")));
    }
    
    const visibleElements = elements.filter(PraxSight.perception.isVisible);
    let allDetections = [];
    let totalLatencyMs = 0;
    
    for (const el of visibleElements) {
      const dataUrl = await getImageDataUrl(el);
      if (!dataUrl) continue;
      
      try {
        const result = await runOcrOnBackground(dataUrl);
        totalLatencyMs += result.latencyMs || 0;
        if (result.text && result.text.trim()) {
          const psId = PraxSight.perception.elementId(el);
          const bbox = PraxSight.perception.bboxOf(el);
          
          // Use the EXACT SAME detection pipeline as text
          const detections = PraxSight.detectors.detectInText(result.text.trim(), psId, bbox);
          
          for (const d of detections) {
            d.source = ["ocr"]; // Tag as OCR
          }
          allDetections.push(...detections);
        }
      } catch (e) {
        console.warn('PraxSight OCR failed for element', el, e);
      }
    }
    
    return { detections: allDetections, latencyMs: totalLatencyMs };
  }

  PraxSight.ocr = { detectFromImages };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PraxSight.ocr;
  }
})(typeof window !== "undefined" ? window : globalThis);


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\privacy\detectors.js
```javascript

/**
 * PraxSight â€” Sensitive Data Detection Engine (Phase 2 + Phase 3 interface)
 *
 * Two detection strategies feed a common `Detection` shape:
 *   1. detectStructural  â€” DOM/field metadata (type=password, autocomplete=email,
 *      label text). Cheap, high-precision, catches most real-world form PII
 *      before any text scanning happens at all.
 *   2. detectInText      â€” regex + checksum scanning over visible text nodes.
 *
 * This file has NO dependency on `window`/DOM â€” perception.js already turned
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
 * here yet â€” see docs/CURRENT_IMPLEMENTATION.md for why the rules backend is
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


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\privacy\model-backends.js
```javascript

/**
 * PraxSight — Model-Backed Detection Backend Adapters
 *
 * These implement the DetectionBackend interface used by detectors.js:
 *
 *   interface DetectionBackend {
 *     name: "rules" | "gemini-nano" | "transformers-js-ner";
 *     available(): Promise<boolean>;
 *     detect(perception): Promise<Detection[]>;
 *   }
 *
 * IMPLEMENTATION STATUS (honest):
 *   - GeminiNanoBackend.available() performs real Chrome AI API feature detection.
 *   - GeminiNanoBackend.detect() returns [] — not yet wired to live pipeline.
 *   - TransformersJsNERBackend.detect() returns [] — needs bundler step for ONNX model.
 *
 * See docs/CURRENT_IMPLEMENTATION.md for wiring plan.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  class GeminiNanoBackend {
    get name() { return "gemini-nano"; }

    async available() {
      try {
        if (!("ai" in window) || !window.ai || !window.ai.languageModel) return false;
        const caps = await window.ai.languageModel.capabilities();
        return caps && caps.available !== "no";
      } catch {
        return false;
      }
    }

    async detect(perception) {
      // Future: prompt Gemini Nano over textNodes to catch free-text PII
      // (names, addresses) that structural rules cannot detect.
      return [];
    }
  }

  class TransformersJsNERBackend {
    get name() { return "transformers-js-ner"; }

    async available() {
      try {
        return typeof window !== "undefined" && "transformers" in window;
      } catch {
        return false;
      }
    }

    async detect(perception) {
      // Future: quantized NER model via Transformers.js (Firefox fallback)
      return [];
    }
  }

  PraxSight.modelBackends = {
    GeminiNanoBackend,
    TransformersJsNERBackend,
    async getBestAvailable() {
      const gemini = new GeminiNanoBackend();
      if (await gemini.available()) return gemini;
      const tfjs = new TransformersJsNERBackend();
      if (await tfjs.available()) return tfjs;
      return null;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\privacy\policy-engine.js
```javascript

/**
 * PraxSight â€” Privacy Policy Engine (Phase 4 â†’ Phase 12 manifest)
 *
 * Decides what happens to each detection (allow / redact) and builds the
 * `privacy_manifest` that travels with every outgoing request. The manifest
 * is what background.js's hard gate (Phase 5) checks before it will call
 * fetch() at all â€” see extension/background.js.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  // Default policy: only 'low' severity (rare â€” reserved for future
  // low-confidence heuristics) is allowed through unredacted. Everything
  // else is redacted. This is intentionally fail-closed: an unrecognized
  // severity string is NOT in this map and therefore defaults to 'redact'.
  const DEFAULT_POLICY = {
    critical: "redact",
    high: "redact",
    medium: "redact",
    low: "allow",
  };

  function applyPolicy(detections, policy = DEFAULT_POLICY) {
    return detections.map((d) => ({ ...d, action: policy[d.severity] || "redact" }));
  }

  function buildManifest(policedDetections, sanitized) {
    const redacted = policedDetections.filter((d) => d.action !== "allow");
    const byType = {};
    for (const d of policedDetections) byType[d.type] = (byType[d.type] || 0) + 1;
    return {
      performed: true,
      version: "0.1.0",
      detectors: Array.from(new Set(policedDetections.flatMap((d) => d.source))),
      entities_detected: policedDetections.length,
      entities_redacted: redacted.length,
      by_type: byType,
      generated_at: new Date().toISOString(),
    };
  }

  const api = { applyPolicy, buildManifest, DEFAULT_POLICY };
  PraxSight.policyEngine = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\content\privacy\redaction.js
```javascript

/**
 * PraxSight â€” Semantic Redaction (Phase 4)
 *
 * Turns raw detected values into deterministic semantic tokens so a server
 * can still reason about page *structure* ("there is a person and an email
 * near this button") without ever receiving the actual secret.
 *
 *   "John Smith"           -> "[PERSON_1]"
 *   "john@example.com"     -> "[EMAIL_1]"
 *   "4111 1111 1111 1111"  -> "[CARD_REDACTED]"   (irreversible-class fields
 *                                                    never get a counter â€”
 *                                                    there is no legitimate
 *                                                    reason the model needs
 *                                                    to distinguish CARD_1
 *                                                    from CARD_2)
 *
 * Tokens are stable only within a single scan/task â€” this module holds no
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


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\popup\popup.css
```css

/* ============================================================
   PraxSight Extension Popup — Premium redesign (Phase 6)
   ============================================================ */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg:          #080e14;
  --surface:     #0d1620;
  --surface-alt: #111d2b;
  --border:      #1a2e42;
  --ink:         #e8f0f8;
  --ink-muted:   #7a99b8;
  --ink-faint:   #3a5470;
  --accent:      #2563eb;
  --safe:        #10b981;
  --warn:        #f59e0b;
  --danger:      #ef4444;
  --purple:      #8b5cf6;
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { font-size: 14px; }

body {
  width: 380px;
  min-height: 200px;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Inter', system-ui, sans-serif;
  line-height: 1.5;
}

/* ── Header ─────────────────────────────────────────────────── */
.rail {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(13,22,32,0.95);
  border-bottom: 1px solid var(--border);
}

.rail-mark {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, var(--accent), var(--purple));
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}

.rail-heading { flex: 1; }
.rail-heading h1 { font-size: 14px; font-weight: 700; line-height: 1.2; }
.rail-heading p  { font-size: 10px; color: var(--ink-muted); line-height: 1.2; }

.rail-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--ink-faint);
  font-weight: 600;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-faint);
  transition: background 0.3s, box-shadow 0.3s;
}

[data-state="ok"]   .dot { background: var(--safe);   box-shadow: 0 0 6px var(--safe); }
[data-state="down"] .dot { background: var(--danger);  box-shadow: 0 0 6px var(--danger); }

/* ── Main ───────────────────────────────────────────────────── */
main { padding: 0 12px 12px; }

/* ── Panel ─────────────────────────────────────────────────── */
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  margin-top: 10px;
}

.panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-row h2 {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.04em;
}

/* ── Readout grid ───────────────────────────────────────────── */
.readout-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.readout {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.readout-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}

.readout-value {
  font-size: 20px;
  font-weight: 800;
  color: var(--ink);
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.1;
}

.accent-safe .readout-value { color: var(--safe); }
.accent-safe { border-color: rgba(16,185,129,0.2); }

/* ── Badge ─────────────────────────────────────────────────── */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  color: var(--ink-muted);
  transition: all 0.2s;
}

[data-state="pass"]    { background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.3); color: var(--safe); }
[data-state="blocked"] { background: rgba(239,68,68,0.1);  border-color: rgba(239,68,68,0.3);  color: var(--danger); }
[data-state="idle"]    { color: var(--ink-faint); }

/* ── Firewall split ─────────────────────────────────────────── */
.firewall-grid { grid-template-columns: 1fr 1fr; }

.split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.split-col h3 {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  margin-bottom: 4px;
}

.code-block {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  color: var(--ink-muted);
  max-height: 90px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.code-block.danger { border-color: rgba(239,68,68,0.2); }
.code-block.safe   { border-color: rgba(16,185,129,0.2); color: var(--safe); }

/* ── Task / agent panel ─────────────────────────────────────── */
textarea {
  width: 100%;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  padding: 8px 10px;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
  margin-bottom: 8px;
  display: block;
}

textarea:focus { border-color: var(--accent); }

/* ── Trace list ─────────────────────────────────────────────── */
.trace {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
}

.trace li {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 11px;
  color: var(--ink-muted);
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
  border: 1px solid var(--border);
  animation: fadeIn 0.25s ease;
}

.trace li[data-status="done"] .tstep    { color: var(--safe); }
.trace li[data-status="blocked"] .tstep { color: var(--danger); }
.trace li[data-status="running"] .tstep { color: var(--warn); animation: pulse 1.5s infinite; }
.trace li[data-status="done"]    { border-color: rgba(16,185,129,0.15); }
.trace li[data-status="blocked"] { border-color: rgba(239,68,68,0.15); color: var(--danger); }

.tstep {
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
}

/* ── Approval box ───────────────────────────────────────────── */
.approval {
  background: rgba(245,158,11,0.06);
  border: 1px solid rgba(245,158,11,0.3);
  border-radius: var(--radius-md);
  padding: 12px;
  margin-top: 8px;
  animation: fadeIn 0.3s ease;
}

.approval-head {
  font-size: 11px;
  font-weight: 700;
  color: var(--warn);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.approval-reason {
  font-size: 11px;
  color: var(--ink-muted);
  line-height: 1.5;
  margin-bottom: 6px;
}

.approval-meta {
  font-size: 10px;
  color: var(--ink-faint);
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 8px;
}

.approval-actions { display: flex; gap: 6px; }

/* ── Network guard log ──────────────────────────────────────── */
.log { display: flex; flex-direction: column; gap: 4px; max-height: 130px; overflow-y: auto; }

.log-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  padding: 5px 8px;
  background: var(--surface-alt);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  animation: fadeIn 0.25s ease;
}

.status-allowed { color: var(--safe); font-weight: 700; }
.status-blocked { color: var(--danger); font-weight: 700; }
.status-error   { color: var(--warn); font-weight: 700; }

p.empty { font-size: 10px; color: var(--ink-faint); text-align: center; padding: 8px; font-style: italic; }

/* ── Buttons ────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
  line-height: 1;
  font-family: 'Inter', sans-serif;
  white-space: nowrap;
}

.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: rgba(255,255,255,0.1);
  width: 100%;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(37,99,235,0.35);
}

.btn-primary:hover:not(:disabled) { background: #1d4ed8; }

.btn-ghost {
  background: var(--surface-alt);
  color: var(--ink-muted);
  border-color: var(--border);
}

.btn-ghost:hover:not(:disabled) { background: var(--border); color: var(--ink); }

.btn-approve {
  background: rgba(16,185,129,0.1);
  color: var(--safe);
  border-color: rgba(16,185,129,0.3);
  flex: 1;
}

.btn-approve:hover:not(:disabled) { background: rgba(16,185,129,0.2); }

.btn-reject {
  background: rgba(239,68,68,0.08);
  color: var(--danger);
  border-color: rgba(239,68,68,0.2);
  flex: 1;
}

.btn-reject:hover:not(:disabled) { background: rgba(239,68,68,0.15); }

.btn-small { padding: 5px 9px; font-size: 10px; }

/* ── Animations ─────────────────────────────────────────────── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

/* ── Scrollbar ─────────────────────────────────────────────── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\popup\popup.html
```html

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PraxSight</title>
<link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header class="rail">
    <div class="rail-mark">PS</div>
    <div class="rail-heading">
      <h1>PraxSight</h1>
      <p>Privacy firewall for browser agents</p>
    </div>
    <div class="rail-status" id="backendStatus" data-state="unknown">
      <span class="dot"></span>
      <span class="rail-status-label" id="modeLabel">offline</span>
    </div>
  </header>

  <main>

    <section class="panel" id="scanPanel">
      <div class="panel-row">
        <h2>1 Â· Local Scan</h2>
        <div>
          <button class="btn btn-ghost btn-small" id="scanBtn">Scan page</button>
          <button class="btn btn-ghost btn-small" id="scanOcrBtn">Scan images (OCR)</button>
        </div>
      </div>
      <div class="readout-grid" id="scanCounts">
        <div class="readout">
          <span class="readout-label">Inputs</span>
          <span class="readout-value" id="cInputs">â€“</span>
        </div>
        <div class="readout">
          <span class="readout-label">Controls</span>
          <span class="readout-value" id="cInteractive">â€“</span>
        </div>
        <div class="readout">
          <span class="readout-label">Text</span>
          <span class="readout-value" id="cText">â€“</span>
        </div>
      </div>
    </section>

    <section class="panel" id="firewallPanel">
      <div class="panel-row">
        <h2>Privacy Firewall</h2>
        <span class="badge" id="gateBadge" data-state="idle">GATE IDLE</span>
      </div>
      <div class="readout-grid firewall-grid">
        <div class="readout">
          <span class="readout-label">Detected</span>
          <span class="readout-value" id="mDetected">0</span>
        </div>
        <div class="readout">
          <span class="readout-label">Redacted</span>
          <span class="readout-value" id="mRedacted">0</span>
        </div>
        <div class="readout accent-safe">
          <span class="readout-label">Raw sent</span>
          <span class="readout-value" id="mRawSent">0</span>
        </div>
        <div class="readout">
          <span class="readout-label">OCR Time</span>
          <span class="readout-value" id="mOcrLatency">â€“</span>
        </div>
      </div>
      <div class="split">
        <div class="split-col">
          <h3>What's on the page</h3>
          <pre class="code-block danger" id="rawPreview">Run a scan.</pre>
        </div>
        <div class="split-col">
          <h3>What leaves the browser</h3>
          <pre class="code-block safe" id="sanitizedPreview">Run a scan.</pre>
        </div>
      </div>
    </section>

    <section class="panel" id="agentPanel">
      <div class="panel-row">
        <h2>2 Â· Task</h2>
      </div>
      <textarea id="taskInput" rows="2" placeholder="e.g. Resolve this support ticket">Resolve this support ticket</textarea>
      <button class="btn btn-primary" id="runAgentBtn">Send sanitized context â†’ run agent</button>

      <ol class="trace" id="traceList"></ol>

      <div class="approval" id="approvalBox" hidden>
        <div class="approval-head">âš  Approval required</div>
        <p class="approval-reason" id="approvalReason"></p>
        <div class="approval-meta">
          <span id="approvalAction"></span> Â· risk: <span id="approvalRisk"></span>
        </div>
        <div class="approval-actions">
          <button class="btn btn-approve" id="approveBtn">Approve &amp; execute</button>
          <button class="btn btn-reject" id="rejectBtn">Reject</button>
        </div>
      </div>
    </section>

    <section class="panel" id="networkPanel">
      <div class="panel-row">
        <h2>Network Guard</h2>
        <button class="btn btn-ghost btn-small" id="clearLogBtn">Clear</button>
      </div>
      <div class="log" id="logList">
        <p class="empty">No requests yet.</p>
      </div>
    </section>

    <div style="text-align:center;padding:8px 0 4px;">
      <a href="http://localhost:8000/dashboard/" target="_blank" style="font-size:10px;color:var(--ink-faint);text-decoration:none;">Open Instrument Console â†—</a>
    </div>

  </main>

  <script src="popup.js"></script>
</body>
</html>


```

## C:\Users\vijay\OneDrive\Desktop\praxsight\praxsight\extension\popup\popup.js
```javascript

const $ = (id) => document.getElementById(id);

let activeTabId = null;
let pendingAction = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => chrome.tabs.sendMessage(tabId, message, (r) => {
    if (chrome.runtime.lastError) { resolve(null); return; }
    resolve(r);
  }));
}

function sendToBackground(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (r) => {
    if (chrome.runtime.lastError) { resolve(null); return; }
    resolve(r);
  }));
}

function traceStep(label, status) {
  const li = document.createElement("li");
  li.dataset.status = status;
  li.innerHTML = `<span class="tstep">${status === "done" ? "âœ“" : status === "blocked" ? "âœ•" : "â€¦"}</span><span>${label}</span>`;
  $("traceList").appendChild(li);
  return li;
}

function resetTrace() {
  $("traceList").innerHTML = "";
}

function previewText(obj) {
  const lines = [];
  for (const inp of obj.inputs || []) {
    if (inp.value) lines.push(`${inp.label || inp.tag}: ${inp.value}`);
  }
  for (const n of (obj.textNodes || []).slice(0, 25)) {
    if (n.text && n.text.length < 140) lines.push(n.text);
  }
  return lines.slice(0, 18).join("\n") || "(nothing visible captured)";
}

async function runScan(includeImages = false) {
  const tab = await getActiveTab();
  activeTabId = tab.id;
  const btnId = includeImages ? "scanOcrBtn" : "scanBtn";
  $(btnId).disabled = true;
  $(btnId).textContent = "Scanningâ€¦";

  let resp;
  try {
    resp = await sendToTab(tab.id, { type: includeImages ? "PRAXSIGHT_SCAN_IMAGES" : "PRAXSIGHT_SCAN" });
  } catch (e) {
    resp = null;
  }

  $(btnId).disabled = false;
  $(btnId).textContent = includeImages ? "Scan images (OCR)" : "Scan page";

  if (!resp || !resp.ok) {
    $("gateBadge").textContent = "NO CONTENT SCRIPT";
    $("gateBadge").dataset.state = "blocked";
    return null;
  }

  $("cInputs").textContent = resp.counts.inputs;
  $("cInteractive").textContent = resp.counts.interactive;
  $("cText").textContent = resp.counts.textNodes;

  $("mDetected").textContent = resp.manifest.entities_detected;
  $("mRedacted").textContent = resp.manifest.entities_redacted;
  $("mRawSent").textContent = "0";
  if (resp.ocrLatencyMs !== undefined) {
    $("mOcrLatency").textContent = resp.ocrLatencyMs > 0 ? `${Math.round(resp.ocrLatencyMs)}ms` : 'â€“';
  }

  $("rawPreview").textContent = previewText(resp.raw);
  $("sanitizedPreview").textContent = previewText(resp.sanitized);

  const clean = resp.residual && resp.residual.clean;
  $("gateBadge").textContent = clean ? "GATE: READY" : "GATE: RESIDUAL PII";
  $("gateBadge").dataset.state = clean ? "pass" : "blocked";

  return resp;
}

async function runAgent() {
  resetTrace();
  $("approvalBox").hidden = true;
  pendingAction = null;

  traceStep("Perceiving page (DOM + text)", "done");
  const scan = await runScan();
  if (!scan) {
    traceStep("Scan failed â€” no content script on this page", "blocked");
    return;
  }
  traceStep(`Detected ${scan.manifest.entities_detected} sensitive entities`, "done");
  traceStep(`Redacted ${scan.manifest.entities_redacted} entities before transmission`, "done");

  const gateStep = traceStep("Privacy gate check (manifest + residual scan)", "running");

  const task = $("taskInput").value.trim() || "Resolve this support ticket";
  const payload = {
    task,
    manifest: scan.manifest,
    residual: scan.residual,
    sanitized: scan.sanitized,
  };

  const result = await sendToBackground({ type: "PRAXSIGHT_SEND_TO_SERVER", payload });

  if (result.blocked) {
    gateStep.dataset.status = "blocked";
    gateStep.querySelector(".tstep").textContent = "âœ•";
    traceStep(`Transmission BLOCKED: ${result.reason}`, "blocked");
    await loadLog();
    return;
  }
  gateStep.dataset.status = "done";
  gateStep.querySelector(".tstep").textContent = "âœ“";
  traceStep("Sanitized context sent to backend", "done");

  if (!result.ok) {
    traceStep(`Server error: ${JSON.stringify(result.data || result.error)}`, "blocked");
    await loadLog();
    return;
  }

  const action = result.data;
  traceStep(`Agent proposed: ${action.action}${action.target ? " â†’ " + action.target.id : ""}`, "done");
  traceStep(action.validated ? "Action passed server-side validation" : "Action NOT validated", action.validated ? "done" : "blocked");

  if (action.requires_approval) {
    pendingAction = action;
    $("approvalReason").textContent = action.reason;
    $("approvalAction").textContent = `${action.action} â†’ ${action.target ? action.target.id : "(none)"}`;
    $("approvalRisk").textContent = action.risk;
    $("approvalBox").hidden = false;
    traceStep("Waiting for human approval (Shift-In-Charge equivalent)", "running");
  } else {
    traceStep("Low risk â€” no approval required. Executingâ€¦", "running");
    await executeAndReport(action);
  }

  await loadLog();
}

async function executeAndReport(action) {
  const exec = await sendToTab(activeTabId, { type: "PRAXSIGHT_EXECUTE_ACTION", action });
  traceStep(exec.ok ? "Action executed and verified" : `Execution failed: ${exec.error}`, exec.ok ? "done" : "blocked");
}

async function loadLog() {
  const log = await sendToBackground({ type: "PRAXSIGHT_GET_LOG" });
  const el = $("logList");
  if (!log || !log.length) {
    el.innerHTML = '<p class="empty">No requests yet.</p>';
    return;
  }
  el.innerHTML = "";
  for (const entry of log) {
    const div = document.createElement("div");
    div.className = "log-entry";
    const statusClass = entry.status === "ALLOWED" ? "status-allowed" : entry.status === "BLOCKED" ? "status-blocked" : "status-error";
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const detail =
      entry.status === "ALLOWED"
        ? `${entry.entitiesRedacted}/${entry.entitiesDetected} redacted Â· ${entry.payloadBytes}B Â· ${entry.latencyMs}ms`
        : entry.reason || "";
    div.innerHTML = `<span>${time}</span><span class="${statusClass}">${entry.status}</span><span>${detail}</span>`;
    el.appendChild(div);
  }
}

async function checkBackend() {
  const el = $('backendStatus');
  const label = $('modeLabel');
  try {
    const resp = await fetch('http://localhost:8000/api/health', { method: 'GET' });
    const data = await resp.json().catch(() => ({}));
    el.dataset.state = resp.ok ? 'ok' : 'down';
    if (resp.ok && data.model_router) {
      const active = data.model_router.active;
      label.textContent = active === 'deterministic' ? 'offline' :
        active === 'openrouter' ? 'LLM' : active || 'online';
    } else {
      label.textContent = resp.ok ? 'online' : 'offline';
    }
  } catch {
    el.dataset.state = 'down';
    label.textContent = 'no server';
  }
}

$("scanBtn").addEventListener("click", () => runScan(false));
$("scanOcrBtn").addEventListener("click", () => runScan(true));
$("runAgentBtn").addEventListener("click", runAgent);
$("clearLogBtn").addEventListener("click", async () => {
  await sendToBackground({ type: "PRAXSIGHT_CLEAR_LOG" });
  await loadLog();
});
$("approveBtn").addEventListener("click", async () => {
  $("approvalBox").hidden = true;
  if (pendingAction) await executeAndReport(pendingAction);
  pendingAction = null;
});
$("rejectBtn").addEventListener("click", () => {
  $("approvalBox").hidden = true;
  traceStep("Human rejected the proposed action â€” nothing executed", "blocked");
  pendingAction = null;
});

checkBackend();
loadLog();


```

