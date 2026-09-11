#!/usr/bin/env node
/**
 * collectPerfSnapshot.js — one-shot real-frame perf sample, appended as a single CSV line to
 * `perf_log.csv` (GOVERNANCE.md §13 "Hafif Performans Günlüğü": raw data only, no dashboard/graph,
 * accumulated one line per run). Unlike `game3dSmokeChecksScene.js`'s `checkPerfPanel`, which drives
 * `debug/perfPanel.js` against a *fake* renderer to test its own throttle/format logic, this script
 * boots the real `game3d.html` scene, lets the real `renderer` render real frames for a few seconds,
 * then reads the same F2 panel's live DOM output — real draw calls/triangles/geometry+texture
 * counts, not synthetic ones. Never asserts pass/fail (that's `smokeTestGame3D.js`'s job) — this
 * only measures and records.
 *
 * Reuses `devServerHelper.js`'s static-server + Playwright bootstrap (run 59) rather than
 * duplicating it a third time.
 *
 * **FPS caveat:** headless Chromium in this container renders in software (no real GPU), so the
 * sampled FPS is far below any real desktop/mobile device's — it is only meaningful compared
 * run-over-run *within this same harness* (a sudden large drop flags a real regression), never as
 * an absolute number matching GOVERNANCE.md §4's 60-120/30-60 real-device targets. Draw
 * calls/triangles/geometry+texture counts are real GPU-submission numbers regardless (they don't
 * depend on render speed) and are directly comparable to §4's budgets.
 *
 * Usage: `node scripts/collectPerfSnapshot.js` — prints the sampled line and appends it to
 * `perf_log.csv` (creating it with a header row on first run).
 */

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
const LOG_PATH = path.join(ROOT, 'perf_log.csv');
const CSV_HEADER = 'date,run,fps,drawCalls,triangles,geometries,textures,jsHeapUsedMB';

/** How long real frames are allowed to render before sampling — long enough for the F2 panel's own
 * 0.25s refresh throttle (`perfPanel.js`) to have written at least a couple of real numbers, short
 * enough this stays a fast dev-tool run, not a benchmark suite. */
const SAMPLE_WAIT_MS = 3000;

/**
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<{fps: number, drawCalls: number, triangles: number, geometries: number, textures: number, jsHeapUsedMB: number|null}>}
 */
async function sample(browser, baseUrl) {
	const page = await browser.newPage();
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		// Same readiness signal `game3dSmokeChecksScene.js`'s `check3DMode` already uses: the
		// `#game3d-loading` element gets `.g3d-loading-hidden` once `GAME_READY` (phase1-scene) fires.
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			{ timeout: 60000, polling: 250 },
		);
		// Same activation mechanism every existing F2-panel smoke check already uses
		// (`game3dSmokeChecksScene.js`'s `checkPerfPanel`) — a real `window` keydown dispatch.
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' })));
		await page.waitForTimeout(SAMPLE_WAIT_MS);

		return await page.evaluate(() => {
			const text = document.querySelector('.g3d-perf-panel')?.textContent ?? '';
			// Strip thousands-separator commas (`toLocaleString()`'s output, e.g. "1,234,567")
			// before parsing — `Number()` on a comma-containing string is NaN, not the digits.
			const num = (re) => Number((text.match(re) ?? [])[1]?.replace(/,/g, '') ?? NaN);
			return {
				fps: num(/FPS:\s*(\d+)/),
				drawCalls: num(/Draw calls:\s*(\d+)/),
				triangles: num(/Triangles:\s*([\d,]+)/),
				geometries: num(/Geometries:\s*(\d+)/),
				textures: num(/Textures:\s*(\d+)/),
				// Chromium-only, requires no special launch flag for the *presence* of the API (only its
				// precision does) — absent entirely on other engines, hence the null fallback.
				jsHeapUsedMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
			};
		});
	} finally {
		await page.close();
	}
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error(
			'[collectPerfSnapshot] SKIP: Playwright is not available in this environment. Install it ' +
				'globally or run `npx playwright install chromium` to enable this script.',
		);
		process.exit(2);
	}

	const runArg = process.argv[2];
	if (!runArg) {
		console.error('[collectPerfSnapshot] Usage: node scripts/collectPerfSnapshot.js <run-label>');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });

	let result;
	try {
		result = await sample(browser, baseUrl);
	} finally {
		await browser.close();
		server.close();
	}

	if ([result.fps, result.drawCalls, result.triangles, result.geometries, result.textures].some(Number.isNaN)) {
		console.error('[collectPerfSnapshot] FAIL: could not parse the F2 panel output — panel text may have changed shape.');
		process.exit(1);
	}

	const dateIso = new Date().toISOString().slice(0, 10);
	const row = [
		dateIso,
		runArg,
		result.fps,
		result.drawCalls,
		result.triangles,
		result.geometries,
		result.textures,
		result.jsHeapUsedMB ?? '',
	].join(',');

	if (!fs.existsSync(LOG_PATH)) {
		fs.writeFileSync(LOG_PATH, CSV_HEADER + '\n');
	}
	fs.appendFileSync(LOG_PATH, row + '\n');

	console.log(`[collectPerfSnapshot] sampled: ${row}`);
	console.log(`[collectPerfSnapshot] appended to ${LOG_PATH}`);
}

main().catch((error) => {
	console.error('[collectPerfSnapshot] FAIL: unexpected error:', error);
	process.exit(1);
});
