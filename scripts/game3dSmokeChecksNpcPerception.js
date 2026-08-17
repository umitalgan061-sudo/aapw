const NAV_TIMEOUT_MS = 30_000;

/**
 * Real shipped-runtime proof for the configured guard perception slice. Loads the same Mixamo FBX
 * family the game uses, drives the actual createNPC controller, and distinguishes visual acquisition
 * from hearing-only investigation before verifying a static guard returns to its authored home.
 */
async function checkNpcGuardPerception(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createNPC } = await import('/src/3d/gameplay/npc.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { NPC_CONFIG } = await import('/src/3d/gameplay/npcConfig.js');

			const assetLoader = new AssetLoader();
			const spawn = NPC_CONFIG.SPAWNS[0];
			const delta = 1 / 60;
			const groundCollider = { getGroundHeight: () => 0 };
			const passThroughCollider = { resolveXZ: (x, z) => ({ x, z }) };

			function makeGuard(name) {
				return createNPC({
					assetLoader,
					modelUrl: spawn.modelUrl,
					idleAnimationUrl: NPC_CONFIG.IDLE_ANIMATION_URL,
					worldX: 0,
					worldZ: 0,
					groundY: 0,
					rotationYRadians: 0,
					name,
					groundCollider,
					playerCollider: passThroughCollider,
					speedMps: NPC_CONFIG.PATROL_SPEED_MPS,
					turnRateRadiansPerSecond: NPC_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
					combatStanceTriggerRadiusMeters: NPC_CONFIG.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
					combatStanceIdleTimeScale: NPC_CONFIG.COMBAT_STANCE_IDLE_TIME_SCALE,
					combatStanceTransitionSeconds: NPC_CONFIG.COMBAT_STANCE_TRANSITION_SECONDS,
					perceptionEnabled: true,
				});
			}

			const visualGuard = await makeGuard('smoke-visual-guard');
			const visiblePlayer = { x: 0, z: 5 };
			for (let i = 0; i < 30; i += 1) visualGuard.update(delta, visiblePlayer);
			const visualState = visualGuard.object3D.userData.npcPerception;
			const visualAcquiresCombat = visualState?.intent === 'combat' && visualState.heard === false;
			const visualLosBounded = visualState?.lineOfSight === true && visualState.lineOfSightSamples <= 32;
			const combatBlendRaised = visualGuard.object3D.userData.combatStanceBlend > 0.5;
			visualGuard.dispose();

			const hearingGuard = await makeGuard('smoke-hearing-guard');
			hearingGuard.update(delta, { x: 0, z: -6 });
			hearingGuard.update(delta, { x: 0, z: -5.8 });
			const hearingState = hearingGuard.object3D.userData.npcPerception;
			const hearingInvestigates = hearingState?.heard === true && hearingState.intent === 'investigate';
			const hearingDoesNotCombat = hearingGuard.object3D.userData.combatStanceBlend === 0;
			const movedTowardNoise = hearingGuard.object3D.position.z < 0;

			const farPlayer = { x: 100, z: 100 };
			for (let i = 0; i < 900; i += 1) hearingGuard.update(delta, farPlayer);
			const homeDistance = Math.hypot(hearingGuard.object3D.position.x, hearingGuard.object3D.position.z);
			const returnedHome = homeDistance <= 0.25;
			const finalState = hearingGuard.object3D.userData.npcPerception;
			const investigationExpired = finalState?.intent === 'patrol' && finalState.investigationRemaining === 0;
			hearingGuard.dispose();

			return {
				visualAcquiresCombat,
				visualLosBounded,
				combatBlendRaised,
				hearingInvestigates,
				hearingDoesNotCombat,
				movedTowardNoise,
				returnedHome,
				investigationExpired,
				homeDistance,
			};
		});
	} finally {
		await page.close();
	}

	const ok = Object.entries(result).filter(([key]) => key !== 'homeDistance').every(([, value]) => value === true);
	const details = ok
		? `real FBX guard visually acquires combat, hearing only investigates, LOS <=32 probes, static return home=${result.homeDistance.toFixed(3)}m`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'NPC guard perception/investigation (real createNPC runtime)', ok, details };
}

module.exports = { checkNpcGuardPerception };
