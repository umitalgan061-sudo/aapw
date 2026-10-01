export const POPULATION_BUDGET_POLICY = Object.freeze({
  id: 'safak-kartali-population-budget-2026-09-14-v1',
  deterministic: true,
  maxActors: 128,
  maxSpawnRequests: 48,
  maxAmbientCandidates: 32,
  maxNearTicksPerFrame: 36,
  maxDistantTicksPerFrame: 18,
  maxFarTicksPerFrame: 8,
  maxAmbientPerFrame: 6,
  maxSpawnPerFrame: 4,
  nearMeters: 45,
  distantMeters: 120,
  farMeters: 260,
});

const KINDS = Object.freeze(['npc', 'animal', 'creature', 'dragon']);
const WEIGHTS = Object.freeze({ npc: 1, animal: 0.8, creature: 1.2, dragon: 1.8 });
const num = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, num(v, lo)));
const str = (v, f = '') => v == null || v === '' ? f : String(v);
const pos = (v) => { const p = v?.object3D?.position ?? v?.position ?? v?.transform?.position; if (!p) return null; const x = num(p.x, NaN); const z = num(p.z, NaN); return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; };
const dist = (a, b) => a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
function hash(value) { let h = 2166136261; for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
function round(v, d = 5) { const p = 10 ** d; return Math.round(num(v) * p) / p; }

export function normalizeLod(distanceMeters, thresholds = {}) {
  const near = Math.max(1, num(thresholds.nearMeters, POPULATION_BUDGET_POLICY.nearMeters));
  const distant = Math.max(near + 1, num(thresholds.distantMeters, POPULATION_BUDGET_POLICY.distantMeters));
  const far = Math.max(distant + 1, num(thresholds.farMeters, POPULATION_BUDGET_POLICY.farMeters));
  if (distanceMeters <= near) return 'near';
  if (distanceMeters <= distant) return 'distant';
  if (distanceMeters <= far) return 'far';
  return 'culled';
}

export function tickInterval(lod, custom = {}) { return lod === 'near' ? 0 : lod === 'distant' ? Math.max(0, num(custom.distant, 0.75)) : lod === 'far' ? Math.max(0, num(custom.far, 2)) : Infinity; }

export function normalizePopulationActor(actor, index = 0) {
  const kind = str(actor?.kind ?? actor?.type, 'npc').toLowerCase();
  return Object.freeze({ id: str(actor?.id ?? actor?.actorId ?? actor?.object3D?.uuid, `${kind}-${index}`), kind: KINDS.includes(kind) ? kind : 'npc', position: pos(actor), priority: clamp(actor?.priority), essential: Boolean(actor?.essential), ambient: Boolean(actor?.ambient), active: actor?.active !== false, groupId: str(actor?.groupId), species: str(actor?.species) });
}

export function normalizePopulationCollection(collections = {}) {
  const result = [];
  for (const kind of KINDS) for (const actor of Array.isArray(collections[kind]) ? collections[kind] : []) { if (result.length >= POPULATION_BUDGET_POLICY.maxActors) break; result.push(normalizePopulationActor({ ...actor, kind }, result.length)); }
  return Object.freeze(result.sort((a, b) => a.id.localeCompare(b.id)));
}

export function calculateActorLod(actor, playerPosition, thresholds = {}) { return normalizeLod(dist(pos(actor), pos({ position: playerPosition })), thresholds); }

export function calculateImportance(actor, context = {}) {
  const a = normalizePopulationActor(actor);
  const distanceScore = Number.isFinite(context.distanceMeters) ? clamp(1 - context.distanceMeters / 300) : 0;
  const score = distanceScore * 0.45 + a.priority * 0.2 + (context.questRelevant ? 0.35 : 0) + (context.inCombat ? 0.25 : 0) + (a.essential ? 0.6 : 0) - (a.ambient ? 0.15 : 0);
  return round(clamp(score * (WEIGHTS[a.kind] ?? 1)));
}

export function chooseFrameBudget({ actorCount = 0, mobile = false, near = 0, distant = 0, far = 0, requestedSpawn = 4, requestedAmbient = 6 } = {}) {
  const scale = mobile ? 0.68 : 1;
  const count = Math.max(0, num(actorCount));
  const safety = count > POPULATION_BUDGET_POLICY.maxActors ? POPULATION_BUDGET_POLICY.maxActors / count : 1;
  return Object.freeze({
    nearTicks: Math.max(1, Math.floor(POPULATION_BUDGET_POLICY.maxNearTicksPerFrame * scale * safety)),
    distantTicks: Math.max(1, Math.floor(POPULATION_BUDGET_POLICY.maxDistantTicksPerFrame * scale * safety)),
    farTicks: Math.max(1, Math.floor(POPULATION_BUDGET_POLICY.maxFarTicksPerFrame * scale * safety)),
    spawn: Math.min(POPULATION_BUDGET_POLICY.maxSpawnPerFrame, Math.max(0, Math.floor(num(requestedSpawn, 4) * scale))),
    ambient: Math.min(POPULATION_BUDGET_POLICY.maxAmbientPerFrame, Math.max(0, Math.floor(num(requestedAmbient, 6) * scale))),
    observed: Object.freeze({ actorCount: count, near, distant, far }),
  });
}

function baseCapacity(kind) { return { npc: 12, animal: 18, creature: 10, dragon: 2 }[kind] ?? 8; }
export function computePopulationPressure(existingActors = [], context = {}) { const counts = { npc: 0, animal: 0, creature: 0, dragon: 0 }; for (const actor of existingActors) { const kind = str(actor?.kind, 'npc'); if (KINDS.includes(kind)) counts[kind] += 1; } const pressure = {}; for (const kind of KINDS) { const capacity = Math.max(1, Math.floor(baseCapacity(kind) * Math.max(0.25, num(context?.capacity?.[kind], 1)))); pressure[kind] = round(counts[kind] / capacity); } return Object.freeze({ counts: Object.freeze(counts), pressure: Object.freeze(pressure) }); }

export function admitSpawnCandidate(candidate, existingActors = [], context = {}) { const actor = normalizePopulationActor(candidate); const state = computePopulationPressure(existingActors, context); const pressure = state.pressure[actor.kind] ?? 1; const capacity = baseCapacity(actor.kind); const habitat = clamp(context.habitatScore, 0, 1); const blocked = context.blocked === true; const density = clamp(1 - pressure); const player = Number.isFinite(context.distanceToPlayerMeters) ? clamp(context.distanceToPlayerMeters / 80) : 1; const score = round(habitat * 0.5 + density * 0.3 + player * 0.1 + actor.priority * 0.1); const accepted = !blocked && state.counts[actor.kind] < capacity && score >= 0.28; return Object.freeze({ accepted, actor, score, reason: blocked ? 'blocked-context' : state.counts[actor.kind] >= capacity ? 'capacity' : accepted ? 'within-budget' : 'low-score', count: state.counts[actor.kind], capacity }); }

export function rankSpawnCandidates(candidates, existingActors, context = {}) { return Object.freeze((Array.isArray(candidates) ? candidates : []).slice(0, POPULATION_BUDGET_POLICY.maxSpawnRequests).map((c, i) => ({ index: i, ...admitSpawnCandidate(c, existingActors, context) })).sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score || a.actor.id.localeCompare(b.actor.id))); }

export function ambientDensity({ biome = 'temperate', timeOfDay = 12, weather = 'clear', settlementDistanceMeters = Infinity, currentCount = 0, seed = 0 } = {}) { const base = { forest: .92, meadow: .85, marsh: .72, coast: .7, steppe: .58, mountain: .45, snow: .36, desert: .3, city: .22, temperate: .65 }[str(biome, 'temperate').toLowerCase()] ?? .55; const daylight = clamp(1 - Math.abs(num(timeOfDay, 12) - 13) / 13); const wp = weather === 'storm' ? .5 : weather === 'rain' ? .78 : weather === 'snow' ? .72 : 1; const settlement = Number.isFinite(settlementDistanceMeters) ? clamp(settlementDistanceMeters / 120) : 1; const saturation = clamp(1 - num(currentCount) / 24); const jitter = (hash(`${seed}|${biome}|${Math.floor(num(timeOfDay) * 4)}`) % 1000) / 1000; return round(clamp(base * (.55 + daylight * .45) * wp * (.65 + settlement * .35) * saturation + jitter * .04)); }

export function buildAmbientCandidates(options = {}) { const density = ambientDensity(options); const source = Array.isArray(options.species) && options.species.length ? options.species : ['bird', 'bee', 'deer', 'fox']; const limit = Math.min(POPULATION_BUDGET_POLICY.maxAmbientCandidates, Math.max(0, Math.floor(num(options.limit, 18)))); const count = Math.min(limit, Math.floor(density * 18)); const result = []; for (let i = 0; i < count; i += 1) { const species = String(source[hash(`${options.seed ?? 0}|${i}|${options.biome ?? ''}`) % source.length]); result.push(Object.freeze({ id: `ambient-${species}-${hash(`${options.seed ?? 0}|${i}`).toString(16)}`, kind: 'animal', species, ambient: true, radiusMeters: 18 + hash(`${options.seed ?? 0}|r|${i}`) % 90, angleRadians: (hash(`${options.seed ?? 0}|a|${i}`) % 6283) / 1000, density, priority: .1 })); } return Object.freeze(result); }

export function chooseSimulationSlice(actors, budget = {}, nowSeconds = 0, lastTickById = new Map()) { const player = budget.playerPosition; const rows = (Array.isArray(actors) ? actors : []).map((a, i) => { const actor = normalizePopulationActor(a, i); const lod = calculateActorLod(actor, player, budget.lodThresholds); const elapsed = nowSeconds - num(lastTickById.get(actor.id), -Infinity); const due = elapsed >= tickInterval(lod, budget.tickIntervals); const importance = calculateImportance(actor, { distanceMeters: dist(actor.position, pos({ position: player })), ...budget.context }); return { actor, lod, elapsed, due, importance }; }).sort((a, b) => Number(b.due) - Number(a.due) || b.importance - a.importance || a.actor.id.localeCompare(b.actor.id)); const selected = rows.filter((r) => r.due && r.lod !== 'culled').slice(0, Math.max(0, Math.floor(num(budget.maxTicks, rows.length)))); const selectedIds = new Set(selected.map((r) => r.actor.id)); return Object.freeze({ selected: Object.freeze(selected), skipped: Object.freeze(rows.filter((r) => !selectedIds.has(r.actor.id))), remaining: Math.max(0, Math.floor(num(budget.maxTicks, rows.length)) - selected.length) }); }

export function ambientAdmission(candidate, context = {}) { const blocked = Boolean(context.waterTooDeep || context.slopeTooSteep || context.insideSettlement || context.onRoad); const density = clamp(context.density); const distancePenalty = Number.isFinite(context.distanceToSettlementMeters) ? clamp(1 - context.distanceToSettlementMeters / 120) : 0; const kindPenalty = candidate?.kind === 'dragon' ? .85 : candidate?.kind === 'creature' ? .5 : .12; const score = round(clamp(density - distancePenalty * kindPenalty - Number(blocked) * .9)); return Object.freeze({ accepted: !blocked && score >= .18, score, reason: blocked ? 'surface-context' : score >= .18 ? 'ambient-density' : 'density-floor' }); }

export function deterministicPopulationFingerprint(input, seed = 0) { return hash(`${seed}|${JSON.stringify(input ?? null)}`).toString(16).padStart(8, '0'); }
export function auditPopulationBudget(snapshot) { const errors = []; if (num(snapshot?.actorCount) > POPULATION_BUDGET_POLICY.maxActors) errors.push('actor-overflow'); if (num(snapshot?.spawnCount) > POPULATION_BUDGET_POLICY.maxSpawnPerFrame) errors.push('spawn-budget-overflow'); if (num(snapshot?.ambientCount) > POPULATION_BUDGET_POLICY.maxAmbientPerFrame) errors.push('ambient-budget-overflow'); return Object.freeze({ ok: !errors.length, errors: Object.freeze(errors), fingerprint: deterministicPopulationFingerprint(snapshot) }); }
export function summarizePopulation(actors, playerPosition, context = {}) { const counts = { near: 0, distant: 0, far: 0, culled: 0 }; const kinds = { npc: 0, animal: 0, creature: 0, dragon: 0 }; for (const a of actors ?? []) { const n = normalizePopulationActor(a); counts[calculateActorLod(n, playerPosition, context.lodThresholds)] += 1; kinds[n.kind] += 1; } return Object.freeze({ counts: Object.freeze(counts), kinds: Object.freeze(kinds), pressure: computePopulationPressure(actors, context) }); }
export function projectBudgetForDevice(snapshot, { mobile = false, pwa = false } = {}) { const factor = mobile || pwa ? .68 : 1; return Object.freeze({ nearTicks: Math.max(1, Math.floor(num(snapshot?.nearTicks, 12) * factor)), distantTicks: Math.max(1, Math.floor(num(snapshot?.distantTicks, 8) * factor)), farTicks: Math.max(1, Math.floor(num(snapshot?.farTicks, 4) * factor)), spawn: Math.max(0, Math.floor(num(snapshot?.spawn, 2) * factor)), ambient: Math.max(0, Math.floor(num(snapshot?.ambient, 3) * factor)) }); }
export function stableRoundRobin(ids, cursor = 0, limit = ids?.length ?? 0) { const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort(); if (!list.length) return Object.freeze([]); const start = Math.max(0, Math.floor(cursor)) % list.length; const count = Math.max(0, Math.min(list.length, Math.floor(limit))); return Object.freeze(Array.from({ length: count }, (_, i) => list[(start + i) % list.length])); }
export function deterministicSliceOrder(actors, seed = 0) { return Object.freeze((actors ?? []).map((a, i) => normalizePopulationActor(a, i)).sort((a, b) => hash(`${seed}|${a.id}`) - hash(`${seed}|${b.id}`) || a.id.localeCompare(b.id)).map((a) => a.id)); }
export function auditDeviceBudget(budget = {}) { const errors = []; for (const key of ['nearTicks', 'distantTicks', 'farTicks', 'spawn', 'ambient']) if (!Number.isFinite(Number(budget[key])) || budget[key] < 0) errors.push(`${key}-invalid`); if (num(budget.spawn) > POPULATION_BUDGET_POLICY.maxSpawnPerFrame) errors.push('spawn-over-cap'); if (num(budget.ambient) > POPULATION_BUDGET_POLICY.maxAmbientPerFrame) errors.push('ambient-over-cap'); return Object.freeze({ ok: !errors.length, errors: Object.freeze(errors) }); }
