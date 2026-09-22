const $ = (id) => document.getElementById(id);

let activeTabId = null;
let pendingAction = null;
const handledApprovals = new Set();

function approvalKey(action) {
  if (!action) return 'none';
  const target = action.target && action.target.id ? action.target.id : 'none';
  return `${action.action || 'action'}::${target}::${action.reason || ''}`;
}

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
  li.innerHTML = `<span class="tstep">${status === "done" ? "✓" : status === "blocked" ? "✕" : "…"}</span><span>${label}</span>`;
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
  $(btnId).textContent = "Scanning…";

  let resp;
  try {
    resp = await sendToTab(tab.id, { type: includeImages ? "PRAXSIGHT_SCAN_IMAGES" : "PRAXSIGHT_SCAN" });
  } catch (e) {
    resp = null;
  }

  $(btnId).disabled = false;
  $(btnId).textContent = includeImages ? "Scan images (OCR)" : "Scan page";

  if (!resp) {
    $("btnScanImages").disabled = false;
    $("btnScanImages").textContent = "Scan images (OCR)";
    $("gateBadge").textContent = "NO CONTENT SCRIPT";
    $("gateBadge").dataset.state = "blocked";
    return null;
  }
  if (!resp.ok) {
    $("btnScanImages").disabled = false;
    $("btnScanImages").textContent = "Scan images (OCR)";
    $("gateBadge").textContent = "ERROR";
    $("gateBadge").dataset.state = "blocked";
    console.error("Scan error:", resp.error);
    alert("Scan error: " + resp.error);
    return null;
  }

  $("cInputs").textContent = resp.counts.inputs;
  $("cInteractive").textContent = resp.counts.interactive;
  $("cText").textContent = resp.counts.textNodes;

  $("mDetected").textContent = resp.manifest.entities_detected;
  $("mRedacted").textContent = resp.manifest.entities_redacted;
  $("mRawSent").textContent = "0";
  if (resp.ocrLatencyMs !== undefined) {
    $("mOcrLatency").textContent = resp.ocrLatencyMs > 0 ? `${Math.round(resp.ocrLatencyMs)}ms` : '–';
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
    traceStep("Scan failed — no content script on this page", "blocked");
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
    gateStep.querySelector(".tstep").textContent = "✕";
    traceStep(`Transmission BLOCKED: ${result.reason}`, "blocked");
    await loadLog();
    return;
  }
  gateStep.dataset.status = "done";
  gateStep.querySelector(".tstep").textContent = "✓";
  traceStep("Sanitized context sent to backend", "done");

  if (!result.ok) {
    traceStep(`Server error: ${JSON.stringify(result.data || result.error)}`, "blocked");
    await loadLog();
    return;
  }

  const action = result.data;
  traceStep(`Agent proposed: ${action.action}${action.target ? " → " + action.target.id : ""}`, "done");
  traceStep(action.validated ? "Action passed server-side validation" : "Action NOT validated", action.validated ? "done" : "blocked");

  if (action.requires_approval) {
    if (handledApprovals.has(approvalKey(action))) {
      traceStep("Approval already handled for this action", "done");
      return;
    }
    pendingAction = action;
    $("approvalReason").textContent = action.reason;
    $("approvalAction").textContent = `${action.action} → ${action.target ? action.target.id : "(none)"}`;
    $("approvalRisk").textContent = action.risk;
    $("approvalBox").hidden = false;
    traceStep("Waiting for human approval (Shift-In-Charge equivalent)", "running");
  } else {
    traceStep("Low risk — no approval required. Executing…", "running");
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
        ? `${entry.entitiesRedacted}/${entry.entitiesDetected} redacted · ${entry.payloadBytes}B · ${entry.latencyMs}ms`
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
  if (!pendingAction) return;
  handledApprovals.add(approvalKey(pendingAction));
  await executeAndReport(pendingAction);
  pendingAction = null;
});
$("rejectBtn").addEventListener("click", () => {
  $("approvalBox").hidden = true;
  if (pendingAction) {
    handledApprovals.add(approvalKey(pendingAction));
  }
  traceStep("Human rejected the proposed action — nothing executed", "blocked");
  pendingAction = null;
});

checkBackend();
loadLog();
