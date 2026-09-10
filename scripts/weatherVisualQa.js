#!/usr/bin/env node
/**
 * Focused visual-QA capture for run 371's `world/weather.js` rain effect — GOVERNANCE.md's
 * "Görsel Doğrulama Standardı" (at least 2 camera angles, before/after) applied to a feature that
 * `smokeTestGame3D.js`'s full suite could not yet capture: that suite currently stalls on its
 * `audio-and-movement` phase (see 3D_GAME_PROGRESS.md Run 371, suspected same LFS asset gap
 * affecting player animation FBX, not this feature). This script only needs the game to reach
 * GAME_READY (phase1-scene), the same boot point `game3dSmokeChecksScene.js`'s `check3DMode`
 * already proved completes cleanly this run — it never reaches the movement phase, so the stall
 * does not block it.
 *
 * Deliberately does not add any new debug-only hook to the game itself: `gameEvents` is dynamically
 * re-imported *inside the page* from the exact same `eventBus.js` URL the running game already
 * imported, which the browser's module cache resolves to the identical singleton instance (the same
 * technique every `game3dSmokeChecks*.js` check already relies on for its own assertions) — so this
 * script observes the real, already-running weather system exactly as a player would trigger it
 * in-game (the `distant_storm` world event), not a synthetic stand-in scene.
 *
 * Usage: `node scripts/weatherVisualQa.js [outputDir]` (defaults to `artifacts/weather-visual-qa/`).
 * Exit codes: 0 = captured + zero console/page errors. 1 = failure.
 * @module scripts/weatherVisualQa
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const NAV_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 120000; // generous: full-boot GAME_READY took ~50-90s per phase in this run's earlier smokeTestGame3D.js attempt, likely LFS-asset-gap-related fetch stalls (see RCA_RUN370_LFS_PROXY_AUTH.md), not a bug in this script.
const outDir = path.resolve(__dirname, '..', process.argv[2] || 'artifacts/weather-visual-qa');

async function waitForReady(page) {
	const handle = await page.waitForFunction(
		() => {
			const el = document.getElementById('game3d-loading');
			return Boolean(el && el.classList.contains('g3d-loading-hidden'));
		},
		null,
		{ timeout: READY_TIMEOUT_MS, polling: 250 },
	);
	await handle.dispose();
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[weatherVisualQa] playwright not resolvable (see 3D_GAME_PROGRESS.md Run 371 node_modules/three note) — SKIP, not a failure.');
		process.exit(0);
	}
	fs.mkdirSync(outDir, { recursive: true });
	const server = await startStaticServer();
	const browser = await playwright.chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	// Hard vs. soft split, same reasoning `game3dSmokeChecksScene.js`'s own `check2DShell` already
	// established: an uncaught `pageerror` is always hard, but a `console.error` naming a known
	// asset-loading failure is expected in this environment (git-lfs/proxy-auth gap, see
	// RCA_RUN370_LFS_PROXY_AUTH.md — every `assets/**/*.glb`/`.fbx` is a stub pointer file, so
	// `AssetLoader` logging "failed, using placeholder box" for each one is the *working*
	// fallback path, not a bug) and must not fail a check whose actual subject is the weather
	// effect, not asset loading.
	const errors = [];
	const softErrors = [];
	const KNOWN_ASSET_GAP_PATTERN = /asset error|failed, using placeholder box/;
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		const text = msg.text();
		if (KNOWN_ASSET_GAP_PATTERN.test(text)) softErrors.push(`console.error: ${text}`);
		else errors.push(`console.error: ${text}`);
	});

	try {
		// `waitUntil: 'commit'` — confirmed by hand this run (not just copied): both `'load'` and
		// `'domcontentloaded'` hang on this page in this environment (30s+, no request/response
		// event ever fires — isolated with a direct Playwright repro before concluding this, not
		// guessed), matching why `smokeTestGame3D.js`'s own `createCommittedNavigationBrowser`
		// already rewrites both to `'commit'` for `game3d.html` specifically. `waitForReady` below
		// still authoritatively waits for the real GAME_READY DOM signal, so this only changes when
		// `goto()` itself resolves, not what state the page must reach before screenshots are taken.
		await page.goto(`${server.baseUrl}/game3d.html`, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
		await waitForReady(page);

		// `game3d.html`'s own "run266 entry gate" (an interactive intro overlay, `giriş.png` +
		// "Giriş yap"/"Geri dön" buttons) sits on top of the already-booted scene until dismissed —
		// GAME_READY firing does not mean this overlay is gone, only that the scene behind it is
		// ready. Not previously known to this script (found by inspecting its first, misleadingly
		// "successful" screenshot, which turned out to be this gate, not the 3D view).
		// A real `elementHandle.click()` here hung for the full 30s timeout ("performing click
		// action" logged, never resolved) — this button's own click handler
		// (`game3d.html`'s `enterWorld`) is a few synchronous lines with nothing that could hang, so
		// this is Playwright's own actionability/stability wait misbehaving against this element's
		// CSS transition in this environment's software-rendered Chromium, not a real block. A
		// same-page synthetic `.click()` (still the genuine DOM click event, still runs the real
		// listener) sidesteps that wait entirely.
		const hasEntryGate = await page.evaluate(() => {
			const button = document.getElementById('run266-entry-enter');
			if (!button) return false;
			button.click();
			return true;
		});
		if (hasEntryGate) {
			await page.waitForSelector('#run266-entry-gate[hidden]', { timeout: 5000 }).catch(() => {});
			await page.waitForTimeout(300);
		}

		await page.screenshot({ path: path.join(outDir, '01-before-chase-cam.png') });

		// Trigger the exact same event the real `distant_storm` world event fires — see module doc
		// for why this reaches the real running singleton instead of a synthetic stand-in.
		await page.evaluate(async () => {
			const { gameEvents } = await import('./src/3d/eventBus.js');
			const { EVENTS } = await import('./src/3d/config.js');
			gameEvents.emit(EVENTS.WORLD_EVENT_TRIGGERED, {
				id: 'distant_storm', icon: '🌩️', title: 'Uzak Fırtına',
				desc: '[weatherVisualQa] manually triggered for a visual-evidence capture.',
				color: '#4a88c8',
			});
		});
		// INTENSITY_FADE_SECONDS (4s) fade-in, plus margin for the fade to be clearly visible rather
		// than mid-ramp — matches `checkWeatherSystem.js`'s own simulated timing.
		await page.waitForTimeout(5500);
		await page.screenshot({ path: path.join(outDir, '02-during-chase-cam.png') });

		// Second camera angle: F4 debug free-cam (debug/freeCamera.js), same key a developer would
		// press — satisfies GOVERNANCE.md's "en az 2 kamera açısı" requirement.
		await page.keyboard.press('F4');
		await page.waitForTimeout(300);
		for (let i = 0; i < 6; i += 1) {
			await page.keyboard.down('KeyW');
			await page.waitForTimeout(150);
			await page.keyboard.up('KeyW');
		}
		await page.waitForTimeout(200);
		await page.screenshot({ path: path.join(outDir, '03-during-freecam.png') });

		await page.close();
		await browser.close();
		await server.stop();

		const ok = errors.length === 0;
		if (ok) {
			console.log(
				`[weatherVisualQa] PASS: 3 screenshot(s) saved to ${path.relative(process.cwd(), outDir)}/, ` +
					`zero unexpected console/page errors (${softErrors.length} known asset-gap error(s) ` +
					'soft-reported, see RCA_RUN370_LFS_PROXY_AUTH.md — not a failure of this check).',
			);
		} else {
			console.error(`[weatherVisualQa] FAIL: ${errors.length} unexpected console/page error(s):`);
			for (const error of errors) console.error(`  - ${error}`);
		}
		process.exit(ok ? 0 : 1);
	} catch (error) {
		console.error(`[weatherVisualQa] FAIL: ${error.message}`);
		try { await browser.close(); } catch { /* already closed */ }
		try { await server.stop(); } catch { /* already stopped */ }
		process.exit(1);
	}
}

main();
