/**
 * Deterministic fauna/ecology director layered over existing living-world owners.
 *
 * This is an adapter: it owns no ActorRegistry, spawn system, navigation mesh, or
 * material/placement implementation. Callers provide habitat samples and existing
 * services; the director returns bounded spawn/group directives and can optionally
 * forward them through an injected spawn owner.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_FAUNA_DIRECTOR_POLICY = freeze({
  id: 'living-world-fauna-director-2026-09-14-v1',
  deterministic: true,
  maxCandidatesPerTick: 24,
  maxSpawnsPerTick: 4,
  maxGroupSize: 8,
  minHabitatScore: 0.55,
  threatMemorySeconds: 18,
});

const DEFAULT_SPECIES = freeze({
  wolf: freeze({ habitat: ['forest', 'taiga', 'hills'], groupMin: 2, groupMax: 5, prey: ['deer', 'hare'], fleeFrom: ['dragon', 'guard', 'player'] }),
  deer: freeze({ habitat: ['forest', 'meadow', 'hills'], groupMin: 2, groupMax: 6, prey: [], fleeFrom: ['wolf', 'dragon', 'guard', 'player'] }),
  horse: freeze({ habitat: ['meadow', 'roadside', 'settlement-edge'], groupMin: 1, groupMax: 3, prey: [], fleeFrom: ['wolf', 'dragon'] }),
  dragon: freeze({ habitat: ['mountain', 'volcanic', 'ruins'], groupMin: 1, groupMax: 1, prey: ['horse', 'deer', 'wolf'], fleeFrom: ['guard', 'player'] }),
});

function hash32(text) {
  let hash = 2166136261;
  for (const ch of String(text)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(seed) {
  return (hash32(seed) % 100000) / 100000;
}

function stableSort(items) {
  return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalizeHabitat(sample = {}) {
  return freeze({
    id: asId(sample.id, 'habitat'),
    biome: asId(sample.biome, 'unknown').toLowerCase(),
    score: clamp(sample.score, 0, 1),
    water: clamp(sample.water, 0, 1),
    slope: clamp(sample.slope, 0, 1),
    occupancy: clamp(sample.occupancy, 0, 1),
    position: sample.position && Number.isFinite(Number(sample.position.x)) && Number.isFinite(Number(sample.position.z))
      ? freeze({ x: Number(sample.position.x), z: Number(sample.position.z) })
      : null,
  });
}

function normalizeThreats(threats) {
  if (!Array.isArray(threats)) return [];
  return stableSort(threats).slice(0, 16).map((threat, index) => freeze({
    id: asId(threat?.id, `threat-${index}`),
    kind: asId(threat?.kind, 'unknown').toLowerCase(),
    distanceMeters: Math.max(0, finite(threat?.distanceMeters, Infinity)),
    ageSeconds: Math.max(0, finite(threat?.ageSeconds, 0)),
  }));
}

function speciesSpec(species, speciesTable) {
  return speciesTable?.[species] ?? DEFAULT_SPECIES[species] ?? freeze({ habitat: [], groupMin: 1, groupMax: 1, prey: [], fleeFrom: [] });
}

function chooseGroupSize(seed, spec, pressure) {
  const min = Math.max(1, Math.min(LIVING_WORLD_FAUNA_DIRECTOR_POLICY.maxGroupSize, finite(spec.groupMin, 1)));
  const max = Math.max(min, Math.min(LIVING_WORLD_FAUNA_DIRECTOR_POLICY.maxGroupSize, finite(spec.groupMax, min)));
  const roll = unit(`${seed}:group`);
  const base = min + Math.floor(roll * (max - min + 1));
  return Math.max(1, Math.min(max, base - (pressure > 0.7 ? 1 : 0)));
}

function threatState(spec, threats) {
  const active = threats.filter((threat) => threat.ageSeconds <= LIVING_WORLD_FAUNA_DIRECTOR_POLICY.threatMemorySeconds);
  const relevant = active.filter((threat) => spec.fleeFrom.includes(threat.kind) || spec.prey.includes(threat.kind));
  const nearest = relevant.reduce((best, item) => item.distanceMeters < best.distanceMeters ? item : best, { distanceMeters: Infinity });
  if (!relevant.length) return freeze({ mode: 'roam', threatId: '', threatKind: '', pressure: 0 });
  const pressure = clamp(1 - nearest.distanceMeters / 80, 0, 1);
  const mode = spec.fleeFrom.includes(nearest.kind) && pressure >= 0.3 ? 'flee' : spec.prey.includes(nearest.kind) && pressure >= 0.45 ? 'stalk' : 'roam';
  return freeze({ mode, threatId: nearest.id, threatKind: nearest.kind, pressure });
}

export function planFaunaTick({ worldSeed = 'world', tick = 0, habitats = [], candidates = [], threats = [], speciesTable } = {}) {
  const normalizedHabitats = stableSort((Array.isArray(habitats) ? habitats : []).map(normalizeHabitat));
  const normalizedThreats = normalizeThreats(threats);
  const sortedCandidates = stableSort(Array.isArray(candidates) ? candidates : []).slice(0, LIVING_WORLD_FAUNA_DIRECTOR_POLICY.maxCandidatesPerTick);
  const candidateMap = new Map(sortedCandidates.map((candidate) => [asId(candidate.id), candidate]));
  const spawn = [];
  const updates = [];

  for (const habitat of normalizedHabitats) {
    if (!habitat.position || habitat.score < LIVING_WORLD_FAUNA_DIRECTOR_POLICY.minHabitatScore || habitat.occupancy >= 0.95) continue;
    const species = asId(habitat.species, 'deer').toLowerCase();
    const spec = speciesSpec(species, speciesTable);
    if (Array.isArray(spec.habitat) && spec.habitat.length && !spec.habitat.includes(habitat.biome)) continue;
    const pressure = normalizedThreats.length ? normalizedThreats.reduce((sum, threat) => sum + (threat.distanceMeters < 60 ? 0.25 : 0), 0) : 0;
    const groupSize = chooseGroupSize(`${worldSeed}:${tick}:${habitat.id}:${species}`, spec, pressure);
    spawn.push(freeze({
      id: `${habitat.id}:${species}:${tick}`,
      species,
      habitatId: habitat.id,
      count: groupSize,
      mode: threatState(spec, normalizedThreats).mode,
      position: habitat.position,
      placementContract: 'WorldAssetPlacementPipeline',
      materialContract: 'MaterialAssignmentCore',
    }));
  }

  for (const candidate of sortedCandidates) {
    const species = asId(candidate.species, 'deer').toLowerCase();
    const spec = speciesSpec(species, speciesTable);
    const state = threatState(spec, normalizedThreats);
    updates.push(freeze({
      id: asId(candidate.id),
      species,
      state: state.mode,
      threatId: state.threatId,
      threatKind: state.threatKind,
      pressure: state.pressure,
      lod: asId(candidate.lod, 'near'),
      tickIntervalSeconds: candidate.lod === 'far' ? 2 : candidate.lod === 'distant' ? 0.75 : 0,
      existing: candidateMap.has(asId(candidate.id)),
    }));
  }

  return freeze({
    tick: Math.max(0, Math.floor(finite(tick, 0))),
    spawn: freeze(spawn.slice(0, LIVING_WORLD_FAUNA_DIRECTOR_POLICY.maxSpawnsPerTick)),
    updates: freeze(updates),
    deterministicKey: `${asId(worldSeed)}:${Math.max(0, Math.floor(finite(tick, 0)))}:${spawn.map((item) => item.id).join('|')}:${updates.map((item) => `${item.id}:${item.state}`).join('|')}`,
  });
}

export function applyFaunaTick(plan, services = {}) {
  const safePlan = plan && typeof plan === 'object' ? plan : { spawn: [], updates: [] };
  const spawned = [];
  for (const directive of Array.isArray(safePlan.spawn) ? safePlan.spawn : []) {
    if (typeof services.spawnGroup === 'function') spawned.push(services.spawnGroup(directive));
  }
  for (const update of Array.isArray(safePlan.updates) ? safePlan.updates : []) {
    if (typeof services.updateActor === 'function') services.updateActor(update);
  }
  return freeze({ spawned: freeze(spawned), updated: Array.isArray(safePlan.updates) ? safePlan.updates.length : 0 });
}
