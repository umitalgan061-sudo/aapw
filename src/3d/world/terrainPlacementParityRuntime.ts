/**
 * Runtime-facing parity adapter for already-prepared WorldAssetPlacementPipeline results.
 *
 * The placement pipeline remains the only owner of asset hydration, material assignment,
 * grounding, manifest creation and scene attachment. This module only converts the pipeline's
 * observed surface/footprint records into the shared parity contract so environment consumers
 * can fail closed before attachment without creating a second placement system.
 */
import {
  assertTerrainPlacementParity,
  evaluateTerrainPlacementParity,
  type TerrainParityPolicy,
  type TerrainParityResult,
  type TerrainParitySample,
} from './terrainPlacementParity.ts';

export type PreparedPlacementObservation = Readonly<{
  surface?: Readonly<{
    x?: number;
    z?: number;
    height?: number;
    renderedHeight?: number;
    colliderHeight?: number;
  }> | null;
  footprint?: Readonly<{
    samples?: readonly Readonly<{
      x?: number;
      z?: number;
      height?: number;
      renderedHeight?: number;
      colliderHeight?: number;
    }>[];
    islandSamples?: readonly Readonly<{
      x?: number;
      z?: number;
      height?: number;
      renderedHeight?: number;
      colliderHeight?: number;
    }>[];
  }> | null;
}>;

function toSample(record: Readonly<Record<string, unknown>>): TerrainParitySample {
  const fallbackHeight = record.height;
  return {
    x: Number(record.x),
    z: Number(record.z),
    renderedHeight: Number(record.renderedHeight ?? fallbackHeight),
    colliderHeight: Number(record.colliderHeight ?? fallbackHeight),
  };
}

export function collectPreparedPlacementParitySamples(
  prepared: PreparedPlacementObservation | null | undefined,
): readonly TerrainParitySample[] {
  const records = [
    ...(prepared?.footprint?.samples ?? []),
    ...(prepared?.footprint?.islandSamples ?? []),
    ...(prepared?.surface ? [prepared.surface] : []),
  ];
  const deduped = new Map<string, TerrainParitySample>();
  for (const record of records) {
    const sample = toSample(record as Readonly<Record<string, unknown>>);
    const key = `${sample.x}:${sample.z}`;
    // The first pipeline observation is the canonical surface sample. Later island or
    // overlapping footprint projections must never replace it with a non-canonical value.
    if (!deduped.has(key)) deduped.set(key, sample);
  }
  return Object.freeze([...deduped.values()]);
}

export function evaluatePreparedWorldPlacementParity(
  prepared: PreparedPlacementObservation | null | undefined,
  policy: TerrainParityPolicy = {},
): TerrainParityResult {
  return evaluateTerrainPlacementParity(
    collectPreparedPlacementParitySamples(prepared),
    policy,
  );
}

export function assertPreparedWorldPlacementParity(
  prepared: PreparedPlacementObservation | null | undefined,
  policy: TerrainParityPolicy = {},
): TerrainParityResult {
  return assertTerrainPlacementParity(
    collectPreparedPlacementParitySamples(prepared),
    policy,
  );
}