/**
 * PraxSight Dashboard — Phase 5 upgrade
 * - Model router status in /api/health
 * - Demo reset via /api/demo/reset
 * - Auto-polling every 5s
 * - Proper error boundaries
 * - Honest pipeline states
 */
const state = { scan: null, backend: false, pollingTimer: null };
const $ = (id) => document.getElementById(id);

// ── Helpers ───────────────────────────────────────────────────────────────

function setDot(id, status) {
  const el = $(id);
  if (el) el.className = status;
}

function setPipeline(step, status) {
  const el = document.querySelector(`[data-step="${step}"]`);
  if (el) el.className = `pipeline-step ${status}`;
}

function safePreview(value) {
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
}

function previewText(obj) {
  const lines = [];
  for (const input of obj?.inputs || []) {
    if (input.value) lines.push(`${input.label || input.tag}: ${input.value}`);
  }
  for (const node of (obj?.textNodes || []).slice(0, 25)) {
    if (node.text) lines.push(node.text);
  }
  return lines.slice(0, 18).join('\n') || '(nothing visible captured)';
}

function showNotice(text, tone = '') {
  const el = $('connectionNotice');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'danger' ? 'notice danger' : 'notice';
}

// ── Backend health check ──────────────────────────────────────────────────

async function checkBackend() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    state.backend = response.ok;
    setDot('networkDot', response.ok ? 'ok' : 'down');

    const version = data.version || 'unknown';
    const router = data.model_router;
    let routerLabel = 'DETERMINISTIC';
    let routerClass = 'model-badge local';
    if (router) {
      if (router.active === 'openrouter') {
        routerLabel = router.openrouter?.model?.split('/').pop()?.split(':')[0]?.toUpperCase() || 'OPENROUTER';
        routerClass = 'model-badge llm';
      } else if (router.active === 'google') {
        routerLabel = (router.google?.model || 'GOOGLE AI').toUpperCase();
        routerClass = 'model-badge llm';
      }
    }
    const badge = $('modelBadge');
    if (badge) { badge.textContent = routerLabel; badge.className = routerClass; }
    $('backendVersion').textContent = `backend v${version} / model: ${routerLabel.toLowerCase()}`;

    await loadLatestSession();
  } catch {
    state.backend = false;
    setDot('networkDot', 'down');
    $('backendVersion').textContent = 'backend: unavailable — run: python run.py';
  }
}

// ── Demo reset ────────────────────────────────────────────────────────────

async function resetDemo() {
  try {
    await fetch('/api/demo/reset', { method: 'POST' });
    state.scan = null;
    $('heroTitle').textContent = 'Demo reset — ready for a fresh run';
    $('heroDescription').textContent = 'Session cleared. Open the demo page and run a new scan.';
    $('postureValue').textContent = 'LOCAL';
    $('postureValue').className = 'posture-value idle';
    $('postureDetail').textContent = 'No page data has left the browser.';
    $('actionEmpty').hidden = false;
    $('actionDetails').hidden = true;
    $('actionBadge').textContent = 'WAITING';
    $('actionBadge').className = 'badge';
    $('scanBadge').textContent = 'IDLE';
    $('scanBadge').className = 'badge';
    $('rawPreview').textContent = 'No scan captured yet.';
    $('sanitizedPreview').textContent = 'No sanitized payload yet.';
    ['localDot', 'gateDot', 'agentDot'].forEach(id => setDot(id, ''));
    ['detect', 'sanitize', 'reason', 'validate', 'act'].forEach(s => setPipeline(s, ''));
    setPipeline('see', 'active');
    setPipeline('verify', 'not-built');
    $('agentButton').disabled = true;
    $('inputsMetric').textContent = '—';
    $('interactiveMetric').textContent = '—';
    $('textMetric').textContent = '—';
    $('detectedMetric').textContent = '—';
    $('redactedMetric').textContent = '—';
    $('networkLog').innerHTML = '<div class="empty-state">Log cleared — run a new scan to populate.</div>';
    showNotice('Demo session reset. Run a local scan to start.');
    $('lastUpdated').textContent = 'reset at ' + new Date().toLocaleTimeString();
  } catch (e) {
    showNotice('Reset failed: ' + e.message, 'danger');
  }
}

// ── Session polling ───────────────────────────────────────────────────────

async function loadLatestSession() {
  try {
    const response = await fetch('/api/session/latest');
    const session = await response.json();

    if (session.action) {
      renderAction(session.action);
      $('heroTitle').textContent = 'Latest agent result received';
      $('heroDescription').textContent = 'Structured action passed through the privacy gate and server validation.';
      $('postureDetail').textContent = 'Sanitized context used — raw values remain browser-only.';
      setPipeline('see', 'complete');
      setPipeline('detect', 'complete');
      setPipeline('sanitize', 'complete');
      setPipeline('reason', 'complete');
      setPipeline('validate', session.action.validated ? 'complete' : 'blocked');
      setPipeline('act', session.action.validated ? 'complete' : 'blocked');
      setPipeline('verify', 'not-built');
      setDot('agentDot', session.action.requires_approval ? 'warn' : 'ok');
    }

    if (session.scan) {
      $('detectedMetric').textContent = session.scan.entitiesDetected ?? '—';
      $('redactedMetric').textContent = session.scan.entitiesRedacted ?? '—';
      const clean = session.scan.sanitized;
      $('scanBadge').textContent = clean ? 'SANITIZED' : 'BLOCKED';
      $('scanBadge').className = `badge ${clean ? 'ready' : 'blocked'}`;
      $('postureValue').textContent = clean ? 'PROTECTED' : 'BLOCKED';
      $('postureValue').className = `posture-value ${clean ? 'protected' : 'blocked'}`;
      $('rawPreview').textContent = 'Raw page values remain inside the browser only — not exported.';
      if (session.scan.sanitizedPayload) {
        $('sanitizedPreview').textContent = safePreview(session.scan.sanitizedPayload);
      }
      if (session.updated_at) {
        $('lastUpdated').textContent = new Date(session.updated_at).toLocaleTimeString();
      }
    }

    if (session.network) {
      const status = session.network.status || 'ALLOWED';
      const ms = session.network.latencyMs ? ` · ${session.network.latencyMs}ms` : '';
      $('networkLog').innerHTML = `
        <div class="network-entry">
          <span>${session.updated_at ? new Date(session.updated_at).toLocaleTimeString() : 'Latest'} · <b class="${status === 'ALLOWED' ? 'allowed' : 'error'}">${status}</b></span>
          <span class="detail">/api/agent/act${ms}</span>
        </div>`;
    }
  } catch {
    // Session polling is best-effort; the extension bridge is the primary live path.
  }
}

// ── Extension bridge ──────────────────────────────────────────────────────

function receiveBridge(type, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      reject(new Error('extension_bridge_timeout'));
    }, timeout);
    function listener(event) {
      if (event.source !== window || !event.data || event.data.type !== type) return;
      clearTimeout(timer);
      window.removeEventListener('message', listener);
      resolve(event.data);
    }
    window.addEventListener('message', listener);
  });
}

function requestBridge(type, payload = {}) {
  const responseType = `${type}_RESULT`;
  const result = receiveBridge(responseType);
  window.postMessage({ source: 'praxsight-dashboard', type, ...payload }, window.location.origin);
  return result;
}

// ── Scan ──────────────────────────────────────────────────────────────────

function renderScan(result) {
  state.scan = result;
  const counts = result.counts || {};
  $('inputsMetric').textContent = counts.inputs ?? 0;
  $('interactiveMetric').textContent = counts.interactive ?? 0;
  $('textMetric').textContent = counts.textNodes ?? 0;
  $('detectedMetric').textContent = result.manifest?.entities_detected ?? 0;
  $('redactedMetric').textContent = result.manifest?.entities_redacted ?? 0;
  $('rawPreview').textContent = previewText(result.raw);
  $('sanitizedPreview').textContent = safePreview({
    elements: {
      inputs: result.sanitized?.inputs || [],
      textNodes: (result.sanitized?.textNodes || []).slice(0, 12),
    },
    manifest: result.manifest,
  });
  const clean = result.residual?.clean === true;
  $('scanBadge').textContent = clean ? 'SANITIZED' : 'BLOCKED';
  $('scanBadge').className = `badge ${clean ? 'ready' : 'blocked'}`;
  $('postureValue').textContent = clean ? 'PROTECTED' : 'BLOCKED';
  $('postureValue').className = `posture-value ${clean ? 'protected' : 'blocked'}`;
  $('postureDetail').textContent = clean
    ? `${result.manifest?.entities_redacted || 0} sensitive entities redacted before transmission.`
    : 'Residual PII found — transmission will fail closed.';
  $('heroTitle').textContent = clean
    ? 'Page captured behind the privacy gate'
    : 'Page capture blocked by the privacy gate';
  $('heroDescription').textContent = clean
    ? `${result.manifest?.entities_detected || 0} entities detected, ${result.manifest?.entities_redacted || 0} redacted. The sanitized payload is safe to transmit.`
    : 'Residual PII was found in the sanitized output. The background gate will refuse to transmit this.';

  setDot('localDot', 'ok');
  setDot('gateDot', clean ? 'ok' : 'down');
  setDot('agentDot', '');
  setPipeline('see', 'complete');
  setPipeline('detect', 'complete');
  setPipeline('sanitize', clean ? 'complete' : 'blocked');
  setPipeline('reason', '');
  setPipeline('validate', '');
  setPipeline('act', '');
  setPipeline('verify', 'not-built');
  $('agentButton').disabled = !clean;
  $('lastUpdated').textContent = new Date().toLocaleTimeString();
}

async function runScan() {
  const button = $('scanButton');
  button.disabled = true;
  button.textContent = '⟳ Scanning…';
  showNotice('Requesting a local scan from the browser extension…');
  try {
    const result = await requestBridge('PRAXSIGHT_DASHBOARD_SCAN');
    if (!result.ok) throw new Error(result.error || 'scan_failed');
    renderScan(result.scan);
    showNotice('Local scan complete. No raw PII was sent to the dashboard.');
  } catch (error) {
    setDot('localDot', 'down');
    setDot('gateDot', 'down');
    
    let msg = 'Extension bridge unavailable. Load extension/ as an unpacked Chrome extension, open the demo page, then try again.';
    if (error.message === 'open_the_demo_page_in_another_tab') {
      msg = 'Please open a Demo Page (like the Support Ticket) in another tab first.';
    } else if (error.message === 'content_script_missing_on_active_page') {
      msg = 'Please go to the Demo Page tab and refresh it (F5) so the extension can load into it.';
    } else if (error.message !== 'extension_bridge_timeout') {
      msg = `Scan failed: ${error.message}`;
    }
    
    showNotice(msg, 'danger');
  } finally {
    button.disabled = false;
    button.textContent = '▶ Run local scan';
  }
}

// ── Action rendering ──────────────────────────────────────────────────────

function renderAction(action) {
  $('actionEmpty').hidden = true;
  $('actionDetails').hidden = false;
  $('actionBadge').textContent = action.requires_approval ? 'NEEDS APPROVAL' : 'EXECUTED';
  $('actionBadge').className = `badge ${action.requires_approval ? '' : 'ready'}`;
  $('actionName').textContent = action.action.toUpperCase();
  $('actionTarget').textContent = action.target?.id || 'none';
  $('actionRisk').textContent = action.risk;
  $('actionRisk').className = action.risk === 'high' ? 'danger-text' : action.risk === 'medium' ? 'warn-text' : 'safe-text';
  $('actionApproval').textContent = action.requires_approval ? 'Yes — see extension popup' : 'No — low risk';
  $('actionReason').textContent = action.reason;
  setDot('agentDot', action.requires_approval ? 'warn' : 'ok');
  setPipeline('reason', 'complete');
  setPipeline('validate', action.validated ? 'complete' : 'blocked');
  setPipeline('act', action.validated ? (action.requires_approval ? 'active' : 'complete') : 'blocked');
}

// ── Agent ─────────────────────────────────────────────────────────────────

async function runAgent() {
  if (!state.scan) return;
  const button = $('agentButton');
  button.disabled = true;
  button.textContent = '⟳ Reasoning…';
  setPipeline('reason', 'active');
  showNotice('Sending only the sanitized context through the extension privacy gate…');
  try {
    const task = $('taskInput').value.trim() || 'Resolve this support ticket';
    const result = await requestBridge('PRAXSIGHT_DASHBOARD_AGENT', { task });
    if (!result.ok) throw new Error(result.error || JSON.stringify(result.data || {}));
    renderAction(result.data);
    showNotice(
      result.data.requires_approval
        ? 'Agent proposed an action. Approval required in the extension popup.'
        : 'Agent action returned and passed through the server validator.'
    );
    await refreshLog();
  } catch (error) {
    setPipeline('reason', 'blocked');
    setDot('agentDot', 'down');
    showNotice(`Agent request failed: ${error.message}`, 'danger');
  } finally {
    button.disabled = false;
    button.textContent = '⚡ Run agent';
  }
}

// ── Network log ───────────────────────────────────────────────────────────

async function refreshLog() {
  try {
    const response = await requestBridge('PRAXSIGHT_DASHBOARD_LOG');
    const log = response.log || [];
    if (!log.length) {
      $('networkLog').innerHTML = '<div class="empty-state">No requests yet — run the agent to populate.</div>';
      return;
    }
    $('networkLog').innerHTML = log.map(entry => `
      <div class="network-entry">
        <span>${new Date(entry.timestamp).toLocaleTimeString()} · <b class="${entry.status === 'ALLOWED' ? 'allowed' : 'error'}">${entry.status}</b></span>
        <span class="detail">${entry.endpoint || entry.reason || ''} ${entry.latencyMs ? `· ${entry.latencyMs}ms` : ''} ${entry.payloadBytes ? `· ${entry.payloadBytes}B` : ''}</span>
      </div>`).join('');
  } catch {
    // Extension bridge not yet active — empty state is self-explanatory.
  }
}

// ── Auto-polling ──────────────────────────────────────────────────────────

function startPolling() {
  if (state.pollingTimer) return;
  state.pollingTimer = setInterval(() => {
    if (state.backend) loadLatestSession();
  }, 5000);
}

// ── Init ──────────────────────────────────────────────────────────────────

$('scanButton').addEventListener('click', runScan);
$('agentButton').addEventListener('click', runAgent);
$('refreshLog').addEventListener('click', refreshLog);
$('resetBtn').addEventListener('click', resetDemo);

// Set initial pipeline state honestly
setPipeline('see', 'active');
setPipeline('verify', 'not-built');

checkBackend().then(startPolling);
