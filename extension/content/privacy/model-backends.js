/**
 * PraxSight — Model-backed DetectionBackend adapters (Phase 3)
 *
 * STATUS: scaffolded interface only — NOT wired into the live scan pipeline.
 * content-script.js currently only calls PraxSight.detectors (the rules
 * backend). These two adapters exist so the follow-up work is a matter of
 * filling in `classify()` and adding one line to content-script.js, not
 * redesigning the pipeline. See docs/CURRENT_IMPLEMENTATION.md.
 *
 * Both adapters implement the same DetectionBackend shape as the rules
 * backend in detectors.js:
 *   { name, available(): Promise<boolean>, detect(perception): Promise<Detection[]> }
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["person_name", "email", "phone", "address", "other"] },
            text: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["type", "text", "confidence"],
        },
      },
    },
    required: ["entities"],
  };

  // ── Chrome path: Gemini Nano via the on-device Prompt API ──────────────
  const geminiNanoBackend = {
    name: "gemini-nano",
    async available() {
      // Chrome 128+: `LanguageModel` (or the legacy `window.ai.languageModel`
      // origin-trial shape) is only present when the on-device model has
      // been downloaded. Feature-detect rather than assume.
      return typeof root.LanguageModel !== "undefined" || !!(root.ai && root.ai.languageModel);
    },
    async detect(perceptionResult) {
      const ok = await this.available();
      if (!ok) return [];
      // Intentionally unimplemented: would create a session with
      // `responseConstraint: RESPONSE_SCHEMA` and classify free-text spans
      // the rules backend didn't already catch (e.g. a bare name in a
      // paragraph with no surrounding label). Left as a stub so this file
      // is honest about what's shipped vs. planned rather than silently
      // returning fabricated detections.
      return [];
    },
  };

  // ── Firefox / fallback path: Transformers.js NER model ─────────────────
  const transformersNerBackend = {
    name: "transformers-js-ner",
    async available() {
      return false; // no model bundled in this pass — see CURRENT_IMPLEMENTATION.md
    },
    async detect(_perceptionResult) {
      return [];
    },
  };

  PraxSight.modelBackends = { geminiNanoBackend, transformersNerBackend, RESPONSE_SCHEMA };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { geminiNanoBackend, transformersNerBackend, RESPONSE_SCHEMA };
  }
})(typeof window !== "undefined" ? window : globalThis);