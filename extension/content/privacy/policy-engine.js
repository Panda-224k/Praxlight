/**
 * PraxSight — Privacy Policy Engine (Phase 4 → Phase 12 manifest)
 *
 * Decides what happens to each detection (allow / redact) and builds the
 * `privacy_manifest` that travels with every outgoing request. The manifest
 * is what background.js's hard gate (Phase 5) checks before it will call
 * fetch() at all — see extension/background.js.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  // Default policy: only 'low' severity (rare — reserved for future
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
