const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extensionPath = path.join(__dirname, 'extension');
  const browser = await chromium.launchPersistentContext('', {
    headless: true,
    args: [
      '--disable-extensions-except=' + extensionPath,
      '--load-extension=' + extensionPath
    ]
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:8000/demo/kyc-upload/index.html');
  
  // Expose a function to log to terminal
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  
  // Inject tesseract.js and test it
  await page.addScriptTag({ path: 'extension/lib/tesseract/tesseract.min.js' });
  
  await page.evaluate(async () => {
    try {
      console.log('Creating worker...');
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: 'http://localhost:8000/extension/lib/tesseract/worker.min.js',
        corePath: 'http://localhost:8000/extension/lib/tesseract/tesseract-core.wasm.js',
        langPath: 'http://localhost:8000/extension/lib/tesseract/lang-data',
        workerBlobURL: false
      });
      console.log('Worker created!');
      
      const canvas = document.getElementById('idCanvas');
      const dataUrl = canvas.toDataURL('image/png');
      console.log('Running OCR...');
      const { data: { text } } = await worker.recognize(dataUrl);
      console.log('OCR Result:', text);
      await worker.terminate();
    } catch (e) {
      console.log('ERROR:', e.message, e.stack);
    }
  });
  
  await browser.close();
})();
