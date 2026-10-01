import type { BrowserCapabilities, EntityState, RenderDecision, RuntimeHealthReport, Tick, Vec3 } from './types';
import { hashJson } from './deterministic';

export interface SceneNodeHandle { readonly id: string; readonly entityId: string; readonly visible: boolean; }
export interface SceneAdapter {
  readonly createEntity: (entity: EntityState) => SceneNodeHandle;
  readonly updateEntity: (handle: SceneNodeHandle, entity: EntityState) => SceneNodeHandle;
  readonly removeEntity: (handle: SceneNodeHandle) => void;
  readonly setQuality: (decision: RenderDecision) => void;
  readonly setCamera: (position: Vec3, focus: Vec3) => void;
}
export interface SceneHealth {
  readonly tick: Tick;
  readonly nodes: number;
  readonly lastFrameDigest: string;
  readonly capability: BrowserCapabilities;
  readonly runtime: RuntimeHealthReport | null;
}
export class R40SceneBridge {
  readonly adapter: SceneAdapter; readonly capabilities: BrowserCapabilities;
  #nodes = new Map<string, SceneNodeHandle>(); #lastFrameDigest = ''; #health: RuntimeHealthReport | null = null;
  constructor(adapter: SceneAdapter, capabilities: BrowserCapabilities) { this.adapter = adapter; this.capabilities = capabilities; }
  syncEntity(entity: EntityState): SceneNodeHandle {
    const key = String(entity.id); const current = this.#nodes.get(key);
    const handle = current ? this.adapter.updateEntity(current, entity) : this.adapter.createEntity(entity);
    this.#nodes.set(key, Object.freeze(handle)); return handle;
  }
  removeEntity(id: string): boolean { const handle = this.#nodes.get(id); if (!handle) return false; this.adapter.removeEntity(handle); return this.#nodes.delete(id); }
  applyQuality(decision: RenderDecision): void { this.adapter.setQuality(decision); this.#lastFrameDigest = hashJson(decision); }
  moveCamera(position: Vec3, focus: Vec3): void { this.adapter.setCamera(Object.freeze({ ...position }), Object.freeze({ ...focus })); }
  syncHealth(report: RuntimeHealthReport): void { this.#health = Object.freeze(report); }
  nodeCount(): number { return this.#nodes.size; }
  health(tick: Tick): SceneHealth { return Object.freeze({ tick, nodes: this.#nodes.size, lastFrameDigest: this.#lastFrameDigest, capability: this.capabilities, runtime: this.#health }); }
  clear(): void { for (const handle of this.#nodes.values()) this.adapter.removeEntity(handle); this.#nodes.clear(); this.#lastFrameDigest = ''; this.#health = null; }
}
