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
 * `collectPerfSnapshot.js`). The actual per-feature assertions live in focused check modules.
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
const debugToolChecks = require('./game3dSmokeChecksDebugTools.js');
const checks = require('./game3dSmokeChecks.js');
const movementChecks = require('./game3dSmokeChecksMovement.js');
const npcPerceptionChecks = require('./game3dSmokeChecksNpcPerception.js');
const dragonFlightChecks = require('./game3dSmokeChecksDragonFlight.js');
const dragonDiveChecks = require('./game3dSmokeChecksDragonDive.js');
const dragonPursuitChecks = require('./game3dSmokeChecksDragonPursuit.js');
const safeModeChecks = require('./game3dSmokeChecksSafeMode.js');
const dialogueTouchChecks = require('./game3dSmokeChecksDialogueTouch.js');
const controlsHelpChecks = require('./game3dSmokeChecksControlsHelp.js');
const settlementCompassChecks = require('./game3dSmokeChecksSettlementCompass.js');
const settlementDiscoveryChecks = require('./game3dSmokeChecksSettlementDiscovery.js');
const dayNightClockChecks = require('./game3dSmokeChecksDayNightClock.js');
const vegetationChecks = require('./game3dSmokeChecksVegetation.js');
const pauseMenuChecks = require('./game3dSmokeChecksPauseMenu.js');
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
		results.push(await sceneChecks.checkWaterDepthTaperedSwell(browser, baseUrl));
		results.push(await sceneChecks.checkSettlementGroundFlatten(browser, baseUrl));
		results.push(await debugToolChecks.checkFreeCamera(browser, baseUrl));
		results.push(await debugToolChecks.checkPerfPanel(browser, baseUrl));
		results.push(await debugToolChecks.checkWorldEvents(browser, baseUrl));
		results.push(await debugToolChecks.checkWorldEventsTimeGating(browser, baseUrl));
		results.push(await checks.checkSettlementCollider(browser, baseUrl));
		results.push(await checks.checkPlayerCartDynamicCollider(browser, baseUrl));
		results.push(await checks.checkJumpArc(browser, baseUrl));
		results.push(await checks.checkInteractionController(browser, baseUrl));
		results.push(await checks.checkInteractionPromptTap(browser, baseUrl));
		results.push(await dialogueTouchChecks.checkDialogueChoiceTap(browser, baseUrl));
		results.push(await dialogueTouchChecks.checkDialoguePauseGate(browser, baseUrl));
		results.push(await controlsHelpChecks.checkControlsHelp(browser, baseUrl));
		results.push(await settlementCompassChecks.checkSettlementCompass(browser, baseUrl));
		results.push(await settlementDiscoveryChecks.checkSettlementDiscovery(browser, baseUrl));
		results.push(await dayNightClockChecks.checkDayNightClock(browser, baseUrl));
		results.push(await vegetationChecks.checkVegetation(browser, baseUrl));
		results.push(await pauseMenuChecks.checkPauseMenu(browser, baseUrl));
		results.push(await pauseMenuChecks.checkPauseMenuSettings(browser, baseUrl));
		results.push(await pauseMenuChecks.checkControlsHelpPauseMenuEscapeCoexistence(browser, baseUrl));
		results.push(await checks.checkStarfieldTwinkle(browser, baseUrl));
		results.push(await movementChecks.checkWolfPackAlert(browser, baseUrl));
		results.push(await movementChecks.checkNpcPatrol(browser, baseUrl));
		results.push(await movementChecks.checkWolfPatrol(browser, baseUrl));
		results.push(await movementChecks.checkNpcCombatStance(browser, baseUrl));
		results.push(await npcPerceptionChecks.checkNpcGuardPerception(browser, baseUrl));
		results.push(await movementChecks.checkNpcAnimalCreatureObstacleCollider(browser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonFlight(browser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonNotice(browser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonReactiveFlight(browser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonWingFlapAgitation(browser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonDive(browser, baseUrl));
		results.push(await dragonPursuitChecks.checkDragonPursuit(browser, baseUrl));
		results.push(await dragonPursuitChecks.checkDragonGiveUpCue(browser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonDiveTelegraph(browser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonBiteAttack(browser, baseUrl));
		results.push(await safeModeChecks.checkSafeModeEntityDisposeThrows(browser, baseUrl));
		results.push(await safeModeChecks.checkSafeModeSystemDisposeThrows(browser, baseUrl));
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
