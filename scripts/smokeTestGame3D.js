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
 * This file is just the orchestration (result printing over each check) — the static file server
 * and Playwright bootstrap it uses live in `devServerHelper.js` (run 59, shared with
 * `collectPerfSnapshot.js`). The actual per-feature assertions live in `game3dSmokeChecksScene.js` (page/scene-
 * level: 2D shell load, 3D mode boot, water vertex-shader-has-no-displacement, F4 debug camera, F2
 * debug/profiling panel, world-event system), `game3dSmokeChecks.js` (per-entity gameplay:
 * settlement collider, jump/gravity arc, interaction controller), and `game3dSmokeChecksMovement.js`
 * (waypoint-patrol/flee-AI: wolf flee/pack-alert, NPC waypoint patrol, wolf waypoint patrol), and
 * `game3dSmokeChecksDragonDive.js` (run 64: dragon dive/swoop reaction) — split across four files
 * (run 40, again once `game3dSmokeChecks.js` hit 596/600 lines, again run 64 since
 * `game3dSmokeChecksMovement.js` was already at 614/600 going into that run) — see each file's own
 * header comment for why.
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

const sceneChecks = require('./game3dSmokeChecksScene.js');
const checks = require('./game3dSmokeChecks.js');
const movementChecks = require('./game3dSmokeChecksMovement.js');
const dragonDiveChecks = require('./game3dSmokeChecksDragonDive.js');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

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
		results.push(await checks.checkInteractionPromptTap(browser, baseUrl));
		results.push(await movementChecks.checkWolfPackAlert(browser, baseUrl));
		results.push(await movementChecks.checkNpcPatrol(browser, baseUrl));
		results.push(await movementChecks.checkWolfPatrol(browser, baseUrl));
		results.push(await movementChecks.checkDragonFlight(browser, baseUrl));
		results.push(await movementChecks.checkDragonNotice(browser, baseUrl));
		results.push(await movementChecks.checkDragonReactiveFlight(browser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonDive(browser, baseUrl));
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
