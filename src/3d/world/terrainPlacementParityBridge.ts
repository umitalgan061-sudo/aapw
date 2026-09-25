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
  samples?: readonly (SurfaceRecord | null | undefined | unknown)[];
}>;

function toParitySample(record: unknown): TerrainParitySample | null {
  if (!record || typeof record !== 'object') return null;
  const source = record as SurfaceRecord;
  return {
    x: Number(source.x),
    z: Number(source.z),
    renderedHeight: Number(source.renderedHeight ?? source.height),
    colliderHeight: Number(source.colliderHeight ?? source.height),
  };
}

export function collectTerrainParitySamples(
  surface: SurfaceRecord | null | undefined,
  footprint: FootprintRecord | null | undefined,
): readonly TerrainParitySample[] {
  const records: unknown[] = [
    ...(footprint?.samples ?? []),
    ...(surface ? [surface] : []),
  ];

  const deduped = new Map<string, TerrainParitySample>();
  const malformed: TerrainParitySample[] = [];
  for (const record of records) {
    const sample = toParitySample(record);
    if (!sample) {
      malformed.push(null as unknown as TerrainParitySample);
      continue;
    }

    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.z)
      || !Number.isFinite(sample.renderedHeight) || !Number.isFinite(sample.colliderHeight)) {
      malformed.push(null as unknown as TerrainParitySample);
      continue;
    }

    const key = `${sample.x}:${sample.z}`;
    // The first observation at a world coordinate is the canonical one for
    // this preparation pass. Later duplicates may come from an overlapping
    // footprint/island projection and must not replace the already-selected
    // sample with a different height observation.
    if (!deduped.has(key)) {
      deduped.set(key, sample);
    }
  }

  return Object.freeze([...malformed, ...deduped.values()]);
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
