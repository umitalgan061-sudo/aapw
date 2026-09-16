import type { Disposable } from './coreTypes.js';

export type RecoveryPhase = 'idle' | 'diagnose' | 'quiesce' | 'reset' | 'restore' | 'resume' | 'failed';
export interface RecoveryDomain { readonly id: string; readonly priority: number; readonly diagnose: () => boolean; readonly quiesce: () => void; readonly reset: () => void; readonly restore: () => void; readonly resume: () => void; }
export interface RecoveryAttempt { readonly id: number; readonly startedAt: number; readonly endedAt: number; readonly phase: RecoveryPhase; readonly reason: string; readonly domains: readonly string[]; readonly failures: readonly string[]; }
export interface RecoveryStats { readonly attempts: number; readonly successes: number; readonly failures: number; readonly phase: RecoveryPhase; readonly lastReason: string | null; }

export class RecoveryRuntime implements Disposable {
  #domains = new Map<string, RecoveryDomain>();
  #attempts: RecoveryAttempt[] = [];
  #phase: RecoveryPhase = 'idle';
  #sequence = 1;
  #now: () => number;
  #lastReason: string | null = null;
  #disposed = false;

  constructor(now: () => number = () => typeof performance !== 'undefined' ? performance.now() : Date.now()) { this.#now = now; }
  register(domain: RecoveryDomain): boolean { if (this.#disposed || !domain.id || this.#domains.has(domain.id)) return false; this.#domains.set(domain.id, Object.freeze({ ...domain })); return true; }
  unregister(id: string): boolean { return this.#domains.delete(id); }
  get phase(): RecoveryPhase { return this.#phase; }

  recover(reason: string, limit = 64): RecoveryAttempt {
    if (this.#disposed) return Object.freeze({ id: this.#sequence++, startedAt: this.#now(), endedAt: this.#now(), phase: 'failed', reason: 'disposed', domains: [], failures: ['disposed'] });
    const startedAt = this.#now(); const failures: string[] = []; const ordered = [...this.#domains.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).slice(0, Math.max(1, limit));
    this.#phase = 'diagnose';
    const ready = ordered.filter(domain => { try { return domain.diagnose(); } catch { failures.push(`${domain.id}:diagnose`); return false; } });
    this.#phase = 'quiesce'; for (const domain of ready) { try { domain.quiesce(); } catch { failures.push(`${domain.id}:quiesce`); } }
    this.#phase = 'reset'; for (const domain of ready) { try { domain.reset(); } catch { failures.push(`${domain.id}:reset`); } }
    this.#phase = 'restore'; for (const domain of ready) { try { domain.restore(); } catch { failures.push(`${domain.id}:restore`); } }
    this.#phase = 'resume'; for (const domain of ready) { try { domain.resume(); } catch { failures.push(`${domain.id}:resume`); } }
    this.#phase = failures.length ? 'failed' : 'idle';
    this.#lastReason = reason;
    const attempt = Object.freeze({ id: this.#sequence++, startedAt, endedAt: this.#now(), phase: this.#phase, reason, domains: Object.freeze(ready.map(domain => domain.id)), failures: Object.freeze([...failures]) });
    this.#attempts.push(attempt); if (this.#attempts.length > 64) this.#attempts.shift(); return attempt;
  }

  latest(): RecoveryAttempt | null { return this.#attempts.at(-1) ?? null; }
  history(): readonly RecoveryAttempt[] { return Object.freeze(this.#attempts.slice()); }
  stats(): RecoveryStats { const successes = this.#attempts.filter(attempt => attempt.phase === 'idle').length; return Object.freeze({ attempts: this.#attempts.length, successes, failures: this.#attempts.length - successes, phase: this.#phase, lastReason: this.#lastReason }); }
  clear(): void { this.#attempts.length = 0; this.#phase = 'idle'; this.#lastReason = null; }
  dispose(): void { this.#disposed = true; this.#domains.clear(); this.clear(); }
}
