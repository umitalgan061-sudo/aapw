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
 * Some checks need only a same-origin committed document before dynamically importing the real
 * shipped modules; waiting for the full game3d module graph to reach load/domcontentloaded adds no
 * coverage to those checks and can time out under software-WebGL CI contention. Scene boot itself
 * remains covered by check3DMode's authoritative GAME_READY assertion and the other full-page checks.
 */
function createCommittedNavigationBrowser(browser) {
	return {
		async newPage(...args) {
			const page = await browser.newPage(...args);
			const nativeGoto = page.goto.bind(page);
			page.goto = (url, options = {}) => {
				const target = String(url || '');
				if (
					target.includes('/game3d.html') &&
					(options.waitUntil === 'load' || options.waitUntil === 'domcontentloaded')
				) {
					return nativeGoto(url, { ...options, waitUntil: 'commit' });
				}
				return nativeGoto(url, options);
			};
			return page;
		},
	};
}

function markSmokePhase(name) {
	console.log(`[smokeTestGame3D] PHASE: ${name}`);
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
	const committedBrowser = createCommittedNavigationBrowser(browser);

	const results = [];
	try {
		markSmokePhase('scene-and-debug');
		results.push(await sceneChecks.check2DShell(browser, baseUrl));
		results.push(await sceneChecks.check3DMode(committedBrowser, baseUrl));
		results.push(await sceneChecks.checkWaterDepthTaperedSwell(committedBrowser, baseUrl));
		results.push(await sceneChecks.checkSettlementGroundFlatten(committedBrowser, baseUrl));
		results.push(await debugToolChecks.checkFreeCamera(committedBrowser, baseUrl));
		results.push(await debugToolChecks.checkPerfPanel(committedBrowser, baseUrl));
		markSmokePhase('world-events-and-interaction');
		results.push(await worldEventChecks.checkWorldEvents(committedBrowser, baseUrl));
		results.push(await worldEventChecks.checkWorldEventsTimeGating(committedBrowser, baseUrl));
		results.push(await checks.checkSettlementCollider(committedBrowser, baseUrl));
		results.push(await checks.checkPlayerCartDynamicCollider(committedBrowser, baseUrl));
		results.push(await checks.checkJumpArc(committedBrowser, baseUrl));
		results.push(await checks.checkInteractionController(committedBrowser, baseUrl));
		results.push(await checks.checkInteractionPromptTap(committedBrowser, baseUrl));
		results.push(await dialogueTouchChecks.checkDialogueChoiceTap(committedBrowser, baseUrl));
		results.push(await dialogueTouchChecks.checkDialoguePauseGate(committedBrowser, baseUrl));
		markSmokePhase('settlement-and-ui');
		results.push(await controlsHelpChecks.checkControlsHelp(browser, baseUrl));
		results.push(await settlementCompassChecks.checkSettlementCompass(committedBrowser, baseUrl));
		results.push(await settlementDiscoveryChecks.checkSettlementDiscovery(committedBrowser, baseUrl));
		results.push(await dayNightClockChecks.checkDayNightClock(committedBrowser, baseUrl));
		results.push(await vegetationChecks.checkVegetation(committedBrowser, baseUrl));
		results.push(await pauseMenuChecks.checkPauseMenu(committedBrowser, baseUrl));
		results.push(await pauseMenuChecks.checkPauseMenuSettings(committedBrowser, baseUrl));
		results.push(await pauseMenuChecks.checkControlsHelpPauseMenuEscapeCoexistence(committedBrowser, baseUrl));
		results.push(await pauseMenuChecks.checkPauseMenuMute(committedBrowser, baseUrl));
		markSmokePhase('audio-and-movement');
		results.push(await audioChecks.checkAudioManager(browser, baseUrl));
		results.push(await checks.checkStarfieldTwinkle(committedBrowser, baseUrl));
		results.push(await movementChecks.checkWolfPackAlert(committedBrowser, baseUrl));
		results.push(await movementChecks.checkNpcPatrol(committedBrowser, baseUrl));
		results.push(await movementChecks.checkWolfPatrol(committedBrowser, baseUrl));
		results.push(await movementChecks.checkNpcCombatStance(committedBrowser, baseUrl));
		results.push(await npcPerceptionChecks.checkNpcGuardPerception(committedBrowser, baseUrl));
		results.push(await creatureThreatChecks.checkCreatureThreatMemory(committedBrowser, baseUrl));
		results.push(await movementChecks.checkNpcAnimalCreatureObstacleCollider(committedBrowser, baseUrl));
		markSmokePhase('dragon-runtime');
		results.push(await dragonFlightChecks.checkDragonFlight(committedBrowser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonNotice(committedBrowser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonReactiveFlight(committedBrowser, baseUrl));
		results.push(await dragonFlightChecks.checkDragonWingFlapAgitation(committedBrowser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonDive(committedBrowser, baseUrl));
		results.push(await dragonPursuitChecks.checkDragonPursuit(committedBrowser, baseUrl));
		results.push(await dragonPursuitChecks.checkDragonGiveUpCue(committedBrowser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonDiveTelegraph(committedBrowser, baseUrl));
		results.push(await dragonDiveChecks.checkDragonBiteAttack(committedBrowser, baseUrl));
		markSmokePhase('safe-mode-disposal');
		results.push(await safeModeChecks.checkSafeModeEntityDisposeThrows(committedBrowser, baseUrl));
		results.push(await safeModeChecks.checkSafeModeSystemDisposeThrows(committedBrowser, baseUrl));
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