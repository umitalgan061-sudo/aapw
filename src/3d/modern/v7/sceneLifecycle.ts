import { stableSort, type Disposable } from './primitives.js';

export type SceneLifecycleState = 'new' | 'loading' | 'ready' | 'background' | 'suspended' | 'disposing' | 'disposed';
export interface SceneLifecycleHandler { readonly name: string; readonly enter?: () => void | Promise<void>; readonly leave?: () => void | Promise<void>; readonly suspend?: () => void | Promise<void>; readonly resume?: () => void | Promise<void>; readonly dispose?: () => void | Promise<void>; readonly priority?: number; }
export interface SceneTransition { readonly from: SceneLifecycleState; readonly to: SceneLifecycleState; readonly reason: string; readonly serial: number; readonly success: boolean; }
export interface SceneLifecycleReport { readonly state: SceneLifecycleState; readonly transitions: number; readonly handlers: number; readonly failures: number; readonly digest: string; }

const allowed: Readonly<Record<SceneLifecycleState, readonly SceneLifecycleState[]>> = Object.freeze({
  new: ['loading', 'disposing'], loading: ['ready', 'disposing'], ready: ['background', 'suspended', 'disposing'], background: ['ready', 'suspended', 'disposing'], suspended: ['ready', 'disposing'], disposing: ['disposed'], disposed: [],
});

export class SceneLifecycleCoordinator implements Disposable {
  #state: SceneLifecycleState = 'new'; #handlers = new Map<string, SceneLifecycleHandler>(); #transitions: SceneTransition[] = []; #serial = 0; #failures = 0; #disposed = false;
  register(handler: SceneLifecycleHandler): boolean { if (this.#disposed || !handler.name || this.#handlers.has(handler.name)) return false; this.#handlers.set(handler.name, Object.freeze({ ...handler, priority: Math.trunc(handler.priority ?? 0) })); return true; }
  state(): SceneLifecycleState { return this.#state; }
  history(): readonly SceneTransition[] { return Object.freeze([...this.#transitions]); }
  async transition(to: SceneLifecycleState, reason = 'manual'): Promise<boolean> {
    if (this.#disposed && to !== 'disposed') return false; if (!allowed[this.#state].includes(to)) return false; const from = this.#state; const handlers = stableSort([...this.#handlers.values()], (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name)); let success = true;
    try { if (to === 'loading') await Promise.all(handlers.map((handler) => handler.enter?.())); else if (to === 'ready') { if (from === 'suspended') await Promise.all(handlers.map((handler) => handler.resume?.())); else await Promise.all(handlers.map((handler) => handler.enter?.())); } else if (to === 'background' || to === 'suspended') await Promise.all(handlers.map((handler) => (to === 'suspended' ? handler.suspend?.() : handler.leave?.()))); else if (to === 'disposing') await Promise.all(handlers.map((handler) => handler.dispose?.())); }
    catch { success = false; this.#failures += 1; }
    if (success) this.#state = to; this.#transitions.push(Object.freeze({ from, to, reason, serial: ++this.#serial, success })); if (this.#transitions.length > 256) this.#transitions.shift(); if (to === 'disposed' && success) this.#disposed = true; return success;
  }
  async dispose(): Promise<void> { if (this.#state !== 'disposed') await this.transition('disposing', 'dispose'); if (this.#state === 'disposing') { this.#state = 'disposed'; this.#disposed = true; } this.#handlers.clear(); }
  report(): SceneLifecycleReport { return Object.freeze({ state: this.#state, transitions: this.#transitions.length, handlers: this.#handlers.size, failures: this.#failures, digest: `${this.#state}:${this.#serial}:${this.#failures}` }); }
}
