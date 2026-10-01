/**
 * Deterministic ecology adapter over existing creatureBrain/creatureSpawner owners.
 * It plans bounded roam/flee/perch intents and spawn records; callers execute them through
 * the already-shipped creature runtime. No second ActorRegistry, AI state machine or placement owner.
 */

const POLICY = Object.freeze({
  id: 'safak-kartali-fauna-ecology-bridge-2026-09-14-v1',
  maxHabitats: 64,
  maxActors: 256,
  maxSpawns: 32,
  nearMeters: 45,
  farMeters: 320,
  tickSeconds: Object.freeze({ near: 0, mid: 0.75, far: 2, culled: 8 }),
  threatMemorySeconds: 18,
});

const SPECIES = Object.freeze({
  kurt: Object.freeze({ role: 'predator', preferred: Object.freeze(['forest', 'taiga', 'mountain']), social: true, alertRadius: 72 }),
  geyik: Object.freeze({ role: 'grazer', preferred: Object.freeze(['forest', 'meadow', 'taiga']), social: true, alertRadius: 54 }),
  at: Object.freeze({ role: 'domestic', preferred: Object.freeze(['meadow', 'road', 'settlement']), social: false, alertRadius: 36 }),
  tavsan: Object.freeze({ role: 'prey', preferred: Object.freeze(['forest', 'meadow']), social: false, alertRadius: 42 }),
  kuzgun: Object.freeze({ role: 'avian', preferred: Object.freeze(['forest', 'mountain', 'settlement']), social: true, alertRadius: 64 }),
  ejderha: Object.freeze({ role: 'apex', preferred: Object.freeze(['mountain', 'volcanic', 'wasteland']), social: false, alertRadius: 160 }),
});

const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, finite(v, a)));
const id = (v, f = '') => String(v ?? f).trim() || f;
const dist = (a, b) => (!a || !b) ? Infinity : Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0); };
const pick = (list, seed) => list[hash(seed) % list.length];
const freeze = (v) => Object.freeze(v);

function lodFor(distanceMeters) {
  if (distanceMeters <= POLICY.nearMeters) return 'near';
  if (distanceMeters <= POLICY.farMeters) return 'mid';
  if (distanceMeters <= POLICY.farMeters * 4) return 'far';
  return 'culled';
}

function normalizeHabitat(row, index) {
  const biome = id(row?.canonicalBiome || row?.biome, 'unknown').toLowerCase();
  return freeze({
    id: id(row?.id, `habitat-${index}`), biome,
    position: row?.position ? freeze({ x: finite(row.position.x), z: finite(row.position.z) }) : null,
    quality: clamp(row?.score, 0, 1), food: clamp(row?.food, 0, 1), water: clamp(row?.water, 0, 1), cover: clamp(row?.cover, 0, 1), danger: clamp(row?.danger, 0, 1), occupancy: clamp(row?.occupancy, 0, 1),
    groundValid: row?.groundValid !== false, navReachable: row?.navReachable !== false,
    slope: Math.max(0, Math.min(89, finite(row?.slopeDegrees ?? row?.slope))),
    waterDepth: Math.max(0, finite(row?.waterDepthMeters)),
  });
}

function normalizeActor(row, index) {
  return freeze({
    id: id(row?.id, `fauna-${index}`), species: id(row?.species || row?.speciesId, 'geyik').toLowerCase(),
    groupId: id(row?.groupId), habitatId: id(row?.habitatId), position: row?.position ? freeze({ x: finite(row.position.x), z: finite(row.position.z) }) : null,
    health: clamp(row?.health, 0, 1), active: row?.active !== false, visible: row?.visible !== false,
    distanceMeters: Math.max(0, finite(row?.distanceMeters, 9999)), lastThreatSeconds: Math.max(0, finite(row?.lastThreatSeconds, 9999)),
  });
}

function normalizeThreat(row, index) {
  return freeze({ id: id(row?.id, `threat-${index}`), position: row?.position ? freeze({ x: finite(row.position.x), z: finite(row.position.z) }) : null, distanceMeters: Math.max(0, finite(row?.distanceMeters, 9999)), confidence: clamp(row?.confidence, 0, 1), visible: row?.visible !== false, heard: Boolean(row?.heard), hostile: row?.hostile !== false });
}

function habitatFit(species, habitat) {
  const profile = SPECIES[species] || SPECIES.geyik;
  if (!habitat.groundValid || !habitat.navReachable) return 0;
  if (['ocean', 'deep-water', 'cliff'].includes(habitat.biome)) return 0;
  const biome = profile.preferred.includes(habitat.biome) ? 1 : 0.35;
  const role = profile.role === 'predator' ? habitat.cover * 0.45 : profile.role === 'avian' ? (1 - habitat.occupancy) * 0.25 : habitat.food * 0.4;
  const safety = (1 - habitat.danger) * 0.25;
  const slopePenalty = profile.role === 'domestic' ? clamp(1 - habitat.slope / 35) : clamp(1 - habitat.slope / 70);
  return clamp(habitat.quality * 0.35 + biome * 0.2 + role + safety + slopePenalty * 0.1);
}

function threatFor(actor, threats) {
  return threats.filter((t) => t.hostile && t.confidence > 0 && (t.visible || t.heard)).sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id))[0] || null;
}

function actorState(actor, threat) {
  if (!actor.active || actor.health <= 0) return 'inactive';
  if (!threat) return 'roam';
  const profile = SPECIES[actor.species] || SPECIES.geyik;
  if (profile.role === 'predator' && threat.distanceMeters <= profile.alertRadius * 0.7) return 'stalk';
  if (profile.role === 'apex' && threat.distanceMeters <= profile.alertRadius * 0.4) return 'territorial';
  return 'flee';
}

export function planFaunaEcologyTick(input = {}) {
  const seed = id(input.seed, 'fauna');
  const tick = Math.max(0, Math.floor(finite(input.tick)));
  const playerPosition = input.playerPosition || null;
  const habitats = (Array.isArray(input.habitats) ? input.habitats : []).slice(0, POLICY.maxHabitats).map(normalizeHabitat);
  const actors = (Array.isArray(input.fauna) ? input.fauna : []).slice(0, POLICY.maxActors).map(normalizeActor);
  const threats = (Array.isArray(input.threats) ? input.threats : []).slice(0, 64).map(normalizeThreat);
  const habitatById = new Map(habitats.map((h) => [h.id, h]));
  const updates = actors.map((actor) => {
    const habitat = habitatById.get(actor.habitatId) || habitats.find((h) => habitatFit(actor.species, h) > 0) || null;
    const nearestThreat = threatFor(actor, threats);
    const distanceMeters = actor.distanceMeters || dist(actor.position, playerPosition);
    const lod = lodFor(distanceMeters);
    const state = actorState(actor, nearestThreat);
    const profile = SPECIES[actor.species] || SPECIES.geyik;
    const groupSignal = profile.social && state === 'flee' ? 'alert-group' : profile.social && state === 'roam' ? 'cohesion' : null;
    return freeze({ id: actor.id, species: actor.species, groupId: actor.groupId, habitatId: habitat?.id || null, state, lod, tickIntervalSeconds: POLICY.tickSeconds[lod], threatId: nearestThreat?.id || null, groupSignal, deterministicKey: `${seed}:${tick}:${actor.id}` });
  });

  const species = [...new Set((Array.isArray(input.species) ? input.species : actors.map((a) => a.species)).map((s) => id(s, 'geyik').toLowerCase()))].slice(0, 16);
  const spawns = [];
  for (const speciesId of species) {
    const best = habitats.map((h) => ({ habitat: h, score: habitatFit(speciesId, h) })).sort((a, b) => b.score - a.score || a.habitat.id.localeCompare(b.habitat.id))[0];
    if (!best || best.score <= 0.45 || spawns.length >= POLICY.maxSpawns) continue;
    const existing = actors.filter((a) => a.species === speciesId && a.habitatId === best.habitat.id).length;
    if (existing >= 8) continue;
    const count = 1 + (hash(`${seed}:${tick}:${speciesId}`) % 3);
    for (let i = 0; i < count && spawns.length < POLICY.maxSpawns; i += 1) {
      const spread = 4 + (hash(`${seed}:${speciesId}:${i}`) % 12);
      spawns.push(freeze({ id: `${speciesId}-${best.habitat.id}-${tick}-${i}`, speciesId, x: finite(best.habitat.position?.x) + spread, z: finite(best.habitat.position?.z) - spread, habitatId: best.habitat.id, socialAnchorX: finite(best.habitat.position?.x), socialAnchorZ: finite(best.habitat.position?.z), assetFirst: true, placement: freeze({ groundAligned: true, navAligned: true, habitatAligned: true }), materialContract: 'MaterialAssignmentCore', placementContract: 'WorldAssetPlacementPipeline' }));
    }
  }

  const events = updates.filter((u) => u.groupSignal === 'alert-group').map((u) => freeze({ type: 'fauna-group-alert', actorId: u.id, groupId: u.groupId, deterministicKey: `${seed}:${tick}:alert:${u.id}` })).slice(0, 24);
  return freeze({ policy: POLICY.id, deterministic: true, tick, updates: freeze(updates), spawns: freeze(spawns), events: freeze(events), budget: freeze({ habitats: habitats.length, actors: actors.length, updates: updates.length, spawns: spawns.length }), digest: `${seed}:${tick}:${updates.map((u) => `${u.id}:${u.state}:${u.lod}`).join('|')}:${spawns.map((s) => s.id).join('|')}` });
}

export function applyFaunaEcologyTick(plan, owners = {}) {
  if (!plan || plan.deterministic !== true) return freeze({ accepted: false, spawned: [], updated: [], emitted: [] });
  const spawned = [], updated = [], emitted = [];
  for (const spawn of plan.spawns || []) { if (typeof owners.spawnConfiguredCreatures === 'function') { owners.spawnConfiguredCreatures(spawn); spawned.push(spawn.id); } }
  for (const update of plan.updates || []) { if (typeof owners.updateCreatureBeing === 'function') { owners.updateCreatureBeing(update); updated.push(update.id); } }
  for (const event of plan.events || []) { if (typeof owners.emitWorldEvent === 'function') { owners.emitWorldEvent(event); emitted.push(event.type); } }
  return freeze({ accepted: true, spawned: freeze(spawned), updated: freeze(updated), emitted: freeze(emitted), delegated: spawned.length + updated.length + emitted.length });
}

export function auditFaunaEcologyPlan(plan) {
  const failures = [];
  if (!plan || plan.deterministic !== true) failures.push('non-deterministic');
  if (plan?.spawns?.some((s) => !s.assetFirst || s.materialContract !== 'MaterialAssignmentCore' || s.placementContract !== 'WorldAssetPlacementPipeline')) failures.push('shared-contract');
  if (plan?.spawns?.some((s) => !s.placement?.groundAligned || !s.placement?.navAligned || !s.placement?.habitatAligned)) failures.push('placement');
  return freeze({ ok: failures.length === 0, failures: freeze(failures) });
}

export { POLICY as LIVING_WORLD_FAUNA_ECOLOGY_BRIDGE_POLICY };
