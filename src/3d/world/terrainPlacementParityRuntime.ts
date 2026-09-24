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
    samples?: readonly (Readonly<{
      x?: number;
      z?: number;
      height?: number;
      renderedHeight?: number;
      colliderHeight?: number;
    }> | null | undefined)[];
    islandSamples?: readonly (Readonly<{
      x?: number;
      z?: number;
      height?: number;
      renderedHeight?: number;
      colliderHeight?: number;
    }> | null | undefined)[];
  }> | null;
}>;

function toSample(record: unknown): TerrainParitySample {
  if (!record || typeof record !== 'object') {
    return null as unknown as TerrainParitySample;
  }
  const source = record as Readonly<Record<string, unknown>>;
  const fallbackHeight = source.height;
  return {
    x: Number(source.x),
    z: Number(source.z),
    renderedHeight: Number(source.renderedHeight ?? fallbackHeight),
    colliderHeight: Number(source.colliderHeight ?? fallbackHeight),
  };
}

function isFiniteSample(sample: TerrainParitySample): boolean {
  return Boolean(
    sample
      && Number.isFinite(sample.x)
      && Number.isFinite(sample.z)
      && Number.isFinite(sample.renderedHeight)
      && Number.isFinite(sample.colliderHeight),
  );
}

export function collectPreparedPlacementParitySamples(
  prepared: PreparedPlacementObservation | null | undefined,
): readonly TerrainParitySample[] {
  const records: unknown[] = [
    ...(prepared?.footprint?.samples ?? []),
    ...(prepared?.footprint?.islandSamples ?? []),
    ...(prepared?.surface ? [prepared.surface] : []),
  ];
  const deduped = new Map<string, TerrainParitySample>();
  const malformed: TerrainParitySample[] = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      malformed.push(null as unknown as TerrainParitySample);
      continue;
    }
    const sample = toSample(record);
    if (!isFiniteSample(sample)) {
      // Preserve malformed observations as explicit fail-closed samples instead of
      // collapsing all NaN coordinates into one deduplication key.
      malformed.push(null as unknown as TerrainParitySample);
      continue;
    }
    const key = `${sample.x}:${sample.z}`;
    // The first pipeline observation is the canonical surface sample. Later island or
    // overlapping footprint projections must never replace it with a non-canonical value.
    if (!deduped.has(key)) deduped.set(key, sample);
  }
  return Object.freeze([...malformed, ...deduped.values()]);
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
