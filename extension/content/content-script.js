/**
 * PraxSight — Content Script Orchestrator
 *
 * Wires perception → detection → policy → redaction into one scan, and
 * exposes it to the popup via chrome.runtime messaging. This file has DOM
 * access (needed to execute agent actions) but never calls fetch() itself —
 * that chokepoint lives only in background.js (Phase 5 hard gate).
 */
(function () {
  const PraxSight = window.PraxSight;
  let lastScan = null;

  /**
   * Defense-in-depth pass #1 (client side): re-scan the *sanitized* payload
   * for obvious residual PII before it's even offered to background.js.
   * This does not trust the redaction step blindly — if anything still
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
        // 'type' action unless value_policy === 'user-provided' — the agent
        // is structurally prevented from inventing field values.
        return { ok: false, error: "requires_user_input_not_implemented_in_popup" };
      case "read": {
        if (el) return { ok: true, text: el.innerText || el.textContent };
        // No specific target — the agent legitimately found nothing to
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
      runScan(msg.type === "PRAXSIGHT_SCAN_IMAGES")
        .then((result) =>
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
        )
        .catch((e) => {
          console.error("runScan failed:", e);
          sendResponse({ ok: false, error: e.toString() });
        });
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
    if (event.data.type === "PRAXSIGHT_DASHBOARD_EXECUTE") {
      try {
        const result = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PRAXSIGHT_EXECUTE_ACTION_ACTIVE", action: event.data.action }, resolve));
        window.postMessage({ type: "PRAXSIGHT_DASHBOARD_EXECUTE_RESULT", ...result }, window.location.origin);
      } catch (error) {
        window.postMessage({ type: "PRAXSIGHT_DASHBOARD_EXECUTE_RESULT", ok: false, error: String(error) }, window.location.origin);
      }
    }
  });
})();
