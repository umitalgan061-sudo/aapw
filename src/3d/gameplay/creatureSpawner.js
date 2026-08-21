/**
 * `gameplay/creatureSpawner.js` — deterministic world placement and bounded simulation scheduling for
 * `gameplay/creatureBrain.js`'s procedural creatures. Placement reuses `world/vegetation.js`'s own
 * physical exclusion rules; behavior LOD only controls how often an already-spawned creature brain
 * ticks. Keeping both fauna population budgets here avoids adding another runtime module to the PWA
 * dependency graph while preserving `creatureBrain.js` as the owner of actual creature behavior.
 *
 * **Population size — a real performance budget, not "as many as fit".** Unlike instanced trees,
 * every creature is its own unique `THREE.SkinnedMesh` with its own skeleton. Desktop is capped at 80
 * creatures and mobile at 12. Far/distant behavior ticks are additionally staggered by deterministic
 * per-id phases so the population does not wake in lockstep.
 *
 * Placement reuses `world/vegetation.js`'s exported `isPlaceablePosition` (water/slope/seat/road
 * exclusion — unchanged, not reimplemented) over a uniform-disc bounded rejection sample. On top of
 * that canonical physical gate, this module owns only the fauna-specific habitat envelope.
 * @module gameplay/creatureSpawner
 */

import { isPlaceablePosition } from '../world/vegetation.js';

const MAX_ATTEMPTS_PER_CREATURE = 10;

export const CREATURE_HABITAT_RULES = Object.freeze({
	kedi: Object.freeze({ maxSeatDistanceMeters: 420, maxElevationAboveSeaMeters: 650 }),
	kopek: Object.freeze({ maxSeatDistanceMeters: 520, maxElevationAboveSeaMeters: 800 }),
	at: Object.freeze({ maxSeatDistanceMeters: 850, maxElevationAboveSeaMeters: 1050 }),
	koyun: Object.freeze({ maxSeatDistanceMeters: 900, maxElevationAboveSeaMeters: 1300 }),
	inek: Object.freeze({ maxSeatDistanceMeters: 700, maxElevationAboveSeaMeters: 900 }),
	keci: Object.freeze({ maxSeatDistanceMeters: 950, maxElevationAboveSeaMeters: 1800 }),
	domuz: Object.freeze({ minSeatDistanceMeters: 120, maxElevationAboveSeaMeters: 950 }),
	tavuk: Object.freeze({ maxSeatDistanceMeters: 360, maxElevationAboveSeaMeters: 600 }),
	geyik: Object.freeze({ minSeatDistanceMeters: 180, maxElevationAboveSeaMeters: 1450 }),
	ayi: Object.freeze({ minSeatDistanceMeters: 320, minElevationAboveSeaMeters: 80 }),
	aslan: Object.freeze({ minSeatDistanceMeters: 420, maxElevationAboveSeaMeters: 700 }),
	zurafa: Object.freeze({ minSeatDistanceMeters: 500, maxElevationAboveSeaMeters: 520 }),
	fil: Object.freeze({ minSeatDistanceMeters: 450, maxElevationAboveSeaMeters: 520 }),
	tavsan: Object.freeze({ minSeatDistanceMeters: 80, maxElevationAboveSeaMeters: 1200 }),
});

// Species with established herd/flock alert behavior should also have a realistic chance to spawn
// inside one another's communication envelope. Every radius is strictly below half the matching
// runtime alert radius in creatureBrain.js, so even two members on opposite sides of the shared anchor
// remain mutually reachable on the first simulation tick. Solitary species keep uniform-disc scatter.
export const CREATURE_SOCIAL_SPAWN_RADIUS_METERS = Object.freeze({
	at: 8,
	geyik: 7,
	koyun: 2.5,
	inek: 3.25,
	keci: 4,
	zurafa: 8,
	kuzgun: 5,
	kartal: 8,
	tavuk: 3.25,
});

// Predators are authored later in the deterministic species order than their prey. Without an
// inter-species spawn gate, a lion/bear can therefore materialize directly inside a freshly clustered
// herd and force an unavoidable flee burst on the first simulation tick. These buffers are deliberately
// modest (well below habitat scales and world-disc size): they prevent "predator spawned in the flock"
// while still allowing natural encounters after both actors begin moving under creatureBrain.js.
export const CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS = Object.freeze({
	ayi: Object.freeze({ geyik: 30, koyun: 24, keci: 22, tavsan: 18 }),
	aslan: Object.freeze({ geyik: 34, koyun: 28, inek: 24, at: 26, zurafa: 30, tavsan: 20 }),
});

function nearestSeatDistanceMeters(x, z, seats) {
	let nearest = Infinity;
	for (const seat of seats ?? []) nearest = Math.min(nearest, Math.hypot(x - seat.x, z - seat.z));
	return nearest;
}

export function isCreatureHabitatCompatible(speciesId, x, z, {
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	habitatRules = CREATURE_HABITAT_RULES,
} = {}) {
	const rule = habitatRules?.[speciesId];
	if (!rule) return true;
	const seatDistance = nearestSeatDistanceMeters(x, z, seats);
	if (rule.minSeatDistanceMeters != null && seatDistance < rule.minSeatDistanceMeters) return false;
	if (rule.maxSeatDistanceMeters != null && seatDistance > rule.maxSeatDistanceMeters) return false;
	if (typeof sampleHeightMeters !== 'function') return false;
	const elevationAboveSea = sampleHeightMeters(x, z) - seaLevelMeters;
	if (!Number.isFinite(elevationAboveSea)) return false;
	if (rule.minElevationAboveSeaMeters != null && elevationAboveSea < rule.minElevationAboveSeaMeters) return false;
	if (rule.maxElevationAboveSeaMeters != null && elevationAboveSea > rule.maxElevationAboveSeaMeters) return false;
	return true;
}

export function isCreaturePredatorSpawnSeparated(speciesId, x, z, spawns, {
	bufferRules = CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS,
} = {}) {
	const preyBuffers = bufferRules?.[speciesId];
	if (!preyBuffers) return true;
	for (const spawn of spawns ?? []) {
		const minimumDistanceMeters = preyBuffers[spawn?.speciesId];
		if (!(minimumDistanceMeters > 0)) continue;
		if (Math.hypot(x - spawn.x, z - spawn.z) < minimumDistanceMeters) return false;
	}
	return true;
}

function clampCreatureSimulationDelta(delta, maxStepSeconds) {
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
			const boundedDelta = clampCreatureSimulationDelta(delta, maxStepSeconds);
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

export const DESKTOP_SPECIES_COUNTS = Object.freeze({
	kedi: 4, kopek: 4, at: 6, fil: 2, geyik: 8, koyun: 10, inek: 5,
	keci: 6, domuz: 5, tavsan: 8, ayi: 3, aslan: 3, zurafa: 2,
	kuzgun: 6, kartal: 2, tavuk: 6,
});

export const MOBILE_SPECIES_COUNTS = Object.freeze({
	kedi: 1, kopek: 1, at: 1, geyik: 1, koyun: 2, inek: 1, keci: 1, domuz: 1, tavsan: 1,
	kuzgun: 1, tavuk: 1,
});

export function scatterCreatures({
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
	seed,
	seedTag,
	mulberry32,
	centerX,
	centerZ,
	radiusMeters,
	speciesCounts,
}) {
	const rng = mulberry32(seed ^ seedTag);
	const spawns = [];
	let spawnIndex = 0;
	for (const [speciesId, count] of Object.entries(speciesCounts)) {
		let placedForSpecies = 0;
		let socialAnchor = null;
		const socialRadiusMeters = CREATURE_SOCIAL_SPAWN_RADIUS_METERS[speciesId] ?? null;
		for (let i = 0; i < count; i++) {
			let placed = false;
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CREATURE; attempt++) {
				const angle = rng() * Math.PI * 2;
				const sampleRadius = socialAnchor && socialRadiusMeters
					? socialRadiusMeters * Math.sqrt(rng())
					: radiusMeters * Math.sqrt(rng());
				const sampleCenterX = socialAnchor?.x ?? centerX;
				const sampleCenterZ = socialAnchor?.z ?? centerZ;
				const x = sampleCenterX + Math.cos(angle) * sampleRadius;
				const z = sampleCenterZ + Math.sin(angle) * sampleRadius;
				const rotationYRadians = rng() * Math.PI * 2;
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
				if (!isCreatureHabitatCompatible(speciesId, x, z, { sampleHeightMeters, seaLevelMeters, seats })) continue;
				if (!isCreaturePredatorSpawnSeparated(speciesId, x, z, spawns)) continue;
				if (!socialAnchor && socialRadiusMeters) socialAnchor = Object.freeze({ x, z });
				const socialMetadata = socialAnchor && socialRadiusMeters
					? {
						socialAnchorX: socialAnchor.x,
						socialAnchorZ: socialAnchor.z,
						socialSpawnRadiusMeters: socialRadiusMeters,
					}
					: {};
				spawns.push({
					id: `creature-${speciesId}-${spawnIndex++}`,
					speciesId,
					x,
					z,
					rotationYRadians,
					...socialMetadata,
				});
				placed = true;
				placedForSpecies++;
				break;
			}
			// If a social anchor happens to sit beside a narrow physical/habitat boundary, do not let
			// the whole herd disappear. Clear it once and retry the remaining individual from the
			// canonical world disc on its next iteration; a new valid member becomes the next anchor.
			if (!placed && socialAnchor) socialAnchor = null;
		}
		if (placedForSpecies < count) {
			console.warn(
				`[gameplay/creatureSpawner] "${speciesId}": placed ${placedForSpecies}/${count} — remainder dropped ` +
					`(no valid physical+habitat+ecology position found within ${MAX_ATTEMPTS_PER_CREATURE} attempts each; not a silent cap).`,
			);
		}
	}
	return spawns;
}
