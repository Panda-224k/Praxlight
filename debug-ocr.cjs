const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extensionPath = path.join(__dirname, 'extension');
  const browser = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--disable-extensions-except=' + extensionPath,
      '--load-extension=' + extensionPath
    ]
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:8000/demo/kyc-upload/index.html');
  
  let background = browser.serviceWorkers()[0];
  if (!background) background = await browser.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];
  console.log('Extension ID:', extensionId);

  const popup = await browser.newPage();
  await popup.goto('chrome-extension://' + extensionId + '/popup/popup.html');

  popup.on('console', msg => console.log('POPUP CONSOLE:', msg.text()));
  popup.on('dialog', async dialog => {
    console.log('DIALOG:', dialog.message());
    await dialog.dismiss();
  });

  await popup.click('#btnScanImages');
  await popup.waitForTimeout(2000);
  
  await browser.close();
})();
