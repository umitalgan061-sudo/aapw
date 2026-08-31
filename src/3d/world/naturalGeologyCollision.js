/**
 * Conservative gameplay blockers for the largest natural-geology outcrops.
 *
 * The canonical terrain/collider height remains owned by world/terrain.js. This module only derives
 * simple horizontal circles from already-authoritative geology placements so a player cannot walk
 * through a twenty-metre bedrock mass while the renderer shows it as solid stone. The circle is
 * intentionally inscribed well inside the visible horizontal footprint; it must never create an
 * invisible wall around talus, boulders or low walkable slabs.
 * @module world/naturalGeologyCollision
 */

export const NATURAL_GEOLOGY_COLLISION_POLICY = Object.freeze({
  id: 'natural-geology-large-outcrop-collision-2026-08-31-v1',
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  canonicalHydrologyUnchanged: true,
  placementAuthorityUnchanged: true,
  approximateHorizontalOnly: true,
  largeOutcropOnly: true,
  blockingKinds: Object.freeze(['fractured-scarp', 'bedrock', 'asset-proxy']),
  minimumVerticalScaleMeters: 4.5,
  minimumMinorHorizontalScaleMeters: 4.0,
  inscribedRadiusFraction: 0.38,
  minimumRadiusMeters: 1.35,
  maximumRadiusMeters: 8.0,
});

const blockingKinds = new Set(NATURAL_GEOLOGY_COLLISION_POLICY.blockingKinds);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Convert deterministic geology placements into fixed analytic blockers.
 *
 * `scale.x/z` describe the visible prototype/asset footprint after placement. We use the *minor*
 * horizontal scale so the collision circle stays inside elongated scarps rather than extending past
 * their narrow dimension. Height filtering prevents flat decorative slabs from becoming obstacles.
 *
 * @param {ReadonlyArray<object>} placements
 * @returns {ReadonlyArray<{x:number,z:number,radius:number,sourcePlacementId:string,kind:string}>}
 */
export function createNaturalGeologyCollisionCircles(placements = []) {
  const policy = NATURAL_GEOLOGY_COLLISION_POLICY;
  const circles = [];
  for (const placement of placements) {
    if (!placement || !blockingKinds.has(placement.kind)) continue;
    const x = finite(placement.x, NaN);
    const z = finite(placement.z, NaN);
    const scaleX = Math.abs(finite(placement.scale?.x));
    const scaleY = Math.abs(finite(placement.scale?.y));
    const scaleZ = Math.abs(finite(placement.scale?.z));
    if (![x, z, scaleX, scaleY, scaleZ].every(Number.isFinite)) continue;
    const minorHorizontal = Math.min(scaleX, scaleZ);
    if (scaleY < policy.minimumVerticalScaleMeters) continue;
    if (minorHorizontal < policy.minimumMinorHorizontalScaleMeters) continue;

    const radius = clamp(
      minorHorizontal * policy.inscribedRadiusFraction,
      policy.minimumRadiusMeters,
      Math.min(policy.maximumRadiusMeters, minorHorizontal * 0.48),
    );
    if (!(radius > 0)) continue;
    circles.push(Object.freeze({
      x,
      z,
      radius,
      sourcePlacementId: String(placement.id ?? ''),
      kind: placement.kind,
    }));
  }
  return Object.freeze(circles);
}

export function summarizeNaturalGeologyCollision(placements = []) {
  const circles = createNaturalGeologyCollisionCircles(placements);
  const byKind = {};
  let maximumRadiusMeters = 0;
  let minimumRadiusMeters = Infinity;
  for (const circle of circles) {
    byKind[circle.kind] = (byKind[circle.kind] ?? 0) + 1;
    maximumRadiusMeters = Math.max(maximumRadiusMeters, circle.radius);
    minimumRadiusMeters = Math.min(minimumRadiusMeters, circle.radius);
  }
  return Object.freeze({
    policyId: NATURAL_GEOLOGY_COLLISION_POLICY.id,
    blockerCount: circles.length,
    byKind: Object.freeze(byKind),
    minimumRadiusMeters: circles.length ? minimumRadiusMeters : 0,
    maximumRadiusMeters,
  });
}
