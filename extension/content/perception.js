/**
 * PraxSight — Local DOM Perception Layer (Phase 1)
 *
 * Extracts inputs, interactive elements, and visible text into a plain-data
 * schema with no live DOM references, so everything downstream (detectors,
 * redaction, the background service worker, the server) only ever touches
 * inert JSON — never a live node a bug could accidentally serialize whole.
 *
 * No PII detection happens here. This module only answers "what is on the
 * page and where" — see content/privacy/detectors.js for "what's sensitive".
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = root.getComputedStyle ? root.getComputedStyle(el) : null;
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

  let idCounter = 0;
  function elementId(el) {
    if (el.dataset && el.dataset.praxsightId) return el.dataset.praxsightId;
    const gen = `ps_${el.tagName.toLowerCase()}_${idCounter++}`;
    if (el.dataset) el.dataset.praxsightId = gen;
    return gen;
  }

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

  function extractInputs() {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    return inputs.filter(isVisible).map((el) => ({
      psId: elementId(el),
      tag: el.tagName.toLowerCase(),
      type: (el.type || "text").toLowerCase(),
      name: el.name || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      label: nearestLabelText(el),
      // Password values are never read into memory at all, not even pre-redaction.
      value: el.type === "password" ? "" : el.value || "",
      bbox: bboxOf(el),
    }));
  }

  function extractInteractive() {
    const els = Array.from(document.querySelectorAll('button, a[href], [role="button"], summary'));
    return els.filter(isVisible).map((el) => ({
      psId: elementId(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || (el.tagName.toLowerCase() === "button" ? "button" : "link"),
      text: (el.innerText || el.textContent || "").trim().slice(0, 120),
      bbox: bboxOf(el),
    }));
  }

  function extractText(maxChars = 20000) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : "";
        if (["script", "style", "noscript", "template"].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && !isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const chunks = [];
    let node;
    let total = 0;
    while ((node = walker.nextNode()) && total < maxChars) {
      const t = node.textContent.trim();
      if (!t) continue;
      chunks.push({ text: t, psId: elementId(node.parentElement), bbox: bboxOf(node.parentElement) });
      total += t.length;
    }
    return chunks;
  }

  function capturePage() {
    return {
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      inputs: extractInputs(),
      interactive: extractInteractive(),
      textNodes: extractText(),
    };
  }

  PraxSight.perception = { capturePage, isVisible, bboxOf };
})(typeof window !== "undefined" ? window : globalThis);