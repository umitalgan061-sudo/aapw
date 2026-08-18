/**
 * FAZ 5/6/7 + procedural-creature spawn wiring: NPCs, wild animals, the run-329 procedural
 * creature population, and dragons — everything that populates the world with living things
 * around/above the 14 kingdom seats. Extracted from `game3d.js` (run 332) purely to stay under
 * the project's 600-line-per-file cap (`game3d.js` was at 597/600, essentially no headroom left)
 * — a pure relocation, no behavior change; every value this used to read off `initGame3D`'s local
 * scope (`assetLoader`, `state`, `spawnWorld`) is now passed in explicitly instead. Reconciled
 * against ADR-0278 (also run 332, landed concurrently on main), which added `state.playerCollider`
 * threading into the NPC/animal/creature spawn calls this extraction moved — that threading is
 * preserved below, not dropped. Mirrors the
 * same "move a cohesive spawn block into its own module" precedent `gameplay/npc.js`'s
 * `spawnConfiguredNPCs` / `gameplay/animals.js`'s `spawnConfiguredAnimals` already set at run 29
 * (DECISIONS.md ADR-0028) and `gameLoopHelpers.js` set at run 105 for the tick-loop helpers.
 * @module gameplay/livingWorldSpawner
 */

import { EVENTS, WORLD_DEFAULTS, SETTLEMENT_CONFIG, CHUNK_CONFIG } from '../config.js';
import { NPC_CONFIG, ANIMAL_CONFIG, DRAGON_CONFIG } from './gameplayConfig.js';
import { spawnConfiguredNPCs } from './npc.js';
import { spawnConfiguredAnimals } from './animals.js';
import { spawnConfiguredCreatures, CREATURE_BEHAVIOR_PROFILES } from './creatureBrain.js';
import { scatterCreatures, DESKTOP_SPECIES_COUNTS, MOBILE_SPECIES_COUNTS, wrapCreatureWithSimulationLod } from './creatureSpawner.js';
import { spawnConfiguredCarts } from './cartBrain.js';
import { mulberry32 } from '../world/terrain.js';
import { spawnConfiguredDragons } from './dragons.js';
import { isCoarsePointerDevice } from '../sceneManager.js';
import { createDynamicCircleCollider } from '../physics.js';

/**
 * Adds short bounded threat memory around the established creature brain. The inner controller still
 * owns flee/herd/flight decisions; this adapter only prevents a skittish creature from flipping back
 * to wander on the first frame it crosses the exact trigger-radius boundary. While memory is active,
 * an away-reactive species receives a synthetic nearby threat on the last known away heading so the
 * existing flee branch continues for at most `memorySeconds`, then the real player position resumes.
 * Friendly approach species are intentionally untouched.
 */
export function wrapCreatureWithThreatMemory(creature, {
	triggerRadiusMeters,
	reactiveDirection = 'away',
	memorySeconds = 1.25,
} = {}) {
	if (!creature?.object3D || typeof creature.update !== 'function') throw new Error('creature controller contract required');
	const enabled = reactiveDirection === 'away' && triggerRadiusMeters > 0 && memorySeconds > 0;
	let memoryRemainingSeconds = 0;
	let awayX = 0;
	let awayZ = 1;
	const telemetry = creature.object3D.userData;
	telemetry.creatureThreat = Object.freeze({ phase: 'roam', direct: false, memoryRemainingSeconds: 0 });
	return {
		object3D: creature.object3D,
		get isFleeing() { return Boolean(creature.isFleeing || memoryRemainingSeconds > 0); },
		update(delta, playerPosition, herdmateReactivePositions = []) {
			const validPlayer = Boolean(playerPosition && Number.isFinite(playerPosition.x) && Number.isFinite(playerPosition.z));
			const dx = validPlayer ? creature.object3D.position.x - playerPosition.x : 0;
			const dz = validPlayer ? creature.object3D.position.z - playerPosition.z : 0;
			const distance = validPlayer ? Math.hypot(dx, dz) : Infinity;
			const direct = enabled && distance < triggerRadiusMeters;
			if (direct) {
				memoryRemainingSeconds = memorySeconds;
				const safeDistance = Math.max(distance, 1e-6);
				awayX = dx / safeDistance;
				awayZ = dz / safeDistance;
			}
			let effectivePlayerPosition = playerPosition;
			let usingMemory = false;
			if (enabled && !direct && memoryRemainingSeconds > 0) {
				memoryRemainingSeconds = Math.max(0, memoryRemainingSeconds - Math.max(0, delta));
				const syntheticDistance = Math.max(0.5, triggerRadiusMeters * 0.5);
				effectivePlayerPosition = {
					x: creature.object3D.position.x - awayX * syntheticDistance,
					z: creature.object3D.position.z - awayZ * syntheticDistance,
				};
				usingMemory = true;
			}
			creature.update(delta, effectivePlayerPosition, herdmateReactivePositions);
			const fleeing = Boolean(creature.isFleeing || memoryRemainingSeconds > 0);
			telemetry.creatureThreat = Object.freeze({
				phase: fleeing ? (usingMemory ? 'recover' : 'flee') : 'roam',
				direct,
				memoryRemainingSeconds: Number(memoryRemainingSeconds.toFixed(3)),
			});
		},
		dispose() { creature.dispose?.(); },
	};
}

/**
 * Spawns NPCs, animals, procedural creatures, carts, and dragons into `state.scene`, storing the
 * results back onto `state.npcs`/`state.animals`/`state.creatures`/`state.carts`/`state.dragons`
 * (same field names and shapes `game3d.js`'s tick loop and `pagehide` dispose handler already
 * expect — this function exists purely to build those arrays, not to change how callers consume
 * them).
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {object} options.state Scene-manager state (`sceneManager.js`'s `createScene` return
 *   value plus `game3d.js`'s own additions) — read for `settlementSeats`/`roadEdges`/
 *   `groundCollider`/`scene`, written for `npcs`/`animals`/`creatures`/`dragons`.
 * @param {{x: number, z: number}} options.spawnWorld Player spawn point in world space — the
 *   mobile-class creature scatter anchors on this the same way `game3d.js`'s own mobile
 *   spawn-anchored vegetation disc does, for the same world-coverage-footprint reason.
 * @param {import('../eventBus.js').gameEvents} options.eventsBus
 * @returns {Promise<void>}
 */
export async function spawnLivingWorld({ assetLoader, state, spawnWorld, eventsBus }) {
	const seatsById = new Map(state.settlementSeats.map((seat) => [seat.id, seat]));
	const sampleClampedGroundY = (worldX, worldZ) => Math.max(
		state.groundCollider.getGroundHeight(worldX, worldZ),
		WORLD_DEFAULTS.WATER_LEVEL_METERS + SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
	);
	state.npcs = await spawnConfiguredNPCs({
		assetLoader,
		npcConfig: NPC_CONFIG,
		seatsById,
		sampleGroundY: sampleClampedGroundY,
		groundCollider: state.groundCollider,
		playerCollider: state.playerCollider,
	});
	for (const npc of state.npcs) state.scene.add(npc.object3D);
	console.info(`[game3d] Spawned ${state.npcs.length} FAZ 5 NPC(s).`);

	state.animals = await spawnConfiguredAnimals({
		assetLoader,
		animalConfig: ANIMAL_CONFIG,
		seatsById,
		sampleGroundY: sampleClampedGroundY,
		groundCollider: state.groundCollider,
		playerCollider: state.playerCollider,
	});
	for (const animal of state.animals) state.scene.add(animal.object3D);
	console.info(`[game3d] Spawned ${state.animals.length} FAZ 6 animal(s).`);

	// Procedural creature population. Placement and habitat rules remain in creatureSpawner.js;
	// creatureBrain.js remains the behavior owner. Away-reactive wildlife gets a short boundary-memory
	// adapter before deterministic behavior LOD, so flee remains urgent while the animal clears the
	// trigger edge instead of flickering between flee and wander.
	const isMobileClassCreatures = isCoarsePointerDevice();
	const creatureScatterRadiusMeters = (isMobileClassCreatures ? CHUNK_CONFIG.STREAM_RADIUS_CHUNKS : CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS) * CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const creatureSpawns = scatterCreatures({
		sampleHeightMeters: (x, z) => state.groundCollider.getGroundHeight(x, z),
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seats: state.settlementSeats,
		roadEdges: state.roadEdges,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seedTag: isMobileClassCreatures ? 0x4352544d : 0x43524554,
		mulberry32,
		centerX: isMobileClassCreatures ? spawnWorld.x : 0,
		centerZ: isMobileClassCreatures ? spawnWorld.z : 0,
		radiusMeters: creatureScatterRadiusMeters,
		speciesCounts: isMobileClassCreatures ? MOBILE_SPECIES_COUNTS : DESKTOP_SPECIES_COUNTS,
	});
	const rawCreatures = spawnConfiguredCreatures({ spawns: creatureSpawns, groundCollider: state.groundCollider, playerCollider: state.playerCollider, mulberry32 });
	state.creatures = rawCreatures.map((creature, index) => {
		const speciesId = creatureSpawns[index]?.speciesId;
		const profile = CREATURE_BEHAVIOR_PROFILES[speciesId];
		const threatAwareCreature = wrapCreatureWithThreatMemory(creature, {
			triggerRadiusMeters: profile?.reactiveTriggerRadiusMeters ?? 0,
			reactiveDirection: profile?.reactiveDirection,
			memorySeconds: 1.25,
		});
		return wrapCreatureWithSimulationLod(threatAwareCreature, {
			id: `${speciesId ?? 'creature'}:${index}`,
			nearRadiusMeters: 70,
			farIntervalSeconds: 0.25,
			distantRadiusMeters: 180,
			distantIntervalSeconds: 1,
			maxStepSeconds: 0.25,
		});
	});
	for (const creature of state.creatures) state.scene.add(creature.object3D);
	console.info(`[game3d] Spawned ${state.creatures.length}/${creatureSpawns.length} procedural creature(s) with threat memory + behavior LOD.`);

	state.carts = isMobileClassCreatures ? [] : spawnConfiguredCarts({ roadEdges: state.roadEdges, mulberry32 });
	for (const cart of state.carts) state.scene.add(cart.object3D);
	console.info(`[game3d] Spawned ${state.carts.length} FAZ 6 cart(s).`);
	if (state.carts.length > 0 && typeof state.playerCollider?.registerDynamicCollider === 'function') {
		state.playerCollider.registerDynamicCollider(
			createDynamicCircleCollider(() => state.carts.map((cart) => cart.getCollisionCircle())),
		);
	}

	state.dragons = await spawnConfiguredDragons({
		assetLoader,
		dragonConfig: DRAGON_CONFIG,
		seatsById,
		sampleGroundY: sampleClampedGroundY,
		eventsBus,
		eventName: EVENTS.WORLD_EVENT_TRIGGERED,
		biteEventName: EVENTS.PLAYER_DAMAGED,
	});
	for (const dragon of state.dragons) state.scene.add(dragon.object3D);
	console.info(`[game3d] Spawned ${state.dragons.length} FAZ 7 dragon(s).`);
}