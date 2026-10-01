import type { RuntimeCommand, RuntimePhase, Tick } from './types';
import { hashJson } from './deterministic';

export type StateSource = 'engine' | 'ui' | 'network' | 'save' | 'replay' | 'system';
export interface StatePatch { readonly path: string; readonly value: unknown; readonly source: StateSource; readonly tick: Tick; readonly digest: string; }
export interface GraphLimits { readonly maxDepth: number; readonly maxNodes: number; readonly maxPatches: number; }
export interface GraphSnapshot { readonly revision: number; readonly tick: Tick; readonly state: unknown; readonly patches: readonly StatePatch[]; readonly digest: string; }

function pathParts(path: string): readonly string[] { return path.split('.').filter(Boolean).slice(0, 64); }
function validatePath(path: string): boolean { return /^[A-Za-z0-9_.-]{1,256}$/.test(path); }

export class RuntimeStateGraph {
  readonly limits: GraphLimits;
  #state: Record<string, unknown> = {};
  #revision = 0;
  #patches: StatePatch[] = [];
  constructor(limits: Partial<GraphLimits> = {}) { this.limits = Object.freeze({ maxDepth: 12, maxNodes: 10000, maxPatches: 2048, ...limits }); }
  commit(path: string, value: unknown, source: StateSource, tick: Tick): StatePatch | null {
    if (!validatePath(path) || pathParts(path).length > this.limits.maxDepth) return null;
    const clone = structuredClone(value);
    const patch = Object.freeze({ path, value: clone, source, tick, digest: hashJson({ path, value: clone, source, tick }) });
    if (!this.write(pathParts(path), clone)) return null;
    this.#patches.push(patch); this.#revision += 1;
    if (this.#patches.length > this.limits.maxPatches) this.#patches.shift();
    return patch;
  }
  applyCommand(command: RuntimeCommand, tick: Tick, source: StateSource = 'engine'): StatePatch | null {
    const path = typeof command.payload.path === 'string' ? command.payload.path : 'commands.' + command.type;
    const value = command.payload.value ?? command.payload;
    return this.commit(path, value, source, tick);
  }
  read(path: string): unknown {
    if (!validatePath(path)) return undefined;
    let current: unknown = this.#state;
    for (const segment of pathParts(path)) { if (!current || typeof current !== 'object') return undefined; current = (current as Record<string, unknown>)[segment]; }
    return current;
  }
  snapshot(tick: Tick): GraphSnapshot {
    const state = structuredClone(this.#state);
    const patches = Object.freeze([...this.#patches]);
    return Object.freeze({ revision: this.#revision, tick, state, patches, digest: hashJson({ revision: this.#revision, tick, state, patches }) });
  }
  rollback(snapshot: GraphSnapshot): void {
    this.#state = structuredClone(snapshot.state) as Record<string, unknown>;
    this.#revision = snapshot.revision;
    this.#patches = [...snapshot.patches];
  }
  phaseCommit(phase: RuntimePhase, values: Readonly<Record<string, unknown>>, tick: Tick): number {
    let count = 0; for (const [key, value] of Object.entries(values)) if (this.commit(phase + '.' + key, value, 'engine', tick)) count += 1; return count;
  }
  patchCount(): number { return this.#patches.length; }
  revision(): number { return this.#revision; }
  clear(): void { this.#state = {}; this.#revision = 0; this.#patches.length = 0; }
  private write(parts: readonly string[], value: unknown): boolean {
    if (parts.length === 0) return false;
    let cursor = this.#state;
    let nodes = 0;
    for (let i = 0; i < parts.length - 1; i += 1) {
      nodes += 1; if (nodes > this.limits.maxNodes) return false;
      const key = parts[i]!;
      const child = cursor[key];
      if (child !== undefined && (typeof child !== 'object' || child === null || Array.isArray(child))) return false;
      if (child === undefined) cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]!] = value; return true;
  }
}
