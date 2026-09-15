/**
 * Deterministic fauna population director.
 *
 * Adapter over the existing ecology policy and fauna runtime bridge. This module
 * does not create a second spawn, ActorRegistry, navigation, faction or event
 * framework. It only converts canonical habitat samples and existing actor
 * observations into bounded group directives that existing owners execute.
 *
 * Model-bearing directives are intentionally declarative. Callers must load a
 * real asset, inspect its material slots and pass the object through
 * MaterialAssignmentCore -> WorldAssetPlacementPipeline before scene attach.
 */
import {
  normalizeEcologyContext,
  evaluateHabitat,
  chooseEcologyActivity,
  chooseGroupSize,
  speciesCompetitionScore,
  planFaunaGroup,
  planHabitatSpecies,
  auditEcologyPlan,
} from './livingWorldEcologyPolicy.js';
import { planFaunaRuntimeTick } from './livingWorldFaunaRuntimeBridge.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const text = (value, fallback = '') => value == null ? fallback : String(value);
const idOf = (value, fallback = '') => text(value, fallback).trim() || fallback;

export const FAUNA_POPULATION_DIRECTOR_POLICY = freeze({
  id: 'safak-kartali-fauna-population-director-2026-09-14-v1',
  deterministic: true,
  maxHabitats: 64,
  maxSpeciesPerHabitat: 8,
  maxGroupsPerTick: 10,
  maxMembersPerGroup: 24,
  maxExistingActors: 160,
  maxSignals: 32,
  maxAmbientEvents: 8,
  nearMeters: 45,
  distantMeters: 140,
  farMeters: 340,
  culledMeters: 720,
  nearTickSeconds: 0,
  distantTickSeconds: 0.75,
  farTickSeconds: 2,
  offscreenTickSeconds: 5,
  threatMemorySeconds: 18,
  alertPropagationMeters: 85,
  regroupRadiusMeters: 32,
  sharedMaterialContract: 'src/3d/materials/MaterialAssignmentCore.js',
  sharedPlacementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
});

const SPECIES_SOURCE_FAMILIES = freeze({
  wolf: freeze({ family: 'animals', sources: ['assets/models/animals/wolf.glb', 'assets/models/animals/wolf.fbx'], palette: 'animal-fur-dark' }),
  deer: freeze({ family: 'animals', sources: ['assets/models/animals/deer_T6Cs7tmMHJ.glb', 'assets/models/animals/stag_tQdzbZ1Cmw.glb'], palette: 'animal-fur-warm' }),
  horse: freeze({ family: 'animals', sources: ['assets/models/animals/horse.glb', 'assets/models/animals/ivory_stallion.glb'], palette: 'horse-coat' }),
  bear: freeze({ family: 'animals', sources: ['assets/models/animals/bear_0PXWfxfb0Hu.glb'], palette: 'animal-fur-brown' }),
  bison: freeze({ family: 'animals', sources: ['assets/models/animals/bison_by_poly_by_google_9strha_txds_na.glb', 'assets/models/animals/bizon_RqkLNYPnfx.glb'], palette: 'animal-fur-dark' }),
  boar: freeze({ family: 'animals', sources: ['assets/models/animals/boar.glb'], palette: 'animal-fur-brown' }),
  fox: freeze({ family: 'animals', sources: ['assets/models/animals/fox.glb'], palette: 'animal-fur-warm' }),
  sheep: freeze({ family: 'animals', sources: ['assets/models/animals/sheep.glb'], palette: 'animal-fur-light' }),
  goat: freeze({ family: 'animals', sources: ['assets/models/animals/goat.glb'], palette: 'animal-fur-light' }),
  cat: freeze({ family: 'animals', sources: ['assets/models/animals/cat_6dM1J6f6pm9.glb'], palette: 'animal-fur-warm' }),
  bird: freeze({ family: 'animals', sources: ['assets/models/animals/bird_8Ph79kHbt9s.glb'], palette: 'avian-feather' }),
  bee: freeze({ family: 'animals', sources: ['assets/models/animals/bee_f0lW38lzjd4.glb'], palette: 'avian-accent' }),
  dragon: freeze({ family: 'dragons', sources: ['assets/models/dragons/dragon.glb', 'assets/models/fbx/dragon.fbx'], palette: 'dragon-black' }),
});

const LOD_LEVELS = freeze(['near', 'distant', 'far', 'offscreen', 'culled']);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
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

function stableSort(rows, key = 'id') {
  return [...rows].sort((a, b) => text(a?.[key]).localeCompare(text(b?.[key])));
}

function vec(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
  return freeze({ x: Number(value.x), z: Number(value.z), y: Number.isFinite(Number(value.y)) ? Number(value.y) : null });
}

function distance2d(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
}

function lodFor(distanceMeters, visible = true) {
  const distance = Math.max(0, finite(distanceMeters, Infinity));
  if (distance <= FAUNA_POPULATION_DIRECTOR_POLICY.nearMeters) return 'near';
  if (distance <= FAUNA_POPULATION_DIRECTOR_POLICY.distantMeters) return 'distant';
  if (distance <= FAUNA_POPULATION_DIRECTOR_POLICY.farMeters) return 'far';
  if (distance <= FAUNA_POPULATION_DIRECTOR_POLICY.culledMeters) return visible ? 'offscreen' : 'offscreen';
  return 'culled';
}

function tickIntervalFor(lod) {
  if (lod === 'near') return FAUNA_POPULATION_DIRECTOR_POLICY.nearTickSeconds;
  if (lod === 'distant') return FAUNA_POPULATION_DIRECTOR_POLICY.distantTickSeconds;
  if (lod === 'far') return FAUNA_POPULATION_DIRECTOR_POLICY.farTickSeconds;
  if (lod === 'offscreen') return FAUNA_POPULATION_DIRECTOR_POLICY.offscreenTickSeconds;
  return Infinity;
}

function normalizeHabitat(row, index) {
  const context = normalizeEcologyContext({
    ...(row || {}),
    biome: row?.canonicalBiome ?? row?.biome,
    distanceToSettlementMeters: row?.distanceToSettlementMeters ?? row?.settlementDistance,
    distanceToRoadMeters: row?.distanceToRoadMeters ?? row?.roadDistance,
  });
  return freeze({
    id: idOf(row?.id, `habitat-${index}`),
    biome: context.biome,
    canonicalBiome: text(row?.canonicalBiome, context.biome).toLowerCase(),
    context,
    position: vec(row?.position),
    groundValid: row?.groundValid !== false,
    navReachable: row?.navReachable !== false,
    settlementId: idOf(row?.settlementId),
    roadId: idOf(row?.roadId),
    score: clamp(row?.score, 0, 1),
    occupancy: clamp(row?.occupancy, 0, 1),
    cover: clamp(row?.cover, 0, 1),
    food: clamp(row?.food, 0, 1),
  });
}

function normalizeActor(row, index) {
  const position = vec(row?.position ?? row?.object3D?.position);
  return freeze({
    id: idOf(row?.id ?? row?.actorId ?? row?.object3D?.uuid, `fauna-${index}`),
    species: text(row?.species, 'deer').toLowerCase(),
    groupId: idOf(row?.groupId),
    habitatId: idOf(row?.habitatId),
    position,
    distanceMeters: Math.max(0, finite(row?.distanceMeters, Infinity)),
    active: row?.active !== false,
    health: clamp(row?.health, 0, 1),
    threatMemorySeconds: Math.max(0, finite(row?.threatMemorySeconds, 0)),
    visible: row?.visible !== false,
    behavior: text(row?.behavior, 'roam').toLowerCase(),
  });
}

function normalizeThreat(row, index) {
  return freeze({
    id: idOf(row?.id, `threat-${index}`),
    kind: text(row?.kind, 'unknown').toLowerCase(),
    position: vec(row?.position),
    distanceMeters: Math.max(0, finite(row?.distanceMeters, Infinity)),
    confidence: clamp(row?.confidence, 0, 1),
    visible: row?.visible !== false,
    heard: row?.heard === true,
    hostile: row?.hostile !== false,
    ageSeconds: Math.max(0, finite(row?.ageSeconds, 0)),
    targetFactionId: idOf(row?.targetFactionId),
  });
}

function normalizedSpeciesList(species, fallback = ['deer', 'wolf', 'horse']) {
  const rows = Array.isArray(species) && species.length ? species : fallback;
  const out = [];
  const seen = new Set();
  for (const item of rows) {
    const value = text(item?.species ?? item, '').toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= FAUNA_POPULATION_DIRECTOR_POLICY.maxSpeciesPerHabitat) break;
  }
  return out;
}

function sourceManifest(species, groupId, habitatId) {
  const source = SPECIES_SOURCE_FAMILIES[species] || freeze({ family: 'animals', sources: [], palette: 'animal-fur-warm' });
  return freeze({
    groupId,
    habitatId,
    species,
    assetFamily: source.family,
    sourceCandidates: source.sources,
    paletteHint: source.palette,
    assetFirst: true,
    loadOrder: ['resolve-lfs-or-remote-source', 'load-real-asset', 'analyze-material-slots', 'choose-named-or-layered-recipe', 'apply-material-recipe', 'validateMaterialAssignment', 'createMaterialManifest', 'prepareWorldAssetForPlacement', 'attachPreparedWorldAsset'],
    slotFamilies: species === 'horse'
      ? ['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']
      : species === 'dragon'
        ? ['scale', 'wing', 'eye', 'horn', 'claw']
        : species === 'bird'
          ? ['feather', 'eye', 'beak', 'claw']
          : ['fur', 'eye', 'claw', 'tooth'],
    fallback: 'layered-material-on-single-mesh',
    missingAssetPolicy: 'skip-and-report',
    materialContract: FAUNA_POPULATION_DIRECTOR_POLICY.sharedMaterialContract,
    placementContract: FAUNA_POPULATION_DIRECTOR_POLICY.sharedPlacementContract,
  });
}

function canonicalHabitatGate(habitat, species, context = {}) {
  if (!habitat?.position) return freeze({ accepted: false, reason: 'missing-position' });
  if (!habitat.groundValid) return freeze({ accepted: false, reason: 'invalid-ground' });
  if (!habitat.navReachable) return freeze({ accepted: false, reason: 'nav-unreachable' });
  if (['ocean', 'lake', 'river', 'cliff'].includes(habitat.canonicalBiome)) return freeze({ accepted: false, reason: `forbidden-biome:${habitat.canonicalBiome}` });
  const evaluation = evaluateHabitat(species, { ...habitat.context, ...context, biome: habitat.biome });
  if (!evaluation.accepted) return freeze({ accepted: false, reason: evaluation.reasons[0] || 'ecology-score', evaluation });
  return freeze({ accepted: true, evaluation });
}

function occupancyFor(habitat, actors) {
  const count = actors.filter((actor) => actor.habitatId === habitat.id && actor.active).length;
  const density = Math.min(1, count / Math.max(1, FAUNA_POPULATION_DIRECTOR_POLICY.maxMembersPerGroup * 2));
  return Math.max(habitat.occupancy, density);
}

function existingGroupsFor(habitatId, species, actors) {
  return stableSort(actors.filter((actor) => actor.habitatId === habitatId && actor.species === species && actor.active && actor.groupId), 'groupId')
    .reduce((groups, actor) => groups.includes(actor.groupId) ? groups : [...groups, actor.groupId], []);
}

function bestThreatFor(threats) {
  return stableSort(threats.filter((threat) => threat.hostile && threat.ageSeconds <= FAUNA_POPULATION_DIRECTOR_POLICY.threatMemorySeconds), 'id')
    .map((threat) => ({ threat, score: threat.confidence * 0.55 + (threat.visible ? 0.25 : threat.heard ? 0.12 : 0) + Math.max(0, 0.2 - threat.distanceMeters / 500) }))
    .sort((a, b) => b.score - a.score || a.threat.id.localeCompare(b.threat.id))[0] || null;
}

function groupState(species, actors, threats, hour, habitat) {
  const active = actors.filter((actor) => actor.active && actor.species === species && actor.habitatId === habitat.id);
  const threat = bestThreatFor(threats);
  if (!active.length) return freeze({ state: 'spawn', threat: null, reason: 'no-active-members' });
  if (threat) {
    if (species === 'wolf' && threat.threat.distanceMeters < 80) return freeze({ state: 'stalk', threat, reason: 'predator-opportunity' });
    if (species === 'dragon' && threat.threat.distanceMeters < 140) return freeze({ state: 'attack', threat, reason: 'territorial-threat' });
    return freeze({ state: 'flee', threat, reason: 'threat-detected' });
  }
  const activity = chooseEcologyActivity(species, { biome: habitat.biome, nearWater: habitat.context.nearWater, threatLevel: 0 }, 0, hour * 3600);
  return freeze({ state: activity, threat: null, reason: 'ecology-schedule' });
}

function memberDirective(actor, state, threat, habitat, groupId) {
  const lod = lodFor(actor.distanceMeters, actor.visible);
  const base = {
    id: actor.id,
    groupId,
    species: actor.species,
    habitatId: habitat.id,
    lod,
    tickIntervalSeconds: tickIntervalFor(lod),
    simulatedOffscreen: lod === 'offscreen' || lod === 'far',
    state,
    targetId: threat?.threat?.id || '',
    destination: habitat.position,
  };
  if (state === 'flee' && threat?.threat?.position && actor.position) {
    const dx = actor.position.x - threat.threat.position.x;
    const dz = actor.position.z - threat.threat.position.z;
    const length = Math.hypot(dx, dz) || 1;
    return freeze({ ...base, destination: { x: actor.position.x + (dx / length) * FAUNA_POPULATION_DIRECTOR_POLICY.regroupRadiusMeters, z: actor.position.z + (dz / length) * FAUNA_POPULATION_DIRECTOR_POLICY.regroupRadiusMeters }, speedMultiplier: 1.25 });
  }
  if (state === 'stalk' || state === 'attack') return freeze({ ...base, destination: threat?.threat?.position || habitat.position, speedMultiplier: state === 'attack' ? 1 : 1.1 });
  if (state === 'rest') return freeze({ ...base, destination: actor.position || habitat.position, speedMultiplier: 0 });
  return freeze({ ...base, speedMultiplier: state === 'travel' ? 1 : 0.7 });
}

function groupDirective({ seed, tick, species, habitat, count, state, threat, activity, existingGroupIds }) {
  const groupId = `${species}-${habitat.id}-${digest({ seed, tick, species, habitat: habitat.id })}`;
  return freeze({
    id: `group-${groupId}`,
    groupId,
    species,
    count,
    habitatId: habitat.id,
    biome: habitat.biome,
    position: habitat.position,
    state,
    activity,
    threatId: threat?.threat?.id || '',
    existingGroupIds: freeze(existingGroupIds),
    regroupRadiusMeters: FAUNA_POPULATION_DIRECTOR_POLICY.regroupRadiusMeters,
    propagationRadiusMeters: FAUNA_POPULATION_DIRECTOR_POLICY.alertPropagationMeters,
    worldEventType: state === 'flee' ? 'fauna-pack-alert' : state === 'attack' ? 'fauna-territorial-attack' : `fauna-${activity}`,
    assetManifest: sourceManifest(species, groupId, habitat.id),
    placement: freeze({ groundAligned: true, navAligned: true, habitatAligned: true, canonicalContextRequired: true }),
  });
}

function ambientEventFor(group) {
  if (!group || !group.worldEventType) return null;
  return freeze({
    type: group.worldEventType,
    actorId: group.groupId,
    species: group.species,
    habitatId: group.habitatId,
    targetId: group.threatId,
    radiusMeters: group.propagationRadiusMeters,
    deterministicKey: digest({ group: group.groupId, state: group.state, activity: group.activity }),
  });
}

function rankHabitat(habitat, species, actors, context) {
  const gate = canonicalHabitatGate(habitat, species, context);
  if (!gate.accepted) return freeze({ habitat, accepted: false, score: 0, reason: gate.reason, evaluation: gate.evaluation || null });
  const occupancy = occupancyFor(habitat, actors);
  const competition = speciesCompetitionScore(species, [], { ...habitat.context, ...context });
  const score = clamp(habitat.score * 0.35 + gate.evaluation.score * 0.4 + (1 - occupancy) * 0.15 + competition * 0.1);
  return freeze({ habitat, accepted: score >= 0.24, score, occupancy, evaluation: gate.evaluation });
}

function selectSpeciesForHabitat(habitat, requestedSpecies, actors, context, seed) {
  const ranked = planHabitatSpecies({
    species: normalizedSpeciesList(requestedSpecies),
    context: { ...habitat.context, ...context, biome: habitat.biome },
    seed: `${seed}:${habitat.id}`,
    maxSpecies: FAUNA_POPULATION_DIRECTOR_POLICY.maxSpeciesPerHabitat,
  });
  return ranked.filter((entry) => rankHabitat(habitat, entry.species, actors, context).accepted);
}

function buildSpawnGroup({ seed, tick, species, habitat, actors, context, hour }) {
  const gate = canonicalHabitatGate(habitat, species, context);
  if (!gate.accepted) return null;
  const occupancy = occupancyFor(habitat, actors);
  if (occupancy >= 0.82) return null;
  const existing = existingGroupsFor(habitat.id, species, actors);
  if (existing.length) return null;
  const abundance = clamp((habitat.food + habitat.cover + (1 - occupancy)) / 3);
  const count = Math.max(1, Math.min(FAUNA_POPULATION_DIRECTOR_POLICY.maxMembersPerGroup, chooseGroupSize(species, `${seed}:${tick}:${habitat.id}`, abundance)));
  const activity = chooseEcologyActivity(species, { ...habitat.context, ...context }, `${seed}:${species}`, hour * 3600);
  const group = groupDirective({ seed, tick, species, habitat, count, state: 'spawn', threat: null, activity, existingGroupIds: existing });
  return freeze({ ...group, score: gate.evaluation.score, ecology: gate.evaluation, groupPlan: planFaunaGroup({ species, centerX: habitat.position.x, centerZ: habitat.position.z, radiusMeters: species === 'dragon' ? 36 : 18, seed: `${seed}:${tick}:${habitat.id}`, context: { ...habitat.context, ...context }, existingSpecies: [] }) });
}

function buildExistingGroup({ species, habitat, actors, threats, hour }) {
  const members = actors.filter((actor) => actor.habitatId === habitat.id && actor.species === species && actor.active);
  if (!members.length) return null;
  const current = groupState(species, members, threats, hour, habitat);
  const groupId = members[0].groupId || `${species}-${habitat.id}-existing`;
  const directives = members.map((actor) => memberDirective(actor, current.state, current.threat, habitat, groupId));
  return freeze({
    id: `existing-${groupId}`,
    groupId,
    species,
    habitatId: habitat.id,
    count: members.length,
    state: current.state,
    activity: current.state,
    threatId: current.threat?.threat?.id || '',
    reason: current.reason,
    members: freeze(directives),
    assetManifest: sourceManifest(species, groupId, habitat.id),
    placement: freeze({ groundAligned: true, navAligned: true, habitatAligned: true, canonicalContextRequired: true }),
  });
}

function normalizeInput(input = {}) {
  const habitats = stableSort((input.habitats || []).slice(0, FAUNA_POPULATION_DIRECTOR_POLICY.maxHabitats)).map(normalizeHabitat);
  const actors = stableSort((input.fauna || input.actors || []).slice(0, FAUNA_POPULATION_DIRECTOR_POLICY.maxExistingActors)).map(normalizeActor);
  const threats = stableSort((input.threats || []).slice(0, FAUNA_POPULATION_DIRECTOR_POLICY.maxSignals)).map(normalizeThreat);
  const playerPosition = vec(input.playerPosition);
  return freeze({
    seed: text(input.seed, 'aapw'),
    tick: Math.max(0, Math.floor(finite(input.tick, 0))),
    hour: Math.max(0, Math.min(24, finite(input.hour, 12))),
    context: normalizeEcologyContext(input.context || {}),
    requestedSpecies: normalizedSpeciesList(input.species),
    habitats,
    actors,
    threats,
    playerPosition,
    maxGroups: Math.max(0, Math.min(FAUNA_POPULATION_DIRECTOR_POLICY.maxGroupsPerTick, Math.floor(finite(input.maxGroups, FAUNA_POPULATION_DIRECTOR_POLICY.maxGroupsPerTick)))),
  });
}

export function planFaunaPopulationTick(input = {}) {
  const safe = normalizeInput(input);
  const groups = [];
  const rejected = [];
  const rankedHabitats = safe.habitats.map((habitat) => {
    const rank = rankHabitat(habitat, safe.requestedSpecies[0] || 'deer', safe.actors, safe.context);
    return { habitat, rank };
  }).sort((a, b) => b.rank.score - a.rank.score || a.habitat.id.localeCompare(b.habitat.id));

  for (const row of rankedHabitats) {
    if (groups.length >= safe.maxGroups) break;
    const habitat = row.habitat;
    const speciesRows = selectSpeciesForHabitat(habitat, safe.requestedSpecies, safe.actors, safe.context, safe.seed);
    if (!speciesRows.length) {
      rejected.push(freeze({ habitatId: habitat.id, reason: row.rank.reason || 'no-species-admitted' }));
      continue;
    }
    for (const entry of speciesRows) {
      if (groups.length >= safe.maxGroups) break;
      const existing = buildExistingGroup({ species: entry.species, habitat, actors: safe.actors, threats: safe.threats, hour: safe.hour });
      if (existing) {
        groups.push(existing);
        continue;
      }
      const spawned = buildSpawnGroup({ seed: safe.seed, tick: safe.tick, species: entry.species, habitat, actors: safe.actors, context: safe.context, hour: safe.hour });
      if (spawned) groups.push(spawned);
      else rejected.push(freeze({ habitatId: habitat.id, species: entry.species, reason: 'occupancy-or-canonical-gate' }));
    }
  }

  const memberUpdates = groups.flatMap((group) => Array.isArray(group.members) ? group.members : []);
  const spawn = groups.filter((group) => group.state === 'spawn').map((group) => freeze({ ...group, members: freeze([]) }));
  const ambientEvents = groups.map(ambientEventFor).filter(Boolean).slice(0, FAUNA_POPULATION_DIRECTOR_POLICY.maxAmbientEvents);
  const runtimePreview = planFaunaRuntimeTick({ seed: safe.seed, tick: safe.tick, hour: safe.hour, habitats: safe.habitats.map((habitat) => ({ id: habitat.id, biome: habitat.biome, score: habitat.score, occupancy: habitat.occupancy, food: habitat.food, cover: habitat.cover, position: habitat.position, groundValid: habitat.groundValid, navReachable: habitat.navReachable, canonicalBiome: habitat.canonicalBiome })), fauna: safe.actors.map((actor) => ({ id: actor.id, species: actor.species, habitatId: actor.habitatId, groupId: actor.groupId, position: actor.position, distanceMeters: actor.distanceMeters, active: actor.active, health: actor.health })), threats: safe.threats });
  const result = {
    policy: FAUNA_POPULATION_DIRECTOR_POLICY.id,
    deterministic: true,
    seed: safe.seed,
    tick: safe.tick,
    hour: safe.hour,
    groups: freeze(groups),
    spawn: freeze(spawn),
    updates: freeze(memberUpdates),
    events: freeze(ambientEvents),
    rejected: freeze(rejected),
    runtimePreview,
    budget: freeze({ habitats: safe.habitats.length, actors: safe.actors.length, threats: safe.threats.length, groups: groups.length, spawn: spawn.length, updates: memberUpdates.length, events: ambientEvents.length }),
  };
  return freeze({ ...result, digest: digest(result) });
}

export function applyFaunaPopulationTick(plan, owners = {}) {
  const spawned = [];
  const updated = [];
  const emitted = [];
  for (const group of plan?.spawn || []) {
    if (typeof owners.spawnGroup === 'function') spawned.push(owners.spawnGroup(group));
  }
  for (const update of plan?.updates || []) {
    if (typeof owners.updateActor === 'function') { owners.updateActor(update); updated.push(update.id); }
  }
  for (const event of plan?.events || []) {
    if (typeof owners.emitWorldEvent === 'function') { owners.emitWorldEvent(event); emitted.push(event.deterministicKey); }
  }
  return freeze({ spawned: freeze(spawned), updated: freeze(updated), emitted: freeze(emitted), delegated: spawned.length + updated.length + emitted.length, digest: digest({ spawned, updated, emitted }) });
}

export function auditFaunaPopulationPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') errors.push('missing-plan');
  if (plan?.deterministic !== true) errors.push('non-deterministic-plan');
  if ((plan?.groups || []).length > FAUNA_POPULATION_DIRECTOR_POLICY.maxGroupsPerTick) errors.push('group-budget-overflow');
  for (const group of plan?.groups || []) {
    if (!group?.assetManifest?.assetFirst) errors.push(`asset-first:${group?.groupId || 'unknown'}`);
    if (group?.assetManifest?.materialContract !== FAUNA_POPULATION_DIRECTOR_POLICY.sharedMaterialContract) errors.push(`material-contract:${group?.groupId || 'unknown'}`);
    if (group?.assetManifest?.placementContract !== FAUNA_POPULATION_DIRECTOR_POLICY.sharedPlacementContract) errors.push(`placement-contract:${group?.groupId || 'unknown'}`);
    if (!group?.placement?.groundAligned || !group?.placement?.navAligned || !group?.placement?.habitatAligned) errors.push(`placement-alignment:${group?.groupId || 'unknown'}`);
  }
  for (const group of plan?.spawn || []) {
    if (!group?.groupPlan) errors.push(`missing-ecology-group-plan:${group?.groupId || 'unknown'}`);
    else errors.push(...(auditEcologyPlan(group.groupPlan).errors || []).map((error) => `${group.groupId}:${error}`));
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(plan), groupCount: plan?.groups?.length || 0 });
}

export function createFaunaPopulationDirector(defaults = {}) {
  let disposed = false;
  return {
    tick(input = {}) {
      if (disposed) return freeze({ accepted: false, reason: 'disposed' });
      return freeze({ accepted: true, plan: planFaunaPopulationTick({ ...defaults, ...input }) });
    },
    apply(plan, owners = {}) {
      if (disposed) return freeze({ accepted: false, reason: 'disposed' });
      return freeze({ accepted: true, result: applyFaunaPopulationTick(plan, owners) });
    },
    read() { return freeze({ disposed, policy: FAUNA_POPULATION_DIRECTOR_POLICY.id, lodLevels: LOD_LEVELS }); },
    dispose() { disposed = true; },
  };
}
