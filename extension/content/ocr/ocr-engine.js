(function (root) {
  const PraxSight = (root.PraxSight = root.PraxSight || {});

  async function getImageDataUrl(el) {
    if (el.tagName.toLowerCase() === 'canvas') {
      try {
        return el.toDataURL('image/png');
      } catch (e) {
        return null; // Tainted canvas
      }
    }
    if (el.tagName.toLowerCase() === 'img') {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = el.naturalWidth || el.width;
        canvas.height = el.naturalHeight || el.height;
        if (!canvas.width || !canvas.height) return null;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0);
        return canvas.toDataURL('image/png');
      } catch (e) {
        return null; // Tainted cross-origin image
      }
    }
    return null;
  }

  async function runOcrOnBackground(imageData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "PRAXSIGHT_OCR_REQUEST", imageData },
        (response) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          if (!response || !response.ok) return reject(new Error(response?.error || 'OCR failed'));
          resolve(response);
        }
      );
    });
  }

  async function detectFromImages(doc) {
    const roots = PraxSight.perception.collectAllRoots(doc);
    const elements = [];
    for (const r of roots) {
      elements.push(...Array.from(r.querySelectorAll("img, canvas")));
    }
    
    const visibleElements = elements.filter(PraxSight.perception.isVisible);
    let allDetections = [];
    let totalLatencyMs = 0;
    
    for (const el of visibleElements) {
      const dataUrl = await getImageDataUrl(el);
      if (!dataUrl) continue;
      
      try {
        const result = await runOcrOnBackground(dataUrl);
        totalLatencyMs += result.latencyMs || 0;
        if (result.text && result.text.trim()) {
          const psId = PraxSight.perception.elementId(el);
          const bbox = PraxSight.perception.bboxOf(el);
          
          // Use the EXACT SAME detection pipeline as text
          const detections = PraxSight.detectors.detectInText(result.text.trim(), psId, bbox);
          
          for (const d of detections) {
            d.source = ["ocr"]; // Tag as OCR
          }
          allDetections.push(...detections);
        }
      } catch (e) {
        console.warn('PraxSight OCR failed for element', el, e);
      }
    }
    
    return { detections: allDetections, latencyMs: totalLatencyMs };
  }

  PraxSight.ocr = { detectFromImages };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PraxSight.ocr;
  }
})(typeof window !== "undefined" ? window : globalThis);
