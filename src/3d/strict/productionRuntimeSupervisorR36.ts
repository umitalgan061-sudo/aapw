import {
  RuntimeCircuitBreakerR12,
  type RuntimeCircuitSnapshot,
} from './runtimeCircuitBreakerR12.ts';
import {
  RuntimeHardeningSupervisorV25,
  type HardeningDecision,
  type HardeningSnapshot,
} from './runtimeHardeningV25.ts';
import {
  RuntimeWatchdogR33,
  type RuntimeWatchdogSnapshot,
  type RuntimeWatchdogState,
} from './runtimeWatchdogR33.ts';
import {
  StrictRenderBackendRuntime,
  buildStrictRenderPolicy,
  probeRenderCapabilities,
  type CapabilityProbe,
  type RendererPreference,
} from './renderBackendRuntime.ts';
import type { QualityTier, RenderPolicy, RenderCapabilities } from './liveCoreTypes.ts';

export type ProductionRuntimeHealthState =
  | 'nominal'
  | 'throttled'
  | 'critical'
  | 'recovering'
  | 'circuit-open'
  | 'disposed';

export interface ProductionRuntimeSupervisorPolicy {
  readonly degradeAfterScore: number;
  readonly criticalAfterScore: number;
  readonly recoverAfterFrames: number;
  readonly emergencyQuality: QualityTier;
  readonly defaultPreference: RendererPreference;
  readonly watchdogFrameBudgetMs?: number;
  readonly watchdogCriticalFrameBudgetMs?: number;
}

export interface ProductionRuntimeFrameObservation {
  readonly frame: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly pressure: number;
  readonly drawCalls?: number;
  readonly triangles?: number;
  readonly memoryPressure?: number;
  readonly hardeningState?: string;
}

export interface ProductionRuntimeDecision {
  readonly state: ProductionRuntimeHealthState;
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly backend: string;
  readonly throttleFactor: number;
  readonly watchdog: RuntimeWatchdogSnapshot;
  readonly hardening: HardeningDecision;
  readonly circuit: RuntimeCircuitSnapshot;
  readonly recoveryReady: boolean;
  readonly reason: string;
  readonly digest: string;
}

export interface ProductionRuntimeSnapshot extends ProductionRuntimeDecision {
  readonly version: 36;
  readonly generation: number;
  readonly capabilities: RenderCapabilities;
  readonly policy: RenderPolicy;
  readonly hardeningSnapshot: HardeningSnapshot;
}

const DEFAULT_POLICY: ProductionRuntimeSupervisorPolicy = Object.freeze({
  degradeAfterScore: 0.58,
  criticalAfterScore: 0.86,
  recoverAfterFrames: 12,
  emergencyQuality: 'low',
  defaultPreference: Object.freeze({ backend: 'auto', quality: 'auto' }),
  watchdogFrameBudgetMs: 16.67,
  watchdogCriticalFrameBudgetMs: 33.34,
});

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function qualityRank(quality: QualityTier): number {
  return quality === 'minimal' ? 0 : quality === 'low' ? 1 : quality === 'medium' ? 2 : quality === 'high' ? 3 : 4;
}

function lowerQuality(quality: QualityTier, steps: number): QualityTier {
  const order: readonly QualityTier[] = ['minimal', 'low', 'medium', 'high', 'ultra'];
  return order[Math.max(0, qualityRank(quality) - Math.max(0, Math.trunc(steps)))] ?? 'minimal';
}

export class ProductionRuntimeSupervisorR36 {
  readonly hardening: RuntimeHardeningSupervisorV25;
  readonly watchdog: RuntimeWatchdogR33;
  readonly circuit: RuntimeCircuitBreakerR12;
  readonly renderer: StrictRenderBackendRuntime;

  #policy: ProductionRuntimeSupervisorPolicy;
  #basePreference: RendererPreference;
  #generation = 0;
  #disposed = false;
  #lastDecision: ProductionRuntimeDecision | null = null;
  #healthyFrames = 0;

  constructor(
    capabilityProbe: CapabilityProbe = {},
    policy: Partial<ProductionRuntimeSupervisorPolicy> = {},
  ) {
    this.#policy = Object.freeze({ ...DEFAULT_POLICY, ...policy });
    this.#basePreference = this.#policy.defaultPreference;
    const capabilities = probeRenderCapabilities(capabilityProbe);
    this.renderer = new StrictRenderBackendRuntime(capabilities, this.#basePreference);
    this.hardening = new RuntimeHardeningSupervisorV25();
    this.watchdog = new RuntimeWatchdogR33({
      ...(this.#policy.watchdogFrameBudgetMs !== undefined
        ? { frameBudgetMs: this.#policy.watchdogFrameBudgetMs }
        : {}),
      ...(this.#policy.watchdogCriticalFrameBudgetMs !== undefined
        ? { criticalFrameBudgetMs: this.#policy.watchdogCriticalFrameBudgetMs }
        : {}),
    });
    this.circuit = new RuntimeCircuitBreakerR12();
  }

  get capabilities(): RenderCapabilities {
    return this.renderer.capabilities();
  }

  get policy(): ProductionRuntimeSupervisorPolicy {
    return this.#policy;
  }

  observe(frame: ProductionRuntimeFrameObservation): ProductionRuntimeDecision {
    if (this.#disposed) return this.snapshot().lastDecision;

    if (!this.circuit.canExecute()) {
      const circuit = this.circuit.snapshot();
      const hardening = this.hardening.snapshot();
      const watchdog = this.watchdog.snapshot();
      const decision = this.#makeDecision('circuit-open', this.renderer.policy().tier, this.renderer.policy(), watchdog, hardening, circuit, false, 'circuit-open');
      this.#lastDecision = decision;
      return decision;
    }

    const hardening = this.hardening.observeFrame({
      frameMs: Math.max(0, frame.frameMs),
      cpuMs: Math.max(0, frame.cpuMs),
      gpuMs: Math.max(0, frame.gpuMs ?? 0),
      drawCalls: Math.max(0, frame.drawCalls ?? 0),
      triangles: Math.max(0, frame.triangles ?? 0),
      memoryPressure: clamp01(frame.memoryPressure ?? frame.pressure),
      entityPressure: 0,
      assetBacklog: 0,
      networkJitterMs: 0,
    });
    const watchdog = this.watchdog.observe({
      frame: frame.frame,
      frameMs: frame.frameMs,
      cpuMs: frame.cpuMs,
      gpuMs: frame.gpuMs ?? 0,
      pressure: frame.pressure,
      hardeningState: hardening.state,
    });

    if (watchdog.state === 'critical' || watchdog.score >= this.#policy.criticalAfterScore || hardening.state === 'critical') {
      this.#generation += 1;
      this.#healthyFrames = 0;
      const emergency = lowerQuality(this.renderer.policy().tier, 2);
      const policy = this.renderer.requestPreference(Object.freeze({
        ...this.#basePreference,
        quality: emergency,
      }));
      const decision = this.#makeDecision('critical', emergency, policy, watchdog, hardening, this.circuit.snapshot(), false, 'critical-pressure');
      this.circuit.recordFailure('runtime.frame', new Error('Critical runtime pressure.'));
      this.#lastDecision = decision;
      return decision;
    }

    if (watchdog.state === 'degraded' || watchdog.score >= this.#policy.degradeAfterScore || hardening.state === 'throttled') {
      this.#healthyFrames = 0;
      const nextQuality = lowerQuality(this.renderer.policy().tier, 1);
      const policy = this.renderer.requestPreference(Object.freeze({
        ...this.#basePreference,
        quality: nextQuality,
      }));
      const decision = this.#makeDecision('throttled', nextQuality, policy, watchdog, hardening, this.circuit.snapshot(), false, 'adaptive-throttle');
      this.circuit.recordSuccess('runtime.frame');
      this.#lastDecision = decision;
      return decision;
    }

    this.#healthyFrames += 1;
    let policy = this.renderer.policy();
    if (this.#healthyFrames >= this.#policy.recoverAfterFrames && policy.tier !== this.#basePreference.quality && this.#basePreference.quality !== 'auto') {
      policy = this.renderer.requestPreference(this.#basePreference);
      this.#healthyFrames = 0;
      this.#generation += 1;
    }

    this.circuit.recordSuccess('runtime.frame');
    const decision = this.#makeDecision(
      watchdog.state === 'recovering' ? 'recovering' : 'nominal',
      policy.tier,
      policy,
      watchdog,
      hardening,
      this.circuit.snapshot(),
      true,
      watchdog.state === 'recovering' ? 'recovery-window' : 'nominal',
    );
    this.#lastDecision = decision;
    return decision;
  }

  markDeviceLost(): ProductionRuntimeDecision {
    if (this.#disposed) return this.snapshot().lastDecision;
    this.#generation += 1;
    const policy = this.renderer.markDeviceLost();
    const watchdog = this.watchdog.observe({
      frame: 0,
      frameMs: policy.backend === 'headless' ? 50 : 0,
      cpuMs: 0,
      gpuMs: 0,
      pressure: policy.backend === 'headless' ? 1 : 0,
      hardeningState: 'throttled',
    });
    this.circuit.recordFailure('renderer.device-lost', new Error('Renderer device lost.'));
    this.hardening.recordFailure('renderer.device-lost', new Error('Renderer device lost.'));
    const decision = this.#makeDecision('throttled', policy.tier, policy, watchdog, this.hardening.snapshot(), this.circuit.snapshot(), false, 'device-lost');
    this.#lastDecision = decision;
    return decision;
  }

  refreshCapabilities(probe: CapabilityProbe): ProductionRuntimeDecision {
    if (this.#disposed) return this.snapshot().lastDecision;
    const capabilities = probeRenderCapabilities(probe);
    const policy = this.renderer.refreshCapabilities(capabilities);
    this.#generation += 1;
    const decision = this.#makeDecision('recovering', policy.tier, policy, this.watchdog.snapshot(), this.hardening.snapshot(), this.circuit.snapshot(), true, 'capabilities-refreshed');
    this.#lastDecision = decision;
    return decision;
  }

  forceQuality(quality: QualityTier, reason = 'manual'): ProductionRuntimeDecision {
    if (this.#disposed) return this.snapshot().lastDecision;
    const policy = this.renderer.requestPreference(Object.freeze({ ...this.#basePreference, quality }));
    this.#generation += 1;
    const decision = this.#makeDecision(
      quality === 'minimal' || quality === 'low' ? 'throttled' : 'nominal',
      quality,
      policy,
      this.watchdog.snapshot(),
      this.hardening.snapshot(),
      this.circuit.snapshot(),
      true,
      reason,
    );
    this.#lastDecision = decision;
    return decision;
  }

  reset(): ProductionRuntimeDecision {
    if (this.#disposed) return this.snapshot().lastDecision;
    this.hardening.reset();
    this.watchdog.dispose();
    this.circuit.reset();
    this.#generation += 1;
    this.#healthyFrames = 0;
    const policy = this.renderer.requestPreference(this.#basePreference);
    const decision = this.#makeDecision('nominal', policy.tier, policy, this.watchdog.snapshot(), this.hardening.snapshot(), this.circuit.snapshot(), true, 'reset');
    this.#lastDecision = decision;
    return decision;
  }

  snapshot(): ProductionRuntimeSnapshot {
    if (this.#lastDecision) {
      return Object.freeze({
        version: 36,
        generation: this.#generation,
        capabilities: this.renderer.capabilities(),
        policy: this.renderer.policy(),
        hardeningSnapshot: this.hardening.snapshot(),
        ...this.#lastDecision,
      });
    }
    const policy = this.renderer.policy();
    const decision = this.#makeDecision('nominal', policy.tier, policy, this.watchdog.snapshot(), this.hardening.snapshot(), this.circuit.snapshot(), true, 'uninitialized');
    this.#lastDecision = decision;
    return Object.freeze({
      version: 36,
      generation: this.#generation,
      capabilities: this.renderer.capabilities(),
      policy,
      hardeningSnapshot: this.hardening.snapshot(),
      ...decision,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.hardening.dispose();
    this.watchdog.dispose();
    this.circuit.dispose();
    this.renderer.dispose();
    this.#generation += 1;
    this.#lastDecision = null;
  }

  #makeDecision(
    state: ProductionRuntimeHealthState,
    quality: QualityTier,
    policy: RenderPolicy,
    watchdog: RuntimeWatchdogSnapshot,
    hardening: HardeningDecision | HardeningSnapshot,
    circuit: RuntimeCircuitSnapshot,
    recoveryReady: boolean,
    reason: string,
  ): ProductionRuntimeDecision {
    const throttleFactor = 'throttleFactor' in hardening ? hardening.throttleFactor : 1;
    const digest = JSON.stringify({
      version: 36,
      generation: this.#generation,
      state,
      quality,
      backend: policy.backend,
      renderScale: Number(policy.renderScale.toFixed(4)),
      watchdog: watchdog.state,
      circuit: circuit.state,
      reason,
    });
    return Object.freeze({
      state,
      quality,
      renderScale: policy.renderScale,
      backend: policy.backend,
      throttleFactor,
      watchdog,
      hardening: 'state' in hardening && 'reason' in hardening
        ? hardening as HardeningDecision
        : Object.freeze({
          state: hardening.state,
          health: null,
          throttleFactor,
          failureCount: hardening.failureCount,
          retrySuggested: hardening.state !== 'nominal',
          reason,
        }),
      circuit,
      recoveryReady,
      reason,
      digest,
    });
  }
}

export const PRODUCTION_RUNTIME_SUPERVISOR_POLICY_R36 = DEFAULT_POLICY;
