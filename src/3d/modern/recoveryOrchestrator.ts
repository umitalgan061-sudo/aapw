import type { PlatformError, Result, UnixMillis } from './types';

export type RecoveryDomain = 'renderer' | 'streaming' | 'network' | 'save' | 'simulation' | 'input' | 'full';
export type RecoveryPhase = 'idle' | 'diagnosing' | 'quiescing' | 'resetting' | 'replaying' | 'resuming' | 'recovered' | 'failed';

export interface RecoveryRequest {
  readonly domain: RecoveryDomain;
  readonly reason: string;
  readonly severity?: 'warning' | 'error' | 'fatal';
  readonly frame?: number;
}

export interface RecoveryAttempt {
  readonly id: number;
  readonly domain: RecoveryDomain;
  readonly reason: string;
  readonly startedAt: UnixMillis;
  readonly finishedAt: UnixMillis | null;
  readonly phase: RecoveryPhase;
  readonly success: boolean | null;
  readonly error: PlatformError | null;
}

export interface RecoveryHandler {
  diagnose?: (request: RecoveryRequest) => Promise<boolean> | boolean;
  quiesce?: (request: RecoveryRequest) => Promise<void> | void;
  reset?: (request: RecoveryRequest) => Promise<void> | void;
  replay?: (request: RecoveryRequest) => Promise<void> | void;
  resume?: (request: RecoveryRequest) => Promise<void> | void;
}

export interface RecoveryOptions {
  readonly now?: () => UnixMillis;
  readonly maxAttempts?: number;
  readonly windowMs?: number;
  readonly retryDelayMs?: number;
}

export interface RecoveryStats {
  readonly phase: RecoveryPhase;
  readonly inFlight: boolean;
  readonly attempts: number;
  readonly successful: number;
  readonly failed: number;
  readonly lastError: PlatformError | null;
}

const DOMAIN_ORDER: readonly RecoveryDomain[] = Object.freeze(['input', 'streaming', 'network', 'save', 'renderer', 'simulation', 'full']);

function severityValue(severity: RecoveryRequest['severity']): number {
  return severity === 'fatal' ? 3 : severity === 'error' ? 2 : 1;
}

/** Coordinates subsystem recovery so failures cannot independently restart shared runtime services. */
export class RecoveryOrchestrator {
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly retryDelayMs: number;
  #now: () => UnixMillis;
  #handlers = new Map<RecoveryDomain, RecoveryHandler>();
  #attempts: RecoveryAttempt[] = [];
  #phase: RecoveryPhase = 'idle';
  #nextId = 0;
  #running = false;
  #successful = 0;
  #failed = 0;
  #lastError: PlatformError | null = null;

  constructor(options: RecoveryOptions = {}) {
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.maxAttempts = Math.max(1, Math.min(20, Math.trunc(options.maxAttempts ?? 5)));
    this.windowMs = Math.max(1_000, Math.min(300_000, Math.trunc(options.windowMs ?? 60_000)));
    this.retryDelayMs = Math.max(0, Math.min(10_000, Math.trunc(options.retryDelayMs ?? 150)));
  }

  register(domain: RecoveryDomain, handler: RecoveryHandler): () => void {
    this.#handlers.set(domain, handler);
    return () => this.#handlers.delete(domain);
  }

  get phase(): RecoveryPhase { return this.#phase; }
  get inFlight(): boolean { return this.#running; }

  async recover(request: RecoveryRequest): Promise<Result<RecoveryAttempt>> {
    if (this.#running) return { ok: false, error: this.#error('RECOVERY_BUSY', 'Recovery already running', true) };
    if (this.#tooManyAttempts()) return { ok: false, error: this.#error('RECOVERY_RATE_LIMIT', 'Recovery attempt window exhausted', false) };
    const id = ++this.#nextId;
    const attempt: RecoveryAttempt = { id, domain: request.domain, reason: request.reason, startedAt: this.#now(), finishedAt: null, phase: 'diagnosing', success: null, error: null };
    this.#attempts.push(attempt);
    this.#running = true;
    this.#phase = 'diagnosing';
    try {
      const order = this.#resolveOrder(request.domain);
      for (const domain of order) {
        const handler = this.#handlers.get(domain);
        if (!handler) continue;
        if (handler.diagnose && !(await handler.diagnose(request))) continue;
        this.#phase = 'quiescing';
        await handler.quiesce?.(request);
        this.#phase = 'resetting';
        await handler.reset?.(request);
        this.#phase = 'replaying';
        await handler.replay?.(request);
        this.#phase = 'resuming';
        await handler.resume?.(request);
      }
      this.#phase = 'recovered';
      this.#successful += 1;
      const completed: RecoveryAttempt = Object.freeze({ ...attempt, finishedAt: this.#now(), phase: 'recovered', success: true, error: null });
      this.#replaceAttempt(completed);
      return { ok: true, value: completed };
    } catch (cause) {
      this.#phase = 'failed';
      this.#failed += 1;
      this.#lastError = this.#error('RECOVERY_FAILED', cause, true);
      const completed: RecoveryAttempt = Object.freeze({ ...attempt, finishedAt: this.#now(), phase: 'failed', success: false, error: this.#lastError });
      this.#replaceAttempt(completed);
      return { ok: false, error: this.#lastError };
    } finally {
      this.#running = false;
      if (this.#phase === 'recovered' || this.#phase === 'failed') this.#phase = 'idle';
      if (this.retryDelayMs) await this.#sleep(this.retryDelayMs);
    }
  }

  attempts(): readonly RecoveryAttempt[] {
    return Object.freeze(this.#attempts.map((attempt) => Object.freeze({ ...attempt })));
  }

  stats(): RecoveryStats {
    return Object.freeze({ phase: this.#phase, inFlight: this.#running, attempts: this.#attempts.length, successful: this.#successful, failed: this.#failed, lastError: this.#lastError });
  }

  clearHistory(): void { this.#attempts.length = 0; this.#successful = 0; this.#failed = 0; this.#lastError = null; }

  shouldRecover(request: RecoveryRequest): boolean {
    if (request.severity === 'fatal') return true;
    if (request.domain === 'full') return true;
    const recent = this.#attempts.filter((item) => Number(this.#now()) - Number(item.startedAt) <= this.windowMs && item.domain === request.domain);
    return recent.length > 0;
  }

  #resolveOrder(domain: RecoveryDomain): readonly RecoveryDomain[] {
    if (domain === 'full') return DOMAIN_ORDER;
    const start = DOMAIN_ORDER.indexOf(domain);
    return start < 0 ? [domain] : Object.freeze([domain, ...DOMAIN_ORDER.slice(0, start).filter((item) => item !== domain)]);
  }

  #tooManyAttempts(): boolean {
    const now = this.#now();
    return this.#attempts.filter((attempt) => Number(now) - Number(attempt.startedAt) <= this.windowMs).length >= this.maxAttempts;
  }

  #replaceAttempt(next: RecoveryAttempt): void {
    const index = this.#attempts.findIndex((item) => item.id === next.id);
    if (index >= 0) this.#attempts[index] = next;
  }

  #sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

  #error(code: string, cause: unknown, retryable: boolean): PlatformError { return Object.freeze({ code, message: cause instanceof Error ? cause.message : String(cause), retryable, cause }); }
}

export function recoveryPriority(request: RecoveryRequest): number { return severityValue(request.severity) * 10 + (DOMAIN_ORDER.length - Math.max(0, DOMAIN_ORDER.indexOf(request.domain))); }
