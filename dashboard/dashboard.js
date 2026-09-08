const state = { scan: null, backend: false };
const $ = (id) => document.getElementById(id);

function setDot(id, status) { $(id).className = status; }
function setPipeline(step, status) { const el = document.querySelector(`[data-step="${step}"]`); if (el) el.className = `pipeline-step ${status}`; }
function safePreview(value) { return JSON.stringify(value, null, 2).slice(0, 5000); }
function previewText(obj) {
  const lines = [];
  for (const input of obj?.inputs || []) if (input.value) lines.push(`${input.label || input.tag}: ${input.value}`);
  for (const node of (obj?.textNodes || []).slice(0, 25)) if (node.text) lines.push(node.text);
  return lines.slice(0, 18).join("\n") || "(nothing visible captured)";
}
function showNotice(text, tone = "") { $("connectionNotice").textContent = text; $("connectionNotice").style.color = tone === "danger" ? "var(--ps-danger)" : ""; }

async function checkBackend() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.backend = response.ok;
    setDot("networkDot", response.ok ? "ok" : "down");
    $("backendVersion").textContent = `backend: ${data.service || "available"} / ${data.version || "unknown"}`;
    await loadLatestSession();
  } catch {
    setDot("networkDot", "down");
    $("backendVersion").textContent = "backend status: unavailable";
  }
}

async function loadLatestSession() {
  try {
    const response = await fetch("/api/session/latest");
    const session = await response.json();
    if (session.action) {
      renderAction(session.action);
      $("heroTitle").textContent = "Latest agent result received";
      $("heroDescription").textContent = "The structured action passed through the privacy gate and server validation.";
      $("postureDetail").textContent = "Sanitized context was used; raw page values remain browser-only.";
      setPipeline("see", "complete"); setPipeline("detect", "complete"); setPipeline("sanitize", "complete"); setPipeline("reason", "complete"); setPipeline("act", session.action.validated ? "complete" : "blocked");
      setDot("agentDot", session.action.requires_approval ? "warn" : "ok");
      showNotice("Showing the latest structured result from the extension session.");
    }
    if (session.scan) {
      $("detectedMetric").textContent = session.scan.entitiesDetected ?? "—";
      $("redactedMetric").textContent = session.scan.entitiesRedacted ?? "—";
      $("scanBadge").textContent = session.scan.sanitized ? "SANITIZED" : "BLOCKED";
      $("scanBadge").className = `badge ${session.scan.sanitized ? "ready" : "blocked"}`;
      $("postureValue").textContent = session.scan.sanitized ? "PROTECTED" : "BLOCKED";
      $("rawPreview").textContent = "Raw page values remain inside the browser and are not exported to the dashboard.";
      if (session.scan.sanitizedPayload) $("sanitizedPreview").textContent = safePreview(session.scan.sanitizedPayload);
    }
    if (session.network) {
      $("networkLog").innerHTML = `<div class="network-entry"><span>${session.updated_at ? new Date(session.updated_at).toLocaleTimeString() : "Latest request"} · <b class="allowed">${session.network.status || "ALLOWED"}</b></span><span class="detail">Latest agent request completed through the backend privacy gate.</span></div>`;
    }
  } catch { /* The bridge remains the primary live data path. */ }
}

function receiveBridge(type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", listener); reject(new Error("extension_bridge_timeout")); }, timeout);
    function listener(event) {
      if (event.source !== window || !event.data || event.data.type !== type) return;
      clearTimeout(timer); window.removeEventListener("message", listener); resolve(event.data);
    }
    window.addEventListener("message", listener);
  });
}
function requestBridge(type, payload = {}) {
  const responseType = `${type}_RESULT`;
  const result = receiveBridge(responseType);
  window.postMessage({ source: "praxsight-dashboard", type, ...payload }, window.location.origin);
  return result;
}

function renderScan(result) {
  state.scan = result;
  const counts = result.counts || {};
  $("inputsMetric").textContent = counts.inputs ?? 0;
  $("interactiveMetric").textContent = counts.interactive ?? 0;
  $("textMetric").textContent = counts.textNodes ?? 0;
  $("detectedMetric").textContent = result.manifest?.entities_detected ?? 0;
  $("redactedMetric").textContent = result.manifest?.entities_redacted ?? 0;
  $("rawPreview").textContent = previewText(result.raw);
  $("sanitizedPreview").textContent = safePreview({ elements: { inputs: result.sanitized?.inputs || [], textNodes: (result.sanitized?.textNodes || []).slice(0, 12) }, manifest: result.manifest });
  const clean = result.residual?.clean === true;
  $("scanBadge").textContent = clean ? "SANITIZED" : "BLOCKED";
  $("scanBadge").className = `badge ${clean ? "ready" : "blocked"}`;
  $("postureValue").textContent = clean ? "PROTECTED" : "BLOCKED";
  $("postureValue").style.color = clean ? "var(--ps-safe)" : "var(--ps-danger)";
  $("postureDetail").textContent = clean ? `${result.manifest?.entities_redacted || 0} sensitive entities redacted before transmission.` : "Residual PII was found; transmission will fail closed.";
  $("heroTitle").textContent = clean ? "Page captured behind the privacy gate" : "Page capture blocked by the privacy gate";
  setDot("localDot", "ok"); setDot("gateDot", clean ? "ok" : "down"); setDot("agentDot", "");
  setPipeline("see", "complete"); setPipeline("detect", "complete"); setPipeline("sanitize", clean ? "complete" : "blocked"); setPipeline("reason", ""); setPipeline("act", "");
  $("agentButton").disabled = !clean;
  $("lastUpdated").textContent = new Date().toLocaleTimeString();
}

async function runScan() {
  const button = $("scanButton"); button.disabled = true; button.textContent = "Scanning…"; showNotice("Requesting a local scan from the browser extension…");
  try {
    const result = await requestBridge("PRAXSIGHT_DASHBOARD_SCAN");
    if (!result.ok) throw new Error(result.error || "scan_failed");
    renderScan(result.scan); showNotice("Local scan complete. No raw page value was sent to the dashboard.");
  } catch (error) {
    setDot("localDot", "down"); setDot("gateDot", "down"); showNotice("Extension bridge unavailable. Load extension/ as an unpacked extension, then refresh this page.", "danger");
  } finally { button.disabled = false; button.textContent = "Run local scan"; }
}

function renderAction(action) {
  $("actionEmpty").hidden = true; $("actionDetails").hidden = false;
  $("actionBadge").textContent = action.requires_approval ? "ACTION" : "EXECUTED";
  $("actionBadge").className = `badge ${action.requires_approval ? "" : "ready"}`;
  $("actionName").textContent = action.action.toUpperCase();
  $("actionTarget").textContent = action.target?.id || "none";
  $("actionRisk").textContent = action.risk;
  $("actionRisk").style.color = action.risk === "high" ? "var(--ps-danger)" : action.risk === "medium" ? "var(--ps-warn)" : "var(--ps-safe)";
  $("actionReason").textContent = action.reason;
  setDot("agentDot", action.requires_approval ? "warn" : "ok"); setPipeline("reason", "complete"); setPipeline("act", action.validated ? "complete" : "blocked");
}

async function runAgent() {
  if (!state.scan) return;
  const button = $("agentButton"); button.disabled = true; button.textContent = "Reasoning…"; setPipeline("reason", "active"); showNotice("Sending only the sanitized context through the extension network guard…");
  try {
    const result = await requestBridge("PRAXSIGHT_DASHBOARD_AGENT", { task: $("taskInput").value.trim() || "Resolve this support ticket" });
    if (!result.ok) throw new Error(result.error || JSON.stringify(result.data || {}));
    renderAction(result.data); showNotice(result.data.requires_approval ? "Agent proposed an action. Human approval is required in the extension popup." : "Agent action returned and passed through the server validator."); await refreshLog();
  } catch (error) { setPipeline("reason", "blocked"); setDot("agentDot", "down"); showNotice(`Agent request failed: ${error.message}`, "danger"); }
  finally { button.disabled = false; button.textContent = "Run agent"; }
}

async function refreshLog() {
  try {
    const response = await requestBridge("PRAXSIGHT_DASHBOARD_LOG");
    const log = response.log || [];
    $("networkLog").innerHTML = log.length ? log.map(entry => `<div class="network-entry"><span>${new Date(entry.timestamp).toLocaleTimeString()} · <b class="${entry.status === "ALLOWED" ? "allowed" : "error"}">${entry.status}</b></span><span class="detail">${entry.endpoint || entry.reason || "No additional detail"}${entry.latencyMs ? ` · ${entry.latencyMs}ms` : ""}</span></div>`).join("") : '<div class="empty-state">No requests yet.</div>';
  } catch { /* The empty state already explains the unavailable bridge. */ }
}

$("scanButton").addEventListener("click", runScan);
$("agentButton").addEventListener("click", runAgent);
$("refreshLog").addEventListener("click", refreshLog);
checkBackend();
