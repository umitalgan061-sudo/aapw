import type { PerformanceSample, PressureState, QualityTier } from './types.ts';
import type { RuntimePolicyPort } from './portsR3.ts';

export interface RuntimePolicyConfigR3 {
  readonly targetFrameMs: number;
  readonly initialQuality: QualityTier;
  readonly minimumQuality: QualityTier;
  readonly maximumQuality: QualityTier;
  readonly simulationMs: number;
  readonly streamingMs: number;
  readonly workerTasks: number;
  readonly networkMs: number;
  readonly hysteresis: number;
}

export interface RuntimePolicySnapshotR3 {
  readonly quality: QualityTier;
  readonly pressure: PressureState;
  readonly simulationMs: number;
  readonly streamingMs: number;
  readonly workerTasks: number;
  readonly networkMs: number;
  readonly generation: number;
}

const TIERS: readonly QualityTier[] = ['minimal', 'balanced', 'high', 'ultra'];
const DEFAULT_CONFIG: RuntimePolicyConfigR3 = {
  targetFrameMs: 16.67,
  initialQuality: 'high',
  minimumQuality: 'minimal',
  maximumQuality: 'ultra',
  simulationMs: 8,
  streamingMs: 4,
  workerTasks: 8,
  networkMs: 2,
  hysteresis: 0.15,
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function pressureFor(sample: PerformanceSample, targetFrameMs: number): PressureState {
  const frame = clamp(sample.frameMs / Math.max(targetFrameMs, 0.1), 0, 2);
  const cpu = clamp(sample.cpuMs / Math.max(targetFrameMs * 0.75, 0.1), 0, 2);
  const gpu = clamp((sample.gpuMs ?? sample.frameMs * 0.6) / Math.max(targetFrameMs * 0.65, 0.1), 0, 2);
  const memory = clamp(sample.memoryPressure, 0, 2);
  const thermal = clamp(sample.thermalPressure, 0, 2);
  const combined = clamp(frame * 0.35 + cpu * 0.2 + gpu * 0.2 + memory * 0.15 + thermal * 0.1, 0, 2);
  return { cpu, gpu, frame, memory, thermal, combined };
}

export class AdaptiveRuntimePolicyR3 implements RuntimePolicyPort {
  readonly #config: RuntimePolicyConfigR3;
  #quality: QualityTier;
  #pressure: PressureState = { cpu: 0, gpu: 0, frame: 0, memory: 0, thermal: 0, combined: 0 };
  #generation = 0;
  #lastChange = 0;

  constructor(config: Partial<RuntimePolicyConfigR3> = {}) {
    this.#config = {
      ...DEFAULT_CONFIG,
      ...config,
      targetFrameMs: Math.max(4, config.targetFrameMs ?? DEFAULT_CONFIG.targetFrameMs),
      simulationMs: Math.max(1, config.simulationMs ?? DEFAULT_CONFIG.simulationMs),
      streamingMs: Math.max(0.5, config.streamingMs ?? DEFAULT_CONFIG.streamingMs),
      workerTasks: Math.max(1, Math.floor(config.workerTasks ?? DEFAULT_CONFIG.workerTasks)),
      networkMs: Math.max(0.25, config.networkMs ?? DEFAULT_CONFIG.networkMs),
      hysteresis: clamp(config.hysteresis ?? DEFAULT_CONFIG.hysteresis, 0.01, 0.5),
    };
    this.#quality = this.#config.initialQuality;
  }

  observe(sample: PerformanceSample): RuntimePolicySnapshotR3 {
    this.#pressure = pressureFor(sample, this.#config.targetFrameMs);
    const cooldown = sample.frame as unknown as number;
    const canChange = cooldown - this.#lastChange >= 8;
    if (canChange && this.#pressure.combined > 1 + this.#config.hysteresis) this.#stepDown();
    else if (canChange && this.#pressure.combined < 0.58 - this.#config.hysteresis) this.#stepUp();
    return this.snapshot();
  }

  qualityTier(): QualityTier { return this.#quality; }

  maxSimulationMs(): number {
    return this.#config.simulationMs * (this.#quality === 'minimal' ? 0.75 : this.#quality === 'ultra' ? 1.1 : 1);
  }

  maxStreamingMs(): number {
    return this.#config.streamingMs * (this.#quality === 'minimal' ? 0.5 : this.#quality === 'ultra' ? 1.25 : 1);
  }

  maxWorkerTasks(): number {
    return Math.max(1, Math.floor(this.#config.workerTasks * (this.#quality === 'minimal' ? 0.5 : this.#quality === 'ultra' ? 1.5 : 1)));
  }

  shouldThrottle(domain: 'simulation' | 'rendering' | 'streaming' | 'network'): boolean {
    const p = this.#pressure.combined;
    const thresholds = { simulation: 1.25, rendering: 0.95, streaming: 1.05, network: 1.45 };
    return p >= thresholds[domain];
  }

  pressure(): PressureState { return { ...this.#pressure }; }

  snapshot(): RuntimePolicySnapshotR3 {
    return {
      quality: this.#quality,
      pressure: { ...this.#pressure },
      simulationMs: this.maxSimulationMs(),
      streamingMs: this.maxStreamingMs(),
      workerTasks: this.maxWorkerTasks(),
      networkMs: this.#config.networkMs,
      generation: this.#generation,
    };
  }

  forceQuality(quality: QualityTier): void {
    const current = TIERS.indexOf(this.#quality);
    const next = TIERS.indexOf(quality);
    const minimum = TIERS.indexOf(this.#config.minimumQuality);
    const maximum = TIERS.indexOf(this.#config.maximumQuality);
    const clamped = TIERS[Math.min(maximum, Math.max(minimum, next))] ?? this.#quality;
    if (clamped === this.#quality || current < 0) return;
    this.#quality = clamped;
    this.#generation += 1;
  }

  #stepDown(): void {
    const index = TIERS.indexOf(this.#quality);
    const minimum = TIERS.indexOf(this.#config.minimumQuality);
    if (index <= minimum) return;
    this.#quality = TIERS[index - 1] ?? this.#quality;
    this.#generation += 1;
    this.#lastChange = this.#generation;
  }

  #stepUp(): void {
    const index = TIERS.indexOf(this.#quality);
    const maximum = TIERS.indexOf(this.#config.maximumQuality);
    if (index < 0 || index >= maximum) return;
    this.#quality = TIERS[index + 1] ?? this.#quality;
    this.#generation += 1;
    this.#lastChange = this.#generation;
  }
}
