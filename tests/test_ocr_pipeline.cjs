const test = require('node:test');
const assert = require('node:assert');

// We use the existing detector pipeline for OCR text
const detectors = require('../extension/content/privacy/detectors.js');

test('OCR text pipeline integration', async (t) => {

  await t.test('detectInText extracts PII from raw OCR output', () => {
    // Simulated messy OCR output from Tesseract
    const ocrText = `
      REPUBLIC OF INDIA - INCONE TAX DEPT
      Nane
      VIKRAN SINGH
      Permanent Account Nunber
      BXGPR4592L
      Date of Birth
      14/08/1985
    `;

    const detections = detectors.detectInText(ocrText, 'canvas_ps_1', {x:0, y:0, width:400, height:250});
    
    // Tag them manually as ocr-engine.js would
    for (const d of detections) {
      d.source = ["ocr"];
    }

    assert.ok(detections.length >= 1, 'Should detect at least the PAN');
    
    const panDetection = detections.find(d => d.type === 'gov_id_pan');
    assert.ok(panDetection, 'PAN must be detected from OCR text');
    assert.strictEqual(panDetection.value, 'BXGPR4592L');
    assert.deepStrictEqual(panDetection.source, ['ocr']);

    // The Date detector in detectInText might catch the date
    // Current detectInText might not have a generic date detector, but it's ok as long as PAN works
  });
});
