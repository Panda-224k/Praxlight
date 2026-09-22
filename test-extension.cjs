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
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  
  await page.goto('http://localhost:8000/demo/kyc-upload/index.html');
  await page.waitForTimeout(2000);
  
  // Inject and test detectFromImages
  await page.evaluate(async () => {
    try {
      if (!window.PraxSight || !window.PraxSight.ocr) {
        console.log('PraxSight.ocr is undefined');
        return;
      }
      console.log('Starting OCR...');
      const start = performance.now();
      const res = await window.PraxSight.ocr.detectFromImages(document);
      console.log('OCR Result:', res);
      console.log('Took:', performance.now() - start, 'ms');
    } catch(e) {
      console.log('PAGE ERROR:', e ? e.toString() : 'undefined');
    }
  });

  // Get background page and offscreen console logs
  const background = browser.serviceWorkers()[0];
  if (background) {
    background.on('console', msg => console.log('BG CONSOLE:', msg.text()));
  }

  await page.waitForTimeout(5000);
  await browser.close();
})();
