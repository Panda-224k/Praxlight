const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  page.on('response', response => {
    if (!response.ok()) {
      console.log('FAILED URL:', response.url());
    }
  });
  await page.goto('http://localhost:8000/tesseract-test.html');
  await page.waitForTimeout(2000);
  await browser.close();
})();
