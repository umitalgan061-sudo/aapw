import type { AppDiagnosticEvent, AppLifecycleSnapshot } from './appTypes.ts';

export interface ErrorEntry { readonly id: string; readonly timestampMs: number; readonly phase: string; readonly subsystem: string; readonly message: string; readonly stack?: string; readonly recoverable: boolean; readonly metadata: Readonly<Record<string, string | number | boolean>>; }
export interface RecoveryAttempt { readonly id: string; readonly startedAtMs: number; readonly completedAtMs?: number; readonly successful?: boolean; readonly strategy: string; readonly reason: string; }
export interface ErrorBoundarySnapshot { readonly failures: number; readonly recoveries: number; readonly fatal: boolean; readonly lastError?: ErrorEntry; readonly activeRecovery?: RecoveryAttempt; readonly history: readonly ErrorEntry[]; }
export interface ErrorBoundaryOptions { readonly maxHistory?: number; readonly maxRecoveriesPerMinute?: number; readonly now?: () => number; }

export class RuntimeErrorBoundary {
  readonly #maxHistory: number;
  readonly #maxRecoveriesPerMinute: number;
  readonly #now: () => number;
  readonly #history: ErrorEntry[] = [];
  readonly #recoveries: number[] = [];
  #failureCount = 0;
  #recoveryCount = 0;
  #fatal = false;
  #activeRecovery?: RecoveryAttempt;

  constructor(options: ErrorBoundaryOptions = {}) { this.#maxHistory = Math.max(8, Math.floor(options.maxHistory ?? 128)); this.#maxRecoveriesPerMinute = Math.max(1, Math.floor(options.maxRecoveriesPerMinute ?? 6)); this.#now = options.now ?? (() => Date.now()); }

  capture(error: unknown, context: Readonly<{ phase: AppLifecycleSnapshot['phase'] | string; subsystem: string; recoverable?: boolean; metadata?: Readonly<Record<string, string | number | boolean>> }> ): ErrorEntry {
    const value = error instanceof Error ? error : new Error(String(error));
    const entry: ErrorEntry = Object.freeze({ id: 'err-' + (this.#failureCount + 1), timestampMs: this.#now(), phase: context.phase, subsystem: context.subsystem, message: value.message.slice(0, 1024), ...(value.stack ? { stack: value.stack.slice(0, 4096) } : {}), recoverable: context.recoverable ?? true, metadata: Object.freeze({ ...(context.metadata ?? {}) }) });
    this.#failureCount += 1;
    this.#history.push(entry);
    while (this.#history.length > this.#maxHistory) this.#history.shift();
    if (!entry.recoverable) this.#fatal = true;
    return entry;
  }

  canRecover(): boolean {
    this.#trimRecoveries();
    return !this.#fatal && this.#recoveries.length < this.#maxRecoveriesPerMinute && !this.#activeRecovery;
  }

  beginRecovery(strategy: string, reason: string): RecoveryAttempt | undefined {
    if (!this.canRecover()) return undefined;
    const now = this.#now();
    const attempt = Object.freeze({ id: 'recovery-' + (this.#recoveryCount + 1), startedAtMs: now, strategy: strategy.slice(0, 96), reason: reason.slice(0, 512) });
    this.#activeRecovery = attempt;
    this.#recoveries.push(now);
    this.#recoveryCount += 1;
    return attempt;
  }

  completeRecovery(successful: boolean): RecoveryAttempt | undefined {
    const active = this.#activeRecovery;
    if (!active) return undefined;
    const result = Object.freeze({ ...active, completedAtMs: this.#now(), successful: Boolean(successful) });
    this.#activeRecovery = undefined;
    if (successful) this.#fatal = false;
    else this.#fatal = true;
    return result;
  }

  clearFatal(): void { this.#fatal = false; }
  fatal(): boolean { return this.#fatal; }

  report(event: AppDiagnosticEvent): ErrorEntry | undefined {
    if (event.severity === 'info') return undefined;
    return this.capture(new Error(event.message), { phase: 'running', subsystem: event.subsystem, recoverable: event.severity !== 'critical', metadata: { code: event.code, frame: event.frame, tick: event.tick } });
  }

  snapshot(): ErrorBoundarySnapshot { return Object.freeze({ failures: this.#failureCount, recoveries: this.#recoveryCount, fatal: this.#fatal, ...(this.#history.length ? { lastError: this.#history[this.#history.length - 1] } : {}), ...(this.#activeRecovery ? { activeRecovery: this.#activeRecovery } : {}), history: Object.freeze([...this.#history]) }); }
  reset(): void { this.#history.length = 0; this.#recoveries.length = 0; this.#failureCount = 0; this.#recoveryCount = 0; this.#fatal = false; this.#activeRecovery = undefined; }
  #trimRecoveries(): void { const cutoff = this.#now() - 60_000; while (this.#recoveries[0] !== undefined && this.#recoveries[0] < cutoff) this.#recoveries.shift(); }
}
