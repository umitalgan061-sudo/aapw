import type { CameraState, RenderCapabilities, QualityTier, RuntimeSnapshot, FrameId } from './types';
import { platformEvents } from './eventBus';
import { modernState } from './stateStore';
import { AdaptiveQualityController } from './qualityController';
import { calculatePressure, RollingTelemetry } from './telemetry';
import { negotiateRenderCapabilities, recommendQuality, type RenderCapabilityOptions } from './capabilities';
import { FixedStepClock } from './deterministic';

export interface RuntimeServices {
  readonly capabilities: RenderCapabilities;
  readonly quality: AdaptiveQualityController;
  readonly telemetry: RollingTelemetry;
  readonly clock: FixedStepClock;
}

export interface ModernRuntimeOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly backendHint?: RenderCapabilityOptions['backendHint'];
  readonly initialQuality?: QualityTier;
  readonly maxTelemetrySamples?: number;
}

/**
 * Composition root for the TypeScript-first runtime. It does not replace the existing Three.js
 * renderer; instead it supplies typed decisions and metrics to the renderer that already exists.
 */
export async function createModernRuntime(options: ModernRuntimeOptions = {}): Promise<RuntimeServices> {
  const capabilities = await negotiateRenderCapabilities({ canvas: options.canvas, backendHint: options.backendHint });
  const initialQuality = options.initialQuality ?? recommendQuality(capabilities);
  const quality = new AdaptiveQualityController({ initial: initialQuality, min: 'minimal', max: 'ultra' });
  const telemetry = new RollingTelemetry({ maxSamples: options.maxTelemetrySamples ?? 360 });
  const clock = new FixedStepClock();

  modernState.patch({ quality: initialQuality, backend: capabilities.backend, phase: 'ready', isLoading: false, loadProgress: 1 });
  platformEvents.emit('runtime:ready', { backend: capabilities.backend });
  return { capabilities, quality, telemetry, clock };
}

export interface RuntimeFrameInput {
  readonly frame: FrameId;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly memoryPressure?: number;
  readonly thermalPressure?: number;
  readonly camera: CameraState;
}

export function tickModernRuntime(services: RuntimeServices, input: RuntimeFrameInput): RuntimeSnapshot {
  const pressure = calculatePressure({
    frameMs: input.frameMs,
    cpuMs: input.cpuMs,
    gpuMs: input.gpuMs,
    memoryPressure: input.memoryPressure ?? 0,
    thermalPressure: input.thermalPressure ?? 0,
  });
  const previous = services.quality.tier;
  const tier = services.quality.observe(pressure.combined);
  services.telemetry.push({
    frame: input.frame,
    frameMs: input.frameMs,
    cpuMs: input.cpuMs,
    gpuMs: input.gpuMs,
    drawCalls: input.drawCalls,
    triangles: input.triangles,
    visibleObjects: input.visibleObjects,
    textureBytes: input.textureBytes,
    memoryPressure: pressure.memory,
    thermalPressure: pressure.thermal,
  });
  modernState.patch({ quality: tier, fps: input.frameMs > 0 ? 1000 / input.frameMs : 0, frameMs: input.frameMs });
  if (previous !== tier) platformEvents.emit('render:quality', { previous, next: tier, reason: `pressure=${pressure.combined.toFixed(3)}` });
  platformEvents.emit('render:pressure', pressure);
  return {
    version: 1,
    timestamp: services.clock.now(),
    frame: input.frame,
    quality: tier,
    backend: services.capabilities.backend,
    pressure,
    metrics: [
      { name: 'render.scale', value: services.quality.decision.renderScale, unit: 'ratio' },
      { name: 'frame.ms', value: input.frameMs, unit: 'ms' },
      { name: 'cpu.ms', value: input.cpuMs, unit: 'ms' },
      ...(input.gpuMs === undefined ? [] : [{ name: 'gpu.ms', value: input.gpuMs, unit: 'ms' }]),
      { name: 'draw.calls', value: input.drawCalls, unit: 'count' },
      { name: 'triangles', value: input.triangles, unit: 'count' },
    ],
  };
}
