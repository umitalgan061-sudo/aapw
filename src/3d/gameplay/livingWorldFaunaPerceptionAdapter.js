/**
 * Deterministic perception adapter for the existing fauna/living-world owners.
 * It fuses caller-provided LOS, hearing, stealth and cover observations into
 * threat facts; it does not own raycasters, navigation, actors, combat or events.
 */
const freeze = (value) => Object.freeze(value);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, number(value, min)));
const text = (value, fallback = '') => value == null ? fallback : String(value);
const bool = (value) => value === true;

export const FAUNA_PERCEPTION_POLICY = freeze({
  id: 'living-world-fauna-perception-adapter-2026-09-14-v1',
  maxObservations: 48,
  maxFacts: 48,
  maxHearRadiusMeters: 180,
  maxSightRadiusMeters: 220,
  hearingDecayMeters: 140,
  visualDecayMeters: 170,
  memorySeconds: 18,
  alertBroadcastRadiusMeters: 90,
  stealthFloor: 0.08,
});

function hash32(input) {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(seed) {
  return (hash32(seed) % 1000000) / 1000000;
}

function distance(a, b) {
  if (!a || !b || !Number.isFinite(Number(a.x)) || !Number.isFinite(Number(b.x)) || !Number.isFinite(Number(a.z)) || !Number.isFinite(Number(b.z))) return Infinity;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  return Math.hypot(dx, dz);
}

function normalizePosition(position) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.z))) return null;
  return freeze({
    x: Number(position.x),
    z: Number(position.z),
    y: Number.isFinite(Number(position.y)) ? Number(position.y) : null,
  });
}

function normalizeObserver(observer, index = 0) {
  return freeze({
    id: text(observer?.id, `observer-${index}`),
    species: text(observer?.species, 'unknown').toLowerCase(),
    position: normalizePosition(observer?.position),
    heading: number(observer?.heading, 0),
    fieldOfViewDegrees: clamp(observer?.fieldOfViewDegrees, 20, 180),
    sightRangeMeters: Math.min(FAUNA_PERCEPTION_POLICY.maxSightRadiusMeters, Math.max(1, number(observer?.sightRangeMeters, 100))),
    hearingRangeMeters: Math.min(FAUNA_PERCEPTION_POLICY.maxHearRadiusMeters, Math.max(1, number(observer?.hearingRangeMeters, 80))),
    alertness: clamp(observer?.alertness, 0.05, 1),
    acuity: clamp(observer?.acuity, 0.05, 1),
    nocturnal: bool(observer?.nocturnal),
  });
}

function normalizeTarget(target, index = 0) {
  return freeze({
    id: text(target?.id, `target-${index}`),
    kind: text(target?.kind, 'unknown').toLowerCase(),
    position: normalizePosition(target?.position),
    velocityMetersPerSecond: Math.max(0, number(target?.velocityMetersPerSecond, 0)),
    stealth: clamp(target?.stealth, 0, 1),
    cover: clamp(target?.cover, 0, 1),
    visible: target?.visible !== false,
    noisy: bool(target?.noisy),
    noiseLevel: clamp(target?.noiseLevel, 0, 1),
    scentStrength: clamp(target?.scentStrength, 0, 1),
    lightLevel: clamp(target?.lightLevel, 0.02, 1),
    freshSeconds: Math.max(0, number(target?.freshSeconds, 0)),
  });
}

function normalizeContext(context = {}) {
  return freeze({
    hour: ((number(context.hour, 12) % 24) + 24) % 24,
    weather: text(context.weather, 'clear').toLowerCase(),
    precipitation: clamp(context.precipitation, 0, 1),
    fog: clamp(context.fog, 0, 1),
    wind: clamp(context.wind, 0, 1),
    light: clamp(context.light, 0.02, 1),
    coverMapAvailable: context.coverMapAvailable !== false,
  });
}

function phase(hour) {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 18) return 'day';
  if (hour >= 18 && hour < 21) return 'dusk';
  return 'night';
}

function visualModifier(context, observer, target) {
  const nocturnalBonus = observer.nocturnal && phase(context.hour) === 'night' ? 1.12 : 1;
  const weatherPenalty = context.fog * 0.58 + context.precipitation * 0.12;
  const lightFactor = clamp(context.light * target.lightLevel, FAUNA_PERCEPTION_POLICY.stealthFloor, 1);
  const coverPenalty = target.cover * 0.76;
  return clamp(nocturnalBonus * observer.acuity * lightFactor * (1 - weatherPenalty) * (1 - coverPenalty), 0.02, 1);
}

function hearingModifier(context, observer, target) {
  const windPenalty = 0.28 * context.wind;
  const precipitationPenalty = 0.18 * context.precipitation;
  const noisyBonus = target.noisy ? 1.2 : 1;
  const level = target.noiseLevel > 0 ? target.noiseLevel : target.velocityMetersPerSecond > 0.4 ? 0.42 : 0.08;
  return clamp(observer.alertness * level * noisyBonus * (1 - windPenalty - precipitationPenalty), 0, 1);
}

function scentModifier(context, observer, target) {
  const wind = 0.55 + context.wind * 0.45;
  const weather = context.precipitation > 0.7 ? 0.55 : 1;
  return clamp(target.scentStrength * observer.alertness * wind * weather, 0, 1);
}

function stealthModifier(target, context) {
  const speedExposure = clamp(target.velocityMetersPerSecond / 5, 0, 1);
  const noiseExposure = target.noiseLevel;
  const lightExposure = clamp(context.light * target.lightLevel, 0, 1);
  const coverReduction = target.cover * 0.55;
  const effectiveStealth = clamp(target.stealth * (1 - speedExposure * 0.45 - noiseExposure * 0.4) + coverReduction, 0, 1);
  return Math.max(FAUNA_PERCEPTION_POLICY.stealthFloor, effectiveStealth);
}

function deterministicRoll(seed) {
  return unit(seed);
}

function losVisible(observer, target, context, lineOfSight = null) {
  const rawDistance = distance(observer.position, target.position);
  if (rawDistance > observer.sightRangeMeters) return freeze({ visible: false, reason: 'range', distanceMeters: rawDistance, confidence: 0 });
  if (typeof lineOfSight === 'function') {
    let result = null;
    try { result = lineOfSight(observer, target); } catch { result = false; }
    if (result === false) return freeze({ visible: false, reason: 'occluded', distanceMeters: rawDistance, confidence: 0 });
  }
  if (target.visible === false) return freeze({ visible: false, reason: 'target-hidden', distanceMeters: rawDistance, confidence: 0 });
  const modifier = visualModifier(context, observer, target);
  const stealth = stealthModifier(target, context);
  const confidence = clamp(modifier * (1 - stealth * 0.72) * clamp(1 - rawDistance / FAUNA_PERCEPTION_POLICY.visualDecayMeters, 0, 1), 0, 1);
  const roll = deterministicRoll(`${observer.id}:${target.id}:los`);
  return freeze({
    visible: confidence >= 0.16 && roll <= clamp(confidence + 0.12, 0, 1),
    reason: confidence >= 0.16 ? 'visual-confidence' : 'stealth',
    distanceMeters: rawDistance,
    confidence,
  });
}

function hearingDetected(observer, target, context) {
  const rawDistance = distance(observer.position, target.position);
  if (rawDistance > observer.hearingRangeMeters) return freeze({ heard: false, reason: 'range', distanceMeters: rawDistance, confidence: 0 });
  const modifier = hearingModifier(context, observer, target);
  const confidence = clamp(modifier * clamp(1 - rawDistance / FAUNA_PERCEPTION_POLICY.hearingDecayMeters, 0, 1), 0, 1);
  const roll = deterministicRoll(`${observer.id}:${target.id}:hearing`);
  return freeze({
    heard: target.noisy ? confidence >= 0.12 : confidence >= 0.25 && roll <= clamp(confidence + 0.05, 0, 1),
    reason: confidence >= 0.12 ? 'audible' : 'quiet',
    distanceMeters: rawDistance,
    confidence,
  });
}

function scentDetected(observer, target, context) {
  const rawDistance = distance(observer.position, target.position);
  if (rawDistance > observer.hearingRangeMeters * 0.8) return freeze({ scented: false, reason: 'range', distanceMeters: rawDistance, confidence: 0 });
  const confidence = clamp(scentModifier(context, observer, target) * clamp(1 - rawDistance / 120, 0, 1), 0, 1);
  return freeze({ scented: confidence >= 0.2, reason: confidence >= 0.2 ? 'scent-trace' : 'weak-scent', distanceMeters: rawDistance, confidence });
}

function combinedConfidence(visual, hearing, scent) {
  return clamp(1 - (1 - visual) * (1 - hearing) * (1 - scent), 0, 1);
}

function chooseState(observer, target, perception) {
  if (perception.confidence < 0.2) return 'ignore';
  if (perception.visualVisible && perception.confidence >= 0.58) return 'detect';
  if (perception.heard && perception.confidence >= 0.28) return 'investigate';
  if (perception.scented && perception.confidence >= 0.24) return 'investigate';
  if (target.kind === 'predator' && perception.confidence >= 0.35) return 'evade';
  return 'observe';
}

function normalizeLosMap(value) {
  if (!value || typeof value !== 'object') return null;
  return value;
}

function buildFact(observer, target, perception, now, context) {
  const state = chooseState(observer, target, perception);
  const memory = state === 'ignore' ? 0 : FAUNA_PERCEPTION_POLICY.memorySeconds * perception.confidence;
  return freeze({
    id: `${observer.id}:${target.id}`,
    observerId: observer.id,
    targetId: target.id,
    kind: target.kind,
    state,
    confidence: perception.confidence,
    visualVisible: perception.visualVisible,
    heard: perception.heard,
    scented: perception.scented,
    distanceMeters: perception.distanceMeters,
    memorySeconds: memory,
    ageSeconds: Math.max(0, number(now, 0) - target.freshSeconds),
    phase: phase(context.hour),
    stealth: target.stealth,
    cover: target.cover,
  });
}

function alertCandidate(fact) {
  return fact.state === 'detect' || fact.state === 'investigate' || fact.state === 'evade';
}

export function classifyStealthTarget(target = {}, context = {}) {
  const normalizedTarget = normalizeTarget(target);
  const normalizedContext = normalizeContext(context);
  return freeze({
    stealth: normalizedTarget.stealth,
    effective: stealthModifier(normalizedTarget, normalizedContext),
    exposedByMovement: normalizedTarget.velocityMetersPerSecond > 1.2,
    exposedByNoise: normalizedTarget.noiseLevel >= 0.45 || normalizedTarget.noisy,
    exposedByLight: normalizedContext.light * normalizedTarget.lightLevel >= 0.75,
    cover: normalizedTarget.cover,
  });
}

export function perceiveFauna({
  observer,
  target,
  context = {},
  lineOfSight = null,
  now = 0,
} = {}) {
  const normalizedObserver = normalizeObserver(observer);
  const normalizedTarget = normalizeTarget(target);
  const normalizedContext = normalizeContext(context);
  const los = losVisible(normalizedObserver, normalizedTarget, normalizedContext, lineOfSight);
  const hearing = hearingDetected(normalizedObserver, normalizedTarget, normalizedContext);
  const scent = scentDetected(normalizedObserver, normalizedTarget, normalizedContext);
  const confidence = combinedConfidence(los.confidence, hearing.confidence, scent.confidence);
  return buildFact(
    normalizedObserver,
    normalizedTarget,
    {
      confidence,
      visualVisible: los.visible,
      heard: hearing.heard,
      scented: scent.scented,
      distanceMeters: Math.min(los.distanceMeters, hearing.distanceMeters, scent.distanceMeters),
    },
    now,
    normalizedContext,
  );
}

export function buildFaunaPerceptionBatch({
  observers = [],
  targets = [],
  context = {},
  lineOfSight = null,
  now = 0,
} = {}) {
  const normalizedObservers = observers.map(normalizeObserver).slice(0, FAUNA_PERCEPTION_POLICY.maxObservations);
  const normalizedTargets = targets.map(normalizeTarget).slice(0, FAUNA_PERCEPTION_POLICY.maxObservations);
  const facts = [];
  for (const observer of normalizedObservers.sort((a, b) => a.id.localeCompare(b.id))) {
    for (const target of normalizedTargets.sort((a, b) => a.id.localeCompare(b.id))) {
      facts.push(perceiveFauna({ observer, target, context, lineOfSight, now }));
      if (facts.length >= FAUNA_PERCEPTION_POLICY.maxFacts) return freeze(facts);
    }
  }
  return freeze(facts);
}

export function summarizePerceptionFacts(facts = []) {
  const counts = { ignore: 0, observe: 0, detect: 0, investigate: 0, evade: 0 };
  let maxConfidence = 0;
  let alertCount = 0;
  for (const fact of facts.slice(0, FAUNA_PERCEPTION_POLICY.maxFacts)) {
    if (counts[fact.state] == null) counts[fact.state] = 0;
    counts[fact.state] += 1;
    maxConfidence = Math.max(maxConfidence, number(fact.confidence, 0));
    if (alertCandidate(fact)) alertCount += 1;
  }
  return freeze({
    total: Math.min(facts.length, FAUNA_PERCEPTION_POLICY.maxFacts),
    counts: freeze(counts),
    maxConfidence,
    alertCount,
  });
}

export function planFaunaAlertPropagation({ facts = [], actors = [], now = 0 } = {}) {
  const safeFacts = facts.slice(0, FAUNA_PERCEPTION_POLICY.maxFacts).filter(alertCandidate);
  const normalizedActors = actors.slice(0, FAUNA_PERCEPTION_POLICY.maxObservations).map((actor, index) => freeze({
    id: text(actor?.id, `actor-${index}`),
    position: normalizePosition(actor?.position),
    alertness: clamp(actor?.alertness, 0, 1),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const signals = [];
  for (const fact of safeFacts.sort((a, b) => a.id.localeCompare(b.id))) {
    const source = normalizedActors.find((actor) => actor.id === fact.observerId);
    if (!source || !source.position) continue;
    for (const actor of normalizedActors) {
      if (actor.id === source.id || !actor.position) continue;
      const separation = distance(source.position, actor.position);
      if (separation > FAUNA_PERCEPTION_POLICY.alertBroadcastRadiusMeters) continue;
      signals.push(freeze({
        id: `${fact.id}:alert:${actor.id}`,
        sourceId: fact.observerId,
        receiverId: actor.id,
        targetId: fact.targetId,
        confidence: clamp(fact.confidence * (1 - separation / FAUNA_PERCEPTION_POLICY.alertBroadcastRadiusMeters) * actor.alertness, 0, 1),
        issuedAt: number(now, 0),
      }));
      if (signals.length >= FAUNA_PERCEPTION_POLICY.maxFacts) return freeze(signals);
    }
  }
  return freeze(signals);
}

export function validatePerceptionFacts(facts = []) {
  const errors = [];
  if (!Array.isArray(facts)) errors.push('facts-not-array');
  const rows = Array.isArray(facts) ? facts.slice(0, FAUNA_PERCEPTION_POLICY.maxFacts) : [];
  for (const fact of rows) {
    if (!fact?.observerId) errors.push('missing-observer');
    if (!fact?.targetId) errors.push('missing-target');
    if (!['ignore', 'observe', 'detect', 'investigate', 'evade'].includes(fact?.state)) errors.push(`bad-state:${fact?.id || 'unknown'}`);
    if (number(fact?.confidence, -1) < 0 || number(fact?.confidence, 2) > 1) errors.push(`bad-confidence:${fact?.id || 'unknown'}`);
    if (number(fact?.memorySeconds, -1) < 0) errors.push(`bad-memory:${fact?.id || 'unknown'}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function perceptionContractManifest() {
  return freeze({
    id: FAUNA_PERCEPTION_POLICY.id,
    deterministic: true,
    owners: freeze({
      actorRegistry: 'existing',
      navigation: 'existing',
      combat: 'existing',
      worldEventSystem: 'existing',
      material: 'MaterialAssignmentCore',
      placement: 'WorldAssetPlacementPipeline',
    }),
    inputs: freeze(['los', 'hearing', 'stealth', 'cover', 'scent', 'weather', 'light']),
    outputs: freeze(['ignore', 'observe', 'detect', 'investigate', 'evade', 'alert-propagation']),
    mutation: false,
    maxObservations: FAUNA_PERCEPTION_POLICY.maxObservations,
    maxFacts: FAUNA_PERCEPTION_POLICY.maxFacts,
    editorRuntimeImport: false,
  });
}

export function perceptionReplay(tape = []) {
  const outputs = tape.slice(0, 16).map((entry, index) => {
    const facts = buildFaunaPerceptionBatch(entry);
    const summary = summarizePerceptionFacts(facts);
    return freeze({ index, facts, summary });
  });
  return freeze({ count: outputs.length, outputs });
}

export default freeze({
  policy: FAUNA_PERCEPTION_POLICY,
  perceiveFauna,
  buildFaunaPerceptionBatch,
  summarizePerceptionFacts,
  planFaunaAlertPropagation,
  classifyStealthTarget,
  validatePerceptionFacts,
  perceptionContractManifest,
  perceptionReplay,
});
