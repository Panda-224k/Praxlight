/**
 * PraxSight — Background Service Worker
 *
 * THIS FILE CONTAINS THE ONLY fetch() CALL IN THE ENTIRE EXTENSION THAT
 * TARGETS THE AI BACKEND. Content scripts have no host permission for
 * BACKEND_URL (see manifest.json — host_permissions is scoped to just the
 * backend, and content scripts don't declare it), so structurally, the only
 * way sanitized context reaches the network is through sendSanitizedContext()
 * below. That's the "hard privacy gate" from the build plan (Phase 5).
 *
 * Two independent checks run before any network call:
 *   1. The manifest the content script attached must claim performed=true.
 *   2. A residual-PII re-scan of the sanitized payload (defense-in-depth
 *      pass #2, on top of the one content-script.js already ran) must be
 *      clean.
 * Either failing BLOCKS the request and logs it — this endpoint never
 * silently drops the check.
 *
 * Honesty note (see docs/PRIVACY_MODEL.md "Known limitations"): this proves
 * there is exactly one code path to the network and that it enforces these
 * checks, but it is still the extension checking its own homework. A
 * fully independent proof — e.g. routing through a separate local logging
 * proxy outside this extension's process — is called out as a documented
 * follow-up, following the same lesson the sibling Prax AI project's
 * network-monitor process encodes.
 */

const BACKEND_URL = "http://localhost:8000";
const REQUEST_LOG_KEY = "praxsight_request_log";

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

async function scanActivePageForDashboard(senderTabId) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs.find((tab) => tab.active && tab.id !== senderTabId && tab.url && !tab.url.startsWith(`${BACKEND_URL}/dashboard`))
    || tabs.find((tab) => tab.id !== senderTabId && tab.url && !tab.url.startsWith(`${BACKEND_URL}/dashboard`));
  if (!target || !target.id) return { ok: false, error: "open_the_demo_page_in_another_tab" };
  try {
    const result = await chrome.tabs.sendMessage(target.id, { type: "PRAXSIGHT_SCAN" });
    return result && result.ok ? result : { ok: false, error: "active_page_scan_failed" };
  } catch (e) {
    return { ok: false, error: "content_script_missing_on_active_page" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
