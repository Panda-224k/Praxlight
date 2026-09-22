const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  page.on('response', response => {
    if (!response.ok() && response.url().startsWith('http')) {
      console.log('FAILED URL:', response.url());
    }
  });
  const fileUrl = 'file:///' + path.join(__dirname, 'tesseract-test.html').replace(/\\/g, '/');
  await page.goto(fileUrl);
  await page.waitForTimeout(3000);
  await browser.close();
})();
