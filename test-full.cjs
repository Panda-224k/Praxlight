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
  await page.waitForTimeout(2000); // give extension time to inject
  
  // get background to see if it throws errors
  let bg = browser.serviceWorkers()[0];
  if (!bg) bg = await browser.waitForEvent('serviceworker');
  bg.on('console', msg => console.log('BG CONSOLE:', msg.text()));
  bg.on('pageerror', err => console.log('BG ERROR:', err));
  
  const extId = bg.url().split('/')[2];
  
  // We can just open the popup and click the button!
  const popup = await browser.newPage();
  popup.on('console', msg => console.log('POPUP CONSOLE:', msg.text()));
  
  await popup.goto('chrome-extension://' + extId + '/popup/popup.html');
  
  console.log('Clicking scan images...');
  await popup.evaluate(() => {
    document.getElementById('btnScanImages').click();
  });
  
  await popup.waitForTimeout(5000);
  
  const badge = await popup.evaluate(() => document.getElementById('gateBadge').textContent);
  console.log('BADGE IS:', badge);
  
  // Let's get the raw json from background to see if it worked
  const result = await popup.evaluate(() => {
    return document.getElementById('cDetected').textContent;
  });
  console.log('DETECTED:', result);
  
  await browser.close();
})();
