import type { EntityId, QuaternionLike, TransformState, Vector3Like } from './types';

export interface SceneNode { readonly id: EntityId; readonly parentId: EntityId | null; readonly local: TransformState; readonly world: TransformState; readonly visible: boolean; readonly children: readonly EntityId[]; }
interface MutableNode { id: EntityId; parentId: EntityId | null; local: TransformState; world: TransformState; visible: boolean; children: Set<EntityId>; }

export class SceneGraph {
  private readonly nodes = new Map<EntityId, MutableNode>(); private readonly roots = new Set<EntityId>(); private readonly dirty = new Set<EntityId>(); private disposed = false;
  public create(id: EntityId, local: Partial<TransformState> = {}): SceneNode { this.ensureActive(); if (this.nodes.has(id)) throw new Error(`SCENE_NODE_EXISTS:${id}`); const transform = normalizeTransform(local); const node: MutableNode = { id, parentId: null, local: transform, world: cloneTransform(transform), visible: true, children: new Set() }; this.nodes.set(id, node); this.roots.add(id); this.dirty.add(id); return this.snapshot(node); }
  public attach(childId: EntityId, parentId: EntityId | null): boolean { this.ensureActive(); const child = this.nodes.get(childId); if (!child) return false; if (parentId === childId) throw new Error('SCENE_SELF_PARENT'); if (parentId && !this.nodes.has(parentId)) return false; if (parentId && this.isDescendant(parentId, childId)) throw new Error('SCENE_CYCLE'); if (child.parentId) this.nodes.get(child.parentId)?.children.delete(childId); this.roots.delete(childId); child.parentId = parentId; if (parentId) this.nodes.get(parentId)!.children.add(childId); else this.roots.add(childId); this.dirty.add(childId); return true; }
  public setLocal(id: EntityId, patch: Partial<TransformState>): boolean { const node = this.nodes.get(id); if (!node) return false; node.local = normalizeTransform({ ...node.local, ...patch }); this.dirty.add(id); return true; }
  public setVisible(id: EntityId, visible: boolean): boolean { const node = this.nodes.get(id); if (!node) return false; node.visible = visible; return true; }
  public update(): void { this.ensureActive(); const queue = [...this.dirty].sort(); this.dirty.clear(); for (const id of queue) { const node = this.nodes.get(id); if (!node) continue; const parent = node.parentId ? this.nodes.get(node.parentId) : undefined; node.world = parent ? multiplyTransforms(parent.world, node.local) : cloneTransform(node.local); for (const child of node.children) this.dirty.add(child); } }
  public get(id: EntityId): SceneNode | undefined { const node = this.nodes.get(id); return node ? this.snapshot(node) : undefined; }
  public childrenOf(id: EntityId): readonly EntityId[] { return [...(this.nodes.get(id)?.children ?? [])].sort(); }
  public rootsList(): readonly EntityId[] { return [...this.roots].sort(); }
  public worldPosition(id: EntityId): Vector3Like | undefined { const node = this.nodes.get(id); return node ? { ...node.world.position } : undefined; }
  public traverse(visitor: (node: SceneNode, depth: number) => void): void { const walk = (id: EntityId, depth: number) => { const node = this.nodes.get(id); if (!node) return; visitor(this.snapshot(node), depth); for (const child of [...node.children].sort()) walk(child, depth + 1); }; for (const root of this.rootsList()) walk(root, 0); }
  public remove(id: EntityId, recursive = true): boolean { const node = this.nodes.get(id); if (!node || (!recursive && node.children.size)) return false; for (const child of [...node.children]) this.remove(child, true); if (node.parentId) this.nodes.get(node.parentId)?.children.delete(id); this.roots.delete(id); this.dirty.delete(id); this.nodes.delete(id); return true; }
  public size(): number { return this.nodes.size; }
  private snapshot(node: MutableNode): SceneNode { return { id: node.id, parentId: node.parentId, local: cloneTransform(node.local), world: cloneTransform(node.world), visible: node.visible, children: [...node.children].sort() }; }
  private isDescendant(candidate: EntityId, ancestor: EntityId): boolean { let current: EntityId | null = candidate; while (current) { if (current === ancestor) return true; current = this.nodes.get(current)?.parentId ?? null; } return false; }
  private ensureActive(): void { if (this.disposed) throw new Error('SCENE_GRAPH_DISPOSED'); }
  public dispose(): void { this.nodes.clear(); this.roots.clear(); this.dirty.clear(); this.disposed = true; }
}

const normalizeTransform = (value: Partial<TransformState>): TransformState => ({ position: { x: value.position?.x ?? 0, y: value.position?.y ?? 0, z: value.position?.z ?? 0 }, rotation: { x: value.rotation?.x ?? 0, y: value.rotation?.y ?? 0, z: value.rotation?.z ?? 0, w: value.rotation?.w ?? 1 }, scale: { x: value.scale?.x ?? 1, y: value.scale?.y ?? 1, z: value.scale?.z ?? 1 } });
const cloneTransform = (value: TransformState): TransformState => ({ position: { ...value.position }, rotation: { ...value.rotation }, scale: { ...value.scale } });
const multiplyTransforms = (parent: TransformState, local: TransformState): TransformState => ({ position: { x: parent.position.x + local.position.x * parent.scale.x, y: parent.position.y + local.position.y * parent.scale.y, z: parent.position.z + local.position.z * parent.scale.z }, rotation: multiplyQuaternion(parent.rotation, local.rotation), scale: { x: parent.scale.x * local.scale.x, y: parent.scale.y * local.scale.y, z: parent.scale.z * local.scale.z } });
const multiplyQuaternion = (a: QuaternionLike, b: QuaternionLike): QuaternionLike => ({ x: a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y, y: a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x, z: a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w, w: a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z });
