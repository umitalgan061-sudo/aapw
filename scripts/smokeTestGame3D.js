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
 * This file is just the infrastructure (static file server + Playwright bootstrap + result
 * printing). The actual per-feature assertions live in `game3dSmokeChecksScene.js` (page/scene-
 * level: 2D shell load, 3D mode boot, water vertex-shader-has-no-displacement, F4 debug camera, F2
 * debug/profiling panel, world-event system), `game3dSmokeChecks.js` (per-entity gameplay:
 * settlement collider, jump/gravity arc, interaction controller), and `game3dSmokeChecksMovement.js`
 * (waypoint-patrol/flee-AI: wolf flee/pack-alert, NPC waypoint patrol, wolf waypoint patrol) — split
 * across three files (run 40, then again this run once `game3dSmokeChecks.js` hit 596/600 lines) —
 * see each file's own header comment for why.
 *
 * Requires Playwright's Chromium browser (dev-only tooling — this repo intentionally has no
 * `package.json`/build step for the *deployed* site; this script is never loaded by a browser or
 * referenced from `index.html`/`game3d.html`). If Playwright isn't resolvable in the current
 * environment, this exits 2 (distinct from a real app-code failure) with install guidance instead
 * of throwing.
 *
 * Usage: `node scripts/smokeTestGame3D.js`
 * Exit codes: 0 = 3D mode passed (2D shell informational-only). 1 = the 3D-mode check (or the 2D
 * shell's own navigation) failed. 2 = Playwright unavailable in this environment.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const sceneChecks = require('./game3dSmokeChecksScene.js');
const checks = require('./game3dSmokeChecks.js');
const movementChecks = require('./game3dSmokeChecksMovement.js');

const ROOT = path.resolve(__dirname, '..');

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
		results.push(await sceneChecks.check2DShell(browser, baseUrl));
		results.push(await sceneChecks.check3DMode(browser, baseUrl));
		results.push(await sceneChecks.checkWaterVertexShaderStatic(browser, baseUrl));
		results.push(await sceneChecks.checkFreeCamera(browser, baseUrl));
		results.push(await sceneChecks.checkPerfPanel(browser, baseUrl));
		results.push(await sceneChecks.checkWorldEvents(browser, baseUrl));
		results.push(await checks.checkSettlementCollider(browser, baseUrl));
		results.push(await checks.checkJumpArc(browser, baseUrl));
		results.push(await checks.checkInteractionController(browser, baseUrl));
		results.push(await movementChecks.checkWolfPackAlert(browser, baseUrl));
		results.push(await movementChecks.checkNpcPatrol(browser, baseUrl));
		results.push(await movementChecks.checkWolfPatrol(browser, baseUrl));
		results.push(await movementChecks.checkDragonFlight(browser, baseUrl));
		results.push(await movementChecks.checkDragonNotice(browser, baseUrl));
		results.push(await movementChecks.checkDragonReactiveFlight(browser, baseUrl));
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
