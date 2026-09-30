import type { AssetPipelineR26 } from './assetPipeline.ts';
import type { NetworkSessionR26 } from './networkTransport.ts';
import type { RenderPipelineR26 } from './renderPipeline.ts';
import type { SimulationKernelR26 } from './simulationKernel.ts';

export type RuntimeModeR26 =
  | 'boot'
  | 'running'
  | 'degraded'
  | 'paused'
  | 'recovering'
  | 'stopped'
  | 'failed';

export interface RuntimeControlPolicyR26 {
  readonly targetFrameMs: number;
  readonly degradeAfterFrames: number;
  readonly recoverAfterFrames: number;
  readonly maxConsecutiveFailures: number;
  readonly qualityFloor: number;
  readonly qualityCeiling: number;
}

export interface RuntimeControlObservationR26 {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly gpuMs: number;
  readonly memoryBytes: number;
  readonly networkBytesPerSecond: number;
  readonly failedTasks: number;
  readonly renderHazards: number;
}

export interface RuntimeControlDecisionR26 {
  readonly mode: RuntimeModeR26;
  readonly qualityScale: number;
  readonly shouldEvictAssets: boolean;
  readonly shouldSkipBackground: boolean;
  readonly shouldRecoverRenderer: boolean;
  readonly reasons: readonly string[];
}

export interface RuntimeControlSnapshotR26 {
  readonly frame: number;
  readonly mode: RuntimeModeR26;
  readonly qualityScale: number;
  readonly overloadFrames: number;
  readonly healthyFrames: number;
  readonly failureStreak: number;
  readonly decision: RuntimeControlDecisionR26;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const safe = (value: number): number =>
  Number.isFinite(value) ? value : 0;

export class RuntimeControlPlaneR26 {
  readonly #simulation: SimulationKernelR26;
  readonly #renderer: RenderPipelineR26;
  readonly #assets: AssetPipelineR26;
  readonly #network: NetworkSessionR26<unknown>;
  readonly #policy: RuntimeControlPolicyR26;

  #mode: RuntimeModeR26 = 'boot';
  #qualityScale = 1;
  #overloadFrames = 0;
  #healthyFrames = 0;
  #failureStreak = 0;
  #frame = 0;

  constructor(options: {
    simulation: SimulationKernelR26;
    renderer: RenderPipelineR26;
    assets: AssetPipelineR26;
    network: NetworkSessionR26<unknown>;
    policy?: Partial<RuntimeControlPolicyR26>;
  }) {
    this.#simulation = options.simulation;
    this.#renderer = options.renderer;
    this.#assets = options.assets;
    this.#network = options.network;
    this.#policy = Object.freeze({
      targetFrameMs: Math.max(4, safe(options.policy?.targetFrameMs) || 16.67),
      degradeAfterFrames: Math.max(1, Math.floor(options.policy?.degradeAfterFrames ?? 8)),
      recoverAfterFrames: Math.max(1, Math.floor(options.policy?.recoverAfterFrames ?? 30)),
      maxConsecutiveFailures: Math.max(1, Math.floor(options.policy?.maxConsecutiveFailures ?? 3)),
      qualityFloor: clamp(options.policy?.qualityFloor ?? 0.5, 0.1, 1),
      qualityCeiling: clamp(options.policy?.qualityCeiling ?? 1, 0.1, 1),
    });
  }

  start(): void {
    if (this.#mode === 'boot' || this.#mode === 'stopped') {
      this.#mode = 'running';
      this.#qualityScale = this.#policy.qualityCeiling;
      this.#failureStreak = 0;
    }
  }

  pause(): void {
    if (this.#mode === 'running' || this.#mode === 'degraded') this.#mode = 'paused';
  }

  resume(): void {
    if (this.#mode === 'paused') this.#mode = 'running';
  }

  stop(): void {
    this.#mode = 'stopped';
  }

  fail(): void {
    this.#failureStreak += 1;
    this.#mode = this.#failureStreak >= this.#policy.maxConsecutiveFailures ? 'failed' : 'recovering';
  }

  observe(observation: RuntimeControlObservationR26): RuntimeControlDecisionR26 {
    this.#frame += 1;
    const reasons: string[] = [];
    const framePressure = safe(observation.frameMs) / this.#policy.targetFrameMs;
    const simulationPressure = safe(observation.simulationMs) / Math.max(1, this.#policy.targetFrameMs * 0.7);
    const renderPressure = safe(observation.gpuMs) / Math.max(1, this.#policy.targetFrameMs * 0.8);
    const hazardPressure = Math.min(1, Math.max(0, observation.renderHazards / 4));
    const memoryPressure = Math.min(1.5, Math.max(0, observation.memoryBytes / (768 * 1024 * 1024)));
    const failurePressure = Math.min(1, Math.max(0, observation.failedTasks / 4));

    const pressure = framePressure * 0.32 +
      simulationPressure * 0.2 +
      renderPressure * 0.2 +
      memoryPressure * 0.12 +
      hazardPressure * 0.08 +
      failurePressure * 0.08;

    if (pressure >= 1) {
      this.#overloadFrames += 1;
      this.#healthyFrames = 0;
    } else if (pressure <= 0.78) {
      this.#healthyFrames += 1;
      this.#overloadFrames = 0;
    } else {
      this.#overloadFrames = Math.max(0, this.#overloadFrames - 1);
      this.#healthyFrames = Math.max(0, this.#healthyFrames - 1);
    }

    if (this.#overloadFrames >= this.#policy.degradeAfterFrames) {
      this.#mode = this.#mode === 'paused' ? 'paused' : 'degraded';
      this.#qualityScale = clamp(
        this.#qualityScale - 0.05,
        this.#policy.qualityFloor,
        this.#policy.qualityCeiling,
      );
      reasons.push('sustained-frame-pressure');
    }

    if (this.#healthyFrames >= this.#policy.recoverAfterFrames && this.#mode === 'degraded') {
      this.#qualityScale = clamp(
        this.#qualityScale + 0.025,
        this.#policy.qualityFloor,
        this.#policy.qualityCeiling,
      );
      if (this.#qualityScale >= this.#policy.qualityCeiling - 0.001) this.#mode = 'running';
      reasons.push('sustained-headroom');
    }

    if (simulationPressure > 1) reasons.push('simulation-budget');
    if (renderPressure > 1) reasons.push('gpu-budget');
    if (memoryPressure > 0.85) reasons.push('memory-pressure');
    if (observation.renderHazards > 0) reasons.push('render-hazards');
    if (observation.failedTasks > 0) reasons.push('task-failure');
    if (observation.networkBytesPerSecond > 450 * 1024) reasons.push('network-pressure');

    return Object.freeze({
      mode: this.#mode,
      qualityScale: this.#qualityScale,
      shouldEvictAssets: memoryPressure > 0.85,
      shouldSkipBackground: this.#qualityScale < 0.78 || simulationPressure > 1,
      shouldRecoverRenderer: observation.renderHazards > 0 || this.#failureStreak > 0,
      reasons: Object.freeze([...new Set(reasons)]),
    });
  }

  tick(nowMs: number): RuntimeControlDecisionR26 {
    const simulation = this.#simulation.getMetric('r26.simulation.ms');
    const frame = this.#simulation.getMetric('r26.frame.ms');
    const failedTasks = this.#simulation
      .snapshot()
      .events
      .filter((event) => event.type === 'simulation.task.failed')
      .length;
    const plan = this.#renderer.lastPlan();
    const network = this.#network.stats(nowMs);
    const memory = this.#assets.snapshot().residentBytes;

    return this.observe({
      frameMs: frame,
      simulationMs: simulation,
      gpuMs: plan?.gpuEstimateMs ?? 0,
      memoryBytes: memory,
      networkBytesPerSecond: network.bytesPerSecond,
      failedTasks,
      renderHazards: plan?.hazards.length ?? 0,
    });
  }

  snapshot(decision?: RuntimeControlDecisionR26): RuntimeControlSnapshotR26 {
    const current = decision ?? this.tick(0);
    return Object.freeze({
      frame: this.#frame,
      mode: this.#mode,
      qualityScale: this.#qualityScale,
      overloadFrames: this.#overloadFrames,
      healthyFrames: this.#healthyFrames,
      failureStreak: this.#failureStreak,
      decision: current,
    });
  }

  reset(): void {
    this.#mode = 'boot';
    this.#qualityScale = 1;
    this.#overloadFrames = 0;
    this.#healthyFrames = 0;
    this.#failureStreak = 0;
    this.#frame = 0;
  }
}
