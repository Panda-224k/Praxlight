let tesseractWorker = null;

async function getWorker() {
  if (tesseractWorker) return tesseractWorker;
  
  tesseractWorker = await Tesseract.createWorker({
    workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
    langPath: chrome.runtime.getURL('lib/tesseract/lang-data'),
    workerBlobURL: false,
    logger: m => console.log('Tesseract:', m)
  });
  
  await tesseractWorker.loadLanguage('eng');
  await tesseractWorker.initialize('eng');
  
  return tesseractWorker;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PRAXSIGHT_RUN_OCR") {
    (async () => {
      try {
        const worker = await getWorker();
        const start = performance.now();
        const { data: { text } } = await worker.recognize(msg.imageData);
        const latencyMs = performance.now() - start;
        sendResponse({ ok: true, text: text.trim(), latencyMs });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : (e ? String(e) : 'Unknown OCR error');
        sendResponse({ ok: false, error: errMsg });
      }
    })();
    return true; // async response
  }
});
