/**
 * Runtime bridge between the shared world placement surface records and the
 * observation-only terrain/collider parity contract.
 *
 * This module deliberately does not attach objects, mutate scenes, load assets,
 * assign materials, or create another placement authority. It converts the
 * samples already produced by WorldAssetPlacementPipeline into the canonical
 * parity shape so placement consumers can fail closed before scene attachment.
 */

import {
  evaluateTerrainPlacementParity,
  type TerrainParityPolicy,
  type TerrainParityResult,
  type TerrainParitySample,
} from './terrainPlacementParity.ts';

type SurfaceRecord = Readonly<{
  x?: number;
  z?: number;
  renderedHeight?: number;
  colliderHeight?: number;
  height?: number;
}>;

type FootprintRecord = Readonly<{
  samples?: readonly SurfaceRecord[];
}>;

function toParitySample(record: SurfaceRecord): TerrainParitySample {
  return {
    x: Number(record.x),
    z: Number(record.z),
    renderedHeight: Number(record.renderedHeight ?? record.height),
    colliderHeight: Number(record.colliderHeight ?? record.height),
  };
}

export function collectTerrainParitySamples(
  surface: SurfaceRecord | null | undefined,
  footprint: FootprintRecord | null | undefined,
): readonly TerrainParitySample[] {
  const records = [
    ...(footprint?.samples ?? []),
    ...(surface ? [surface] : []),
  ];

  const deduped = new Map<string, TerrainParitySample>();
  for (const record of records) {
    const sample = toParitySample(record);
    const key = `${sample.x}:${sample.z}`;
    // The first observation at a world coordinate is the canonical one for
    // this preparation pass. Later duplicates may come from an overlapping
    // footprint/island projection and must not replace the already-selected
    // sample with a different height observation.
    if (!deduped.has(key)) {
      deduped.set(key, sample);
    }
  }

  return Object.freeze([...deduped.values()]);
}

export function evaluatePreparedPlacementParity(
  surface: SurfaceRecord | null | undefined,
  footprint: FootprintRecord | null | undefined,
  policy: TerrainParityPolicy = {},
): TerrainParityResult {
  return evaluateTerrainPlacementParity(
    collectTerrainParitySamples(surface, footprint),
    policy,
  );
}
