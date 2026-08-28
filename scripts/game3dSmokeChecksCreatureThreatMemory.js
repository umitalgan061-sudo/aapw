const NAV_TIMEOUT_MS = 90_000;

async function checkCreatureThreatMemory(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { spawnConfiguredCreatures, CREATURE_BEHAVIOR_PROFILES } = await import('/src/3d/gameplay/creatureBrain.js');
			const { wrapCreatureWithThreatMemory, CREATURE_PREDATOR_THREAT_RULES } = await import('/src/3d/gameplay/livingWorldSpawner.js');
			const { wrapCreatureWithSimulationLod } = await import('/src/3d/gameplay/creatureSpawner.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');
			const groundCollider = { getGroundHeight: () => 0 };
			const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
			const spawns = [
				{ id: 'smoke-geyik-leader', speciesId: 'geyik', x: 0, z: 0, rotationYRadians: 0 },
				{ id: 'smoke-geyik-wingman', speciesId: 'geyik', x: 12, z: 0, rotationYRadians: 0 },
				{ id: 'smoke-keci-neighbor', speciesId: 'keci', x: 12, z: 2, rotationYRadians: 0 },
				{ id: 'smoke-geyik-relay', speciesId: 'geyik', x: 29, z: 0, rotationYRadians: 0 },
				{ id: 'smoke-geyik-prey', speciesId: 'geyik', x: 50, z: 0, rotationYRadians: 0 },
				{ id: 'smoke-aslan-predator', speciesId: 'aslan', x: 68, z: 0, rotationYRadians: 0 },
			];
			const raws = spawnConfiguredCreatures({ spawns, groundCollider, playerCollider, mulberry32 });
			const herdRegistry = new Map();
			const ecologyRegistry = new Map();
			const creatures = raws.map((raw, index) => {
				const spawn = spawns[index];
				const profile = CREATURE_BEHAVIOR_PROFILES[spawn.speciesId];
				const predatorRule = CREATURE_PREDATOR_THREAT_RULES[spawn.speciesId];
				const threatAware = wrapCreatureWithThreatMemory(raw, {
					triggerRadiusMeters: profile.reactiveTriggerRadiusMeters,
					reactiveDirection: profile.reactiveDirection,
					memorySeconds: 1.25,
					speciesId: spawn.speciesId,
					packAlertRadiusMeters: profile.packAlertRadiusMeters,
					herdRegistry,
					sourceId: spawn.id,
					predatorSpeciesIds: predatorRule?.predatorSpeciesIds ?? [],
					predatorThreatRadiusMeters: predatorRule?.radiusMeters ?? 0,
					ecologyRegistry,
				});
				return wrapCreatureWithSimulationLod(threatAware, {
					id: spawn.id, nearRadiusMeters: 70, farIntervalSeconds: 0.25,
					distantRadiusMeters: 180, distantIntervalSeconds: 1, maxStepSeconds: 0.25,
				});
			});
			const [leader, wingman, goat, relay, prey, predator] = creatures;
			const delta = 1 / 60;
			const nearbyPlayer = { x: 0, z: 6 };
			for (let i = 0; i < 12; i += 1) leader.update(delta, nearbyPlayer, []);
			const leaderState = { ...leader.object3D.userData.creatureThreat };
			const directFlee = leader.isFleeing && leaderState.phase === 'flee' && leader.object3D.position.z < -0.2;

			const wingmanXBefore = wingman.object3D.position.x;
			const wingmanUrgentBeforeTick = wingman.isFleeing;
			wingman.update(delta, { x: 100, z: 100 }, [{ x: goat.object3D.position.x, z: goat.object3D.position.z }]);
			const wingmanState = { ...wingman.object3D.userData.creatureThreat };
			const sameSpeciesHerdFlee = wingmanUrgentBeforeTick && wingmanState.phase === 'herd-flee' && wingmanState.herd === true;
			const herdLodUrgent = wingman.object3D.userData.simulationLodTier === 'urgent';
			const wingmanMoved = wingman.object3D.position.x > wingmanXBefore;

			goat.update(delta, { x: 100, z: 100 }, [{ x: leader.object3D.position.x, z: leader.object3D.position.z }]);
			const goatState = { ...goat.object3D.userData.creatureThreat };
			const crossSpeciesIsolated = !goat.isFleeing && goatState.phase === 'roam' && goatState.herdReactiveCount === 0;
			const noRelayStorm = !relay.isFleeing;

			const preyXBefore = prey.object3D.position.x;
			const predatorWakeBeforeTick = prey.isFleeing;
			prey.update(delta, { x: 300, z: 300 }, []);
			const preyState = { ...prey.object3D.userData.creatureThreat };
			const predatorFlee = predatorWakeBeforeTick && preyState.phase === 'predator-flee' && preyState.predator === true && preyState.predatorSpeciesId === 'aslan';
			const predatorLodUrgent = prey.object3D.userData.simulationLodTier === 'urgent';
			const preyMovedAway = prey.object3D.position.x < preyXBefore;
			predator.update(delta, { x: 300, z: 300 }, []);
			const predatorStaysCalm = !predator.isFleeing && predator.object3D.userData.creatureThreat.phase === 'roam';
			const predatorDoesNotRelay = !relay.isFleeing;

			const farPlayer = { x: 0, z: 220 };
			leader.update(delta, farPlayer, []);
			const recoveryState = { ...leader.object3D.userData.creatureThreat };
			const urgentRecovery = leader.isFleeing && recoveryState.phase === 'recover' && leader.object3D.userData.simulationLodTier === 'urgent';
			for (let i = 0; i < 100; i += 1) leader.update(delta, farPlayer, []);
			const finalState = { ...leader.object3D.userData.creatureThreat };
			const returnsToRoam = !leader.isFleeing && finalState.phase === 'roam' && finalState.memoryRemainingSeconds === 0;
			for (const creature of creatures) creature.dispose();
			const registryDisposed = herdRegistry.size === 0 && ecologyRegistry.size === 0;
			return {
				directFlee, sameSpeciesHerdFlee, herdLodUrgent, wingmanMoved, crossSpeciesIsolated,
				noRelayStorm, predatorFlee, predatorLodUrgent, preyMovedAway, predatorStaysCalm,
				predatorDoesNotRelay, urgentRecovery, returnsToRoam, registryDisposed,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'Creature herd + predator/prey threat ecology (real Three.js runtime)',
		ok,
		details: ok
			? 'real deer herd reaction preserved; nearby lion wakes deer prey at urgent LOD and prey runs away without ecology relay storm'
			: JSON.stringify(result),
	};
}

module.exports = { checkCreatureThreatMemory };
