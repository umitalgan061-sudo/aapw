import type { Disposable } from './coreTypes.js';
import { EngineRuntime } from './engineRuntime.js';
import { PerformanceRuntime } from './performanceRuntime.js';
import { RecoveryRuntime } from './recoveryRuntime.js';
import { ReleaseRuntime, type ReleaseInput } from './releaseRuntime.js';
import { SecurityRuntime } from './securityRuntime.js';
import { TelemetryRuntime } from './telemetryRuntime.js';

export type ControlCommand = 'pause' | 'resume' | 'recover' | 'flush-telemetry' | 'clear-telemetry' | 'release-check' | 'security-check' | 'set-quality';
export interface ControlRequest { readonly id: string; readonly command: ControlCommand; readonly payload?: unknown; readonly issuedAt: number; readonly operator: string; }
export interface ControlResult { readonly id: string; readonly accepted: boolean; readonly command: ControlCommand; readonly detail: string; readonly data?: unknown; }
export interface ControlPlaneSnapshot { readonly phase: string; readonly engine: ReturnType<EngineRuntime['snapshot']>; readonly performance: ReturnType<PerformanceRuntime['stats']>; readonly recovery: ReturnType<RecoveryRuntime['stats']>; readonly telemetry: ReturnType<TelemetryRuntime['stats']>; readonly security: ReturnType<SecurityRuntime['stats']>; readonly release: ReturnType<ReleaseRuntime['latest']>; }

export class RuntimeControlPlane implements Disposable {
  readonly engine: EngineRuntime;
  readonly performance: PerformanceRuntime;
  readonly recovery: RecoveryRuntime;
  readonly telemetry: TelemetryRuntime;
  readonly security: SecurityRuntime;
  readonly release: ReleaseRuntime;
  #disposed = false;
  #now: () => number;
  #audit: ControlResult[] = [];

  constructor(engine = new EngineRuntime(), now: () => number = () => typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    this.engine = engine;
    this.performance = new PerformanceRuntime();
    this.recovery = new RecoveryRuntime(now);
    this.telemetry = new TelemetryRuntime();
    this.security = new SecurityRuntime();
    this.release = new ReleaseRuntime({}, now);
    this.#now = now;
    this.#installRecoveryDomains();
  }

  async execute(request: ControlRequest): Promise<ControlResult> {
    if (this.#disposed) return this.#result(request, false, 'control-plane-disposed');
    let result: ControlResult;
    switch (request.command) {
      case 'pause': result = this.#phaseResult(request, this.engine.pause()); break;
      case 'resume': result = this.#phaseResult(request, this.engine.resume()); break;
      case 'recover': result = this.#recoverResult(request, String(request.payload ?? 'operator-recovery')); break;
      case 'flush-telemetry': result = this.#result(request, true, `telemetry:${this.telemetry.stats().samples}`, this.telemetry.export()); break;
      case 'clear-telemetry': this.telemetry.clear(); result = this.#result(request, true, 'telemetry-cleared'); break;
      case 'release-check': result = this.#releaseResult(request, request.payload); break;
      case 'security-check': result = this.#securityResult(request, request.payload); break;
      case 'set-quality': result = this.#qualityResult(request, request.payload); break;
      default: result = this.#result(request, false, 'unsupported-command'); break;
    }
    this.#audit.push(result); if (this.#audit.length > 512) this.#audit.shift(); return result;
  }

  async boot(): Promise<boolean> { return this.engine.boot(); }
  audit(): readonly ControlResult[] { return Object.freeze(this.#audit.slice()); }
  snapshot(): ControlPlaneSnapshot { return Object.freeze({ phase: this.engine.phase, engine: this.engine.snapshot(), performance: this.performance.stats(), recovery: this.recovery.stats(), telemetry: this.telemetry.stats(), security: this.security.stats(), release: this.release.latest() }); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.release.dispose(); this.security.dispose(); this.telemetry.dispose(); this.recovery.dispose(); this.performance.dispose(); this.engine.dispose(); this.#audit.length = 0; }

  #phaseResult(request: ControlRequest, accepted: boolean): ControlResult { return this.#result(request, accepted, accepted ? `${request.command}-accepted` : `${request.command}-rejected`); }
  #recoverResult(request: ControlRequest, reason: string): ControlResult { const attempt = this.recovery.recover(reason); return this.#result(request, attempt.phase !== 'failed', attempt.phase === 'failed' ? 'recovery-failed' : 'recovered', attempt); }
  #releaseResult(request: ControlRequest, payload: unknown): ControlResult {
    const input = payload && typeof payload === 'object' ? payload as ReleaseInput : { typecheck: false, tests: false, build: false, deterministic: false, errorRate: 1, p95FrameMs: 999, memoryRatio: 1, unhandledExceptions: 1, legacySurfaces: 999 };
    const report = this.release.evaluate(`operator-${this.#now()}`, input);
    return this.#result(request, report.passed, report.passed ? 'release-passed' : 'release-blocked', report);
  }
  #securityResult(request: ControlRequest, payload: unknown): ControlResult { const result = this.security.validate(payload); return this.#result(request, result.ok, result.ok ? 'payload-accepted' : 'payload-rejected', result.ok ? result.value : result); }
  #qualityResult(request: ControlRequest, payload: unknown): ControlResult { const values = ['minimal', 'low', 'medium', 'high', 'ultra'] as const; const tier = typeof payload === 'string' && values.includes(payload as typeof values[number]) ? payload as typeof values[number] : null; if (!tier) return this.#result(request, false, 'invalid-quality'); this.performance.force(tier); this.engine.render.forceQuality(tier); return this.#result(request, true, `quality:${tier}`); }
  #result(request: ControlRequest, accepted: boolean, detail: string, data?: unknown): ControlResult { return Object.freeze({ id: request.id, accepted, command: request.command, detail, ...(data === undefined ? {} : { data }) }); }
  #installRecoveryDomains(): void {
    this.recovery.register({ id: 'engine', priority: 10, diagnose: () => this.engine.phase !== 'disposed', quiesce: () => { this.engine.pause(); }, reset: () => { this.engine.recover('recovery-reset'); }, restore: () => {}, resume: () => { this.engine.resume(); } });
    this.recovery.register({ id: 'telemetry', priority: 20, diagnose: () => true, quiesce: () => {}, reset: () => this.telemetry.clear(), restore: () => {}, resume: () => {} });
    this.recovery.register({ id: 'network', priority: 30, diagnose: () => true, quiesce: () => {}, reset: () => {}, restore: () => {}, resume: () => {} });
  }
}
