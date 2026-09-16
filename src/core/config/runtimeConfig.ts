import { clamp, freeze, type Result, err, ok } from '../domain/contracts.ts';

export interface RuntimeConfig {
  readonly version: 1;
  readonly environment: 'development' | 'staging' | 'production';
  readonly render: {
    readonly targetFps: number;
    readonly maxFrameMs: number;
    readonly minResolutionScale: number;
    readonly maxResolutionScale: number;
    readonly maxDrawCalls: number;
    readonly maxVisibleEntities: number;
  };
  readonly simulation: {
    readonly fixedStepMs: number;
    readonly maxCatchUpSteps: number;
    readonly maxDeltaMs: number;
  };
  readonly network: {
    readonly enabled: boolean;
    readonly maxRequestsPerSecond: number;
    readonly maxPayloadBytes: number;
    readonly requestTimeoutMs: number;
  };
  readonly storage: {
    readonly schema: number;
    readonly quotaBytes: number;
    readonly autosaveMs: number;
  };
  readonly telemetry: {
    readonly enabled: boolean;
    readonly sampleRate: number;
    readonly maxBuffer: number;
  };
}

export const defaultRuntimeConfig: RuntimeConfig = freeze({
  version: 1,
  environment: 'production',
  render: { targetFps: 60, maxFrameMs: 33.3, minResolutionScale: 0.5, maxResolutionScale: 1, maxDrawCalls: 12_000, maxVisibleEntities: 20_000 },
  simulation: { fixedStepMs: 1000 / 60, maxCatchUpSteps: 4, maxDeltaMs: 200 },
  network: { enabled: true, maxRequestsPerSecond: 30, maxPayloadBytes: 256 * 1024, requestTimeoutMs: 5000 },
  storage: { schema: 2, quotaBytes: 64 * 1024 * 1024, autosaveMs: 30_000 },
  telemetry: { enabled: true, sampleRate: 0.1, maxBuffer: 8192 },
});

export const mergeRuntimeConfig = (input: Partial<RuntimeConfig> = {}): RuntimeConfig => freeze({
  version: 1,
  environment: input.environment ?? defaultRuntimeConfig.environment,
  render: freeze({ ...defaultRuntimeConfig.render, ...(input.render ?? {}), targetFps: clamp(input.render?.targetFps ?? defaultRuntimeConfig.render.targetFps, 30, 240), minResolutionScale: clamp(input.render?.minResolutionScale ?? defaultRuntimeConfig.render.minResolutionScale, 0.25, 1), maxResolutionScale: clamp(input.render?.maxResolutionScale ?? defaultRuntimeConfig.render.maxResolutionScale, 0.25, 1) }),
  simulation: freeze({ ...defaultRuntimeConfig.simulation, ...(input.simulation ?? {}), fixedStepMs: clamp(input.simulation?.fixedStepMs ?? defaultRuntimeConfig.simulation.fixedStepMs, 4, 100), maxCatchUpSteps: Math.floor(clamp(input.simulation?.maxCatchUpSteps ?? defaultRuntimeConfig.simulation.maxCatchUpSteps, 1, 12)), maxDeltaMs: clamp(input.simulation?.maxDeltaMs ?? defaultRuntimeConfig.simulation.maxDeltaMs, 16, 1000) }),
  network: freeze({ ...defaultRuntimeConfig.network, ...(input.network ?? {}), maxRequestsPerSecond: Math.floor(clamp(input.network?.maxRequestsPerSecond ?? defaultRuntimeConfig.network.maxRequestsPerSecond, 1, 120)), maxPayloadBytes: Math.floor(clamp(input.network?.maxPayloadBytes ?? defaultRuntimeConfig.network.maxPayloadBytes, 1024, 2 * 1024 * 1024)), requestTimeoutMs: Math.floor(clamp(input.network?.requestTimeoutMs ?? defaultRuntimeConfig.network.requestTimeoutMs, 100, 30_000)) }),
  storage: freeze({ ...defaultRuntimeConfig.storage, ...(input.storage ?? {}), schema: Math.floor(clamp(input.storage?.schema ?? defaultRuntimeConfig.storage.schema, 1, 100)), quotaBytes: Math.floor(clamp(input.storage?.quotaBytes ?? defaultRuntimeConfig.storage.quotaBytes, 1 * 1024 * 1024, 512 * 1024 * 1024)), autosaveMs: Math.floor(clamp(input.storage?.autosaveMs ?? defaultRuntimeConfig.storage.autosaveMs, 5_000, 300_000)) }),
  telemetry: freeze({ ...defaultRuntimeConfig.telemetry, ...(input.telemetry ?? {}), sampleRate: clamp(input.telemetry?.sampleRate ?? defaultRuntimeConfig.telemetry.sampleRate, 0, 1), maxBuffer: Math.floor(clamp(input.telemetry?.maxBuffer ?? defaultRuntimeConfig.telemetry.maxBuffer, 64, 100_000)) }),
});

export const validateRuntimeConfig = (config: RuntimeConfig): Result<RuntimeConfig> => {
  const failures: string[] = [];
  if (config.render.minResolutionScale > config.render.maxResolutionScale) failures.push('render resolution bounds are inverted');
  if (config.render.targetFps <= 0) failures.push('targetFps must be positive');
  if (config.render.maxFrameMs < 8) failures.push('maxFrameMs is below safe minimum');
  if (config.simulation.maxCatchUpSteps < 1) failures.push('maxCatchUpSteps must be positive');
  if (config.network.maxRequestsPerSecond < 1) failures.push('network rate must be positive');
  if (config.storage.quotaBytes < 1_048_576) failures.push('storage quota too small');
  return failures.length ? err({ code: 'CONFIG_INVALID', message: failures.join('; ') }) : ok(config);
};

export const detectEnvironment = (): RuntimeConfig['environment'] => {
  if (typeof location === 'undefined') return 'production';
  if (/localhost|127\.0\.0\.1|\.local$/i.test(location.hostname)) return 'development';
  if (/staging|preview/i.test(location.hostname)) return 'staging';
  return 'production';
};
