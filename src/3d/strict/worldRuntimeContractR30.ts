/** Strict TypeScript world-runtime invariants for the production map/streaming stack. */

import type { StreamPolicy } from './streamingRuntime.ts';

export interface WorldRuntimeContractInput {
  readonly farPlane: number;
  readonly maxDrawDistance: number;
  readonly worldWidthMeters: number;
  readonly worldDepthMeters: number;
  readonly chunkSizeMeters: number;
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly streamRadiusChunks: number;
  readonly waterLevelMeters: number;
  readonly streamPolicy?: StreamPolicy;
}

export interface WorldRuntimeContractReport {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly metrics: Readonly<{
    nominalGridWidthMeters: number;
    nominalGridDepthMeters: number;
    nominalGridAreaKm2: number;
    worldAreaKm2: number;
    residentRadiusChunkDiameter: number;
    streamPolicyFarRadius: number;
  }>;
}

const finitePositive = (value: number, label: string, errors: string[]): number => {
  if (!Number.isFinite(value) || value <= 0) errors.push(`${label} must be a finite number > 0`);
  return value;
};

const finiteNonNegative = (value: number, label: string, errors: string[]): number => {
  if (!Number.isFinite(value) || value < 0) errors.push(`${label} must be a finite number >= 0`);
  return value;
};

export function validateWorldRuntimeContract(input: WorldRuntimeContractInput): WorldRuntimeContractReport {
  const errors: string[] = [];
  const worldWidthMeters = finitePositive(input.worldWidthMeters, 'worldWidthMeters', errors);
  const worldDepthMeters = finitePositive(input.worldDepthMeters, 'worldDepthMeters', errors);
  const chunkSizeMeters = finitePositive(input.chunkSizeMeters, 'chunkSizeMeters', errors);
  const farPlane = finitePositive(input.farPlane, 'farPlane', errors);
  const maxDrawDistance = finitePositive(input.maxDrawDistance, 'maxDrawDistance', errors);
  const gridColumns = Math.floor(finitePositive(input.gridColumns, 'gridColumns', errors));
  const gridRows = Math.floor(finitePositive(input.gridRows, 'gridRows', errors));
  const streamRadiusChunks = finiteNonNegative(input.streamRadiusChunks, 'streamRadiusChunks', errors);
  const waterLevelMeters = Number(input.waterLevelMeters);

  if (!Number.isInteger(gridColumns) || gridColumns < 1) errors.push('gridColumns must be an integer >= 1');
  if (!Number.isInteger(gridRows) || gridRows < 1) errors.push('gridRows must be an integer >= 1');

  const nominalGridWidthMeters = chunkSizeMeters * gridColumns;
  const nominalGridDepthMeters = chunkSizeMeters * gridRows;
  const nominalGridAreaKm2 = (nominalGridWidthMeters * nominalGridDepthMeters) / 1_000_000;
  const worldAreaKm2 = (worldWidthMeters * worldDepthMeters) / 1_000_000;
  const residentRadiusChunkDiameter = streamRadiusChunks * 2 + 1;
  const streamPolicyFarRadius = input.streamPolicy?.farRadius ?? 0;

  if (farPlane < maxDrawDistance) errors.push('farPlane must cover maxDrawDistance');
  if (worldWidthMeters + 1e-6 < nominalGridWidthMeters) errors.push('worldWidthMeters is smaller than the configured chunk grid');
  if (worldDepthMeters + 1e-6 < nominalGridDepthMeters) errors.push('worldDepthMeters is smaller than the configured chunk grid');
  if (streamRadiusChunks > Math.max(gridColumns, gridRows)) errors.push('streamRadiusChunks exceeds world partition extent');
  if (!Number.isFinite(waterLevelMeters)) errors.push('waterLevelMeters must be finite');
  if (streamPolicyFarRadius > Math.max(gridColumns, gridRows)) errors.push('stream policy farRadius exceeds world partition extent');

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    metrics: Object.freeze({
      nominalGridWidthMeters,
      nominalGridDepthMeters,
      nominalGridAreaKm2: Number(nominalGridAreaKm2.toFixed(3)),
      worldAreaKm2: Number(worldAreaKm2.toFixed(3)),
      residentRadiusChunkDiameter,
      streamPolicyFarRadius,
    }),
  });
}

export function createWorldRuntimeContract(input: WorldRuntimeContractInput) {
  const report = validateWorldRuntimeContract(input);
  if (!report.ok) throw new Error(`World runtime contract invalid: ${report.errors.join('; ')}`);
  return Object.freeze({
    version: 30 as const,
    status: 'valid' as const,
    metrics: report.metrics,
  });
}
