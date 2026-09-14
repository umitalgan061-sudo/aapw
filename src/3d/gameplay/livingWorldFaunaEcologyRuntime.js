/**
 * Deterministic ecology runtime extension for the existing fauna director.
 *
 * The module deliberately remains an adapter. It does not own ActorRegistry,
 * navigation, combat damage, world events, scene attachment, or material logic.
 * Existing owners provide observations and receive bounded commands.
 */
import { planFaunaTick } from './livingWorldFaunaDirector.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nonNegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const text = (value, fallback = '') => value == null ? fallback : String(value);
const bool = (value) => value === true;

export const LIVING_WORLD_FAUNA_ECOLOGY_POLICY = freeze({
  id: 'living-world-fauna-ecology-runtime-2026-09-14-v1',
  deterministic: true,
  maxPopulationRows: 96,
  maxHabitats: 64,
  maxCandidates: 48,
  maxThreats: 24,
  maxEvents: 16,
  maxMovementPoints: 6,
  maxGroupMembers: 8,
  maxCommands: 48,
  maxHistory: 32,
  activeThreatSeconds: 18,
  despawnDistanceMeters: 2400,
  cullDistanceMeters: 4200,
  farDistanceMeters: 1500,
  distantDistanceMeters: 650,
  nearDistanceMeters: 180,
  ecologyTickSeconds: 5,
  eventTickSeconds: 15,
  populationRefreshSeconds: 30,
  spawnCooldownSeconds: 25,
  despawnGraceSeconds: 45,
});

const SPECIES = freeze({
  deer: freeze({
    habitat: ['forest', 'meadow', 'hills', 'taiga'],
    active: ['dawn', 'day', 'dusk'],
    rest: ['night'],
    diet: 'grazer',
    groupMin: 2,
    groupMax: 6,
    preferredWaterDepth: [0, 0.18],
    slopeLimit: 0.48,
    baseRate: 1,
    assetFamily: 'animals',
    sourceCandidates: ['assets/models/animals/deer.glb', 'assets/models/animals/deer.fbx'],
  }),
  wolf: freeze({
    habitat: ['forest', 'taiga', 'hills'],
    active: ['night', 'dawn', 'dusk'],
    rest: ['day'],
    diet: 'predator',
    groupMin: 2,
    groupMax: 5,
    preferredWaterDepth: [0, 0.3],
    slopeLimit: 0.68,
    baseRate: 0.65,
    assetFamily: 'animals',
    sourceCandidates: ['assets/models/animals/wolf.glb', 'assets/models/animals/wolf.fbx'],
  }),
  horse: freeze({
    habitat: ['meadow', 'roadside', 'settlement-edge', 'hills'],
    active: ['day', 'dawn', 'dusk'],
    rest: ['night'],
    diet: 'grazer',
    groupMin: 1,
    groupMax: 3,
    preferredWaterDepth: [0, 0.12],
    slopeLimit: 0.34,
    baseRate: 0.7,
    assetFamily: 'animals',
    sourceCandidates: ['assets/models/animals/horse.glb', 'assets/models/animals/horse.fbx'],
  }),
  dragon: freeze({
    habitat: ['mountain', 'volcanic', 'ruins'],
    active: ['day', 'dusk'],
    rest: ['night'],
    diet: 'apex',
    groupMin: 1,
    groupMax: 1,
    preferredWaterDepth: [0, 0.7],
    slopeLimit: 0.85,
    baseRate: 0.08,
    assetFamily: 'dragons',
    sourceCandidates: ['assets/models/dragons/dragon.glb', 'assets/models/dragons/dragon.fbx'],
  }),
});

const BIOME_MODIFIERS = freeze({
  forest: freeze({ food: 0.92, cover: 0.96, travel: 0.72, danger: 0.42 }),
  meadow: freeze({ food: 1, cover: 0.35, travel: 0.95, danger: 0.52 }),
  hills: freeze({ food: 0.68, cover: 0.58, travel: 0.64, danger: 0.48 }),
  taiga: freeze({ food: 0.58, cover: 0.9, travel: 0.6, danger: 0.5 }),
  mountain: freeze({ food: 0.28, cover: 0.45, travel: 0.38, danger: 0.54 }),
  volcanic: freeze({ food: 0.06, cover: 0.14, travel: 0.3, danger: 0.78 }),
  ruins: freeze({ food: 0.2, cover: 0.72, travel: 0.5, danger: 0.68 }),
  roadside: freeze({ food: 0.48, cover: 0.26, travel: 0.96, danger: 0.44 }),
  'settlement-edge': freeze({ food: 0.62, cover: 0.3, travel: 0.88, danger: 0.5 }),
  ocean: freeze({ food: 0, cover: 0.02, travel: 0.04, danger: 1 }),
  lake: freeze({ food: 0.2, cover: 0.06, travel: 0.2, danger: 0.84 }),
  river: freeze({ food: 0.36, cover: 0.1, travel: 0.32, danger: 0.8 }),
  cliff: freeze({ food: 0.08, cover: 0.32, travel: 0.08, danger: 0.92 }),
});

const TIME_PHASES = freeze({
  dawn: freeze({ from: 5, to: 8, light: 0.45 }),
  day: freeze({ from: 8, to: 18, light: 1 }),
  dusk: freeze({ from: 18, to: 21, light: 0.48 }),
  night: freeze({ from: 21, to: 29, light: 0.08 }),
});

const LOD = freeze({
  near: freeze({ interval: 0, mode: 'full', scoreWeight: 1 }),
  distant: freeze({ interval: 0.75, mode: 'reduced', scoreWeight: 0.65 }),
  far: freeze({ interval: 2, mode: 'aggregate', scoreWeight: 0.25 }),
  culled: freeze({ interval: 10, mode: 'proxy', scoreWeight: 0 }),
});

function hash32(value) {
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

function unit(seed) {
  return (hash32(seed) % 1000000) / 1000000;
}

function stableId(value, fallback = '') {
  return text(value, fallback);
}

function stableSort(rows) {
  return [...rows].sort((a, b) => {
    const ai = stableId(a?.id, '');
    const bi = stableId(b?.id, '');
    return ai.localeCompare(bi);
  });
}

function normalizeList(value, limit) {
  if (!Array.isArray(value)) return [];
  return stableSort(value).slice(0, limit);
}

function normalizeVector(position) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.z))) return null;
  return freeze({
    x: Number(position.x),
    z: Number(position.z),
    y: Number.isFinite(Number(position.y)) ? Number(position.y) : null,
  });
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  const dx = finite(a.x) - finite(b.x);
  const dz = finite(a.z) - finite(b.z);
  return Math.sqrt(dx * dx + dz * dz);
}

function normalizeHour(hour) {
  const raw = nonNegative(hour, 12) % 24;
  return raw;
}

function phaseForHour(hour) {
  const value = normalizeHour(hour);
  if (value >= 5 && value < 8) return 'dawn';
  if (value >= 8 && value < 18) return 'day';
  if (value >= 18 && value < 21) return 'dusk';
  return 'night';
}

function speciesSpec(species, custom = {}) {
  const id = text(species, 'deer').toLowerCase();
  const base = SPECIES[id] || freeze({
    habitat: [],
    active: ['day'],
    rest: ['night'],
    diet: 'opportunist',
    groupMin: 1,
    groupMax: 1,
    preferredWaterDepth: [0, 0.4],
    slopeLimit: 0.7,
    baseRate: 0.2,
    assetFamily: 'animals',
    sourceCandidates: [],
  });
  const override = custom?.[id] || {};
  return freeze({
    ...base,
    ...override,
    habitat: Array.isArray(override.habitat) ? override.habitat.map((value) => text(value).toLowerCase()) : base.habitat,
    active: Array.isArray(override.active) ? override.active.map((value) => text(value).toLowerCase()) : base.active,
    rest: Array.isArray(override.rest) ? override.rest.map((value) => text(value).toLowerCase()) : base.rest,
    sourceCandidates: Array.isArray(override.sourceCandidates) ? override.sourceCandidates.map((value) => text(value)) : base.sourceCandidates,
  });
}

function normalizeHabitat(sample, index = 0) {
  const biome = text(sample?.biome, 'unknown').toLowerCase();
  const modifier = BIOME_MODIFIERS[biome] || freeze({ food: 0.3, cover: 0.3, travel: 0.5, danger: 0.7 });
  return freeze({
    id: stableId(sample?.id, `habitat-${index}`),
    biome,
    score: clamp(sample?.score, 0, 1),
    occupancy: clamp(sample?.occupancy, 0, 1),
    food: clamp(sample?.food, 0, 1) || modifier.food,
    cover: clamp(sample?.cover, 0, 1) || modifier.cover,
    danger: clamp(sample?.danger, 0, 1) || modifier.danger,
    travel: clamp(sample?.travel, 0, 1) || modifier.travel,
    waterDepth: nonNegative(sample?.waterDepth, 0),
    slope: clamp(sample?.slope, 0, 1),
    settlementDistance: nonNegative(sample?.settlementDistance, 9999),
    roadDistance: nonNegative(sample?.roadDistance, 9999),
    position: normalizeVector(sample?.position),
    navReachable: sample?.navReachable !== false,
    groundValid: sample?.groundValid !== false,
    waterValid: sample?.waterValid !== false,
    canonicalBiome: text(sample?.canonicalBiome, biome).toLowerCase(),
  });
}

function normalizeThreat(threat, index = 0) {
  return freeze({
    id: stableId(threat?.id, `threat-${index}`),
    kind: text(threat?.kind, 'unknown').toLowerCase(),
    distanceMeters: nonNegative(threat?.distanceMeters, 9999),
    ageSeconds: nonNegative(threat?.ageSeconds, 0),
    hostile: threat?.hostile !== false,
    position: normalizeVector(threat?.position),
    visible: threat?.visible !== false,
    heard: bool(threat?.heard),
    confidence: clamp(threat?.confidence, 0, 1),
  });
}

function normalizeCandidate(candidate, index = 0) {
  const lod = text(candidate?.lod, 'near').toLowerCase();
  const safeLod = LOD[lod] ? lod : 'near';
  return freeze({
    id: stableId(candidate?.id, `fauna-${index}`),
    species: text(candidate?.species, 'deer').toLowerCase(),
    lod: safeLod,
    position: normalizeVector(candidate?.position),
    ageSeconds: nonNegative(candidate?.ageSeconds, 0),
    spawnTime: nonNegative(candidate?.spawnTime, 0),
    health: clamp(candidate?.health, 0, 1),
    groupId: stableId(candidate?.groupId, ''),
    habitatId: stableId(candidate?.habitatId, ''),
    protected: bool(candidate?.protected),
    distanceMeters: nonNegative(candidate?.distanceMeters, 0),
    lastThreatAt: nonNegative(candidate?.lastThreatAt, 999999),
    active: candidate?.active !== false,
  });
}

function normalizePopulation(row, index = 0) {
  return freeze({
    species: text(row?.species, 'deer').toLowerCase(),
    habitatId: stableId(row?.habitatId, `habitat-${index}`),
    capacity: Math.max(0, Math.floor(nonNegative(row?.capacity, 0))),
    count: Math.max(0, Math.floor(nonNegative(row?.count, 0))),
    juveniles: Math.max(0, Math.floor(nonNegative(row?.juveniles, 0))),
    adults: Math.max(0, Math.floor(nonNegative(row?.adults, 0))),
    stressed: Math.max(0, Math.floor(nonNegative(row?.stressed, 0))),
    lastSpawnAt: nonNegative(row?.lastSpawnAt, -999999),
    lastEventAt: nonNegative(row?.lastEventAt, -999999),
  });
}

function habitatEligible(habitat, spec) {
  if (!habitat.position || !habitat.navReachable || !habitat.groundValid || !habitat.waterValid) return false;
  if (habitat.score < 0.45 || habitat.occupancy >= 0.98) return false;
  if (spec.habitat.length && !spec.habitat.includes(habitat.biome)) return false;
  if (habitat.slope > spec.slopeLimit) return false;
  if (habitat.waterDepth < spec.preferredWaterDepth[0] || habitat.waterDepth > spec.preferredWaterDepth[1]) return false;
  if (habitat.canonicalBiome === 'ocean' || habitat.canonicalBiome === 'cliff') return false;
  return true;
}

function foodSuitability(habitat, spec, phase) {
  const modifier = BIOME_MODIFIERS[habitat.biome] || BIOME_MODIFIERS.meadow;
  const active = spec.active.includes(phase) ? 1 : 0.45;
  const diet = spec.diet === 'predator' ? habitat.cover * 0.7 + modifier.danger * 0.2 : habitat.food * 0.75 + habitat.cover * 0.12;
  return clamp(diet * active + habitat.travel * 0.08, 0, 1);
}

function carryingCapacity(habitat, spec) {
  const density = 1 + habitat.score * 6 + habitat.cover * 2 + habitat.food * 3;
  const speciesScale = spec.groupMax / Math.max(1, spec.groupMin);
  return Math.max(spec.groupMax, Math.min(32, Math.floor(density * speciesScale * spec.baseRate)));
}

function groupPressure(population, capacity) {
  if (capacity <= 0) return 1;
  return clamp(population / capacity, 0, 1.5);
}

function spawnNeed(row, habitat, spec, phase, now) {
  if (!habitatEligible(habitat, spec)) return { wanted: 0, reason: 'habitat-blocked' };
  const cap = carryingCapacity(habitat, spec);
  const pressure = groupPressure(row?.count || 0, cap);
  const active = spec.active.includes(phase);
  if (!active) return { wanted: 0, reason: 'off-schedule' };
  if (pressure >= 0.9) return { wanted: 0, reason: 'capacity-reached' };
  if (now - nonNegative(row?.lastSpawnAt, -999999) < LIVING_WORLD_FAUNA_ECOLOGY_POLICY.spawnCooldownSeconds) return { wanted: 0, reason: 'spawn-cooldown' };
  const suitability = foodSuitability(habitat, spec, phase);
  const available = Math.max(0, cap - Math.max(0, row?.count || 0));
  const wanted = Math.min(spec.groupMax, Math.max(0, Math.floor(available * suitability)));
  return { wanted, reason: wanted > 0 ? 'restock' : 'low-suitability' };
}

function populationKey(species, habitatId) {
  return `${text(species).toLowerCase()}@${text(habitatId)}`;
}

function buildPopulationMap(rows) {
  const map = new Map();
  for (const row of rows) map.set(populationKey(row.species, row.habitatId), row);
  return map;
}

function threatPressure(spec, threats) {
  const relevant = threats.filter((threat) => threat.ageSeconds <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.activeThreatSeconds);
  const distanceScore = relevant.reduce((sum, threat) => {
    const kindPressure = spec.diet === 'predator' && ['dragon', 'guard', 'player'].includes(threat.kind) ? 1.1 : 1;
    const proximity = clamp(1 - threat.distanceMeters / 120, 0, 1);
    return sum + proximity * kindPressure;
  }, 0);
  return clamp(distanceScore / 2.5, 0, 1);
}

function chooseLod(distanceMeters) {
  const distanceValue = nonNegative(distanceMeters, 0);
  if (distanceValue <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.nearDistanceMeters) return 'near';
  if (distanceValue <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.distantDistanceMeters) return 'distant';
  if (distanceValue <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.farDistanceMeters) return 'far';
  return 'culled';
}

function lodPlan(distanceMeters, requested) {
  const chosen = requested && LOD[requested] ? requested : chooseLod(distanceMeters);
  return freeze({
    level: chosen,
    intervalSeconds: LOD[chosen].interval,
    mode: LOD[chosen].mode,
    scoreWeight: LOD[chosen].scoreWeight,
  });
}

function shouldTick(candidate, now) {
  const lod = lodPlan(candidate.distanceMeters, candidate.lod);
  if (lod.intervalSeconds === 0) return true;
  const phase = candidate.id.length % 2;
  const elapsed = Math.max(0, now - candidate.lastThreatAt);
  if (elapsed < 1 && lod.level !== 'near') return true;
  return Math.floor((now + phase) / lod.intervalSeconds) !== Math.floor((now - Math.max(0, lod.intervalSeconds - 0.01) + phase) / lod.intervalSeconds);
}

function threatDecision(spec, candidate, threats) {
  const relevant = threats
    .filter((threat) => threat.ageSeconds <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.activeThreatSeconds)
    .filter((threat) => threat.visible || threat.heard)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  if (!relevant.length) return freeze({ state: 'roam', targetId: '', pressure: 0, reason: 'calm' });
  const nearest = relevant[0];
  const proximity = clamp(1 - nearest.distanceMeters / 90, 0, 1);
  const fleeKinds = candidate.species === 'dragon' ? ['player', 'guard'] : ['dragon', 'wolf', 'player', 'guard'];
  if (fleeKinds.includes(nearest.kind) && proximity >= 0.25) {
    return freeze({ state: 'flee', targetId: nearest.id, pressure: proximity, reason: 'threat' });
  }
  if (spec.diet === 'predator' && nearest.kind === 'deer' && proximity >= 0.4) {
    return freeze({ state: 'stalk', targetId: nearest.id, pressure: proximity, reason: 'prey' });
  }
  return freeze({ state: 'roam', targetId: nearest.id, pressure: proximity * 0.5, reason: 'distant-threat' });
}

function movementVector(seed) {
  const angle = unit(`${seed}:angle`) * Math.PI * 2;
  const radius = 8 + unit(`${seed}:radius`) * 22;
  return freeze({
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
  });
}

function movementPoints(seed, origin, count = LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxMovementPoints) {
  const safeOrigin = origin || { x: 0, z: 0 };
  const points = [];
  const bounded = Math.max(1, Math.min(LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxMovementPoints, Math.floor(nonNegative(count, 1))));
  for (let index = 0; index < bounded; index += 1) {
    const vector = movementVector(`${seed}:${index}`);
    points.push(freeze({
      id: `${text(seed)}:p${index}`,
      x: safeOrigin.x + vector.x,
      z: safeOrigin.z + vector.z,
      weight: 1 - index / Math.max(1, bounded),
    }));
  }
  return freeze(points);
}

function selectMovementPoint(seed, origin, threats, habitat) {
  const points = movementPoints(seed, origin);
  if (!points.length) return null;
  const scored = points.map((point) => {
    const threatDistance = threats.reduce((best, threat) => Math.min(best, distance(point, threat.position)), Infinity);
    const separation = Number.isFinite(threatDistance) ? clamp(threatDistance / 120, 0, 1) : 1;
    const slopePenalty = habitat ? clamp(habitat.slope, 0, 1) * 0.35 : 0;
    return { point, score: separation + point.weight * 0.4 - slopePenalty };
  }).sort((a, b) => b.score - a.score || a.point.id.localeCompare(b.point.id));
  return freeze(scored[0].point);
}

function groupFormation(group, leadIndex = 0) {
  const members = stableSort(group).slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxGroupMembers);
  return freeze(members.map((member, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    const ring = Math.floor(index / 2) + 1;
    return freeze({
      id: member.id,
      leader: index === leadIndex,
      slot: index,
      offset: freeze({ x: side * ring * 2.3, z: ring * 2.7 }),
      role: index === leadIndex ? 'leader' : member.species === 'deer' ? 'herd' : 'wing',
    });
  }));
}

function scheduleWindow(spec, phase, hour) {
  const active = spec.active.includes(phase);
  const rest = spec.rest.includes(phase);
  const phaseData = TIME_PHASES[phase] || TIME_PHASES.day;
  const midpoint = (phaseData.from + phaseData.to) / 2;
  const hourDistance = Math.abs(hour - midpoint);
  const focus = active ? clamp(1 - hourDistance / 8, 0.3, 1) : rest ? 0.08 : 0.2;
  return freeze({
    active,
    rest,
    focus,
    phase,
    light: phaseData.light,
  });
}

function eventChance(spec, habitat, phase, seed, pressure) {
  const activity = spec.active.includes(phase) ? 1 : 0.25;
  const habitatFactor = clamp(habitat.score * 0.65 + habitat.food * 0.25 + habitat.cover * 0.1, 0, 1);
  const noise = unit(seed);
  const chance = clamp(spec.baseRate * activity * habitatFactor * (1 - pressure * 0.45), 0, 1);
  return noise < chance;
}

function createEcologyEvent({ type, species, habitatId, tick, priority = 0, payload = {} }) {
  return freeze({
    id: `${species}:${habitatId}:${type}:${tick}`,
    type,
    species,
    habitatId,
    tick,
    priority,
    payload: freeze({ ...payload }),
  });
}

function chooseEvent(spec, row, habitat, phase, now, seed, pressure) {
  if (!eventChance(spec, habitat, phase, seed, pressure)) return null;
  const options = spec.diet === 'predator'
    ? ['hunt', 'travel', 'rest']
    : spec.diet === 'apex'
      ? ['roam', 'roost', 'hunt']
      : ['graze', 'drink', 'travel', 'rest'];
  const choice = options[Math.floor(unit(`${seed}:event`) * options.length)] || options[0];
  const payload = choice === 'graze'
    ? { durationSeconds: 18 + Math.floor(unit(`${seed}:grazing`) * 35) }
    : choice === 'drink'
      ? { waterSearchRadius: 80 + Math.floor(unit(`${seed}:drink`) * 100) }
      : choice === 'hunt'
        ? { pursuitBudgetSeconds: 12 + Math.floor(unit(`${seed}:hunt`) * 26) }
        : choice === 'roost'
          ? { perchRadius: 35 + Math.floor(unit(`${seed}:roost`) * 80) }
          : { durationSeconds: 8 + Math.floor(unit(`${seed}:travel`) * 25) };
  return createEcologyEvent({ type: choice, species: spec.assetFamily === 'dragons' ? 'dragon' : text(species), habitatId: row?.habitatId || habitat.id, tick: Math.floor(now / LIVING_WORLD_FAUNA_ECOLOGY_POLICY.ecologyTickSeconds), priority: choice === 'flee' ? 10 : 1, payload });
}

function assetManifest(spec, species) {
  return freeze({
    family: spec.assetFamily,
    species,
    sourceCandidates: freeze([...spec.sourceCandidates]),
    requiredOrder: freeze([
      'hydrate-or-load',
      'analyze-mesh-material-slots',
      'resolve-named-part-kit-or-layered-fallback',
      'validateMaterialAssignment',
      'resolve-ground-nav-habitat',
      'create-placement-manifest',
      'scene-attach',
    ]),
    materialContract: 'MaterialAssignmentCore',
    placementContract: 'WorldAssetPlacementPipeline',
    editorRuntimeForbidden: true,
  });
}

function spawnDirective(species, habitat, row, tick, now, seed, phase, threats) {
  const threat = threatDecision(speciesSpec(species), { species, id: `${habitat.id}:${species}`, distanceMeters: 0 }, threats);
  const countSeed = `${seed}:count`;
  const min = speciesSpec(species).groupMin;
  const max = speciesSpec(species).groupMax;
  const count = Math.max(min, Math.min(max, min + Math.floor(unit(countSeed) * (max - min + 1))));
  const event = eventChance(speciesSpec(species), habitat, phase, `${seed}:spawn-event`, threat.pressure) ? 'restock' : 'idle';
  const point = movementPoints(`${seed}:route`, habitat.position, 1)[0] || freeze({ id: `${seed}:origin`, x: habitat.position.x, z: habitat.position.z, weight: 1 });
  return freeze({
    id: `${habitat.id}:${species}:${tick}`,
    species,
    count,
    habitatId: habitat.id,
    position: freeze({ x: point.x, z: point.z }),
    state: threat.state === 'flee' ? 'flee' : 'roam',
    event,
    phase,
    placement: freeze({
      groundRequired: true,
      navRequired: true,
      habitatRequired: true,
      materialManifestRequired: true,
      asset: assetManifest(speciesSpec(species), species),
    }),
    populationBefore: Math.max(0, Math.floor(row?.count || 0)),
    pressure: threat.pressure,
    materialContract: 'MaterialAssignmentCore',
    placementContract: 'WorldAssetPlacementPipeline',
    sourceAssetFamilies: assetManifest(speciesSpec(species), species).sourceCandidates,
  });
}

function despawnDirective(candidate, now, reason) {
  return freeze({
    id: candidate.id,
    species: candidate.species,
    reason,
    ageSeconds: candidate.ageSeconds,
    distanceMeters: candidate.distanceMeters,
    graceSatisfied: now - candidate.spawnTime >= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.despawnGraceSeconds,
    protected: candidate.protected,
  });
}

function shouldDespawn(candidate, now, cullDistance) {
  if (candidate.protected || !candidate.active) return null;
  if (candidate.distanceMeters > cullDistance && now - candidate.spawnTime >= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.despawnGraceSeconds) return despawnDirective(candidate, now, 'outside-world-interest');
  if (candidate.health <= 0) return despawnDirective(candidate, now, 'dead-owner-requested');
  return null;
}

function normalizeClock(clock = {}) {
  return freeze({
    hour: normalizeHour(clock.hour),
    day: Math.max(0, Math.floor(nonNegative(clock.day, 0))),
    phase: text(clock.phase, phaseForHour(clock.hour)).toLowerCase(),
    season: text(clock.season, 'summer').toLowerCase(),
    weather: text(clock.weather, 'clear').toLowerCase(),
  });
}

function weatherModifier(weather) {
  if (weather === 'storm') return 0.6;
  if (weather === 'rain') return 0.86;
  if (weather === 'snow') return 0.68;
  if (weather === 'fog') return 0.8;
  return 1;
}

function seasonModifier(season, species) {
  if (season === 'winter') return species === 'wolf' ? 1.06 : species === 'horse' ? 0.82 : species === 'deer' ? 0.74 : 0.95;
  if (season === 'autumn') return species === 'deer' ? 1.04 : 0.98;
  if (season === 'spring') return species === 'deer' ? 1.08 : species === 'wolf' ? 0.96 : 1;
  return 1;
}

function evaluateHabitat(habitat, spec, clock, populationRow) {
  const schedule = scheduleWindow(spec, clock.phase, clock.hour);
  const capacity = carryingCapacity(habitat, spec);
  const population = Math.max(0, populationRow?.count || 0);
  const crowd = clamp(population / Math.max(1, capacity), 0, 1.5);
  const pressure = threatPressure(spec, []);
  const score = clamp(
    habitat.score * 0.35
      + habitat.food * 0.18
      + habitat.cover * 0.12
      + habitat.travel * 0.08
      + schedule.focus * 0.12
      + weatherModifier(clock.weather) * 0.07
      + seasonModifier(clock.season, text(populationRow?.species, 'deer')) * 0.08
      - crowd * 0.15
      - habitat.danger * 0.08,
    0,
    1,
  );
  return freeze({
    eligible: habitatEligible(habitat, spec),
    score,
    capacity,
    population,
    crowd,
    schedule,
    pressure,
  });
}

function commandPriority(command) {
  const rank = {
    flee: 100,
    attack: 90,
    investigate: 80,
    chase: 78,
    return: 60,
    travel: 55,
    graze: 45,
    drink: 44,
    roam: 30,
    rest: 20,
    despawn: 10,
  };
  return rank[command.type] ?? 1;
}

function buildCommand(id, type, payload = {}, ttl = 5) {
  return freeze({
    id,
    type,
    priority: commandPriority({ type }),
    issuedAt: 0,
    expiresAfterSeconds: Math.max(0.1, finite(ttl, 5)),
    payload: freeze({ ...payload }),
  });
}

function dedupeCommands(commands) {
  const map = new Map();
  for (const command of commands) {
    const existing = map.get(command.id);
    if (!existing || command.priority > existing.priority) map.set(command.id, command);
  }
  return [...map.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function boundedHistory(history, item) {
  const next = [...history, freeze(item)];
  return freeze(next.slice(-LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxHistory));
}

function serializeValue(value) {
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serializeValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fingerprint(value) {
  return hash32(serializeValue(value)).toString(16).padStart(8, '0');
}

function finiteSnapshot(snapshot) {
  return freeze(JSON.parse(JSON.stringify(snapshot, (_key, value) => Number.isFinite(value) ? value : null)));
}

export function classifyFaunaLod(distanceMeters, requested = '') {
  return lodPlan(distanceMeters, requested);
}

export function getFaunaSpeciesProfile(species, customSpecies = {}) {
  const normalized = text(species, 'deer').toLowerCase();
  const spec = speciesSpec(normalized, customSpecies);
  return freeze({
    species: normalized,
    ...spec,
    asset: assetManifest(spec, normalized),
  });
}

export function evaluateFaunaHabitat(sample, species = 'deer', clock = {}, population = null, customSpecies = {}) {
  const normalizedHabitat = normalizeHabitat(sample);
  const normalizedClock = normalizeClock(clock);
  const spec = speciesSpec(species, customSpecies);
  const row = population ? normalizePopulation(population) : null;
  return evaluateHabitat(normalizedHabitat, spec, normalizedClock, row);
}

export function planPopulationRefresh({ worldSeed = 'world', now = 0, clock = {}, habitats = [], population = [], customSpecies = {} } = {}) {
  const normalizedClock = normalizeClock(clock);
  const normalizedHabitats = normalizeList(habitats, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxHabitats).map(normalizeHabitat);
  const normalizedPopulation = normalizeList(population, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows).map(normalizePopulation);
  const map = buildPopulationMap(normalizedPopulation);
  const rows = [];
  for (const habitat of normalizedHabitats) {
    for (const species of Object.keys(SPECIES).sort()) {
      const spec = speciesSpec(species, customSpecies);
      const key = populationKey(species, habitat.id);
      const current = map.get(key);
      const evaluation = evaluateHabitat(habitat, spec, normalizedClock, current);
      const cap = carryingCapacity(habitat, spec);
      const seed = `${worldSeed}:${normalizedClock.day}:${Math.floor(now / LIVING_WORLD_FAUNA_ECOLOGY_POLICY.populationRefreshSeconds)}:${habitat.id}:${species}`;
      const roll = unit(seed);
      const fertility = clamp(evaluation.score * spec.baseRate * seasonModifier(normalizedClock.season, species), 0, 1);
      const juveniles = current?.juveniles ?? Math.floor(fertility * roll * Math.max(1, Math.floor(cap * 0.2)));
      rows.push(freeze({
        species,
        habitatId: habitat.id,
        capacity: cap,
        target: Math.max(spec.groupMin, Math.min(cap, Math.floor(cap * fertility))),
        count: current?.count || 0,
        juveniles,
        adults: current?.adults ?? Math.max(0, (current?.count || 0) - juveniles),
        stressed: current?.stressed || 0,
        suitability: evaluation.score,
        eligible: evaluation.eligible,
      }));
    }
  }
  return freeze({
    kind: 'population-refresh',
    now: nonNegative(now, 0),
    clock: normalizedClock,
    rows: freeze(rows.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows)),
    fingerprint: fingerprint(rows),
  });
}

export function planFaunaEcologyTick({
  worldSeed = 'world',
  now = 0,
  clock = {},
  habitats = [],
  candidates = [],
  threats = [],
  population = [],
  speciesTable = {},
  navigation = null,
  settlement = null,
} = {}) {
  const normalizedClock = normalizeClock(clock);
  const normalizedHabitats = normalizeList(habitats, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxHabitats).map(normalizeHabitat);
  const normalizedThreats = normalizeList(threats, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxThreats).map(normalizeThreat);
  const normalizedCandidates = normalizeList(candidates, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates).map(normalizeCandidate);
  const normalizedPopulation = normalizeList(population, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows).map(normalizePopulation);
  const populationMap = buildPopulationMap(normalizedPopulation);
  const baseFaunaPlan = planFaunaTick({
    worldSeed,
    tick: Math.floor(nonNegative(now, 0)),
    habitats: normalizedHabitats.map((habitat) => ({ ...habitat, species: habitat.species || undefined })),
    candidates: normalizedCandidates.map((candidate) => ({ ...candidate, position: candidate.position })),
    threats: normalizedThreats.map((threat) => ({ ...threat })),
    speciesTable,
  });

  const spawn = [];
  const updates = [];
  const despawn = [];
  const events = [];
  const commands = [];
  const schedule = [];
  const groups = [];

  for (const habitat of normalizedHabitats) {
    for (const species of Object.keys(SPECIES).sort()) {
      const spec = speciesSpec(species, speciesTable);
      const key = populationKey(species, habitat.id);
      const row = populationMap.get(key) || freeze({ species, habitatId: habitat.id, count: 0, lastSpawnAt: -999999 });
      const evaluation = evaluateHabitat(habitat, spec, normalizedClock, row);
      const need = spawnNeed(row, habitat, spec, normalizedClock.phase, now);
      const seed = `${worldSeed}:${Math.floor(nonNegative(now, 0) / LIVING_WORLD_FAUNA_ECOLOGY_POLICY.ecologyTickSeconds)}:${habitat.id}:${species}`;
      if (need.wanted > 0 && spawn.length < 4) {
        const directive = spawnDirective(species, habitat, row, Math.floor(now), now, seed, normalizedClock.phase, normalizedThreats);
        spawn.push(directive);
        commands.push(buildCommand(directive.id, directive.state === 'flee' ? 'flee' : 'roam', {
          species,
          habitatId: habitat.id,
          target: directive.position,
          count: directive.count,
        }, 7));
      }
      const event = chooseEvent(spec, row, habitat, normalizedClock.phase, now, `${seed}:event`, threatPressure(spec, normalizedThreats));
      if (event && events.length < LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxEvents) events.push(event);
      schedule.push(freeze({
        species,
        habitatId: habitat.id,
        active: evaluation.schedule.active,
        rest: evaluation.schedule.rest,
        focus: evaluation.schedule.focus,
        suitability: evaluation.score,
        carryingCapacity: evaluation.capacity,
        population: evaluation.population,
      }));
    }
  }

  for (const candidate of normalizedCandidates) {
    const spec = speciesSpec(candidate.species, speciesTable);
    if (!shouldTick(candidate, now)) continue;
    const threat = threatDecision(spec, candidate, normalizedThreats);
    const lod = lodPlan(candidate.distanceMeters, candidate.lod);
    const habitat = normalizedHabitats.find((item) => item.id === candidate.habitatId)
      || normalizedHabitats.find((item) => item.position && candidate.position && distance(item.position, candidate.position) < 80)
      || null;
    const move = threat.state === 'flee'
      ? selectMovementPoint(`${worldSeed}:${candidate.id}:${Math.floor(now / 3)}:flee`, candidate.position, normalizedThreats, habitat)
      : selectMovementPoint(`${worldSeed}:${candidate.id}:${Math.floor(now / 5)}:roam`, candidate.position, [], habitat);
    const target = move ? freeze({ x: move.x, z: move.z }) : candidate.position;
    updates.push(freeze({
      id: candidate.id,
      species: candidate.species,
      state: threat.state,
      targetId: threat.targetId,
      pressure: threat.pressure,
      reason: threat.reason,
      lod: lod.level,
      tickIntervalSeconds: lod.intervalSeconds,
      target,
      habitatId: candidate.habitatId,
      schedule: scheduleWindow(spec, normalizedClock.phase, normalizedClock.hour),
      asset: assetManifest(spec, candidate.species),
      materialContract: 'MaterialAssignmentCore',
      placementContract: 'WorldAssetPlacementPipeline',
    }));
    commands.push(buildCommand(`${candidate.id}:${threat.state}`, threat.state, {
      actorId: candidate.id,
      species: candidate.species,
      targetId: threat.targetId,
      target,
      lod: lod.level,
    }, threat.state === 'flee' ? 2 : 7));
    if (threat.state === 'flee') {
      events.push(createEcologyEvent({
        type: 'predator-pressure',
        species: candidate.species,
        habitatId: candidate.habitatId || 'unknown',
        tick: Math.floor(now / LIVING_WORLD_FAUNA_ECOLOGY_POLICY.eventTickSeconds),
        priority: 7,
        payload: freeze({ threatId: threat.targetId, pressure: threat.pressure }),
      }));
    }
  }

  for (const candidate of normalizedCandidates) {
    const directive = shouldDespawn(candidate, now, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.cullDistanceMeters);
    if (directive) {
      despawn.push(directive);
      commands.push(buildCommand(`${candidate.id}:despawn`, 'despawn', directive, 3));
    }
  }

  const grouped = new Map();
  for (const candidate of normalizedCandidates) {
    const key = candidate.groupId || `${candidate.habitatId}:${candidate.species}`;
    const bucket = grouped.get(key) || [];
    bucket.push(candidate);
    grouped.set(key, bucket);
  }
  for (const [groupId, members] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    groups.push(freeze({
      id: groupId,
      species: text(members[0]?.species, 'deer'),
      count: Math.min(members.length, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxGroupMembers),
      formation: groupFormation(members),
    }));
  }

  const navigationGate = freeze({
    available: Boolean(navigation),
    routeOwner: navigation ? 'existing-navigation-owner' : 'caller-required',
    mutation: false,
  });
  const settlementGate = freeze({
    available: Boolean(settlement),
    owner: settlement ? 'existing-settlement-owner' : 'caller-required',
    mutation: false,
  });

  const result = {
    version: 1,
    kind: 'living-world-fauna-ecology-tick',
    now: nonNegative(now, 0),
    tick: Math.floor(nonNegative(now, 0) / LIVING_WORLD_FAUNA_ECOLOGY_POLICY.ecologyTickSeconds),
    clock: normalizedClock,
    spawn: spawn.slice(0, 4),
    updates: updates.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates),
    despawn: despawn.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates),
    events: events.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxEvents),
    groups: groups.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates),
    schedule: schedule.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows),
    commands: dedupeCommands(commands).slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands),
    navigation: navigationGate,
    settlement: settlementGate,
    basePlan: baseFaunaPlan,
    governance: freeze({
      actorRegistryOwner: 'existing-actor-registry',
      worldEventOwner: 'existing-world-event-system',
      factionOwner: 'existing-faction-reputation-diplomacy',
      materialOwner: 'MaterialAssignmentCore',
      placementOwner: 'WorldAssetPlacementPipeline',
      editorRuntimeImport: false,
      deterministic: true,
    }),
  };
  const frozen = finiteSnapshot(result);
  return freeze({ ...frozen, fingerprint: fingerprint(frozen) });
}

export function applyFaunaEcologyTick(plan, services = {}, now = 0) {
  const safePlan = plan && typeof plan === 'object' ? plan : {};
  const receipts = [];
  const errors = [];
  const commandList = Array.isArray(safePlan.commands) ? safePlan.commands : [];
  for (const command of commandList) {
    try {
      if (command.type === 'despawn' && typeof services.despawn === 'function') receipts.push(services.despawn(command.payload));
      else if (command.type === 'flee' && typeof services.updateActor === 'function') receipts.push(services.updateActor(command.payload));
      else if (typeof services.dispatchCommand === 'function') receipts.push(services.dispatchCommand(command));
    } catch (error) {
      errors.push(`${command.id}:${error?.message || 'dispatch-failed'}`);
    }
  }
  for (const directive of Array.isArray(safePlan.spawn) ? safePlan.spawn : []) {
    try {
      if (typeof services.spawnGroup === 'function') receipts.push(services.spawnGroup(directive));
    } catch (error) {
      errors.push(`${directive.id}:${error?.message || 'spawn-failed'}`);
    }
  }
  for (const update of Array.isArray(safePlan.updates) ? safePlan.updates : []) {
    try {
      if (typeof services.updateActor === 'function') receipts.push(services.updateActor(update));
    } catch (error) {
      errors.push(`${update.id}:${error?.message || 'update-failed'}`);
    }
  }
  return freeze({
    now: nonNegative(now, 0),
    dispatched: receipts.length,
    errors: freeze(errors),
    ok: errors.length === 0,
  });
}

export function summarizeFaunaEcology(plan) {
  const safePlan = plan && typeof plan === 'object' ? plan : {};
  const updates = Array.isArray(safePlan.updates) ? safePlan.updates : [];
  const spawn = Array.isArray(safePlan.spawn) ? safePlan.spawn : [];
  const events = Array.isArray(safePlan.events) ? safePlan.events : [];
  const despawn = Array.isArray(safePlan.despawn) ? safePlan.despawn : [];
  const states = {};
  for (const update of updates) states[update.state] = (states[update.state] || 0) + 1;
  const lod = {};
  for (const update of updates) lod[update.lod] = (lod[update.lod] || 0) + 1;
  return freeze({
    fingerprint: text(safePlan.fingerprint, fingerprint(safePlan)),
    spawnGroups: spawn.length,
    spawnedAnimals: spawn.reduce((sum, item) => sum + Math.max(0, Math.floor(finite(item.count))), 0),
    actorUpdates: updates.length,
    despawnCount: despawn.length,
    eventCount: events.length,
    stateCounts: freeze(states),
    lodCounts: freeze(lod),
    commandCount: Array.isArray(safePlan.commands) ? safePlan.commands.length : 0,
  });
}

export function validateFaunaEcologyPlan(plan) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== 'object') errors.push('missing-plan');
  const arrays = ['spawn', 'updates', 'despawn', 'events', 'groups', 'schedule', 'commands'];
  for (const key of arrays) if (!Array.isArray(plan?.[key])) errors.push(`missing-${key}`);
  if (Array.isArray(plan?.spawn) && plan.spawn.length > 4) errors.push('spawn-budget-exceeded');
  if (Array.isArray(plan?.commands) && plan.commands.length > LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands) errors.push('command-budget-exceeded');
  if (plan?.governance?.editorRuntimeImport) errors.push('editor-runtime-import');
  if (plan?.governance?.materialOwner !== 'MaterialAssignmentCore') errors.push('material-owner-mismatch');
  if (plan?.governance?.placementOwner !== 'WorldAssetPlacementPipeline') errors.push('placement-owner-mismatch');
  for (const spawn of plan?.spawn || []) {
    if (spawn?.placement?.groundRequired !== true) errors.push(`spawn-no-ground:${spawn?.id || 'unknown'}`);
    if (spawn?.placement?.navRequired !== true) errors.push(`spawn-no-nav:${spawn?.id || 'unknown'}`);
    if (spawn?.materialContract !== 'MaterialAssignmentCore') errors.push(`spawn-material-owner:${spawn?.id || 'unknown'}`);
    if (spawn?.placementContract !== 'WorldAssetPlacementPipeline') errors.push(`spawn-placement-owner:${spawn?.id || 'unknown'}`);
  }
  if (Array.isArray(plan?.updates) && plan.updates.some((item) => !LOD[item.lod])) warnings.push('unknown-lod-normalized');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings) });
}

export function runFaunaEcologyReplay(tape, options = {}) {
  const entries = Array.isArray(tape) ? tape : [];
  const outputs = [];
  for (const entry of entries.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxHistory)) {
    const output = planFaunaEcologyTick({ ...entry, ...options, now: finite(entry?.now, 0) });
    outputs.push(freeze({ now: output.now, fingerprint: output.fingerprint, summary: summarizeFaunaEcology(output) }));
  }
  return freeze({ count: outputs.length, outputs: freeze(outputs), digest: fingerprint(outputs) });
}

export function compareFaunaEcologyRuns(first, second) {
  const left = Array.isArray(first) ? first : [];
  const right = Array.isArray(second) ? second : [];
  const length = Math.max(left.length, right.length);
  const mismatches = [];
  for (let index = 0; index < length; index += 1) {
    const a = left[index]?.fingerprint;
    const b = right[index]?.fingerprint;
    if (a !== b) mismatches.push(freeze({ index, first: a || null, second: b || null }));
  }
  return freeze({ equal: mismatches.length === 0, mismatches: freeze(mismatches), digest: fingerprint(mismatches) });
}

export const FAUNA_ECOLOGY_SCENARIOS = freeze([
  freeze({ id: 'forest-deer-day', species: 'deer', biome: 'forest', hour: 12, weather: 'clear' }),
  freeze({ id: 'forest-deer-dawn', species: 'deer', biome: 'forest', hour: 6, weather: 'clear' }),
  freeze({ id: 'forest-deer-night', species: 'deer', biome: 'forest', hour: 23, weather: 'clear' }),
  freeze({ id: 'taiga-wolf-night', species: 'wolf', biome: 'taiga', hour: 23, weather: 'snow' }),
  freeze({ id: 'taiga-wolf-dawn', species: 'wolf', biome: 'taiga', hour: 7, weather: 'fog' }),
  freeze({ id: 'meadow-horse-day', species: 'horse', biome: 'meadow', hour: 13, weather: 'clear' }),
  freeze({ id: 'meadow-horse-night', species: 'horse', biome: 'meadow', hour: 1, weather: 'clear' }),
  freeze({ id: 'mountain-dragon-day', species: 'dragon', biome: 'mountain', hour: 14, weather: 'clear' }),
  freeze({ id: 'volcanic-dragon-dusk', species: 'dragon', biome: 'volcanic', hour: 19, weather: 'storm' }),
  freeze({ id: 'ruins-dragon-dawn', species: 'dragon', biome: 'ruins', hour: 5.5, weather: 'fog' }),
]);

export function createFaunaScenario({ scenario, worldSeed = 'scenario' } = {}) {
  const selected = scenario || FAUNA_ECOLOGY_SCENARIOS[0];
  const habitat = {
    id: `${selected.id}:habitat`,
    biome: selected.biome,
    score: 0.86,
    food: 0.78,
    cover: 0.7,
    danger: 0.28,
    travel: 0.82,
    waterDepth: 0.05,
    slope: 0.18,
    position: { x: 100, z: 100 },
    navReachable: true,
    groundValid: true,
    waterValid: true,
    canonicalBiome: selected.biome,
  };
  return freeze({
    worldSeed,
    now: selected.hour * 3600,
    clock: { hour: selected.hour, day: 3, phase: phaseForHour(selected.hour), season: 'summer', weather: selected.weather },
    habitats: [habitat],
    candidates: [],
    threats: [],
    population: [{ species: selected.species, habitatId: habitat.id, count: 0, juveniles: 0, adults: 0, lastSpawnAt: -999999 }],
  });
}

export function ecologyContractManifest() {
  return freeze({
    id: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.id,
    deterministic: true,
    runtimeOnly: true,
    owners: freeze({
      actorRegistry: 'existing',
      navigation: 'existing',
      worldEventSystem: 'existing',
      factions: 'existing',
      reputation: 'existing',
      diplomacy: 'existing',
      law: 'existing',
      materials: 'MaterialAssignmentCore',
      placement: 'WorldAssetPlacementPipeline',
    }),
    forbidden: freeze(['new-actor-registry', 'new-spawn-framework', 'new-material-system', 'EditorMaterialStudio-runtime-import', 'primitive-fauna-placeholder']),
    budgets: freeze({
      habitats: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxHabitats,
      candidates: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates,
      commands: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands,
      events: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxEvents,
    }),
  });
}

export function auditFaunaAssetDirective(directive) {
  const errors = [];
  const asset = directive?.placement?.asset || directive?.asset;
  if (!asset) errors.push('missing-asset-manifest');
  if (asset?.materialContract !== 'MaterialAssignmentCore') errors.push('missing-material-contract');
  if (asset && asset.placementContract && asset.placementContract !== 'WorldAssetPlacementPipeline') errors.push('wrong-placement-contract');
  if (asset?.editorRuntimeForbidden !== true) errors.push('editor-runtime-not-forbidden');
  if (asset && !Array.isArray(asset.sourceCandidates)) errors.push('missing-source-candidates');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function planFaunaDespawnSweep({ now = 0, candidates = [], distanceMeters = LIVING_WORLD_FAUNA_ECOLOGY_POLICY.cullDistanceMeters } = {}) {
  const rows = normalizeList(candidates, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates).map(normalizeCandidate);
  const directives = [];
  for (const candidate of rows) {
    const directive = shouldDespawn(candidate, now, distanceMeters);
    if (directive) directives.push(directive);
  }
  return freeze({
    now: nonNegative(now, 0),
    despawn: freeze(directives),
    fingerprint: fingerprint(directives),
  });
}

export function planFaunaGroupCommand({ groupId, members = [], state = 'roam', target = null } = {}) {
  const formation = groupFormation(normalizeList(members, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxGroupMembers).map(normalizeCandidate));
  return freeze({
    id: text(groupId, 'group'),
    state: text(state, 'roam'),
    target: normalizeVector(target),
    members: formation,
    command: buildCommand(`${text(groupId, 'group')}:${text(state, 'roam')}`, text(state, 'roam'), { groupId: text(groupId, 'group'), target: normalizeVector(target), formation }, 6),
  });
}

export function buildFaunaPlacementManifest({ species = 'deer', habitat = null, sourcePath = null } = {}) {
  const spec = speciesSpec(species);
  return freeze({
    asset: assetManifest(spec, text(species, 'deer')),
    sourcePath: sourcePath || spec.sourceCandidates[0] || null,
    ground: habitat?.groundValid !== false,
    navigation: habitat?.navReachable !== false,
    habitat: habitat ? text(habitat.biome, 'unknown').toLowerCase() : null,
    position: normalizeVector(habitat?.position),
    validation: freeze({
      required: freeze(['validateMaterialAssignment', 'ground-alignment', 'nav-alignment']),
      placeholderRejected: true,
      missingAssetFailure: true,
    }),
  });
}

export function getFaunaRuntimeBudgets() {
  return freeze({ ...LIVING_WORLD_FAUNA_ECOLOGY_POLICY });
}

export default freeze({
  policy: LIVING_WORLD_FAUNA_ECOLOGY_POLICY,
  scenarios: FAUNA_ECOLOGY_SCENARIOS,
  planFaunaEcologyTick,
  planPopulationRefresh,
  applyFaunaEcologyTick,
  validateFaunaEcologyPlan,
  ecologyContractManifest,
});
