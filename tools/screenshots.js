/* Генерация скриншотов для превью и манифеста PWA.
   Размеры в манифесте должны совпадать с реальными файлами. */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch();

  // --- мобильные ---
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const m = await mctx.newPage();
  await m.goto(BASE, { waitUntil: 'networkidle' });
  await m.waitForTimeout(900);
  await m.screenshot({ path: 'preview/mobile-hero.png' });

  await m.evaluate(() => document.querySelector('#catalog').scrollIntoView());
  await m.waitForTimeout(700);
  await m.screenshot({ path: 'preview/mobile-catalog.png' });
  await m.screenshot({ path: 'preview/pwa-mobile.png' });

  await m.tap('#grid .card');
  await m.waitForTimeout(800);
  await m.screenshot({ path: 'preview/mobile-recipe.png' });
  await m.tap('#modal .modal-close');
  await m.waitForTimeout(500);

  await m.tap('#searchPill');
  await m.waitForTimeout(700);
  await m.fill('#sheetSearchInput', 'творог');
  await m.waitForTimeout(600);
  await m.screenshot({ path: 'preview/mobile-search.png' });
  await m.tap('#searchCancel');
  await m.waitForTimeout(500);

  await m.tap('#mFilterBtn');
  await m.waitForTimeout(700);
  await m.screenshot({ path: 'preview/mobile-filters.png' });
  await m.tap('#filterApply');
  await m.waitForTimeout(500);

  await mctx.close();

  // --- десктоп ---
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const d = await dctx.newPage();
  await d.goto(BASE, { waitUntil: 'networkidle' });
  await d.waitForTimeout(900);
  await d.screenshot({ path: 'preview/desktop-hero.png' });

  await d.evaluate(() => document.querySelector('#catalog').scrollIntoView());
  await d.waitForTimeout(700);
  await d.screenshot({ path: 'preview/desktop-catalog.png' });
  await d.screenshot({ path: 'preview/pwa-desktop.png' });

  await d.click('.card');
  await d.waitForTimeout(700);
  await d.screenshot({ path: 'preview/desktop-recipe.png' });
  await d.keyboard.press('Escape');
  await d.waitForTimeout(400);

  await d.click('#filterBtn');
  await d.click('.tag-chip[data-tag="Много белка"]');
  await d.waitForTimeout(500);
  await d.evaluate(() => document.querySelector('#catalog').scrollIntoView());
  await d.waitForTimeout(500);
  await d.screenshot({ path: 'preview/desktop-filtered.png' });

  await dctx.close();
  await browser.close();
  console.log('screenshots done');
})();