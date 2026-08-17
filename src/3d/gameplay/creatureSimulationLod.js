/**
 * Deterministic behavior-tick LOD for the existing procedural creature controllers.
 * Keeps near/threatened fauna on the shipped full-rate brain while far/distant creatures
 * run at bounded cadences with per-id phases so a large population does not wake in lockstep.
 * @module gameplay/creatureSimulationLod
 */

function clampSimulationDelta(delta, maxStepSeconds) {
	if (!Number.isFinite(delta) || delta <= 0) return 0;
	return Math.min(delta, maxStepSeconds);
}

export function deterministicCreaturePhaseSeconds(id, intervalSeconds) {
	if (!(intervalSeconds > 0)) return 0;
	let hash = 2166136261;
	for (const char of String(id ?? 'creature')) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d) >>> 0;
	hash ^= hash >>> 15;
	hash = Math.imul(hash, 0x846ca68b) >>> 0;
	hash = (hash ^ (hash >>> 16)) >>> 0;
	return (hash / 0x100000000) * intervalSeconds;
}

export function createCreatureSimulationLod({
	id,
	nearRadiusMeters = 70,
	farIntervalSeconds = 0.25,
	distantRadiusMeters = 180,
	distantIntervalSeconds = 1,
	maxStepSeconds = 0.25,
	hysteresisMeters = 10,
	distantHysteresisMeters = 25,
} = {}) {
	if (!(nearRadiusMeters > 0)) throw new Error('nearRadiusMeters must be > 0');
	if (!(farIntervalSeconds > 0)) throw new Error('farIntervalSeconds must be > 0');
	if (!(distantRadiusMeters > nearRadiusMeters)) throw new Error('distantRadiusMeters must exceed nearRadiusMeters');
	if (!(distantIntervalSeconds >= farIntervalSeconds)) throw new Error('distantIntervalSeconds must be >= farIntervalSeconds');
	if (!(maxStepSeconds > 0)) throw new Error('maxStepSeconds must be > 0');

	const farPhaseSeconds = deterministicCreaturePhaseSeconds(id, farIntervalSeconds);
	const distantPhaseSeconds = deterministicCreaturePhaseSeconds(`${id}:distant`, distantIntervalSeconds);
	let farAccumulatedSeconds = farPhaseSeconds;
	let distantAccumulatedSeconds = distantPhaseSeconds;
	let pendingSimulationSeconds = 0;
	let tier = 'near';
	let nearLatched = true;
	let distantLatched = false;

	return {
		step(delta, distanceToPlayer, urgent = false) {
			const boundedDelta = clampSimulationDelta(delta, maxStepSeconds);
			const finiteDistance = Number.isFinite(distanceToPlayer);
			if (urgent) {
				nearLatched = true;
				distantLatched = false;
			} else if (!finiteDistance) {
				nearLatched = false;
				distantLatched = true;
			} else if (nearLatched) {
				nearLatched = distanceToPlayer <= nearRadiusMeters + hysteresisMeters;
			} else {
				nearLatched = distanceToPlayer <= nearRadiusMeters;
			}

			if (nearLatched) {
				farAccumulatedSeconds = farPhaseSeconds;
				distantAccumulatedSeconds = distantPhaseSeconds;
				pendingSimulationSeconds = 0;
				tier = urgent ? 'urgent' : 'near';
				return boundedDelta;
			}

			pendingSimulationSeconds = Math.min(maxStepSeconds, pendingSimulationSeconds + boundedDelta);
			if (finiteDistance) {
				if (distantLatched) distantLatched = distanceToPlayer > distantRadiusMeters - distantHysteresisMeters;
				else distantLatched = distanceToPlayer > distantRadiusMeters + distantHysteresisMeters;
			}

			if (distantLatched) {
				if (tier !== 'distant' && tier !== 'bootstrap') distantAccumulatedSeconds = distantPhaseSeconds;
				tier = finiteDistance ? 'distant' : 'bootstrap';
				farAccumulatedSeconds = farPhaseSeconds;
				distantAccumulatedSeconds = Math.min(distantIntervalSeconds, distantAccumulatedSeconds + boundedDelta);
				if (distantAccumulatedSeconds + Number.EPSILON < distantIntervalSeconds) return 0;
				distantAccumulatedSeconds = 0;
				const simulationDelta = pendingSimulationSeconds;
				pendingSimulationSeconds = 0;
				return simulationDelta;
			}

			if (tier !== 'far') farAccumulatedSeconds = farPhaseSeconds;
			tier = 'far';
			distantAccumulatedSeconds = distantPhaseSeconds;
			farAccumulatedSeconds = Math.min(farIntervalSeconds, farAccumulatedSeconds + boundedDelta);
			if (farAccumulatedSeconds + Number.EPSILON < farIntervalSeconds) return 0;
			farAccumulatedSeconds = 0;
			const simulationDelta = pendingSimulationSeconds;
			pendingSimulationSeconds = 0;
			return simulationDelta;
		},
		get tier() { return tier; },
	};
}

export function wrapCreatureWithSimulationLod(creature, {
	id,
	nearRadiusMeters = 70,
	farIntervalSeconds = 0.25,
	distantRadiusMeters = 180,
	distantIntervalSeconds = 1,
	maxStepSeconds = 0.25,
} = {}) {
	if (!creature?.object3D || typeof creature.update !== 'function') throw new Error('creature controller contract required');
	const lod = createCreatureSimulationLod({ id, nearRadiusMeters, farIntervalSeconds, distantRadiusMeters, distantIntervalSeconds, maxStepSeconds });
	const telemetry = creature.object3D.userData;
	telemetry.simulationLodTier = 'near';
	telemetry.simulationTicks = 0;
	telemetry.simulationSkippedTicks = 0;
	telemetry.simulationLastStepSeconds = 0;

	return {
		object3D: creature.object3D,
		get isFleeing() { return Boolean(creature.isFleeing); },
		update(delta, playerPosition, herdmateReactivePositions = []) {
			const hasPlayerPosition = Boolean(playerPosition && Number.isFinite(playerPosition.x) && Number.isFinite(playerPosition.z));
			const distanceToPlayer = hasPlayerPosition
				? Math.hypot(creature.object3D.position.x - playerPosition.x, creature.object3D.position.z - playerPosition.z)
				: Infinity;
			const simulationDelta = lod.step(delta, distanceToPlayer, Boolean(creature.isFleeing));
			telemetry.simulationLodTier = lod.tier;
			if (simulationDelta <= 0) {
				telemetry.simulationSkippedTicks += 1;
				telemetry.simulationLastStepSeconds = 0;
				return;
			}
			telemetry.simulationTicks += 1;
			telemetry.simulationLastStepSeconds = simulationDelta;
			creature.update(simulationDelta, playerPosition, herdmateReactivePositions);
		},
		dispose() { creature.dispose?.(); },
	};
}
