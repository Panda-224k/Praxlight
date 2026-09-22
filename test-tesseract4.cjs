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
    console.log('Tesseract keys:', Object.keys(Tesseract));
    console.log('createWorker code:', Tesseract.createWorker.toString().substring(0, 200));
  });
  
  await browser.close();
})();
