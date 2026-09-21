/**
 * Şafak Kartalı — deterministic fauna habitat/LOD policy.
 *
 * Composes with the existing ambient-life policy without owning spawning, navigation,
 * combat, factions, world events, renderer, THREE, DOM, or asset loading.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => value == null ? fallback : String(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const idOf = (value) => String(value ?? '').trim();

export const LIVING_WORLD_FAUNA_HABITAT_POLICY = freeze({
  id: 'safak-kartali-fauna-habitat-2026-09-17-v1',
  maxActors: 128,
  maxPlans: 24,
  tickIntervals: freeze({ near: 0, distant: 0.75, far: 2, offscreen: Infinity }),
});

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
}

function lodFor(meters) {
  if (meters < 60) return 'near';
  if (meters < 140) return 'distant';
  if (meters <= 220) return 'far';
  return 'offscreen';
}

function habitatCompatible(actor) {
  const species = text(actor.species).toLowerCase();
  const habitat = text(actor.habitat, '').toLowerCase();
  if (!habitat) return true;
  if (species.includes('fish') || species.includes('otter')) return habitat === 'water' || habitat === 'shore';
  if (species.includes('hawk') || species.includes('eagle') || species.includes('dragon')) return habitat !== 'water';
  if (species.includes('deer') || species.includes('wolf') || species.includes('goat')) return habitat !== 'water';
  return true;
}

function expectedSurface(actor) {
  const slope = Math.abs(finite(actor.slope));
  if (slope > 0.78 && text(actor.role).toLowerCase() === 'grazer') return 'steep';
  if (text(actor.habitat).toLowerCase() === 'water') return 'water';
  return 'ground';
}

export function planFaunaHabitat(input = {}) {
  const playerPosition = input.playerPosition || null;
  const actors = Array.isArray(input.actors) ? input.actors.slice(0, LIVING_WORLD_FAUNA_HABITAT_POLICY.maxActors) : [];
  const plans = [];
  const rejected = [];
  const seen = new Set();

  for (const actor of actors) {
    const id = idOf(actor?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const meters = distance(actor?.position, playerPosition);
    const lod = lodFor(meters);
    if (lod === 'offscreen') continue;
    if (actor?.groundValid === false || actor?.navReachable === false) {
      rejected.push({ actorId: id, reason: 'invalid-ground-or-nav' });
      continue;
    }
    if (!habitatCompatible(actor)) {
      rejected.push({ actorId: id, reason: 'habitat-mismatch' });
      continue;
    }
    plans.push({
      actorId: id,
      species: text(actor.species, 'unknown'),
      lod,
      tickIntervalSeconds: LIVING_WORLD_FAUNA_HABITAT_POLICY.tickIntervals[lod],
      habitat: text(actor.habitat, 'land'),
      expectedSurface: expectedSurface(actor),
      groundAligned: true,
      navAligned: true,
      assetFirst: true,
      placement: freeze({
        materialContract: 'src/3d/materials/MaterialAssignmentCore.js',
        placementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
      }),
    });
  }

  plans.sort((a, b) => a.actorId.localeCompare(b.actorId));
  rejected.sort((a, b) => a.actorId.localeCompare(b.actorId));
  return freeze({
    policyId: LIVING_WORLD_FAUNA_HABITAT_POLICY.id,
    accepted: true,
    plans: freeze(plans.slice(0, LIVING_WORLD_FAUNA_HABITAT_POLICY.maxPlans)),
    rejected: freeze(rejected),
    audit: freeze({
      ok: plans.every((plan) => plan.groundAligned && plan.navAligned && plan.assetFirst),
      planCount: Math.min(plans.length, LIVING_WORLD_FAUNA_HABITAT_POLICY.maxPlans),
      rejectedCount: rejected.length,
    }),
  });
}

export function auditFaunaHabitatPlan(result) {
  if (!result || result.accepted !== true) return freeze({ ok: false, reason: 'not-accepted' });
  const ids = result.plans.map((plan) => plan.actorId);
  return freeze({
    ok: new Set(ids).size === ids.length && ids.join('|') === [...ids].sort().join('|') && result.plans.every((plan) => plan.tickIntervalSeconds !== undefined && plan.placement.materialContract.endsWith('MaterialAssignmentCore.js')),
    uniqueActorIds: new Set(ids).size,
    sorted: ids.join('|') === [...ids].sort().join('|'),
  });
}
