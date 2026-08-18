const NAV_TIMEOUT_MS = 30_000;

async function checkCreatureThreatMemory(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { spawnConfiguredCreatures, CREATURE_BEHAVIOR_PROFILES } = await import('/src/3d/gameplay/creatureBrain.js');
			const { wrapCreatureWithThreatMemory } = await import('/src/3d/gameplay/livingWorldSpawner.js');
			const { wrapCreatureWithSimulationLod } = await import('/src/3d/gameplay/creatureSpawner.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');
			const groundCollider = { getGroundHeight: () => 0 };
			const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
			const spawn = { id: 'smoke-geyik-threat', speciesId: 'geyik', x: 0, z: 0, rotationYRadians: 0 };
			const raw = spawnConfiguredCreatures({ spawns: [spawn], groundCollider, playerCollider, mulberry32 })[0];
			const profile = CREATURE_BEHAVIOR_PROFILES.geyik;
			const threatAware = wrapCreatureWithThreatMemory(raw, {
				triggerRadiusMeters: profile.reactiveTriggerRadiusMeters,
				reactiveDirection: profile.reactiveDirection,
				memorySeconds: 1.25,
			});
			const creature = wrapCreatureWithSimulationLod(threatAware, {
				id: 'smoke-geyik-threat', nearRadiusMeters: 70, farIntervalSeconds: 0.25,
				distantRadiusMeters: 180, distantIntervalSeconds: 1, maxStepSeconds: 0.25,
			});
			const delta = 1 / 60;
			const nearbyPlayer = { x: 0, z: 6 };
			for (let i = 0; i < 12; i += 1) creature.update(delta, nearbyPlayer, []);
			const fleeState = { ...creature.object3D.userData.creatureThreat };
			const fleeZ = creature.object3D.position.z;
			const directFlee = creature.isFleeing && fleeState.phase === 'flee' && fleeZ < -0.2;

			const farPlayer = { x: 0, z: 220 };
			creature.update(delta, farPlayer, []);
			const recoveryState = { ...creature.object3D.userData.creatureThreat };
			const urgentRecovery = creature.isFleeing && recoveryState.phase === 'recover' && creature.object3D.userData.simulationLodTier === 'urgent';
			const recoverZ = creature.object3D.position.z;
			const recoveryMovesAway = recoverZ < fleeZ;

			for (let i = 0; i < 100; i += 1) creature.update(delta, farPlayer, []);
			const finalState = { ...creature.object3D.userData.creatureThreat };
			const returnsToRoam = !creature.isFleeing && finalState.phase === 'roam' && finalState.memoryRemainingSeconds === 0;
			const finalTier = creature.object3D.userData.simulationLodTier;
			creature.dispose();
			return { directFlee, urgentRecovery, recoveryMovesAway, returnsToRoam, finalTier };
		});
	} finally {
		await page.close();
	}
	const ok = result.directFlee && result.urgentRecovery && result.recoveryMovesAway && result.returnsToRoam;
	return {
		name: 'Creature threat -> flee -> bounded recovery -> roam (real Three.js creature runtime)',
		ok,
		details: ok ? `deer fled, recovery stayed urgent, then returned to roam; final LOD=${result.finalTier}` : JSON.stringify(result),
	};
}

module.exports = { checkCreatureThreatMemory };
