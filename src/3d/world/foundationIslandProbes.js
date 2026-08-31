/**
 * Pure sampling helpers for disconnected structure-foundation islands.
 *
 * `WorldAssetPlacementPipeline` keeps the canonical aggregate footprint contract at nine probes
 * (centre + four corners + four edge midpoints). Compound structures can contain up to four real
 * ground-contact islands inside that aggregate envelope, however, so a raised middle wing can sit
 * entirely between the aggregate probes. This module produces the same nine-point contract for
 * every valid oriented island without depending on THREE.js or terrain implementation details.
 *
 * The helper is deliberately side-effect free: callers decide how to query/evaluate terrain and
 * whether island probes participate in placement policy, target-height selection, diagnostics, or
 * all three. Invalid island records are ignored rather than manufacturing an axis-aligned fallback;
 * the aggregate footprint remains the authoritative safety fallback in that case.
 * @module world/foundationIslandProbes
 */

export const FOUNDATION_ISLAND_PROBE_POLICY = Object.freeze({
  id: 'foundation-island-nine-probe-2026-08-25-v1',
  probesPerIsland: 9,
  maximumIslands: 4,
  orthogonalityTolerance: 0.08,
  minimumAxisLength: 1e-6,
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedAxis(axis) {
  const x = finite(axis?.x);
  const z = finite(axis?.z);
  if (x === null || z === null) return null;
  const length = Math.hypot(x, z);
  if (length < FOUNDATION_ISLAND_PROBE_POLICY.minimumAxisLength) return null;
  return Object.freeze({ x: x / length, z: z / length });
}

export function normalizeFoundationIsland(island) {
  if (!island || typeof island !== 'object') return null;
  const centerX = finite(island.centerX);
  const centerZ = finite(island.centerZ);
  const halfWidthMeters = finite(island.halfWidthMeters);
  const halfDepthMeters = finite(island.halfDepthMeters);
  const axisX = normalizedAxis(island.axisX);
  const axisZ = normalizedAxis(island.axisZ);
  if ([centerX, centerZ, halfWidthMeters, halfDepthMeters].some((value) => value === null)) return null;
  if (!axisX || !axisZ || halfWidthMeters < 0 || halfDepthMeters < 0) return null;
  const dot = axisX.x * axisZ.x + axisX.z * axisZ.z;
  if (Math.abs(dot) > FOUNDATION_ISLAND_PROBE_POLICY.orthogonalityTolerance) return null;
  return Object.freeze({ centerX, centerZ, halfWidthMeters, halfDepthMeters, axisX, axisZ });
}

function worldPoint(island, localX, localZ) {
  return Object.freeze({
    x: island.centerX + island.axisX.x * localX + island.axisZ.x * localZ,
    z: island.centerZ + island.axisX.z * localX + island.axisZ.z * localZ,
  });
}

/**
 * Returns the canonical nine terrain probes for one oriented ground-contact island.
 * @param {object} island Oriented island record from `worldFootprintFor()`.
 * @param {number} [islandIndex=0] Stable island index used only for labels/diagnostics.
 * @returns {ReadonlyArray<{label:string,islandIndex:number,x:number,z:number}>}
 */
export function createFoundationIslandProbePoints(island, islandIndex = 0) {
  const normalized = normalizeFoundationIsland(island);
  if (!normalized) return Object.freeze([]);
  const index = Number.isInteger(islandIndex) && islandIndex >= 0 ? islandIndex : 0;
  const w = normalized.halfWidthMeters;
  const d = normalized.halfDepthMeters;
  const records = [
    ['center', 0, 0],
    ['north-west', -w, -d],
    ['north-east', w, -d],
    ['south-west', -w, d],
    ['south-east', w, d],
    ['north-mid', 0, -d],
    ['south-mid', 0, d],
    ['west-mid', -w, 0],
    ['east-mid', w, 0],
  ];
  return Object.freeze(records.map(([suffix, localX, localZ]) => {
    const point = worldPoint(normalized, localX, localZ);
    return Object.freeze({ label: `island-${index}-${suffix}`, islandIndex: index, x: point.x, z: point.z });
  }));
}

/**
 * Expands up to the runtime foundation island budget into deterministic nine-point probe groups.
 * One-island footprints intentionally return no extra probes because the aggregate nine-point
 * footprint already covers them; this helper exists specifically for disconnected topology.
 */
export function createDisconnectedFoundationIslandProbes(footprintIslands) {
  if (!Array.isArray(footprintIslands) || footprintIslands.length <= 1) return Object.freeze([]);
  const limited = footprintIslands.slice(0, FOUNDATION_ISLAND_PROBE_POLICY.maximumIslands);
  const probes = [];
  limited.forEach((island, index) => probes.push(...createFoundationIslandProbePoints(island, index)));
  return Object.freeze(probes);
}

/**
 * Convenience reducer for callers that already queried terrain at the returned probes.
 */
export function foundationIslandHeightExtrema(samples) {
  if (!Array.isArray(samples) || !samples.length) return Object.freeze({ ok: false, minHeight: null, maxHeight: null });
  const heights = samples.map((sample) => finite(sample?.height)).filter((height) => height !== null);
  if (!heights.length) return Object.freeze({ ok: false, minHeight: null, maxHeight: null });
  return Object.freeze({ ok: true, minHeight: Math.min(...heights), maxHeight: Math.max(...heights) });
}
