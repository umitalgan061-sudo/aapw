import { evaluateTerrainPlacementParity, type TerrainParityPolicy, type TerrainParityResult, type TerrainParitySample } from './terrainPlacementParity.ts';

export type PreparedPlacementObservation = Readonly<{ surface?: Readonly<{ x?: number; z?: number; height?: number; renderedHeight?: number; colliderHeight?: number }> | null; footprint?: Readonly<{ samples?: readonly (Readonly<{ x?: number; z?: number; height?: number; renderedHeight?: number; colliderHeight?: number }> | null | undefined)[]; islandSamples?: readonly (Readonly<{ x?: number; z?: number; height?: number; renderedHeight?: number; colliderHeight?: number }> | null | undefined)[] }> | null }>;

function toSample(record: unknown): TerrainParitySample {
  if (!record || typeof record !== 'object') return null as unknown as TerrainParitySample;
  try {
    const source = record as Readonly<Record<string, unknown>>;
    const fallbackHeight = source.height;
    return { x: Number(source.x), z: Number(source.z), renderedHeight: Number(source.renderedHeight ?? fallbackHeight), colliderHeight: Number(source.colliderHeight ?? fallbackHeight) };
  } catch { return null as unknown as TerrainParitySample; }
}

function isFiniteSample(sample: TerrainParitySample): boolean {
  return Boolean(sample && Number.isFinite(sample.x) && Number.isFinite(sample.z) && Number.isFinite(sample.renderedHeight) && Number.isFinite(sample.colliderHeight));
}

export function collectPreparedPlacementParitySamples(prepared: PreparedPlacementObservation | null | undefined): readonly TerrainParitySample[] {
  const records: unknown[] = [...(prepared?.footprint?.samples ?? []), ...(prepared?.footprint?.islandSamples ?? []), ...(prepared?.surface ? [prepared.surface] : [])];
  const deduped = new Map<string, TerrainParitySample>();
  const malformed: TerrainParitySample[] = [];
  for (const record of records) {
    const sample = toSample(record);
    if (!isFiniteSample(sample)) { malformed.push(null as unknown as TerrainParitySample); continue; }
    const key = `${sample.x}:${sample.z}`;
    if (!deduped.has(key)) deduped.set(key, sample);
  }
  return Object.freeze([...malformed, ...deduped.values()]);
}

function withMalformedPreparedPlacementFailure(samples: readonly TerrainParitySample[], result: TerrainParityResult): TerrainParityResult {
  if (!samples.some((sample) => sample === null)) return result;
  const failures = result.failures.filter((failure) => failure !== 'invalid-sample');
  failures.unshift('malformed-sample');
  return Object.freeze({ ...result, ok: false, failures: Object.freeze([...new Set(failures)]) });
}

export function evaluatePreparedWorldPlacementParity(prepared: PreparedPlacementObservation | null | undefined, policy: TerrainParityPolicy = {}): TerrainParityResult {
  const samples = collectPreparedPlacementParitySamples(prepared);
  return withMalformedPreparedPlacementFailure(samples, evaluateTerrainPlacementParity(samples, policy));
}

export function assertPreparedWorldPlacementParity(prepared: PreparedPlacementObservation | null | undefined, policy: TerrainParityPolicy = {}): TerrainParityResult {
  const result = evaluatePreparedWorldPlacementParity(prepared, policy);
  if (!result.ok) throw new Error(`Prepared world placement rejected: ${result.failures.join(',')}`);
  return result;
}
