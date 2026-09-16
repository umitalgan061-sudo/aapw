import { clamp, integer, stableSort, type Disposable } from './primitives.js';

export type RecoveryDomain = 'input' | 'simulation' | 'ai' | 'streaming' | 'network' | 'render' | 'save' | 'audio' | 'telemetry';
export type RecoveryState = 'idle' | 'diagnosing' | 'quiescing' | 'resetting' | 'restoring' | 'resuming' | 'failed' | 'complete';
export interface RecoveryHandler { readonly domain: RecoveryDomain; readonly diagnose: () => boolean; readonly quiesce: () => void; readonly reset: () => void; readonly restore: () => void; readonly resume: () => void; }
export interface RecoveryAttempt { readonly id: number; readonly domain: RecoveryDomain; readonly state: RecoveryState; readonly startedAt: number; readonly finishedAt: number | null; readonly error: string | null; }
export interface RecoveryReport { readonly id: number; readonly success: boolean; readonly attempts: readonly RecoveryAttempt[]; readonly failedDomains: readonly RecoveryDomain[]; readonly digest: string; }

export class RecoveryCoordinator implements Disposable {
  readonly maxAttempts: number; readonly cooldownTicks: number; #handlers = new Map<RecoveryDomain, RecoveryHandler>(); #attempts: RecoveryAttempt[] = []; #disposed = false; #serial = 0; #lastTick = -Infinity;
  constructor(maxAttempts = 3, cooldownTicks = 120) { this.maxAttempts = clamp(integer(maxAttempts), 1, 8); this.cooldownTicks = clamp(integer(cooldownTicks), 0, 100_000); }
  register(handler: RecoveryHandler): boolean { if (this.#disposed || this.#handlers.has(handler.domain)) return false; this.#handlers.set(handler.domain, handler); return true; }
  recover(domains: readonly RecoveryDomain[] = [...this.#handlers.keys()], tick = 0): RecoveryReport {
    if (this.#disposed) return Object.freeze({ id: 0, success: false, attempts: [], failedDomains: [], digest: 'disposed' }); const numericTick = integer(tick); if (numericTick - this.#lastTick < this.cooldownTicks) return Object.freeze({ id: ++this.#serial, success: false, attempts: [], failedDomains: [...domains], digest: 'cooldown' }); this.#lastTick = numericTick;
    const attempts: RecoveryAttempt[] = []; const failed: RecoveryDomain[] = []; const ordered = stableSort([...new Set(domains)], (a, b) => a.localeCompare(b)); const id = ++this.#serial;
    for (const domain of ordered) { const handler = this.#handlers.get(domain); if (!handler) { failed.push(domain); continue; } let state: RecoveryState = 'diagnosing'; let error: string | null = null; const started = numericTick; try { if (!handler.diagnose()) throw new Error('diagnosis-rejected'); state = 'quiescing'; handler.quiesce(); state = 'resetting'; handler.reset(); state = 'restoring'; handler.restore(); state = 'resuming'; handler.resume(); state = 'complete'; } catch (cause) { state = 'failed'; error = cause instanceof Error ? cause.message : String(cause); failed.push(domain); } attempts.push(Object.freeze({ id, domain, state, startedAt: started, finishedAt: numericTick, error })); }
    this.#attempts.push(...attempts); this.#attempts = this.#attempts.slice(-1024); return Object.freeze({ id, success: failed.length === 0, attempts: Object.freeze(attempts), failedDomains: Object.freeze(failed), digest: `${id}:${attempts.map((attempt) => `${attempt.domain}:${attempt.state}`).join('|')}` });
  }
  history(): readonly RecoveryAttempt[] { return Object.freeze([...this.#attempts]); }
  dispose(): void { this.#disposed = true; this.#handlers.clear(); this.#attempts.length = 0; }
}
