import type { PlatformError, RenderBackend, Result } from './types';
import { clamp01, hash32, sample01 } from './deterministic';
import { Diagnostics } from './diagnostics';
import { TypedEventBus } from './eventBus';

export type RecoveryStage = 'healthy' | 'degraded' | 'reconnecting' | 'reinitializing' | 'fallback' | 'failed';

export interface RecoveryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
  readonly failureWindowMs: number;
  readonly healthyFramesToReset: number;
}

export interface RecoveryState {
  readonly stage: RecoveryStage;
  readonly attempts: number;
  readonly consecutiveHealthyFrames: number;
  readonly lastFailureAt: number;
  readonly nextRetryAt: number;
  readonly backend: RenderBackend;
  readonly reason: string | null;
}

export interface RecoveryEvents {
  readonly 'recovery:stage': { readonly previous: RecoveryStage; readonly next: RecoveryStage; readonly reason: string };
  readonly 'recovery:retry': { readonly attempt: number; readonly delayMs: number; readonly backend: RenderBackend };
  readonly 'recovery:fallback': { readonly from: RenderBackend; readonly to: RenderBackend; readonly reason: string };
  readonly 'recovery:failed': PlatformError;
}

const DEFAULT_POLICY: RecoveryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.15,
  failureWindowMs: 30_000,
  healthyFramesToReset: 180,
};

function exponentialBackoff(policy: RecoveryPolicy, attempt: number, seed: number): number {
  const exponent = Math.max(0, Math.min(12, attempt - 1));
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const noise = (sample01(seed, attempt) - 0.5) * 2 * policy.jitterRatio;
  return Math.max(0, Math.min(policy.maxDelayMs, base * (1 + noise)));
}

/**
 * Device-loss/context-reset recovery coordinator. It deliberately does not recreate Three.js
 * objects; it emits bounded, deterministic decisions that the renderer adapter can enact.
 */
export class RecoveryController {
  readonly policy: RecoveryPolicy;
  readonly diagnostics: Diagnostics;
  readonly events = new TypedEventBus<RecoveryEvents>({ maxListeners: 128 });

  #stage: RecoveryStage = 'healthy';
  #attempts = 0;
  #healthyFrames = 0;
  #lastFailureAt = 0;
  #nextRetryAt = 0;
  #backend: RenderBackend;
  #reason: string | null = null;
  #seed: number;

  constructor(options: {
    readonly backend?: RenderBackend;
    readonly seed?: number;
    readonly policy?: Partial<RecoveryPolicy>;
    readonly diagnostics?: Diagnostics;
  } = {}) {
    this.policy = Object.freeze({ ...DEFAULT_POLICY, ...options.policy });
    this.#backend = options.backend ?? 'webgpu';
    this.#seed = options.seed ?? 0x41575057;
    this.diagnostics = options.diagnostics ?? new Diagnostics();
    this.#validatePolicy();
  }

  state(): RecoveryState {
    return Object.freeze({
      stage: this.#stage,
      attempts: this.#attempts,
      consecutiveHealthyFrames: this.#healthyFrames,
      lastFailureAt: this.#lastFailureAt,
      nextRetryAt: this.#nextRetryAt,
      backend: this.#backend,
      reason: this.#reason,
    });
  }

  observeHealthyFrame(): void {
    if (this.#stage === 'failed') return;
    this.#healthyFrames += 1;
    if (this.#healthyFrames >= this.policy.healthyFramesToReset) {
      this.#healthyFrames = this.policy.healthyFramesToReset;
      if (this.#stage !== 'healthy') this.#setStage('healthy', 'sustained-health');
      this.#attempts = 0;
      this.#reason = null;
      this.#nextRetryAt = 0;
    }
  }

  notifyDeviceLoss(reason: string, timestampMs: number): Result<RecoveryState> {
    const now = Math.max(0, Number.isFinite(timestampMs) ? timestampMs : 0);
    this.#healthyFrames = 0;
    this.#reason = reason || 'device-loss';
    if (now - this.#lastFailureAt > this.policy.failureWindowMs) this.#attempts = 0;
    this.#lastFailureAt = now;

    if (this.#attempts >= this.policy.maxAttempts) {
      const error: PlatformError = { code: 'RECOVERY_ATTEMPTS_EXHAUSTED', message: 'Render recovery attempt budget exhausted', retryable: false };
      this.#setStage('failed', error.message);
      this.diagnostics.fatal(error.code, error.message, 'recovery');
      this.events.emit('recovery:failed', error);
      return { ok: false, error };
    }

    this.#attempts += 1;
    this.#setStage('reinitializing', this.#reason);
    const delayMs = exponentialBackoff(this.policy, this.#attempts, this.#seed);
    this.#nextRetryAt = now + delayMs;
    this.events.emit('recovery:retry', { attempt: this.#attempts, delayMs, backend: this.#backend });
    this.diagnostics.warning('RECOVERY_RETRY', `Render recovery attempt ${this.#attempts}`, 'recovery', { delayMs, backend: this.#backend });
    return { ok: true, value: this.state() };
  }

  canRetry(timestampMs: number): boolean {
    return this.#stage === 'reinitializing' && Number(timestampMs) >= this.#nextRetryAt && this.#attempts <= this.policy.maxAttempts;
  }

  markRetryStarted(): void {
    if (this.#stage === 'reinitializing') this.#setStage('reconnecting', 'retry-started');
  }

  markRetrySucceeded(backend: RenderBackend): void {
    this.#backend = backend;
    this.#setStage('degraded', 'renderer-reinitialized');
    this.#healthyFrames = 0;
    this.#nextRetryAt = 0;
  }

  fallback(to: RenderBackend, reason = 'backend-unavailable'): boolean {
    if (to === this.#backend) return false;
    const previous = this.#backend;
    this.#backend = to;
    this.#setStage('fallback', reason);
    this.events.emit('recovery:fallback', { from: previous, to, reason });
    this.diagnostics.warning('RECOVERY_FALLBACK', `Fallback ${previous} -> ${to}`, 'recovery', { reason });
    return true;
  }

  reset(): void {
    this.#stage = 'healthy';
    this.#attempts = 0;
    this.#healthyFrames = 0;
    this.#lastFailureAt = 0;
    this.#nextRetryAt = 0;
    this.#reason = null;
  }

  chooseFallback(supported: readonly RenderBackend[]): RenderBackend | null {
    const rank: readonly RenderBackend[] = ['webgpu', 'webgl2', 'canvas2d', 'headless'];
    const currentIndex = rank.indexOf(this.#backend);
    for (let index = currentIndex + 1; index < rank.length; index += 1) {
      const candidate = rank[index]!;
      if (supported.includes(candidate)) return candidate;
    }
    return null;
  }

  riskScore(): number {
    const attemptPressure = this.policy.maxAttempts === 0 ? 1 : this.#attempts / this.policy.maxAttempts;
    const stagePressure = this.#stage === 'healthy' ? 0 : this.#stage === 'degraded' ? 0.25 : this.#stage === 'failed' ? 1 : 0.6;
    return clamp01(attemptPressure * 0.55 + stagePressure * 0.45);
  }

  debugDigest(): string {
    return hash32(JSON.stringify(this.state())).toString(16).padStart(8, '0');
  }

  #setStage(next: RecoveryStage, reason: string): void {
    const previous = this.#stage;
    this.#stage = next;
    this.#reason = reason;
    if (previous !== next) this.events.emit('recovery:stage', { previous, next, reason });
  }

  #validatePolicy(): void {
    if (this.policy.maxAttempts < 1 || this.policy.baseDelayMs < 0 || this.policy.maxDelayMs < this.policy.baseDelayMs) throw new RangeError('Invalid recovery policy');
    if (this.policy.jitterRatio < 0 || this.policy.jitterRatio > 1) throw new RangeError('Invalid recovery jitter');
    if (this.policy.failureWindowMs < 0 || this.policy.healthyFramesToReset < 1) throw new RangeError('Invalid recovery window');
  }
}

export function createWebGpuRecovery(seed?: number, diagnostics?: Diagnostics): RecoveryController {
  return new RecoveryController({ backend: 'webgpu', seed, diagnostics });
}

export function createWebGlRecovery(seed?: number, diagnostics?: Diagnostics): RecoveryController {
  return new RecoveryController({ backend: 'webgl2', seed, diagnostics });
}
