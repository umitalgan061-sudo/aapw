#!/usr/bin/env node
/**
 * Persisted regression smoke orchestrator for the 2D shell and shipped Three.js runtime.
 * Feature assertions remain in focused game3dSmokeChecks* modules; this file only owns ordering,
 * browser lifecycle and result aggregation.
 */

const sceneChecks = require('./game3dSmokeChecksScene.js');
const debugToolChecks = require('./game3dSmokeChecksDebugTools.js');
const worldEventChecks = require('./game3dSmokeChecksWorldEvents.js');
const checks = require('./game3dSmokeChecks.js');
const movementChecks = require('./game3dSmokeChecksMovement.js');
const npcPerceptionChecks = require('./game3dSmokeChecksNpcPerception.js');
const creatureThreatChecks = require('./game3dSmokeChecksCreatureThreatMemory.js');
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
const audioChecks = require('./game3dSmokeChecksAudio.js');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/**
 * `check3DMode` already owns the authoritative 60s GAME_READY assertion. Waiting for the browser
 * `load` event before that assertion is both redundant and incorrect for the shipped page: GLB and
 * module work can legitimately keep `load` pending while phase1-scene is already progressing.
 *
 * Keep the scene-check module untouched (other agents own its broader page-boot coverage) and adapt
 * only this call site: for game3d.html, translate its legacy `waitUntil: load` navigation to
 * `domcontentloaded`. The check still fails on GAME_READY timeout, page/console errors or any
 * external request, so no runtime acceptance is removed.
 */
function createGame3DReadyBrowser(browser) {
	return {
		async newPage(...args) {
			const page = await browser.newPage(...args);
			const nativeGoto = page.goto.bind(page);
			page.goto = (url, options = {}) => {
				const target = String(url || '');
				if (target.includes('/game3d.html') && options.waitUntil === 'load') {
					return nativeGoto(url, { ...options, waitUntil: 'domcontentloaded' });
				}
				return nativeGoto(url, options);
			};
			return page;
		},
	};
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error(
			'[smokeTestGame3D] SKIP: Playwright is not available in this environment (dev-only ' +
				'tooling, not a repo dependency). Install Chromium for Playwright to enable this check.',
		);
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const game3DReadyBrowser = createGame3DReadyBrowser(browser);

	const results = [];
	try {
		results.push(await sceneChecks.check2DShell(browser, baseUrl));
		results.push(await sceneChecks.check3DMode(game3DReadyBrowser, baseUrl));
		results.push(await sceneChecks.checkWaterDepthTaperedSwell(browser, baseUrl));
		results.push(await sceneChecks.checkSettlementGroundFlatten(browser, baseUrl));
		results.push(await debugToolChecks.checkFreeCamera(browser, baseUrl));
		results.push(await debugToolChecks.checkPerfPanel(browser, baseUrl));
		results.push(await worldEventChecks.checkWorldEvents(browser, baseUrl));
		results.push(await worldEventChecks.checkWorldEventsTimeGating(browser, baseUrl));
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
		results.push(await pauseMenuChecks.checkPauseMenuMute(browser, baseUrl));
		results.push(await audioChecks.checkAudioManager(browser, baseUrl));
		results.push(await checks.checkStarfieldTwinkle(browser, baseUrl));
		results.push(await movementChecks.checkWolfPackAlert(browser, baseUrl));
		results.push(await movementChecks.checkNpcPatrol(browser, baseUrl));
		results.push(await movementChecks.checkWolfPatrol(browser, baseUrl));
		results.push(await movementChecks.checkNpcCombatStance(browser, baseUrl));
		results.push(await npcPerceptionChecks.checkNpcGuardPerception(browser, baseUrl));
		results.push(await creatureThreatChecks.checkCreatureThreatMemory(browser, baseUrl));
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