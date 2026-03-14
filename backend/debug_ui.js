const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:8000');
    console.log('Page loaded');

    // Wait for the landing page to render
    await page.waitForSelector('text=Fixit Lens');
    console.log('Found "Fixit Lens" title');

    await page.waitForSelector('text=Start AR Lens');
    console.log('Found "Start AR Lens" button');

    // Take a screenshot of the landing page
    await page.screenshot({ path: 'landing_page.png' });
    console.log('Screenshot saved to landing_page.png');

  } catch (error) {
    console.error('Error during debugging:', error);
  } finally {
    await browser.close();
  }
})();
