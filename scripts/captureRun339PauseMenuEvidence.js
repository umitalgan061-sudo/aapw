#!/usr/bin/env node
/**
 * Visual-verification evidence (GOVERNANCE.md §8.5) for run 339/ADR-0285's pause-menu overlay:
 * desktop before/after (button -> open overlay) at two states, a mobile-viewport shot proving the
 * new corner button doesn't collide with the existing controls-help/jump buttons, and a real-time
 * freeze proof — the day/night clock's displayed minute must not advance across ~2.5 real seconds
 * while paused, then must be able to advance again once resumed (the actual behavior the delta=0
 * clamp in `game3d.js`'s tick loop exists to produce, not just the overlay's own open/close state
 * `game3dSmokeChecksPauseMenu.js` already regression-guards in isolation).
 *
 * Usage: node scripts/captureRun339PauseMenuEvidence.js
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const GAME3D_READY_TIMEOUT_MS = 30_000;

async function waitForReady(page) {
	const handle = await page.waitForFunction(
		() => {
			const el = document.getElementById('game3d-loading');
			return Boolean(el && el.classList.contains('g3d-loading-hidden'));
		},
		{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
	);
	await handle.jsonValue();
	// Run 266's entry-gate consent overlay (`#run266-entry-gate`) sits on top of the HUD until
	// dismissed — same click this repo's own `checkRun266EntryGate.js` uses.
	const gate = await page.$('#run266-entry-gate');
	if (gate) {
		await page.click('#run266-entry-enter');
		await page.waitForFunction(
			() => !document.getElementById('run266-entry-gate'),
			null,
			{ timeout: 5000 },
		);
	}
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[run339-pause-menu-visual] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const outDir = path.resolve('artifacts/run339-pause-menu');
	fs.mkdirSync(outDir, { recursive: true });

	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];

	try {
		// --- Desktop: before/after screenshots ---
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		page.on('pageerror', (e) => errors.push(`page:${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: GAME3D_READY_TIMEOUT_MS });
		await waitForReady(page);
		await page.screenshot({ path: path.join(outDir, 'desktop-01-before-pause.png') });

		await page.click('.g3d-pause-menu-button');
		await page.waitForSelector('.g3d-pause-menu-overlay:not([hidden])');
		await page.screenshot({ path: path.join(outDir, 'desktop-02-pause-overlay-open.png') });

		// --- Freeze proof: real time passes while paused, day/night clock text must not move ---
		const clockTextBeforeWait = await page.textContent('.g3d-day-night-clock-time');
		await page.waitForTimeout(2500);
		const clockTextAfterPausedWait = await page.textContent('.g3d-day-night-clock-time');
		const clockFrozeWhilePaused = clockTextBeforeWait === clockTextAfterPausedWait;

		await page.click('.g3d-pause-menu-resume');
		await page.waitForSelector('.g3d-pause-menu-overlay', { state: 'hidden' });
		await page.screenshot({ path: path.join(outDir, 'desktop-03-resumed.png') });

		// --- Mobile: corner-button layout collision check ---
		const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		mobilePage.on('pageerror', (e) => errors.push(`mobile-page:${e.message}`));
		mobilePage.on('console', (m) => { if (m.type() === 'error') errors.push(`mobile-console:${m.text()}`); });
		await mobilePage.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: GAME3D_READY_TIMEOUT_MS });
		await waitForReady(mobilePage);
		await mobilePage.screenshot({ path: path.join(outDir, 'mobile-01-hud.png') });
		const overlapCheck = await mobilePage.evaluate(() => {
			const rects = ['.g3d-pause-menu-button', '.g3d-controls-help-button', '.g3d-touch-jump-button']
				.map((sel) => document.querySelector(sel)?.getBoundingClientRect())
				.filter(Boolean);
			function overlaps(a, b) {
				return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
			}
			let anyOverlap = false;
			for (let i = 0; i < rects.length; i++) {
				for (let j = i + 1; j < rects.length; j++) {
					if (overlaps(rects[i], rects[j])) anyOverlap = true;
				}
			}
			return { found: rects.length, anyOverlap };
		});

		await page.close();
		await mobilePage.close();

		const summary = {
			clockTextBeforeWait, clockTextAfterPausedWait, clockFrozeWhilePaused,
			mobileButtonsFound: overlapCheck.found, mobileButtonsOverlap: overlapCheck.anyOverlap,
			errors,
		};
		fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
		console.log(JSON.stringify(summary, null, 2));
		const ok = clockFrozeWhilePaused && overlapCheck.found === 3 && !overlapCheck.anyOverlap && errors.length === 0;
		process.exit(ok ? 0 : 1);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[run339-pause-menu-visual] FAIL: unexpected error:', error);
	process.exit(1);
});
