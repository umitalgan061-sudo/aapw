/**
 * Fauna-to-living-world bridge for the shipped reaction runtime.
 *
 * This is an adapter, not a second AI, ActorRegistry, navigation, faction, or
 * world-event framework. It converts canonical habitat samples and existing
 * actor observations into bounded fauna schedules, then delegates behavior to
 * livingWorldReactionRuntime through an injected factory.
 *
 * Asset-bearing spawn directives deliberately carry the shared contract names
 * and an asset-first manifest. Scene attachment remains caller-owned and must
 * run through MaterialAssignmentCore -> WorldAssetPlacementPipeline.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const text = (value, fallback = '') => value == null ? fallback : String(value);
const idOf = (value, fallback = '') => text(value, fallback).trim() || fallback;

export const FAUNA_RUNTIME_BRIDGE_POLICY = freeze({
  id: 'safak-kartali-fauna-runtime-bridge-2026-09-14-v1',
  deterministic: true,
  maxHabitats: 48,
  maxFauna: 96,
  maxSpawnsPerTick: 6,
  maxSchedules: 96,
  maxEvents: 8,
  nearMeters: 45,
  distantMeters: 140,
  farMeters: 340,
  threatMemorySeconds: 18,
  spawnCooldownSeconds: 25,
  despawnDistanceMeters: 2400,
  sharedMaterialContract: 'src/3d/materials/MaterialAssignmentCore.js',
  sharedPlacementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
});

const SPECIES = freeze({
  deer: freeze({ family: 'animals', biomes: ['forest', 'meadow', 'hills', 'taiga'], groupMin: 2, groupMax: 6, risk: 0.2, sourceCandidates: ['assets/models/animals/deer.glb', 'assets/models/animals/deer.fbx'] }),
  wolf: freeze({ family: 'animals', biomes: ['forest', 'taiga', 'hills'], groupMin: 2, groupMax: 5, risk: 0.62, sourceCandidates: ['assets/models/animals/wolf.glb', 'assets/models/animals/wolf.fbx'] }),
  horse: freeze({ family: 'animals', biomes: ['meadow', 'roadside', 'settlement-edge', 'hills'], groupMin: 1, groupMax: 3, risk: 0.12, sourceCandidates: ['assets/models/animals/horse.glb', 'assets/models/animals/horse.fbx'] }),
  dragon: freeze({ family: 'dragons', biomes: ['mountain', 'volcanic', 'ruins'], groupMin: 1, groupMax: 1, risk: 0.95, sourceCandidates: ['assets/models/dragons/dragon.glb', 'assets/models/dragons/dragon.fbx'] }),
});

const BIOME_GUARDS = freeze({
  ocean: freeze({ ground: false, water: true, travel: 0 }),
  lake: freeze({ ground: false, water: true, travel: 0.2 }),
  river: freeze({ ground: false, water: true, travel: 0.3 }),
  cliff: freeze({ ground: false, water: false, travel: 0.05 }),
});

function stableHash(value) {
  let hash = 2166136261;
  for (const ch of String(value)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function digest(value) {
  return stableHash(JSON.stringify(value ?? null)).toString(16).padStart(8, '0');
}

function stableSort(rows) {
  return [...rows].sort((a, b) => idOf(a?.id).localeCompare(idOf(b?.id)) || text(a?.species).localeCompare(text(b?.species)));
}

function vec(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
  return freeze({ x: Number(value.x), z: Number(value.z), y: Number.isFinite(Number(value.y)) ? Number(value.y) : null });
}

function speciesSpec(species, overrides = {}) {
  const key = text(species, 'deer').toLowerCase();
  const base = SPECIES[key] || freeze({ family: 'animals', biomes: [], groupMin: 1, groupMax: 1, risk: 0.4, sourceCandidates: [] });
  const custom = overrides?.[key] || {};
  return freeze({ ...base, ...custom, biomes: Array.isArray(custom.biomes) ? custom.biomes.map((v) => text(v).toLowerCase()) : base.biomes, sourceCandidates: Array.isArray(custom.sourceCandidates) ? custom.sourceCandidates.map((v) => text(v)) : base.sourceCandidates });
}

function normalizeHabitat(row, index) {
  const biome = text(row?.biome, 'unknown').toLowerCase();
  const guard = BIOME_GUARDS[biome];
  return freeze({
    id: idOf(row?.id, `habitat-${index}`), biome,
    score: clamp(row?.score, 0, 1), occupancy: clamp(row?.occupancy, 0, 1),
    food: clamp(row?.food, 0, 1), cover: clamp(row?.cover, 0, 1), danger: clamp(row?.danger, 0, 1),
    slope: clamp(row?.slope, 0, 1), waterDepth: Math.max(0, finite(row?.waterDepth, 0)),
    position: vec(row?.position), groundValid: row?.groundValid !== false && (guard?.ground ?? true),
    navReachable: row?.navReachable !== false, canonicalBiome: text(row?.canonicalBiome, biome).toLowerCase(),
    settlementDistance: Math.max(0, finite(row?.settlementDistance, 9999)), roadDistance: Math.max(0, finite(row?.roadDistance, 9999)),
  });
}

function normalizeFauna(row, index) {
  return freeze({
    id: idOf(row?.id, `fauna-${index}`), species: text(row?.species, 'deer').toLowerCase(),
    habitatId: idOf(row?.habitatId), groupId: idOf(row?.groupId), position: vec(row?.position),
    distanceMeters: Math.max(0, finite(row?.distanceMeters, 0)), lod: text(row?.lod, 'near').toLowerCase(),
    active: row?.active !== false, health: clamp(row?.health, 0, 1), ageSeconds: Math.max(0, finite(row?.ageSeconds, 0)),
  });
}

function normalizeThreat(row, index) {
  return freeze({
    id: idOf(row?.id, `threat-${index}`), distanceMeters: Math.max(0, finite(row?.distanceMeters, 9999)),
    ageSeconds: Math.max(0, finite(row?.ageSeconds, 0)), hostile: row?.hostile !== false,
    visible: row?.visible !== false, heard: row?.heard === true, confidence: clamp(row?.confidence, 0, 1),
    position: vec(row?.position), kind: text(row?.kind, 'unknown').toLowerCase(),
  });
}

function eligible(habitat, spec) {
  if (!habitat.position || !habitat.groundValid || !habitat.navReachable) return false;
  if (habitat.canonicalBiome === 'ocean' || habitat.canonicalBiome === 'cliff') return false;
  if (habitat.score < 0.45 || habitat.occupancy >= 0.97) return false;
  if (spec.biomes.length && !spec.biomes.includes(habitat.biome)) return false;
  if (habitat.slope > (spec.slopeLimit ?? 0.72)) return false;
  if (habitat.waterDepth > (spec.maxWaterDepth ?? 0.35)) return false;
  return true;
}

function lodFor(distanceMeters) {
  if (distanceMeters <= FAUNA_RUNTIME_BRIDGE_POLICY.nearMeters) return 'near';
  if (distanceMeters <= FAUNA_RUNTIME_BRIDGE_POLICY.distantMeters) return 'distant';
  if (distanceMeters <= FAUNA_RUNTIME_BRIDGE_POLICY.farMeters) return 'far';
  return 'culled';
}

function tickInterval(lod) {
  if (lod === 'near') return 0;
  if (lod === 'distant') return 0.75;
  if (lod === 'far') return 2;
  return Infinity;
}

function threatFor(fauna, threats) {
  return threats.filter((threat) => threat.hostile && threat.ageSeconds <= FAUNA_RUNTIME_BRIDGE_POLICY.threatMemorySeconds)
    .map((threat) => ({ threat, score: threat.confidence * 0.5 + (threat.visible ? 0.3 : threat.heard ? 0.15 : 0) + Math.max(0, 0.2 - threat.distanceMeters / 500) }))
    .sort((a, b) => b.score - a.score || a.threat.id.localeCompare(b.threat.id))[0] || null;
}

function stateFor(fauna, threat) {
  if (!fauna.active || fauna.health <= 0) return 'inactive';
  if (!threat) return 'roam';
  if (fauna.species === 'wolf' && threat.threat.distanceMeters < 80) return 'stalk';
  if (fauna.species === 'dragon' && threat.threat.distanceMeters < 140) return 'attack';
  return 'flee';
}

function spawnDirective(seed, tick, habitat, species, count) {
  const groupId = `${species}-${habitat.id}-${digest({ seed, tick, habitat: habitat.id, species })}`;
  return freeze({
    id: `spawn-${groupId}`, groupId, species, count,
    habitatId: habitat.id, position: habitat.position, biome: habitat.biome,
    assetFamily: speciesSpec(species).family, sourceCandidates: speciesSpec(species).sourceCandidates,
    placementContract: 'WorldAssetPlacementPipeline', materialContract: 'MaterialAssignmentCore',
    materialSequence: ['analyzeMaterialSurfaces', 'buildRecommendedLayerRecipe', 'applyMaterialRecipe', 'validateMaterialAssignment', 'createMaterialManifest'],
    placementSequence: ['groundHeight', 'navReachable', 'habitatAlignment', 'applyTransform', 'materialReadyForWorld'],
    assetFirst: true, missingAssetPolicy: 'skip-and-report',
  });
}

function updateDirective(fauna, state, threat, habitat) {
  const base = { id: fauna.id, groupId: fauna.groupId, species: fauna.species, state, lod: lodFor(fauna.distanceMeters), tickIntervalSeconds: tickInterval(lodFor(fauna.distanceMeters)), habitatId: fauna.habitatId };
  if (state === 'flee' && threat?.threat.position && fauna.position) {
    const dx = fauna.position.x - threat.threat.position.x; const dz = fauna.position.z - threat.threat.position.z; const length = Math.hypot(dx, dz) || 1;
    return freeze({ ...base, targetId: threat.threat.id, destination: { x: fauna.position.x + dx / length * 28, z: fauna.position.z + dz / length * 28 }, speedMultiplier: 1.25 });
  }
  if (state === 'stalk' || state === 'attack') return freeze({ ...base, targetId: threat?.threat.id || '', destination: threat?.threat.position || null, speedMultiplier: state === 'attack' ? 1 : 1.1 });
  return freeze({ ...base, destination: habitat?.position || null, speedMultiplier: 0.7 });
}

export function planFaunaRuntimeTick({ seed = 0, tick = 0, habitats = [], fauna = [], threats = [], hour = 12, overrides = {}, maxSpawns = FAUNA_RUNTIME_BRIDGE_POLICY.maxSpawnsPerTick } = {}) {
  const safeHabitats = stableSort((habitats || []).slice(0, FAUNA_RUNTIME_BRIDGE_POLICY.maxHabitats)).map(normalizeHabitat);
  const safeFauna = stableSort((fauna || []).slice(0, FAUNA_RUNTIME_BRIDGE_POLICY.maxFauna)).map(normalizeFauna);
  const safeThreats = stableSort((threats || []).slice(0, FAUNA_RUNTIME_BRIDGE_POLICY.maxEvents)).map(normalizeThreat);
  const spawns = [];
  const occupancy = new Map(safeHabitats.map((habitat) => [habitat.id, habitat.occupancy]));
  const speciesRows = stableSort([...new Set(safeFauna.map((row) => row.species).concat(Object.keys(overrides || {})))].map((species) => ({ id: species, species })));
  for (const row of speciesRows) {
    if (spawns.length >= Math.max(0, Math.min(FAUNA_RUNTIME_BRIDGE_POLICY.maxSpawnsPerTick, finite(maxSpawns, FAUNA_RUNTIME_BRIDGE_POLICY.maxSpawnsPerTick)))) break;
    const spec = speciesSpec(row.species, overrides);
    const candidates = safeHabitats.filter((habitat) => eligible(habitat, spec)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const habitat = candidates.find((candidate) => (occupancy.get(candidate.id) || 0) < 0.97 && ((stableHash(`${seed}:${tick}:${candidate.id}:${row.species}`) % 100) / 100) < 0.85);
    if (!habitat) continue;
    const existing = safeFauna.filter((item) => item.species === row.species && item.habitatId === habitat.id).length;
    const groupSize = Math.max(1, Math.min(spec.groupMax, Math.max(spec.groupMin, 1 + (stableHash(`${seed}:${habitat.id}`) % Math.max(1, spec.groupMax)))));
    if (existing === 0 && (occupancy.get(habitat.id) || 0) < 0.75) { spawns.push(spawnDirective(seed, tick, habitat, row.species, groupSize)); occupancy.set(habitat.id, Math.min(1, (occupancy.get(habitat.id) || 0) + 0.08)); }
  }
  const updates = safeFauna.map((item) => { const habitat = safeHabitats.find((candidate) => candidate.id === item.habitatId); const threat = threatFor(item, safeThreats); const state = stateFor(item, threat); return updateDirective(item, state, threat, habitat); });
  const events = updates.filter((update) => ['flee', 'stalk', 'attack'].includes(update.state)).slice(0, FAUNA_RUNTIME_BRIDGE_POLICY.maxEvents).map((update) => freeze({ type: 'fauna-state-change', actorId: update.id, species: update.species, state: update.state, targetId: update.targetId || '', digest: digest(update) }));
  const result = { policy: FAUNA_RUNTIME_BRIDGE_POLICY.id, deterministic: true, hour: finite(hour, 12), spawn: spawns, updates, events, digest: digest({ seed, tick, spawns, updates, events }) };
  return freeze(result);
}

export function applyFaunaRuntimeTick(plan, { spawnGroup, updateActor, emitWorldEvent } = {}) {
  const spawned = []; let updated = 0; let emitted = 0;
  for (const directive of plan?.spawn || []) { if (typeof spawnGroup === 'function') { const id = spawnGroup(directive); spawned.push(id == null ? directive.id : id); } }
  for (const update of plan?.updates || []) { if (typeof updateActor === 'function') { updateActor(update); updated += 1; } }
  for (const event of plan?.events || []) { if (typeof emitWorldEvent === 'function') { emitWorldEvent(event); emitted += 1; } }
  return freeze({ spawned, updated, emitted, digest: digest({ spawned, updated, emitted }) });
}

export function createFaunaRuntimeBridge({ createReactionRuntime, ...defaults } = {}) {
  let disposed = false;
  let runtime = null;
  if (typeof createReactionRuntime === 'function') runtime = createReactionRuntime(defaults);
  return {
    tick(input = {}) {
      if (disposed) return freeze({ accepted: false, reason: 'disposed' });
      const plan = planFaunaRuntimeTick({ ...defaults, ...input });
      const applied = runtime?.tick ? runtime.tick(input.deltaSeconds || 0, input.playerPosition) : null;
      return freeze({ accepted: true, plan, delegated: applied });
    },
    read() { return freeze({ disposed, policy: FAUNA_RUNTIME_BRIDGE_POLICY.id, runtimeReady: Boolean(runtime) }); },
    dispose() { disposed = true; runtime?.dispose?.(); runtime = null; },
  };
}
