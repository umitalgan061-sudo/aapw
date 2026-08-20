#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-combat-hud');
const need = (ok, message) => { if (!ok) throw new Error(`[player-combat-hud-runtime] ${message}`); };
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.textContent?.includes('Serbest'), null, { timeout: 15000 });
	const baseline = await page.locator('.g3d-combat-status').evaluate((el) => ({ text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live'), state: el.dataset.state ?? '' }));
	need(baseline.role === 'status' && baseline.live === 'polite', `combat HUD accessibility contract missing: ${JSON.stringify(baseline)}`);
	await page.keyboard.press('KeyE');
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.dataset.state === 'attack-active-start', null, { timeout: 10000 });
	const active = await page.locator('.g3d-combat-status').evaluate((el) => ({ text: el.textContent, state: el.dataset.state }));
	need(active.text.includes('Hafif') && active.text.includes('VURUŞ'), `real light attack did not project active phase: ${JSON.stringify(active)}`);
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.dataset.state === 'free', null, { timeout: 15000 });
	const lockProjection = await page.evaluate(() => { globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: true, targetId: 'runtime-guard', distanceMeters: 12.345, reason: 'acquired' } })); const el = document.querySelector('.g3d-combat-status'); return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' }; });
	need(lockProjection.state === 'locked' && lockProjection.text.includes('runtime-guard') && lockProjection.text.includes('12.3 m'), `lock event projection failed: ${JSON.stringify(lockProjection)}`);
	await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: false, targetId: 'runtime-guard', reason: 'toggle-release' } })));
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.dataset.state === 'free');
	await page.screenshot({ path: path.join(outDir, 'combat-hud-runtime.png'), fullPage: true });
	need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
	const metrics = { ok: true, baseline, active, lockProjection, browserErrors: errors };
	fs.writeFileSync(path.join(outDir, 'combat-hud-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
	console.log(`PLAYER_COMBAT_HUD_RUNTIME_OK ${JSON.stringify({ active: active.text, locked: lockProjection.text, errors: errors.length })}`);
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
