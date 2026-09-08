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

  async function runScan() {
    const perception = PraxSight.perception.capturePage();
    const rawDetections = await PraxSight.detectors.detect(perception);
    const policed = PraxSight.policyEngine.applyPolicy(rawDetections);
    const sanitized = PraxSight.redaction.sanitizePerception(perception, policed);
    const manifest = PraxSight.policyEngine.buildManifest(policed, sanitized);
    const residual = residualPiiScan(sanitized);
    lastScan = { perception, detections: policed, sanitized, manifest, residual };
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
      case "read":
        return el ? { ok: true, text: el.innerText || el.textContent } : { ok: false, error: "target_not_found" };
      default:
        return { ok: false, error: "unsupported_action" };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PRAXSIGHT_SCAN") {
      runScan().then((result) =>
        sendResponse({
          ok: true,
          manifest: result.manifest,
          residual: result.residual,
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
        const result = await runScan();
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
        const scan = lastScan || await runScan();
        const payload = { task: event.data.task || "Resolve this support ticket", manifest: scan.manifest, residual: scan.residual, sanitized: scan.sanitized };
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
