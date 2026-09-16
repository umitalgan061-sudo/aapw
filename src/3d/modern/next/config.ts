import type { QualityTier } from './render.ts';

export interface NextRuntimeConfigFile {
  readonly version: 1;
  readonly simulation: { readonly hz: number; readonly maxStepsPerFrame: number; readonly maxFrameDeltaSeconds: number };
  readonly streaming: { readonly maxResourceBytes: number; readonly maxResourceEntries: number; readonly maxConcurrentLoads: number };
  readonly network: { readonly maxPayloadBytes: number; readonly maxPendingPackets: number; readonly snapshotRateHz: number };
  readonly rendering: { readonly tier: QualityTier; readonly pixelRatioCap: number; readonly maxShadowMapSize: number };
  readonly security: { readonly maxPayloadBytes: number; readonly maxArrayLength: number; readonly maxStringLength: number; readonly maxCommandsPerSecond: number };
}

export const DEFAULT_NEXT_CONFIG: NextRuntimeConfigFile = {
  version: 1,
  simulation: { hz: 60, maxStepsPerFrame: 8, maxFrameDeltaSeconds: 0.25 },
  streaming: { maxResourceBytes: 256 * 1024 * 1024, maxResourceEntries: 512, maxConcurrentLoads: 8 },
  network: { maxPayloadBytes: 128 * 1024, maxPendingPackets: 256, snapshotRateHz: 20 },
  rendering: { tier: 'high', pixelRatioCap: 2, maxShadowMapSize: 4096 },
  security: { maxPayloadBytes: 256 * 1024, maxArrayLength: 2048, maxStringLength: 4096, maxCommandsPerSecond: 120 },
};

export function resolveNextConfig(input: Partial<NextRuntimeConfigFile> = {}): NextRuntimeConfigFile {
  const simulation = { ...DEFAULT_NEXT_CONFIG.simulation, ...(input.simulation ?? {}) };
  const streaming = { ...DEFAULT_NEXT_CONFIG.streaming, ...(input.streaming ?? {}) };
  const network = { ...DEFAULT_NEXT_CONFIG.network, ...(input.network ?? {}) };
  const rendering = { ...DEFAULT_NEXT_CONFIG.rendering, ...(input.rendering ?? {}) };
  const security = { ...DEFAULT_NEXT_CONFIG.security, ...(input.security ?? {}) };
  const result: NextRuntimeConfigFile = { version: 1, simulation, streaming, network, rendering, security };
  validateNextConfig(result);
  return result;
}

export function validateNextConfig(config: NextRuntimeConfigFile): void {
  if (config.version !== 1) throw new RangeError('unsupported next runtime config version');
  if (!(config.simulation.hz >= 15 && config.simulation.hz <= 240)) throw new RangeError('simulation hz outside supported range');
  if (!(Number.isInteger(config.simulation.maxStepsPerFrame) && config.simulation.maxStepsPerFrame >= 1 && config.simulation.maxStepsPerFrame <= 32)) throw new RangeError('invalid maxStepsPerFrame');
  if (!(config.simulation.maxFrameDeltaSeconds > 0 && config.simulation.maxFrameDeltaSeconds <= 1)) throw new RangeError('invalid maxFrameDeltaSeconds');
  if (!(config.streaming.maxResourceBytes >= 16 * 1024 * 1024)) throw new RangeError('resource byte budget too small');
  if (!(Number.isInteger(config.streaming.maxResourceEntries) && config.streaming.maxResourceEntries >= 8)) throw new RangeError('resource entry budget too small');
  if (!(Number.isInteger(config.streaming.maxConcurrentLoads) && config.streaming.maxConcurrentLoads >= 1 && config.streaming.maxConcurrentLoads <= 64)) throw new RangeError('invalid concurrent load budget');
  if (!(config.network.maxPayloadBytes >= 1024 && config.network.maxPayloadBytes <= 1024 * 1024)) throw new RangeError('network payload budget outside bounds');
  if (!(Number.isInteger(config.network.maxPendingPackets) && config.network.maxPendingPackets >= 8)) throw new RangeError('pending packet budget too small');
  if (!(config.network.snapshotRateHz >= 5 && config.network.snapshotRateHz <= 120)) throw new RangeError('snapshot rate outside supported range');
  if (!(config.rendering.pixelRatioCap >= 0.75 && config.rendering.pixelRatioCap <= 3)) throw new RangeError('pixel ratio cap outside bounds');
  if (!(Number.isInteger(config.rendering.maxShadowMapSize) && config.rendering.maxShadowMapSize >= 256)) throw new RangeError('invalid shadow map size');
  if (!(config.security.maxPayloadBytes >= 4096)) throw new RangeError('security payload budget too small');
  if (!(Number.isInteger(config.security.maxArrayLength) && config.security.maxArrayLength >= 16)) throw new RangeError('invalid security array limit');
  if (!(Number.isInteger(config.security.maxStringLength) && config.security.maxStringLength >= 64)) throw new RangeError('invalid security string limit');
  if (!(Number.isInteger(config.security.maxCommandsPerSecond) && config.security.maxCommandsPerSecond >= 1)) throw new RangeError('invalid command rate limit');
}
