#!/usr/bin/env node
/**
 * smokeTestGame3D.js — persisted regression-guard smoke test for both the existing 2D app shell
 * and the 3D mode (`game3d.html`).
 *
 * Every prior run's "Regression Guard" smoke test was an ad-hoc Playwright script written fresh
 * and thrown away at the end of that run (see 3D_GAME_PROGRESS.md's per-run notes) — flagged by
 * this project's own priority order as missing smoke-test/regression coverage (a real, committed
 * check outranks writing another feature). This script is that committed check.
 *
 * Requires Playwright's Chromium browser (dev-only tooling — this repo intentionally has no
 * `package.json`/build step for the *deployed* site; this script is never loaded by a browser or
 * referenced from `index.html`/`game3d.html`). If Playwright isn't resolvable in the current
 * environment, this exits 2 (distinct from a real app-code failure) with install guidance instead
 * of throwing.
 *
 * What it checks:
 *   - **2D shell (`index.html`) — informational, non-blocking.** Loads the page and reports any
 *     console/page errors, but does NOT fail the run on them and does NOT click "OYNAT" or assert
 *     deep 2D gameplay. Verified (this script's own dev investigation, run 34): every console error
 *     this sandbox produces here traces to either (a) outbound requests to external CDNs
 *     (gstatic.com/cdnjs.cloudflare.com/fonts.googleapis.com) failing with
 *     `net::ERR_CONNECTION_RESET` — this sandbox's own network restriction, not app code — which
 *     cascades into a `firebase is not defined` error since the Firebase SDK script never loaded,
 *     or (b) 404s for `resimler/*.png` and `videolar/*.mp4` — paths that do not exist anywhere in
 *     this git checkout at all (`ls resimler/` → "No such file or directory"), a pre-existing gap
 *     predating every 3D-mode run (the 3D-mode work never touches the 2D game, per Golden Rule #1).
 *     Hard-failing on either would make this check permanently red regardless of actual code
 *     correctness — the opposite of a useful regression guard. Only a failed page *navigation*
 *     (network error on `index.html` itself, or an empty `<title>`) is treated as blocking.
 *   - **3D mode (`game3d.html`) — the real gate.** Waits for `#game3d-loading` to gain the
 *     `g3d-loading-hidden` class — the exact DOM signal `game3d.html`'s own inline script sets in
 *     its `EVENTS.GAME_READY` (`phase1-scene`) handler — within a timeout. Fails if it instead gains
 *     `g3d-loading-error` (the `EVENTS.GAME_ERROR` handler), if neither happens before the timeout,
 *     or if any uncaught page exception / `console.error` occurs during load (the 3D mode has no
 *     external-CDN dependency, so unlike the 2D shell above, an error here is always real).
 *   - **Settlement collider (`physics.js`'s `createSettlementCollider`, added run 35 — see
 *     DECISIONS.md ADR-0037) — a real regression guard, not just a load check.** Dynamic-imports
 *     `physics.js`/`config.js` in-page (same import map `game3d.html` already uses, so `three`-
 *     adjacent resolution matches the real app exactly) and replays the same three assertions
 *     ADR-0037's manual verification used: a point at a synthetic castle's exact center is pushed to
 *     precisely the keep's half-extent; a far point is an exact no-op; and 3000 simulated per-frame
 *     forward steps walking straight at the keep center from 60m away come to rest exactly at the
 *     keep's half-extent, never penetrating further. Guards against a future edit to `physics.js`
 *     or `config.js`'s `SETTLEMENT_CONFIG` silently breaking castle collision (e.g. reintroducing
 *     the exact zero-distance edge-case bug ADR-0037 found and fixed).
 *
 * Usage: `node scripts/smokeTestGame3D.js`
 * Exit codes: 0 = 3D mode passed (2D shell informational-only). 1 = the 3D-mode check (or the 2D
 * shell's own navigation) failed. 2 = Playwright unavailable in this environment.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
/** Timeout for the initial page navigation (`load` event) — asset fetches happen after this. */
const NAV_TIMEOUT_MS = 15000;
/** Timeout for the 3D mode's boot sequence (444 terrain chunks + ~76MB of character/animal
 *  models decoded under SwiftShader software rendering in a headless sandbox can be slow — see
 *  3D_GAME_PROGRESS.md's FPS caveat). Generous on purpose to avoid environment-flaky failures. */
const GAME3D_READY_TIMEOUT_MS = 60000;

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.fbx': 'application/octet-stream',
	'.bin': 'application/octet-stream',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json',
};

/**
 * Starts a plain static file server over the repo root on an OS-assigned free port. No external
 * dependency — this is the only "network" involved, entirely local (127.0.0.1).
 * @returns {Promise<import('http').Server>}
 */
function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT)) {
				res.writeHead(403);
				res.end('Forbidden');
				return;
			}
			if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404);
				res.end('Not found');
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500);
			res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Resolves Playwright without assuming it's a local project dependency (this repo has none by
 * design). Tries plain `require('playwright')` first (works if installed locally or already on
 * Node's module path), then a common global-install location as a fallback.
 * @returns {object|null} The Playwright module, or null if unavailable anywhere tried.
 */
function loadPlaywright() {
	const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
	for (const id of candidates) {
		try {
			return require(id);
		} catch (error) {
			// Try the next candidate.
		}
	}
	return null;
}

/**
 * Navigates to `url` and collects uncaught exceptions / console errors seen during the load.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @returns {Promise<{page: import('playwright').Page, errors: string[]}>}
 */
async function loadAndCollectErrors(browser, url) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
	});
	await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
	return { page, errors };
}

/**
 * Non-blocking: only a failed navigation (empty title) counts against `ok`. Console/page errors
 * are reported for visibility but never fail this check — see the file header comment for why
 * (they trace to this sandbox's external-network restrictions and a pre-existing, unrelated 2D
 * media-asset gap, not to anything a 3D-mode regression could cause).
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function check2DShell(browser, baseUrl) {
	const { page, errors } = await loadAndCollectErrors(browser, `${baseUrl}/index.html`);
	const title = await page.title();
	await page.close();
	const ok = title.length > 0;
	const errorNote = errors.length > 0
		? ` (${errors.length} console/page error(s) seen, non-blocking — see file header comment)`
		: '';
	return { name: '2D shell (index.html)', ok, details: `title="${title}"${errorNote}` };
}

/** @returns {Promise<{name: string, ok: boolean, details: string}>} */
async function check3DMode(browser, baseUrl) {
	const { page, errors } = await loadAndCollectErrors(browser, `${baseUrl}/game3d.html`);
	let outcome = 'timeout';
	try {
		const handle = await page.waitForFunction(
			() => {
				const el = document.getElementById('game3d-loading');
				if (!el) return 'missing-element';
				if (el.classList.contains('g3d-loading-hidden')) return 'ready';
				if (el.classList.contains('g3d-loading-error')) return 'error';
				return false;
			},
			{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
		);
		outcome = await handle.jsonValue();
	} catch (error) {
		outcome = 'timeout';
	}
	await page.close();
	const ok = outcome === 'ready' && errors.length === 0;
	const details = ok
		? 'loading screen hid (GAME_READY phase1-scene), zero console/page errors'
		: `outcome=${outcome}${errors.length ? `, errors: ${errors.join('; ')}` : ''}`;
	return { name: '3D mode (game3d.html)', ok, details };
}

/**
 * Replays ADR-0037's manual collider verification as a persisted, always-run regression check.
 * Runs entirely in-page via dynamic `import()` against the real modules over HTTP (not a separate
 * unit-test harness) so it exercises the exact same module resolution the live game uses.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkSettlementCollider(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createSettlementCollider } = await import('/src/3d/physics.js');
			const { SETTLEMENT_CONFIG } = await import('/src/3d/config.js');

			const seats = [{ id: 'test-castle', x: 1000, z: 500, groundY: 10 }];
			const collider = createSettlementCollider(seats, SETTLEMENT_CONFIG);
			const expectedHalfExtent = SETTLEMENT_CONFIG.KEEP_WIDTH_METERS / 2 + 0.4;

			const center = collider.resolveXZ(1000, 500);
			const centerDist = Math.hypot(center.x - 1000, center.z - 500);
			const centerOk = Math.abs(centerDist - expectedHalfExtent) < 1e-6;

			const far = collider.resolveXZ(5000, 5000);
			const farOk = far.x === 5000 && far.z === 5000;

			let x = 1000;
			let z = 560;
			for (let i = 0; i < 3000; i++) {
				const resolved = collider.resolveXZ(x, z - 0.05);
				x = resolved.x;
				z = resolved.z;
			}
			const walkerDist = Math.hypot(x - 1000, z - 500);
			const walkerOk = Math.abs(walkerDist - expectedHalfExtent) < 1e-6;

			return { centerOk, centerDist, farOk, walkerOk, walkerDist, expectedHalfExtent };
		});
	} finally {
		await page.close();
	}
	const ok = result.centerOk && result.farOk && result.walkerOk;
	const details = ok
		? `castle-center push=${result.centerDist.toFixed(2)}m, far point unchanged, ` +
			`3000-step walker stopped at ${result.walkerDist.toFixed(2)}m (expected ${result.expectedHalfExtent}m)`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'settlement collider (physics.js)', ok, details };
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error(
			'[smokeTestGame3D] SKIP: Playwright is not available in this environment (dev-only ' +
				'tooling, not a repo dependency — this project has no package.json/build step by ' +
				'design). Install it globally or run `npx playwright install chromium` to enable this check.',
		);
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });

	const results = [];
	try {
		results.push(await check2DShell(browser, baseUrl));
		results.push(await check3DMode(browser, baseUrl));
		results.push(await checkSettlementCollider(browser, baseUrl));
	} finally {
		await browser.close();
		server.close();
	}

	let allOk = true;
	for (const result of results) {
		console.log(`[smokeTestGame3D] ${result.ok ? 'PASS' : 'FAIL'}: ${result.name} — ${result.details}`);
		if (!result.ok) allOk = false;
	}

	process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
	console.error('[smokeTestGame3D] FAIL: unexpected error:', error);
	process.exit(1);
});
