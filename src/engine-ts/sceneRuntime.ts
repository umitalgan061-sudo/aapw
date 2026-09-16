import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { ENTITY_ID, stableSort } from './coreTypes.js';

export type SceneNodeType = 'root' | 'group' | 'entity' | 'light' | 'camera' | 'probe';
export interface SceneNode { readonly id: string; readonly type: SceneNodeType; readonly parent: string | null; readonly children: readonly string[]; readonly position: Vec3; readonly visible: boolean; readonly layer: number; readonly entity: EntityId | null; }
export interface SceneStats { readonly nodes: number; readonly roots: number; readonly visible: number; readonly entities: number; readonly maxDepth: number; }

function safeId(value: string): string { return value.trim().replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 128); }
function depth(id: string, nodes: Map<string, SceneNode>, limit = 512): number { let current = id; let count = 0; while (count < limit) { const node = nodes.get(current); if (!node?.parent) return count; current = node.parent; count += 1; } return limit; }

export class SceneRuntime implements Disposable {
  #nodes = new Map<string, SceneNode>();
  #root: string;
  #disposed = false;
  constructor(root = 'scene') { this.#root = safeId(root) || 'scene'; this.#nodes.set(this.#root, Object.freeze({ id: this.#root, type: 'root', parent: null, children: [], position: { x: 0, y: 0, z: 0 }, visible: true, layer: 0, entity: null })); }

  create(node: Omit<SceneNode, 'children'> & Partial<Pick<SceneNode, 'children'>>): boolean {
    if (this.#disposed) return false;
    const id = safeId(node.id); if (!id || this.#nodes.has(id)) return false;
    const parent = node.parent ?? this.#root; if (!this.#nodes.has(parent) || parent === id) return false;
    if (depth(parent, this.#nodes) >= 256) return false;
    const normalized: SceneNode = Object.freeze({ id, type: node.type, parent, children: Object.freeze([]), position: Object.freeze({ ...node.position }), visible: node.visible, layer: Math.trunc(node.layer), entity: node.entity ?? null });
    this.#nodes.set(id, normalized);
    this.#link(parent, id);
    return true;
  }

  update(id: string, patch: Partial<Pick<SceneNode, 'position' | 'visible' | 'layer'>>): boolean {
    const node = this.#nodes.get(id); if (!node || this.#disposed) return false;
    this.#nodes.set(id, Object.freeze({ ...node, ...(patch.position ? { position: Object.freeze({ ...patch.position }) } : {}), ...(patch.visible === undefined ? {} : { visible: patch.visible }), ...(patch.layer === undefined ? {} : { layer: Math.trunc(patch.layer) }) }));
    return true;
  }

  remove(id: string, recursive = true): boolean {
    const node = this.#nodes.get(id); if (!node || id === this.#root) return false;
    if (recursive) for (const child of node.children) this.remove(child, true);
    const parent = node.parent; if (parent) this.#unlink(parent, id);
    this.#nodes.delete(id); return true;
  }

  find(id: string): SceneNode | undefined { return this.#nodes.get(id); }
  descendants(id: string): readonly SceneNode[] { const root = this.#nodes.get(id); if (!root) return []; const result: SceneNode[] = []; const stack = [...root.children]; while (stack.length) { const child = stack.shift()!; const node = this.#nodes.get(child); if (!node) continue; result.push(node); stack.unshift(...node.children); } return Object.freeze(result); }
  visibleNodes(): readonly SceneNode[] { return Object.freeze(stableSort([...this.#nodes.values()].filter(node => node.visible), (a, b) => a.layer - b.layer || a.id.localeCompare(b.id))); }
  entityNode(entity: EntityId): SceneNode | undefined { return [...this.#nodes.values()].find(node => node.entity === entity); }
  stats(): SceneStats { let roots = 0; let visible = 0; let entities = 0; let maxDepth = 0; for (const node of this.#nodes.values()) { if (!node.parent) roots += 1; if (node.visible) visible += 1; if (node.entity) entities += 1; maxDepth = Math.max(maxDepth, depth(node.id, this.#nodes)); } return Object.freeze({ nodes: this.#nodes.size, roots, visible, entities, maxDepth }); }
  snapshot(): readonly SceneNode[] { return Object.freeze(stableSort([...this.#nodes.values()], (a, b) => a.id.localeCompare(b.id))); }
  dispose(): void { this.#disposed = true; this.#nodes.clear(); }
  #link(parent: string, child: string): void { const node = this.#nodes.get(parent); if (!node) return; this.#nodes.set(parent, Object.freeze({ ...node, children: Object.freeze([...node.children, child].sort()) })); }
  #unlink(parent: string, child: string): void { const node = this.#nodes.get(parent); if (!node) return; this.#nodes.set(parent, Object.freeze({ ...node, children: Object.freeze(node.children.filter(item => item !== child)) })); }
}

export const sceneEntity = (id: string): EntityId => ENTITY_ID(id);
