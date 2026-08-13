#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function dragLook(page, fromX, fromY, toX, toY, steps = 20) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function holdKeys(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  await page.waitForTimeout(350);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright unavailable');

  const outDir = path.resolve('artifacts/game3d-close-capture');
  fs.mkdirSync(outDir, { recursive: true });

  const server = await startStaticServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const errors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`page:${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console:${message.text()}`);
    });

    await page.goto(`${baseUrl}/game3d.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    const enter = page.locator('#run266-entry-enter');
    if (await enter.count()) {
      await enter.waitFor({ state: 'visible', timeout: 30000 });
      await enter.click();
      await page.waitForFunction(
        () => !document.getElementById('run266-entry-gate'),
        null,
        { timeout: 10000 }
      );
    }

    await page.waitForFunction(
      () => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(2500);

    const canvas = page.locator('#game3d-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 30000 });

    // Enter the game's real F4 free-fly camera.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
    await page.waitForTimeout(500);

    // Pitch upward and fly upward/forward to gain a genuine in-world inspection altitude.
    await dragLook(page, 800, 500, 800, 180, 24);
    await holdKeys(page, ['ShiftLeft', 'KeyW'], 2600);

    // Turn the same real free camera back down toward the loaded terrain.
    await dragLook(page, 800, 500, 800, 970, 28);
    await page.waitForTimeout(1200);

    await page.screenshot({
      path: path.join(outDir, 'game3d-close-overhead.png'),
      fullPage: true
    });

    // Move closer to the ground along the current downward-looking view for a second, tighter shot.
    await holdKeys(page, ['KeyW'], 1400);
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(outDir, 'game3d-closer-terrain.png'),
      fullPage: true
    });

    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      gatePresent: Boolean(document.getElementById('run266-entry-gate')),
      loadingHidden: document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden') || false,
      canvasWidth: document.getElementById('game3d-canvas')?.width || 0,
      canvasHeight: document.getElementById('game3d-canvas')?.height || 0
    }));
    fs.writeFileSync(path.join(outDir, 'capture-metrics.json'), JSON.stringify({ metrics, errors }, null, 2));

    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`[game3d-close-capture] PASS ${JSON.stringify(metrics)}`);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('[game3d-close-capture] FAIL:', error.stack || error);
  process.exit(1);
});
