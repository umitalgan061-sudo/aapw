/**
 * Şafak Kartalı — spawn admission projection over existing NPC/fauna/creature/dragon spawn owners.
 * This policy is pure; canonical spawners own actual instantiation and destruction.
 */
const freeze = Object.freeze;
const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const stringValue = (value, fallback = '') => value == null ? fallback : String(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, numberValue(value, min)));

export const SPAWN_ADMISSION_POLICY = freeze({
  id: 'safak-kartali-spawn-admission-2026-09-14-v2',
  deterministic: true,
  maxRequests: 16,
  maxGroupSize: 12,
  minimumScore: .3,
  maxSlopeDegrees: 38,
});

export function habitatGate(context = {}) {
  const reasons = [];
  const kind = stringValue(context.kind, 'animal').toLowerCase();
  if (context.insideSettlement && !['npc', 'horse'].includes(kind)) reasons.push('wildlife-settlement');
  if (context.onWater && !['bird', 'dragon'].includes(kind) && numberValue(context.waterDepth) > 2) reasons.push('deep-water');
  if (numberValue(context.slopeDegrees) > SPAWN_ADMISSION_POLICY.maxSlopeDegrees && !['goat', 'dragon'].includes(kind)) reasons.push('slope-too-steep');
  if (context.navReady === false) reasons.push('navigation-not-ready');
  if (context.groundAligned === false) reasons.push('ground-not-aligned');
  return freeze({ ok: !reasons.length, reasons: freeze(reasons) });
}

export function computeSpawnScore(candidate = {}, context = {}) {
  const habitat = clamp(context.habitatScore, 0, 1);
  const pressure = clamp(1 - numberValue(context.populationPressure));
  const playerDistance = Number.isFinite(Number(context.distanceToPlayer))
    ? clamp(numberValue(context.distanceToPlayer) / 80)
    : 1;
  const questBoost = context.questRelevant ? .25 : 0;
  const rareBoost = context.rare ? .2 : 0;
  const priority = clamp(candidate.priority);
  return clamp(habitat * .45 + pressure * .25 + playerDistance * .1 + questBoost + rareBoost + priority * .2);
}

export function admit(candidate = {}, context = {}) {
  const gate = habitatGate({ ...context, kind: candidate.kind });
  const score = computeSpawnScore(candidate, context);
  const currentCount = Math.max(0, numberValue(context.currentCount));
  const capacity = Math.max(1, numberValue(context.capacity, 12));
  const accepted = gate.ok && currentCount < capacity && score >= SPAWN_ADMISSION_POLICY.minimumScore;
  return freeze({
    accepted,
    score,
    reason: !gate.ok ? gate.reasons[0] : currentCount >= capacity ? 'capacity' : accepted ? 'admitted' : 'low-score',
  });
}

export function rank(candidates = [], context = {}) {
  return freeze((Array.isArray(candidates) ? candidates : [])
    .slice(0, SPAWN_ADMISSION_POLICY.maxRequests)
    .map((candidate, index) => ({ candidate, index, decision: admit(candidate, context) }))
    .sort((left, right) => Number(right.decision.accepted) - Number(left.decision.accepted)
      || right.decision.score - left.decision.score
      || stringValue(left.candidate.id, String(left.index)).localeCompare(stringValue(right.candidate.id, String(right.index)))));
}

export function batch(candidates = [], context = {}) {
  const capacity = Math.max(0, Math.min(
    SPAWN_ADMISSION_POLICY.maxRequests,
    Math.floor(numberValue(context.spawnBudget, SPAWN_ADMISSION_POLICY.maxRequests)),
  ));
  return freeze(rank(candidates, context).filter((row) => row.decision.accepted).slice(0, capacity));
}

export function groupSize(kind = 'animal', pressure = 0) {
  const base = { npc: 6, animal: 6, creature: 4, dragon: 1 }[kind] ?? 3;
  return Math.max(1, Math.min(SPAWN_ADMISSION_POLICY.maxGroupSize, Math.floor(base * (1 - clamp(pressure) * .5))));
}

export function buildSpawnIntent(candidate, context = {}) {
  const decision = admit(candidate, context);
  return freeze({
    id: stringValue(candidate?.id),
    kind: stringValue(candidate?.kind, 'animal'),
    species: stringValue(candidate?.species),
    accepted: decision.accepted,
    score: decision.score,
    reason: decision.reason,
    groupSize: groupSize(stringValue(candidate?.kind, 'animal'), context.populationPressure),
    position: context.position ?? null,
    habitat: stringValue(context.biome, 'unknown'),
  });
}

export function chooseSpawnAnchor(candidates = [], context = {}) {
  const admitted = batch(candidates, context);
  return admitted[0]?.candidate ?? null;
}

export function compareSpawnCandidates(left, right) {
  const a = admit(left?.candidate ?? left, left?.context ?? {});
  const b = admit(right?.candidate ?? right, right?.context ?? {});
  return b.score - a.score;
}

export function deterministicSpawnFingerprint(value, seed = 0) {
  let hash = 2166136261;
  for (const character of `${seed}|${JSON.stringify(value ?? null)}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function auditSpawn(result) {
  const errors = [];
  if ((result?.length ?? 0) > SPAWN_ADMISSION_POLICY.maxRequests) errors.push('request-overflow');
  for (const row of result ?? []) {
    if (row?.decision?.score < 0 || row?.decision?.score > 1) errors.push('score-range');
    if (!row?.candidate) errors.push('missing-candidate');
  }
  return freeze({ ok: !errors.length, errors: freeze([...new Set(errors)]), fingerprint: deterministicSpawnFingerprint(result) });
}
