/**
 * Şafak Kartalı — wildlife / creature biological-needs projection.
 *
 * Pure state projection for the existing animal/creature/dragon controllers. It models hunger,
 * thirst, energy, territory pressure, pack cohesion and predator avoidance, but never owns spawn,
 * movement, damage or persistence. The caller feeds the authoritative runtime state into this policy.
 */
const freeze = Object.freeze;
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, num(value, min)));
const id = (value, fallback = '') => value == null || value === '' ? fallback : String(value);

export const FAUNA_NEEDS_POLICY = freeze({
  id: 'safak-kartali-fauna-needs-2026-09-14-v1',
  deterministic: true,
  maxAgents: 96,
  maxThreatsPerAgent: 12,
  energyDrainPerSecond: 0.008,
  hungerGainPerSecond: 0.006,
  thirstGainPerSecond: 0.009,
  territoryPressureScale: 0.42,
  fleeThreatThreshold: 0.58,
  seekWaterThreshold: 0.62,
  seekFoodThreshold: 0.58,
  restEnergyThreshold: 0.28,
  packCohesionThreshold: 0.5,
  dragonRoostPressureThreshold: 0.72,
});

export const FAUNA_ACTIVITY = freeze([
  'roam', 'forage', 'graze', 'drink', 'hunt', 'rest', 'flee', 'regroup', 'travel', 'roost',
]);

const SPECIES_PROFILE = freeze({
  wolf: freeze({ kind: 'predator', diet: 'meat', drinkInterval: 34, forageInterval: 48, restInterval: 20, groupCohesion: .78, territoryRadius: 90, fleeBias: .7 }),
  fox: freeze({ kind: 'predator', diet: 'mixed', drinkInterval: 45, forageInterval: 38, restInterval: 18, groupCohesion: .4, territoryRadius: 50, fleeBias: .76 }),
  deer: freeze({ kind: 'grazer', diet: 'plant', drinkInterval: 32, forageInterval: 24, restInterval: 16, groupCohesion: .82, territoryRadius: 100, fleeBias: .88 }),
  bison: freeze({ kind: 'grazer', diet: 'plant', drinkInterval: 35, forageInterval: 30, restInterval: 22, groupCohesion: .9, territoryRadius: 140, fleeBias: .72 }),
  sheep: freeze({ kind: 'grazer', diet: 'plant', drinkInterval: 30, forageInterval: 18, restInterval: 14, groupCohesion: .88, territoryRadius: 80, fleeBias: .84 }),
  goat: freeze({ kind: 'grazer', diet: 'plant', drinkInterval: 34, forageInterval: 22, restInterval: 15, groupCohesion: .72, territoryRadius: 70, fleeBias: .65 }),
  boar: freeze({ kind: 'forager', diet: 'mixed', drinkInterval: 35, forageInterval: 26, restInterval: 17, groupCohesion: .55, territoryRadius: 65, fleeBias: .56 }),
  bear: freeze({ kind: 'predator', diet: 'mixed', drinkInterval: 42, forageInterval: 60, restInterval: 24, groupCohesion: .25, territoryRadius: 150, fleeBias: .38 }),
  horse: freeze({ kind: 'domestic', diet: 'plant', drinkInterval: 28, forageInterval: 20, restInterval: 12, groupCohesion: .62, territoryRadius: 120, fleeBias: .78 }),
  bird: freeze({ kind: 'avian', diet: 'mixed', drinkInterval: 20, forageInterval: 16, restInterval: 10, groupCohesion: .58, territoryRadius: 40, fleeBias: .9 }),
  bee: freeze({ kind: 'pollinator', diet: 'plant', drinkInterval: 28, forageInterval: 10, restInterval: 8, groupCohesion: .92, territoryRadius: 12, fleeBias: .72 }),
  dragon: freeze({ kind: 'apex', diet: 'meat', drinkInterval: 60, forageInterval: 120, restInterval: 45, groupCohesion: .15, territoryRadius: 500, fleeBias: .12 }),
});

function round(value, digits = 5) {
  const power = 10 ** digits;
  return Math.round(num(value) * power) / power;
}

function speciesKey(species) {
  const key = id(species, 'wolf').trim().toLowerCase();
  return SPECIES_PROFILE[key] ? key : 'wolf';
}

function positionOf(value) {
  const p = value?.object3D?.position ?? value?.position ?? value?.transform?.position;
  if (!p) return null;
  const x = num(p.x, NaN);
  const z = num(p.z, NaN);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function distance(a, b) {
  return a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
}

export function getFaunaProfile(species) {
  const key = speciesKey(species);
  return SPECIES_PROFILE[key];
}

export function normalizeFaunaNeeds(state = {}) {
  return freeze({
    energy: round(clamp(state.energy, 0, 1)),
    hunger: round(clamp(state.hunger, 0, 1)),
    thirst: round(clamp(state.thirst, 0, 1)),
    stress: round(clamp(state.stress, 0, 1)),
    territoryPressure: round(clamp(state.territoryPressure, 0, 1)),
    lastFeedSeconds: Math.max(0, num(state.lastFeedSeconds)),
    lastDrinkSeconds: Math.max(0, num(state.lastDrinkSeconds)),
    lastRestSeconds: Math.max(0, num(state.lastRestSeconds)),
  });
}

export function advanceFaunaNeeds(state, deltaSeconds, modifiers = {}) {
  const current = normalizeFaunaNeeds(state);
  const delta = Math.max(0, num(deltaSeconds));
  const stressModifier = clamp(modifiers.stressModifier, 0, 3);
  const energy = clamp(current.energy - delta * FAUNA_NEEDS_POLICY.energyDrainPerSecond * (1 + stressModifier * .25));
  const hunger = clamp(current.hunger + delta * FAUNA_NEEDS_POLICY.hungerGainPerSecond);
  const thirst = clamp(current.thirst + delta * FAUNA_NEEDS_POLICY.thirstGainPerSecond);
  const stressRecovery = modifiers.safe ? delta * .02 : 0;
  const stressGain = modifiers.predatorNearby ? delta * .035 : modifiers.crowded ? delta * .012 : 0;
  const stress = clamp(current.stress + stressGain - stressRecovery);
  const territoryPressure = clamp(current.territoryPressure + delta * FAUNA_NEEDS_POLICY.territoryPressureScale * num(modifiers.density, 0) / 60 - (modifiers.openTerritory ? delta * .01 : 0));
  return freeze({ ...current, energy: round(energy), hunger: round(hunger), thirst: round(thirst), stress: round(stress), territoryPressure: round(territoryPressure) });
}

export function threatPressure(threats = [], options = {}) {
  const position = positionOf(options.position);
  let score = 0;
  let nearest = Infinity;
  let predatorCount = 0;
  for (const threat of (Array.isArray(threats) ? threats : []).slice(0, FAUNA_NEEDS_POLICY.maxThreatsPerAgent)) {
    const severity = clamp(threat?.severity);
    const threatPosition = positionOf(threat);
    const distanceMeters = distance(position, threatPosition);
    nearest = Math.min(nearest, distanceMeters);
    const proximity = Number.isFinite(distanceMeters) ? clamp(1 - distanceMeters / Math.max(1, num(options.threatRadius, 80))) : 0;
    const predator = Boolean(threat?.predator || threat?.kind === 'predator' || threat?.kind === 'apex');
    predatorCount += Number(predator);
    score += severity * .5 + proximity * .35 + Number(predator) * .15;
  }
  return freeze({ score: round(clamp(score)), nearestMeters: Number.isFinite(nearest) ? round(nearest, 2) : null, predatorCount });
}

export function territoryPressure({ ownGroupCount = 0, territoryCapacity = 8, rivalGroups = 0, radiusMeters = 100 } = {}) {
  const own = clamp(num(ownGroupCount) / Math.max(1, num(territoryCapacity, 8)), 0, 2);
  const rivals = clamp(num(rivalGroups) / Math.max(1, num(territoryCapacity, 8)), 0, 2);
  const radius = clamp(1 - Math.max(0, num(radiusMeters, 100)) / 300);
  return round(clamp(own * .45 + rivals * .4 + radius * .15));
}

export function chooseFaunaActivity(species, state, context = {}) {
  const key = speciesKey(species);
  const profile = SPECIES_PROFILE[key];
  const needs = normalizeFaunaNeeds(state);
  const threats = threatPressure(context.threats, context);
  const waterDistance = Math.max(0, num(context.distanceToWaterMeters, Infinity));
  const foodDistance = Math.max(0, num(context.distanceToFoodMeters, Infinity));
  if (threats.score >= FAUNA_NEEDS_POLICY.fleeThreatThreshold && profile.fleeBias > .2) return 'flee';
  if (needs.territoryPressure >= FAUNA_NEEDS_POLICY.dragonRoostPressureThreshold && key === 'dragon') return 'travel';
  if (needs.thirst >= FAUNA_NEEDS_POLICY.seekWaterThreshold && waterDistance < num(context.maxWaterTravelMeters, 80)) return 'drink';
  if (needs.hunger >= FAUNA_NEEDS_POLICY.seekFoodThreshold && foodDistance < num(context.maxFoodTravelMeters, 120)) return key === 'wolf' || profile.kind === 'predator' || profile.kind === 'apex' ? 'hunt' : 'forage';
  if (needs.energy <= FAUNA_NEEDS_POLICY.restEnergyThreshold) return 'rest';
  if (context.groupThreatened && profile.groupCohesion >= FAUNA_NEEDS_POLICY.packCohesionThreshold) return 'regroup';
  if (context.travelRequired) return 'travel';
  if (profile.kind === 'grazer') return 'graze';
  return 'roam';
}

export function activityPriority(activity, state) {
  const needs = normalizeFaunaNeeds(state);
  const urgency = { flee: 1, drink: needs.thirst, hunt: needs.hunger, forage: needs.hunger, graze: needs.hunger, rest: 1 - needs.energy, regroup: needs.stress, travel: needs.territoryPressure, roam: .15 };
  return round(clamp(urgency[activity] ?? .1));
}

export function buildFaunaDirective(actor, state, context = {}) {
  const species = speciesKey(actor?.species ?? context.species);
  const activity = chooseFaunaActivity(species, state, context);
  const needs = normalizeFaunaNeeds(state);
  const threat = threatPressure(context.threats, context);
  return freeze({ actorId: id(actor?.id), species, activity, priority: activityPriority(activity, needs), threatScore: threat.score, energy: needs.energy, hunger: needs.hunger, thirst: needs.thirst, stress: needs.stress, territoryPressure: needs.territoryPressure, destination: context.destination ?? null });
}

export function buildPackCohesion(members = [], groupCenter = null) {
  const rows = (Array.isArray(members) ? members : []).slice(0, FAUNA_NEEDS_POLICY.maxAgents).map((member, index) => ({ id: id(member?.id, `member-${index}`), position: positionOf(member) })).filter((row) => row.position);
  if (rows.length < 2 || !groupCenter) return freeze({ score: 1, spreadMeters: 0, memberCount: rows.length, regroupNeeded: false });
  const spread = rows.reduce((sum, row) => sum + distance(row.position, groupCenter), 0) / rows.length;
  const score = clamp(1 - spread / 40);
  return freeze({ score: round(score), spreadMeters: round(spread, 2), memberCount: rows.length, regroupNeeded: score < FAUNA_NEEDS_POLICY.packCohesionThreshold });
}

export function buildWaterNeed(state, distanceMeters, profile) {
  const needs = normalizeFaunaNeeds(state);
  const interval = num(profile?.drinkInterval, 30);
  const proximity = clamp(1 - num(distanceMeters, Infinity) / 150);
  return freeze({ urgency: round(clamp(needs.thirst * .75 + proximity * .1 + (needs.lastDrinkSeconds > interval ? .15 : 0))), distanceMeters: Number.isFinite(Number(distanceMeters)) ? round(distanceMeters, 2) : null });
}

export function buildFoodNeed(state, distanceMeters, profile) {
  const needs = normalizeFaunaNeeds(state);
  const interval = num(profile?.forageInterval, 30);
  const proximity = clamp(1 - num(distanceMeters, Infinity) / 180);
  return freeze({ urgency: round(clamp(needs.hunger * .78 + proximity * .08 + (needs.lastFeedSeconds > interval ? .14 : 0))), distanceMeters: Number.isFinite(Number(distanceMeters)) ? round(distanceMeters, 2) : null });
}

export function buildRoostNeed(state, context = {}) {
  const needs = normalizeFaunaNeeds(state);
  const dragon = speciesKey(context.species) === 'dragon';
  const pressure = territoryPressure(context);
  return freeze({ urgency: round(clamp(dragon ? needs.territoryPressure * .6 + pressure * .4 : needs.energy < .3 ? .5 : .1)), destination: context.roostPosition ?? null });
}

export function normalizeFaunaGroup(group = {}) {
  return freeze({ id: id(group.id, 'group'), species: speciesKey(group.species), memberIds: freeze((group.memberIds ?? []).map(String).slice(0, FAUNA_NEEDS_POLICY.maxAgents)), territoryRadiusMeters: Math.max(10, num(group.territoryRadiusMeters, 100)), population: Math.max(0, Math.floor(num(group.population))), rivalGroups: Math.max(0, Math.floor(num(group.rivalGroups))), seed: group.seed ?? 0 });
}

export function buildFaunaGroupDirective(group, context = {}) {
  const normalized = normalizeFaunaGroup(group);
  const profile = SPECIES_PROFILE[normalized.species];
  const pressure = territoryPressure({ ownGroupCount: normalized.population, territoryCapacity: normalized.memberIds.length || 8, rivalGroups: normalized.rivalGroups, radiusMeters: normalized.territoryRadiusMeters });
  const threatened = Boolean(context.threats?.length) && threatPressure(context.threats, context).score >= FAUNA_NEEDS_POLICY.fleeThreatThreshold;
  const intent = threatened ? 'flee' : pressure >= .72 ? 'travel-territory' : profile.kind === 'predator' ? 'hunt-roam' : 'graze-roam';
  return freeze({ groupId: normalized.id, species: normalized.species, intent, pressure: round(pressure), population: normalized.population, territoryRadiusMeters: normalized.territoryRadiusMeters, threat: threatened, preferredActivity: intent === 'flee' ? 'flee' : chooseFaunaActivity(normalized.species, context.state ?? {}, context) });
}

export function deterministicFaunaFingerprint(value, seed = 0) {
  let h = 2166136261;
  for (const c of `${seed}|${JSON.stringify(value ?? null)}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function auditFaunaNeeds(result = {}) {
  const errors = [];
  for (const key of ['energy', 'hunger', 'thirst', 'stress', 'territoryPressure']) if (num(result?.[key], 0) < 0 || num(result?.[key], 0) > 1) errors.push(`${key}-range`);
  if (result?.population > FAUNA_NEEDS_POLICY.maxAgents) errors.push('agent-overflow');
  return freeze({ ok: !errors.length, errors: freeze(errors), fingerprint: deterministicFaunaFingerprint(result) });
}

export function capFaunaAgents(agents) { return freeze((Array.isArray(agents) ? agents : []).slice(0, FAUNA_NEEDS_POLICY.maxAgents)); }
export function stableFaunaOrder(agents = [], seed = 0) { return freeze(capFaunaAgents(agents).map((agent, index) => ({ agent, key: deterministicFaunaFingerprint({ id: agent?.id, species: agent?.species, index }, seed) })).sort((a, b) => a.key.localeCompare(b.key) || id(a.agent?.id).localeCompare(id(b.agent?.id))).map((row) => id(row.agent?.id))); }
