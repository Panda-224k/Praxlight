# Handoff: Demo Reliability Bugfixes (Block 0)

**Context:** Before proceeding to Phase 3 (OCR), two critical demo-blocking bugs were identified and fixed to ensure the extension reliably performs during live demonstrations.

## Bug A: Targetless Read Action Failure
* **File:** extension/content/content-script.js
* **Root Cause:** When the agent proposed a legitimate {action: "read", target: null} (e.g., when a task doesn't match any clickable button), the executeAction function's internal read case would fail. The early guard correctly allowed targetless reads, but the read case itself did return el ? ... : {ok: false, error: "target_not_found"}, which threw an error since el was null.
* **Fix:** Rewrote the read case. If el is present, it returns the element's text. If el is null (no specific target), it falls back to reading the innerText of document.body (up to 800 characters) so the agent gets a page summary instead of a generic failure.
* **Verification:** Verified by returning a targetless read action; the extension returns a page summary without throwing target_not_found. All 24 JS tests pass.

## Bug B: Extension Bridge Unavailable on Pre-existing Tabs
* **File:** extension/background.js
* **Root Cause:** Chrome extensions only inject content scripts into tabs loaded *after* the extension is enabled or reloaded. If a user tried to scan a demo tab that was left open prior to reloading the extension, chrome.tabs.sendMessage would throw an error, causing the dashboard bridge to report "Extension bridge unavailable".
* **Fix:** Introduced sendMessageWithRecovery(tabId, message). If the initial chrome.tabs.sendMessage fails, it uses chrome.scripting.executeScript to dynamically inject the required content script files (perception.js, detectors.js, redaction.js, policy-engine.js, content-script.js) into the target tab on demand, and then retries the message.
* **Verification:** Tested tab message delivery; failures trigger injection and self-heal gracefully. All 6 Python tests pass.

## Status
* **Test Counts:** 24/24 JS tests passing, 6/6 Python tests passing.
* **Ready for:** Block 1 (Phase 3: OCR integration).
