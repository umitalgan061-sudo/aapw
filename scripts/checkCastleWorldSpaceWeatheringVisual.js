#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'castle-world-space-weathering');
const SHOT = path.join(ARTIFACT_DIR, 'castle-world-space-weathering.png');
const REPORT = path.join(ARTIFACT_DIR, 'castle-world-space-weathering.json');

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto(`http://127.0.0.1:${port}/scripts/castleWorldSpaceWeatheringHarness.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__CASTLE_WEATHERING_QA__?.ready === true, null, { timeout: 30000 });
    const report = await page.evaluate(() => window.__CASTLE_WEATHERING_QA__);
    await page.screenshot({ path: SHOT, fullPage: true });

    const failures = [];
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`);
    if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(' | ')}`);
    if (report.glError !== 0) failures.push(`WebGL error ${report.glError}`);
    if (!(report.programCount >= 2)) failures.push(`expected compiled standard-material programs, got ${report.programCount}`);
    if (report.policy?.id !== 'castle-world-space-weathering-2026-09-01-v1') failures.push('unexpected weathering policy id');
    if (report.stoneWeathering?.surface !== 'stone') failures.push('stone material missing world-space weathering metadata');
    if (report.roofWeathering?.surface !== 'roof') failures.push('roof material missing world-space weathering metadata');
    if (!(report.policy?.macroMeters > report.policy?.mesoMeters && report.policy?.mesoMeters > report.policy?.fineMeters)) {
      failures.push('weathering scales are not macro > meso > fine');
    }
    if (!(Math.abs(report.eastWorldX - report.westWorldX) > report.policy.macroMeters)) {
      failures.push('QA keeps are not separated enough to prove world-space de-correlation');
    }

    const payload = { ...report, pageErrors, consoleErrors, failures };
    fs.writeFileSync(REPORT, JSON.stringify(payload, null, 2));
    if (failures.length) throw new Error(failures.join('\n'));
    console.log(`CASTLE_WORLD_SPACE_WEATHERING_VISUAL_PASS ${JSON.stringify({
      policy: report.policy.id,
      programs: report.programCount,
      screenshot: path.relative(process.cwd(), SHOT),
    })}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(`[checkCastleWorldSpaceWeatheringVisual] FAIL: ${error.message}\n${error.stack || ''}`);
  process.exitCode = 1;
});
