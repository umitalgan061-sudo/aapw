import { clamp, digest, stableSort, type Disposable } from './primitives.js';

export type GateStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export interface GateInput { readonly name: string; readonly status: GateStatus; readonly blocking?: boolean; readonly detail?: string; }
export interface GateRecord extends GateInput { readonly normalized: GateStatus; readonly evaluatedAt: string; readonly digest: string; }
export interface ReleaseReport { readonly build: string; readonly version: string; readonly ready: boolean; readonly score01: number; readonly blocking: readonly GateRecord[]; readonly warnings: readonly GateRecord[]; readonly unknown: readonly GateRecord[]; readonly digest: string; }

export class ReleaseGate implements Disposable {
  #gates = new Map<string, GateRecord>(); #disposed = false;
  record(input: GateInput): GateRecord | null { if (this.#disposed || !input.name) return null; const normalized = input.status; const record = Object.freeze({ ...input, normalized, blocking: Boolean(input.blocking), evaluatedAt: new Date(0).toISOString(), digest: digest(input.name, input.status, input.blocking, input.detail) }); this.#gates.set(input.name, record); return record; }
  evaluate(build: string, version: string): ReleaseReport { const gates = stableSort([...this.#gates.values()], (a, b) => a.name.localeCompare(b.name)); const blocking = gates.filter((gate) => gate.blocking && gate.normalized === 'fail'); const warnings = gates.filter((gate) => gate.normalized === 'warn' || (!gate.blocking && gate.normalized === 'fail')); const unknown = gates.filter((gate) => gate.normalized === 'unknown'); const passed = gates.filter((gate) => gate.normalized === 'pass').length; const score = gates.length ? clamp(passed / gates.length, 0, 1) : 0; return Object.freeze({ build, version, ready: blocking.length === 0 && unknown.length === 0 && gates.length > 0, score01: score, blocking: Object.freeze(blocking), warnings: Object.freeze(warnings), unknown: Object.freeze(unknown), digest: digest(build, version, gates, score) }); }
  all(): readonly GateRecord[] { return Object.freeze(stableSort([...this.#gates.values()], (a, b) => a.name.localeCompare(b.name))); }
  clear(): void { this.#gates.clear(); }
  dispose(): void { this.#disposed = true; this.clear(); }
}
