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

export const NPC_GUARD_ATTACK_DEFAULTS = Object.freeze({
	damage: 8,
	windupSeconds: 0.35,
	cooldownSeconds: 1.2,
	minimumCombatBlend: 0.55,
	yieldSeconds: 0.65,
});

export const NPC_GUARD_LEASH_DEFAULTS = Object.freeze({
	leashRadiusMeters: 36,
	rejoinRadiusMeters: 24,
});

function finitePositive(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Keeps an established guard controller tied to its authored home/patrol envelope without owning
 * movement itself. Once the player or guard crosses the bounded home radius, player sensing is
 * suppressed and the existing NPC controller naturally returns to its patrol waypoint/static home.
 * A smaller rejoin radius provides hysteresis so a kiting player cannot make the guard oscillate on
 * the boundary. Combat telemetry is overwritten only while returning, so downstream damage adapters
 * cannot act on stale `combat` intent during the leash return.
 */
export function wrapNpcWithHomeLeash(npc, {
	leashRadiusMeters = NPC_GUARD_LEASH_DEFAULTS.leashRadiusMeters,
	rejoinRadiusMeters = NPC_GUARD_LEASH_DEFAULTS.rejoinRadiusMeters,
} = {}) {
	if (!npc?.object3D || typeof npc.update !== 'function') throw new Error('NPC controller contract required');
	const leashRadius = Math.max(28, Math.min(64, finitePositive(leashRadiusMeters, NPC_GUARD_LEASH_DEFAULTS.leashRadiusMeters)));
	const rejoinRadius = Math.max(8, Math.min(leashRadius - 4, finitePositive(rejoinRadiusMeters, NPC_GUARD_LEASH_DEFAULTS.rejoinRadiusMeters)));
	const home = Object.freeze({ x: npc.object3D.position.x, z: npc.object3D.position.z });
	let returning = false;
	function distanceFromHome(position) {
		if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return Infinity;
		return Math.hypot(position.x - home.x, position.z - home.z);
	}
	function publishTelemetry(playerPosition) {
		npc.object3D.userData.npcLeash = Object.freeze({
			returning,
			homeDistanceMeters: Number(distanceFromHome(npc.object3D.position).toFixed(3)),
			playerHomeDistanceMeters: Number(distanceFromHome(playerPosition).toFixed(3)),
			leashRadiusMeters: leashRadius,
			rejoinRadiusMeters: rejoinRadius,
		});
	}
	publishTelemetry(null);
	return {
		object3D: npc.object3D,
		displayName: npc.displayName ?? null,
		update(delta, playerPosition) {
			const playerHomeDistance = distanceFromHome(playerPosition);
			const guardHomeDistance = distanceFromHome(npc.object3D.position);
			if (playerHomeDistance > leashRadius || guardHomeDistance > leashRadius) returning = true;
			if (returning && guardHomeDistance <= rejoinRadius && playerHomeDistance <= rejoinRadius) returning = false;
			npc.update(delta, returning ? null : playerPosition);
			if (returning) {
				const previous = npc.object3D.userData.npcPerception ?? {};
				npc.object3D.userData.npcPerception = {
					...previous,
					intent: 'return',
					reason: 'leash',
					heard: false,
					assisted: false,
					assistSourceId: null,
					lineOfSight: false,
					lastKnown: null,
				};
			}
			publishTelemetry(playerPosition);
		},
		dispose() { npc.dispose?.(); },
	};
}

/**
 * Small integration adapter between existing NPC combat intent and the existing generic player
 * damage EventBus contract. It owns neither health nor another combat state machine: hearing,
 * assist, investigation and chase remain damage-free; only sustained visual `combat` intent with
 * LOS can complete the bounded windup and emit damage. When a shared settlement attack channel is
 * supplied, only one guard in that group may own a windup at a time; the slot is released on hit,
 * disengage or dispose so nearby guards alternate pressure instead of stacking simultaneous damage.
 */
export function wrapNpcWithCombatDamage(npc, {
	eventsBus,
	damageEventName,
	damage = NPC_GUARD_ATTACK_DEFAULTS.damage,
	windupSeconds = NPC_GUARD_ATTACK_DEFAULTS.windupSeconds,
	cooldownSeconds = NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds,
	minimumCombatBlend = NPC_GUARD_ATTACK_DEFAULTS.minimumCombatBlend,
	attackChannel = null,
	attackGroupId = null,
	attackerId = npc?.object3D?.name || 'guard',
	yieldSeconds = NPC_GUARD_ATTACK_DEFAULTS.yieldSeconds,
} = {}) {
	if (!npc?.object3D || typeof npc.update !== 'function') throw new Error('NPC controller contract required');
	if (!eventsBus?.emit || !damageEventName) return npc;
	const boundedDamage = finitePositive(damage, NPC_GUARD_ATTACK_DEFAULTS.damage);
	const boundedWindup = Math.max(0.1, Math.min(0.8, finitePositive(windupSeconds, NPC_GUARD_ATTACK_DEFAULTS.windupSeconds)));
	const boundedCooldown = Math.max(0.5, Math.min(3, finitePositive(cooldownSeconds, NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds)));
	const boundedYield = Math.max(0.2, Math.min(1.5, finitePositive(yieldSeconds, NPC_GUARD_ATTACK_DEFAULTS.yieldSeconds)));
	const requiredBlend = Math.max(0, Math.min(1, Number.isFinite(minimumCombatBlend) ? minimumCombatBlend : NPC_GUARD_ATTACK_DEFAULTS.minimumCombatBlend));
	const arbitrationEnabled = Boolean(attackGroupId && attackChannel?.holders instanceof Map);
	let windupRemaining = 0;
	let cooldownRemaining = 0;
	let yieldRemaining = 0;
	let attacksEmitted = 0;
	let phase = 'idle';
	const ownsAttackSlot = () => arbitrationEnabled && attackChannel.holders.get(attackGroupId) === attackerId;
	const releaseAttackSlot = () => {
		if (ownsAttackSlot()) attackChannel.holders.delete(attackGroupId);
	};
	const acquireAttackSlot = () => {
		if (!arbitrationEnabled) return true;
		if (yieldRemaining > 0) return false;
		const holder = attackChannel.holders.get(attackGroupId);
		if (holder && holder !== attackerId) return false;
		if (!holder) attackChannel.holders.set(attackGroupId, attackerId);
		return true;
	};
	function publishTelemetry() {
		npc.object3D.userData.npcAttack = Object.freeze({
			phase,
			windupRemaining: Number(windupRemaining.toFixed(3)),
			cooldownRemaining: Number(cooldownRemaining.toFixed(3)),
			yieldRemaining: Number(yieldRemaining.toFixed(3)),
			attacksEmitted,
			damage: boundedDamage,
			attackGroupId: attackGroupId ?? null,
			ownsAttackSlot: ownsAttackSlot(),
		});
	}
	publishTelemetry();
	return {
		object3D: npc.object3D,
		displayName: npc.displayName ?? null,
		update(delta, playerPosition) {
			npc.update(delta, playerPosition);
			const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.25));
			cooldownRemaining = Math.max(0, cooldownRemaining - dt);
			yieldRemaining = Math.max(0, yieldRemaining - dt);
			const perception = npc.object3D.userData.npcPerception;
			const inCombat = perception?.intent === 'combat'
				&& perception?.lineOfSight === true
				&& npc.object3D.userData.combatStanceBlend >= requiredBlend;
			if (!inCombat) {
				windupRemaining = 0;
				releaseAttackSlot();
				phase = cooldownRemaining > 0 || yieldRemaining > 0 ? 'recover' : 'idle';
				publishTelemetry();
				return;
			}
			if (windupRemaining > 0) {
				if (arbitrationEnabled && !ownsAttackSlot()) {
					windupRemaining = 0;
					phase = 'hold';
					publishTelemetry();
					return;
				}
				windupRemaining = Math.max(0, windupRemaining - dt);
				phase = 'windup';
				if (windupRemaining === 0) {
					eventsBus.emit(damageEventName, { amount: boundedDamage, sourceId: attackerId });
					attacksEmitted += 1;
					cooldownRemaining = boundedCooldown;
					yieldRemaining = boundedYield;
					releaseAttackSlot();
					phase = 'recover';
				}
			} else if (cooldownRemaining === 0 && acquireAttackSlot()) {
				windupRemaining = boundedWindup;
				phase = 'windup';
			} else if (cooldownRemaining === 0) {
				phase = 'hold';
			} else {
				phase = 'recover';
			}
			publishTelemetry();
		},
		dispose() {
			releaseAttackSlot();
			npc.dispose?.();
		},
	};
}

export const CREATURE_PREDATOR_THREAT_RULES = Object.freeze({
	geyik: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan', 'ayi']), radiusMeters: 24 }),
	tavsan: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan', 'ayi']), radiusMeters: 20 }),
	koyun: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan', 'ayi']), radiusMeters: 22 }),
	keci: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan', 'ayi']), radiusMeters: 20 }),
	inek: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan']), radiusMeters: 20 }),
	at: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan']), radiusMeters: 22 }),
	zurafa: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan']), radiusMeters: 18 }),
	domuz: Object.freeze({ predatorSpeciesIds: Object.freeze(['aslan']), radiusMeters: 18 }),
});

/**
 * Adds short bounded threat memory around the established creature brain and, when a shared herd
 * registry is supplied, converts the brain's existing pack-alert primitive into a same-species-only
 * signal. The optional ecology registry adds a second bounded input: authored predator species can
 * wake prey and drive flee direction without becoming herd alarm sources themselves.
 *
 * Only direct player threat (plus its short direct-threat memory) is an alarm source. A creature that
 * starts fleeing because a herdmate or predator alarmed it is never re-published as another source,
 * so fear cannot relay indefinitely across the map. Nearby same-species or predator threat also marks
 * the wrapper urgent before simulation LOD runs, allowing otherwise-far prey to wake promptly.
 */
export function wrapCreatureWithThreatMemory(creature, {
	triggerRadiusMeters,
	reactiveDirection = 'away',
	memorySeconds = 1.25,
	speciesId = null,
	packAlertRadiusMeters = null,
	herdRegistry = null,
	sourceId = null,
	predatorSpeciesIds = [],
	predatorThreatRadiusMeters = 0,
	ecologyRegistry = null,
} = {}) {
	if (!creature?.object3D || typeof creature.update !== 'function') throw new Error('creature controller contract required');
	const enabled = reactiveDirection === 'away' && triggerRadiusMeters > 0 && memorySeconds > 0;
	const herdEnabled = enabled && speciesId && packAlertRadiusMeters > 0 && herdRegistry instanceof Map;
	const ecologyEnabled = speciesId && ecologyRegistry instanceof Map;
	const predatorEnabled = enabled && ecologyEnabled && predatorThreatRadiusMeters > 0 && Array.isArray(predatorSpeciesIds) && predatorSpeciesIds.length > 0;
	let memoryRemainingSeconds = 0;
	let awayX = 0;
	let awayZ = 1;
	let directThreatActive = false;
	const telemetry = creature.object3D.userData;
	telemetry.creatureThreat = Object.freeze({ phase: 'roam', direct: false, herd: false, predator: false, predatorSpeciesId: null, herdReactiveCount: 0, memoryRemainingSeconds: 0 });

	let herdMembers = null;
	let member = null;
	if (herdEnabled) {
		herdMembers = herdRegistry.get(speciesId);
		if (!herdMembers) {
			herdMembers = new Set();
			herdRegistry.set(speciesId, herdMembers);
		}
		member = {
			speciesId,
			sourceId: sourceId ?? speciesId,
			object3D: creature.object3D,
			get isDirectAlarmSource() { return directThreatActive || memoryRemainingSeconds > 0; },
		};
		herdMembers.add(member);
	}

	let ecologyMembers = null;
	let ecologyMember = null;
	if (ecologyEnabled) {
		ecologyMembers = ecologyRegistry.get(speciesId);
		if (!ecologyMembers) {
			ecologyMembers = new Set();
			ecologyRegistry.set(speciesId, ecologyMembers);
		}
		ecologyMember = { speciesId, sourceId: sourceId ?? speciesId, object3D: creature.object3D };
		ecologyMembers.add(ecologyMember);
	}

	function sameSpeciesAlarmSources() {
		if (!herdMembers || !member) return [];
		const result = [];
		for (const other of herdMembers) {
			if (other === member || !other.isDirectAlarmSource) continue;
			const dx = other.object3D.position.x - creature.object3D.position.x;
			const dz = other.object3D.position.z - creature.object3D.position.z;
			if (Math.hypot(dx, dz) < packAlertRadiusMeters) result.push({ x: other.object3D.position.x, z: other.object3D.position.z });
		}
		return result;
	}

	function nearbyPredatorSources() {
		if (!predatorEnabled) return [];
		const result = [];
		for (const predatorSpeciesId of predatorSpeciesIds) {
			const predators = ecologyRegistry.get(predatorSpeciesId);
			if (!predators) continue;
			for (const predator of predators) {
				const dx = predator.object3D.position.x - creature.object3D.position.x;
				const dz = predator.object3D.position.z - creature.object3D.position.z;
				const distanceMeters = Math.hypot(dx, dz);
				if (distanceMeters <= predatorThreatRadiusMeters) {
					result.push({ x: predator.object3D.position.x, z: predator.object3D.position.z, speciesId: predatorSpeciesId, distanceMeters });
				}
			}
		}
		result.sort((a, b) => a.distanceMeters - b.distanceMeters || a.speciesId.localeCompare(b.speciesId));
		return result;
	}

	return {
		object3D: creature.object3D,
		get speciesId() { return speciesId; },
		get isFleeing() { return Boolean(creature.isFleeing || memoryRemainingSeconds > 0 || nearbyPredatorSources().length > 0 || sameSpeciesAlarmSources().length > 0); },
		update(delta, playerPosition, _herdmateReactivePositions = []) {
			const validPlayer = Boolean(playerPosition && Number.isFinite(playerPosition.x) && Number.isFinite(playerPosition.z));
			const dx = validPlayer ? creature.object3D.position.x - playerPosition.x : 0;
			const dz = validPlayer ? creature.object3D.position.z - playerPosition.z : 0;
			const distance = validPlayer ? Math.hypot(dx, dz) : Infinity;
			const direct = enabled && distance < triggerRadiusMeters;
			directThreatActive = direct;
			if (direct) {
				memoryRemainingSeconds = memorySeconds;
				const safeDistance = Math.max(distance, 1e-6);
				awayX = dx / safeDistance;
				awayZ = dz / safeDistance;
			}
			const predatorReactivePositions = nearbyPredatorSources();
			const predator = !direct && memoryRemainingSeconds <= 0 && predatorReactivePositions.length > 0;
			const herdReactivePositions = sameSpeciesAlarmSources();
			const herd = !direct && !predator && herdReactivePositions.length > 0;
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
			} else if (predator) {
				const nearestPredator = predatorReactivePositions[0];
				const pdx = nearestPredator.x - creature.object3D.position.x;
				const pdz = nearestPredator.z - creature.object3D.position.z;
				const predatorDistance = Math.max(Math.hypot(pdx, pdz), 1e-6);
				const syntheticDistance = Math.max(0.5, triggerRadiusMeters * 0.5);
				effectivePlayerPosition = {
					x: creature.object3D.position.x + pdx / predatorDistance * syntheticDistance,
					z: creature.object3D.position.z + pdz / predatorDistance * syntheticDistance,
				};
			} else if (herd) {
				effectivePlayerPosition = herdReactivePositions[0];
			}
			creature.update(delta, effectivePlayerPosition, herdEnabled ? herdReactivePositions : _herdmateReactivePositions);
			const fleeing = Boolean(creature.isFleeing || memoryRemainingSeconds > 0 || predator || herd);
			telemetry.creatureThreat = Object.freeze({
				phase: fleeing ? (predator ? 'predator-flee' : herd && !usingMemory ? 'herd-flee' : usingMemory ? 'recover' : 'flee') : 'roam',
				direct,
				herd,
				predator,
				predatorSpeciesId: predator ? predatorReactivePositions[0]?.speciesId ?? null : null,
				herdReactiveCount: herdReactivePositions.length,
				memoryRemainingSeconds: Number(memoryRemainingSeconds.toFixed(3)),
			});
		},
		dispose() {
			if (herdMembers && member) {
				herdMembers.delete(member);
				if (herdMembers.size === 0) herdRegistry.delete(speciesId);
			}
			if (ecologyMembers && ecologyMember) {
				ecologyMembers.delete(ecologyMember);
				if (ecologyMembers.size === 0) ecologyRegistry.delete(speciesId);
			}
			creature.dispose?.();
		},
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
	const rawNpcs = await spawnConfiguredNPCs({
		assetLoader,
		npcConfig: NPC_CONFIG,
		seatsById,
		sampleGroundY: sampleClampedGroundY,
		groundCollider: state.groundCollider,
		playerCollider: state.playerCollider,
	});
	const guardAttackChannel = { holders: new Map() };
	const npcSeatById = new Map(NPC_CONFIG.SPAWNS.map((spawn) => [spawn.id, spawn.seatId]));
	state.npcs = rawNpcs.map((npc) => {
		const leashAwareNpc = wrapNpcWithHomeLeash(npc);
		return wrapNpcWithCombatDamage(leashAwareNpc, {
			eventsBus,
			damageEventName: EVENTS.PLAYER_DAMAGED,
			attackChannel: guardAttackChannel,
			attackGroupId: npcSeatById.get(npc.object3D.name) ?? null,
			attackerId: npc.object3D.name || npc.displayName || 'guard',
		});
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
	const creatureSpawnById = new Map(creatureSpawns.map((spawn) => [spawn.id, spawn]));
	const creatureHerdRegistry = new Map();
	const creatureEcologyRegistry = new Map();
	state.creatures = rawCreatures.map((creature, index) => {
		const creatureSpawn = creatureSpawnById.get(creature.object3D.name);
		const speciesId = creatureSpawn?.speciesId;
		const profile = CREATURE_BEHAVIOR_PROFILES[speciesId];
		const predatorRule = CREATURE_PREDATOR_THREAT_RULES[speciesId];
		const threatAwareCreature = wrapCreatureWithThreatMemory(creature, {
			triggerRadiusMeters: profile?.reactiveTriggerRadiusMeters ?? 0,
			reactiveDirection: profile?.reactiveDirection,
			memorySeconds: 1.25,
			speciesId,
			packAlertRadiusMeters: profile?.packAlertRadiusMeters,
			herdRegistry: creatureHerdRegistry,
			sourceId: creatureSpawn?.id ?? creature.object3D.name ?? `${speciesId ?? 'creature'}:${index}`,
			predatorSpeciesIds: predatorRule?.predatorSpeciesIds ?? [],
			predatorThreatRadiusMeters: predatorRule?.radiusMeters ?? 0,
			ecologyRegistry: creatureEcologyRegistry,
		});
		return wrapCreatureWithSimulationLod(threatAwareCreature, {
			id: creatureSpawn?.id ?? creature.object3D.name ?? `${speciesId ?? 'creature'}:${index}`,
			nearRadiusMeters: 70,
			farIntervalSeconds: 0.25,
			distantRadiusMeters: 180,
			distantIntervalSeconds: 1,
			maxStepSeconds: 0.25,
		});
	});
	for (const creature of state.creatures) state.scene.add(creature.object3D);
	console.info(`[game3d] Spawned ${state.creatures.length}/${creatureSpawns.length} procedural creature(s) with herd/ecology threat + behavior LOD.`);

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
