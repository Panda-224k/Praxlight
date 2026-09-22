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
  page.on('pageerror', err => console.log('PAGE ERROR:', err));
  
  await page.goto('http://localhost:8000/demo/kyc-upload/index.html');
  await page.waitForTimeout(2000);
  
  let background = browser.serviceWorkers()[0];
  if (!background) {
    console.log('Waiting for service worker...');
    background = await browser.waitForEvent('serviceworker');
  }
  
  background.on('console', msg => console.log('BG CONSOLE:', msg.text()));
  background.on('pageerror', err => console.log('BG ERROR:', err));
  
  const extensionId = background.url().split('/')[2];
  console.log('Extension ID:', extensionId);
  
  const popup = await browser.newPage();
  popup.on('console', msg => console.log('POPUP CONSOLE:', msg.text()));
  popup.on('pageerror', err => console.log('POPUP ERROR:', err));
  await popup.goto('chrome-extension://' + extensionId + '/popup/popup.html');
  
  console.log('Clicking Scan images...');
  await popup.evaluate(() => {
    document.getElementById('btnScanImages').click();
  });
  
  await popup.waitForTimeout(5000);
  
  const badge = await popup.evaluate(() => document.getElementById('gateBadge').textContent);
  console.log('BADGE IS:', badge);

  await browser.close();
})();
