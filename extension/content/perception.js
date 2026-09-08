/**
 * PraxSight — Local DOM Perception Layer (Phase 1, hardened in Phase 2)
 *
 * Extracts inputs, interactive elements, and visible text into a plain-data
 * schema with no live DOM references, so everything downstream (detectors,
 * redaction, the background service worker, the server) only ever touches
 * inert JSON — never a live node a bug could accidentally serialize whole.
 *
 * No PII detection happens here. This module only answers "what is on the
 * page and where" — see content/privacy/detectors.js for "what's sensitive".
 *
 * Phase 2 additions (all additive — every field that existed before Phase 2
 * still exists with the same name and meaning, so detectors.js, redaction.js
 * and the 11 existing tests in tests/test_pii_lib.cjs keep working unchanged):
 *   - disabled / required / checked state on form fields
 *   - a small ARIA metadata bag (aria-label, aria-describedby text,
 *     aria-required/-invalid/-expanded/-pressed/-checked)
 *   - nearest containing <form> id/name for inputs
 *   - inViewport (distinct from the existing CSS-visibility `isVisible`
 *     check — an element can be display:block and still be scrolled off
 *     screen)
 *   - schemaVersion + a viewport block on the top-level capturePage() result
 *   - same-origin iframe perception, one level deep (see extractIframes)
 *   - open shadow-root traversal for inputs/interactive/text extraction
 *     (see collectAllRoots) — closed shadow roots are architecturally
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

  // ── Visibility / geometry ────────────────────────────────────────────

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // Use the element's OWN window, not the top-level one — matters for
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
    if (!win) return true; // no window context available — don't guess a false negative
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    return bbox.width > 0 && bbox.height > 0 && bbox.x < vw && bbox.x + bbox.width > 0 && bbox.y < vh && bbox.y + bbox.height > 0;
  }

  // ── Stable identity ──────────────────────────────────────────────────

  let idCounter = 0;
  function elementId(el) {
    if (el.dataset && el.dataset.praxsightId) return el.dataset.praxsightId;
    const gen = `ps_${el.tagName.toLowerCase()}_${idCounter++}`;
    if (el.dataset) el.dataset.praxsightId = gen;
    return gen;
  }

  // ── Labels / forms / ARIA ────────────────────────────────────────────

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
    // — so this is more reliable than walking up with closest("form").
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

  // ── Shadow DOM traversal (open shadow roots only — see module docstring) ─

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

  // ── Extraction ───────────────────────────────────────────────────────

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

  // Same-origin iframes only, one level deep by design — a cross-origin
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
        base.note = "cross-origin iframe — contentDocument is inaccessible by browser design, cannot perceive";
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
