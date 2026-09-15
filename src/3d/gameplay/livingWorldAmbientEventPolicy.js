/**
 * Şafak Kartalı — deterministic ambient world-event candidate policy.
 * WorldEventSystem/publisher remains authoritative for persistence and emission.
 */
const freeze = Object.freeze;
const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, numberValue(value, min)));
const stringValue = (value, fallback = '') => value == null ? fallback : String(value);

export const AMBIENT_EVENT_POLICY = freeze({
  id: 'safak-kartali-ambient-events-2026-09-14-v2',
  deterministic: true,
  maxCandidates: 18,
  maxPerTick: 3,
  defaultCooldownSeconds: 60,
  cooldowns: freeze({ migration: 120, stampede: 40, ambush: 30, festival: 300, storm: 180 }),
});

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function eligibleAmbientEvent(type, context = {}) {
  const eventType = stringValue(type, 'ambient');
  const hour = numberValue(context.timeOfDay, 12);
  const danger = clamp(context.danger);
  const populationDensity = clamp(context.populationDensity);
  const season = stringValue(context.season, 'summer').toLowerCase();
  const biome = stringValue(context.biome, 'temperate').toLowerCase();
  if (eventType === 'migration') return populationDensity > .35 && ['spring', 'autumn'].includes(season);
  if (eventType === 'stampede') return danger > .5 && populationDensity > .3;
  if (eventType === 'ambush') return danger > .62 && ['forest', 'marsh', 'mountain'].includes(biome);
  if (eventType === 'festival') return danger < .35 && populationDensity > .25 && hour > 17 && hour < 23;
  if (eventType === 'storm') return numberValue(context.weatherRisk) > .55;
  return false;
}

export function eventScore(type, context = {}) {
  if (!eligibleAmbientEvent(type, context)) return 0;
  const score = .9 + numberValue(context.eventBias) * .1 - numberValue(context.danger) * .25;
  return clamp(score);
}

export function buildAmbientEvent(type, context = {}, seed = 0, index = 0) {
  const eventType = stringValue(type, 'ambient');
  return freeze({
    id: `ambient-${eventType}-${stableHash(`${seed}|${eventType}|${index}`).toString(16)}`,
    type: eventType,
    eligible: eligibleAmbientEvent(eventType, context),
    score: eventScore(eventType, context),
    locationId: stringValue(context.locationId),
    tick: numberValue(context.tick),
    biome: stringValue(context.biome, 'temperate'),
    season: stringValue(context.season, 'summer'),
    seed,
  });
}

export function buildAmbientEvents(context = {}, types = [], seed = 0) {
  const source = Array.isArray(types) && types.length
    ? types
    : ['migration', 'stampede', 'ambush', 'festival', 'storm'];
  return freeze(source
    .slice(0, AMBIENT_EVENT_POLICY.maxCandidates)
    .map((type, index) => buildAmbientEvent(type, context, seed, index))
    .filter((event) => event.eligible)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, AMBIENT_EVENT_POLICY.maxPerTick));
}

export function cooldownAllows(type, lastIssued = {}, nowSeconds = 0, cooldownSeconds = null) {
  const fallback = AMBIENT_EVENT_POLICY.cooldowns[type] ?? AMBIENT_EVENT_POLICY.defaultCooldownSeconds;
  return nowSeconds - numberValue(lastIssued?.[type], -Infinity) >= numberValue(cooldownSeconds, fallback);
}

export function selectAmbientEvents(context = {}, types = [], seed = 0, lastIssued = {}, nowSeconds = 0) {
  return freeze(buildAmbientEvents(context, types, seed)
    .filter((event) => cooldownAllows(event.type, lastIssued, nowSeconds)));
}

export function buildDistressEvent({ actorId, targetId = '', locationId = '', severity = .5, seed = 0, tick = 0 } = {}) {
  const normalizedSeverity = clamp(severity);
  return freeze({
    type: 'distress',
    actorId: stringValue(actorId),
    targetId: stringValue(targetId),
    locationId: stringValue(locationId),
    severity: normalizedSeverity,
    eligible: normalizedSeverity >= .35,
    key: stableHash(`${seed}|distress|${actorId}|${tick}`).toString(16).padStart(8, '0'),
  });
}

export function buildMigrationEvent({ species = 'deer', season = 'summer', biome = 'forest', pressure = .2, seed = 0 } = {}) {
  const eligible = ['spring', 'autumn'].includes(season) && numberValue(pressure) > .3;
  return freeze({ type: 'migration', species: stringValue(species), season: stringValue(season), biome: stringValue(biome), pressure: clamp(pressure), eligible, key: stableHash(`${seed}|migration|${species}|${season}|${biome}`).toString(16) });
}

export function buildStampedeEvent({ species = 'deer', groupCount = 0, predatorThreat = 0, noise = 0, seed = 0 } = {}) {
  const score = clamp(numberValue(groupCount) / 8 * .35 + numberValue(predatorThreat) * .45 + numberValue(noise) * .2);
  return freeze({ type: 'stampede', species: stringValue(species), score, eligible: score >= .62, key: stableHash(`${seed}|stampede|${species}`).toString(16) });
}

export function auditAmbientEvents(candidates = []) {
  const errors = [];
  if (candidates.length > AMBIENT_EVENT_POLICY.maxPerTick) errors.push('event-overflow');
  for (const candidate of candidates) {
    if (!candidate.id) errors.push('missing-id');
    if (!candidate.type) errors.push('missing-type');
    if (candidate.score < 0 || candidate.score > 1) errors.push('score-range');
  }
  return freeze({ ok: !errors.length, errors: freeze([...new Set(errors)]), count: candidates.length });
}

export function deterministicAmbientFingerprint(value, seed = 0) {
  return stableHash(`${seed}|${JSON.stringify(value ?? null)}`).toString(16).padStart(8, '0');
}
