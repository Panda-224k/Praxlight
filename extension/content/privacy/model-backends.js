/**
 * PraxSight — Model-Backed Detection Backend Adapters
 *
 * These implement the DetectionBackend interface used by detectors.js:
 *
 *   interface DetectionBackend {
 *     name: "rules" | "gemini-nano" | "transformers-js-ner";
 *     available(): Promise<boolean>;
 *     detect(perception): Promise<Detection[]>;
 *   }
 *
 * IMPLEMENTATION STATUS (honest):
 *   - GeminiNanoBackend.available() performs real Chrome AI API feature detection.
 *   - GeminiNanoBackend.detect() returns [] — not yet wired to live pipeline.
 *   - TransformersJsNERBackend.detect() returns [] — needs bundler step for ONNX model.
 *
 * See docs/CURRENT_IMPLEMENTATION.md for wiring plan.
 */
(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  class GeminiNanoBackend {
    get name() { return "gemini-nano"; }

    async available() {
      try {
        if (!("ai" in window) || !window.ai || !window.ai.languageModel) return false;
        const caps = await window.ai.languageModel.capabilities();
        return caps && caps.available !== "no";
      } catch {
        return false;
      }
    }

    async detect(perception) {
      // Future: prompt Gemini Nano over textNodes to catch free-text PII
      // (names, addresses) that structural rules cannot detect.
      return [];
    }
  }

  class TransformersJsNERBackend {
    get name() { return "transformers-js-ner"; }

    async available() {
      try {
        return typeof window !== "undefined" && "transformers" in window;
      } catch {
        return false;
      }
    }

    async detect(perception) {
      // Future: quantized NER model via Transformers.js (Firefox fallback)
      return [];
    }
  }

  PraxSight.modelBackends = {
    GeminiNanoBackend,
    TransformersJsNERBackend,
    async getBestAvailable() {
      const gemini = new GeminiNanoBackend();
      if (await gemini.available()) return gemini;
      const tfjs = new TransformersJsNERBackend();
      if (await tfjs.available()) return tfjs;
      return null;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
