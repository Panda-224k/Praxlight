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
  
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  
  await page.addScriptTag({ path: 'extension/lib/tesseract/tesseract.min.js' });
  
  await page.evaluate(async () => {
    try {
      console.log('Creating worker...');
      const worker = await Tesseract.createWorker({
        workerPath: 'http://localhost:8000/extension/lib/tesseract/worker.min.js',
        corePath: 'http://localhost:8000/extension/lib/tesseract/tesseract-core.wasm.js',
        langPath: 'http://localhost:8000/extension/lib/tesseract/lang-data',
        workerBlobURL: false,
        logger: m => console.log('LOGGER:', m)
      });
      console.log('Worker created!');
      await worker.loadLanguage('eng');
      console.log('Language loaded!');
      await worker.initialize('eng');
      console.log('Initialized!');
      const canvas = document.getElementById('idCanvas');
      const dataUrl = canvas.toDataURL('image/png');
      const { data: { text } } = await worker.recognize(dataUrl);
      console.log('Result:', text);
    } catch (e) {
      console.log('ERROR:', e ? e.toString() : 'undefined error');
    }
  });
  
  await browser.close();
})();
