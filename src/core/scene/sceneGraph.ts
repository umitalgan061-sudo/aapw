import { clamp, freeze, type EntityId, entityId, normalizeVec3, type Vec3 } from '../domain/contracts.ts';

export type SceneNodeKind = 'root' | 'group' | 'mesh' | 'light' | 'camera' | 'audio' | 'ui';

export interface SceneNodeSnapshot {
  readonly id: EntityId;
  readonly parentId: EntityId | null;
  readonly kind: SceneNodeKind;
  readonly name: string;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly layer: number;
  readonly children: readonly EntityId[];
  readonly metadata: Readonly<Record<string, string>>;
}

export interface SceneNodeInput {
  readonly id?: string;
  readonly parentId?: string | null;
  readonly kind?: SceneNodeKind;
  readonly name?: string;
  readonly position?: Partial<Vec3>;
  readonly rotation?: Partial<Vec3>;
  readonly scale?: Partial<Vec3>;
  readonly visible?: boolean;
  readonly enabled?: boolean;
  readonly layer?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SceneChange {
  readonly type: 'added' | 'updated' | 'removed' | 'reparented';
  readonly id: EntityId;
  readonly revision: number;
}

const normalizeScale = (scale?: Partial<Vec3>): Vec3 => normalizeVec3({ x: scale?.x ?? 1, y: scale?.y ?? 1, z: scale?.z ?? 1 });
const normalizeMetadata = (metadata?: Readonly<Record<string, string>>): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const key of Object.keys(metadata ?? {}).sort().slice(0, 32)) result[key.slice(0, 64)] = String(metadata?.[key] ?? '').slice(0, 256);
  return freeze(result);
};

const createNode = (input: SceneNodeInput, fallbackId: string): SceneNodeSnapshot => freeze({
  id: entityId(input.id ?? fallbackId),
  parentId: input.parentId ? entityId(input.parentId) : null,
  kind: input.kind ?? 'group',
  name: input.name?.trim().slice(0, 128) || fallbackId,
  position: normalizeVec3(input.position),
  rotation: normalizeVec3(input.rotation),
  scale: normalizeScale(input.scale),
  visible: input.visible ?? true,
  enabled: input.enabled ?? true,
  layer: Math.floor(clamp(input.layer ?? 0, 0, 31)),
  children: [],
  metadata: normalizeMetadata(input.metadata),
});

export class SceneGraph {
  readonly #nodes = new Map<EntityId, SceneNodeSnapshot>();
  readonly #root: EntityId;
  #revision = 0;

  constructor(rootId = 'world-root') {
    this.#root = entityId(rootId);
    this.#nodes.set(this.#root, createNode({ id: rootId, kind: 'root', name: 'World Root' }, rootId));
  }

  get rootId(): EntityId { return this.#root; }
  get revision(): number { return this.#revision; }

  add(input: SceneNodeInput): SceneChange {
    const id = entityId(input.id ?? `node-${this.#nodes.size + 1}`);
    if (this.#nodes.has(id)) throw new Error(`Scene node ${id} already exists.`);
    const parentId = input.parentId ? entityId(input.parentId) : this.#root;
    const parent = this.#nodes.get(parentId);
    if (!parent) throw new Error(`Parent ${parentId} does not exist.`);
    if (this.#wouldCycle(id, parentId)) throw new Error('Scene hierarchy cycle detected.');
    const node = createNode({ ...input, id: String(id), parentId: String(parentId) }, `node-${this.#nodes.size + 1}`);
    this.#nodes.set(id, node);
    this.#setChildren(parentId, [...parent.children, id]);
    this.#revision += 1;
    return freeze({ type: 'added', id, revision: this.#revision });
  }

  update(id: EntityId, patch: Partial<SceneNodeInput>): SceneChange {
    const current = this.#nodes.get(id);
    if (!current) throw new Error(`Scene node ${id} does not exist.`);
    const nextParentId = patch.parentId === undefined ? current.parentId : patch.parentId ? entityId(patch.parentId) : null;
    if (nextParentId && !this.#nodes.has(nextParentId)) throw new Error(`Parent ${nextParentId} does not exist.`);
    if (nextParentId && this.#wouldCycle(id, nextParentId)) throw new Error('Scene hierarchy cycle detected.');
    if (nextParentId !== current.parentId) this.#reparent(id, current.parentId, nextParentId);
    const next = freeze({
      ...current,
      name: patch.name === undefined ? current.name : patch.name.trim().slice(0, 128) || current.name,
      position: patch.position === undefined ? current.position : normalizeVec3(patch.position),
      rotation: patch.rotation === undefined ? current.rotation : normalizeVec3(patch.rotation),
      scale: patch.scale === undefined ? current.scale : normalizeScale(patch.scale),
      visible: patch.visible === undefined ? current.visible : patch.visible,
      enabled: patch.enabled === undefined ? current.enabled : patch.enabled,
      layer: patch.layer === undefined ? current.layer : Math.floor(clamp(patch.layer, 0, 31)),
      metadata: patch.metadata === undefined ? current.metadata : normalizeMetadata(patch.metadata),
      parentId: nextParentId,
    });
    this.#nodes.set(id, next);
    this.#revision += 1;
    return freeze({ type: nextParentId !== current.parentId ? 'reparented' : 'updated', id, revision: this.#revision });
  }

  remove(id: EntityId, recursive = true): readonly SceneChange[] {
    if (id === this.#root) throw new Error('Root cannot be removed.');
    const node = this.#nodes.get(id);
    if (!node) return [];
    const ids: EntityId[] = [];
    const visit = (candidate: EntityId): void => {
      ids.push(candidate);
      const value = this.#nodes.get(candidate);
      if (recursive) for (const child of value?.children ?? []) visit(child);
    };
    visit(id);
    if (!recursive && node.children.length) throw new Error('Cannot remove non-leaf node without recursive=true.');
    if (node.parentId) {
      const parent = this.#nodes.get(node.parentId);
      if (parent) this.#setChildren(node.parentId, parent.children.filter((child) => child !== id));
    }
    const changes: SceneChange[] = [];
    for (const candidate of ids.reverse()) {
      this.#nodes.delete(candidate);
      this.#revision += 1;
      changes.push(freeze({ type: 'removed', id: candidate, revision: this.#revision }));
    }
    return changes;
  }

  get(id: EntityId): SceneNodeSnapshot | undefined { return this.#nodes.get(id); }
  has(id: EntityId): boolean { return this.#nodes.has(id); }
  childrenOf(id: EntityId): readonly SceneNodeSnapshot[] { return (this.#nodes.get(id)?.children ?? []).map((child) => this.#nodes.get(child)).filter((child): child is SceneNodeSnapshot => Boolean(child)); }
  all(): readonly SceneNodeSnapshot[] { return [...this.#nodes.values()]; }

  worldPosition(id: EntityId): Vec3 {
    const chain: SceneNodeSnapshot[] = [];
    let current = this.#nodes.get(id);
    const guard = this.#nodes.size + 1;
    let steps = 0;
    while (current && current.parentId && steps++ < guard) {
      chain.push(current);
      current = this.#nodes.get(current.parentId);
    }
    let result = normalizeVec3();
    for (const node of chain.reverse()) result = freeze({ x: result.x + node.position.x, y: result.y + node.position.y, z: result.z + node.position.z });
    return result;
  }

  query(predicate: (node: SceneNodeSnapshot) => boolean): readonly SceneNodeSnapshot[] {
    return [...this.#nodes.values()].filter(predicate);
  }

  audit(): Readonly<{ valid: boolean; nodes: number; roots: number; cycles: number; orphaned: number }> {
    let roots = 0; let cycles = 0; let orphaned = 0;
    for (const node of this.#nodes.values()) {
      if (!node.parentId) roots += 1;
      else if (!this.#nodes.has(node.parentId)) orphaned += 1;
      if (this.#wouldCycle(node.id, node.parentId)) cycles += 1;
    }
    return freeze({ valid: roots === 1 && cycles === 0 && orphaned === 0, nodes: this.#nodes.size, roots, cycles, orphaned });
  }

  #setChildren(parentId: EntityId, children: readonly EntityId[]): void {
    const parent = this.#nodes.get(parentId);
    if (!parent) return;
    this.#nodes.set(parentId, freeze({ ...parent, children: [...new Set(children)] }));
  }

  #reparent(id: EntityId, oldParentId: EntityId | null, nextParentId: EntityId | null): void {
    if (oldParentId) {
      const parent = this.#nodes.get(oldParentId);
      if (parent) this.#setChildren(oldParentId, parent.children.filter((child) => child !== id));
    }
    if (nextParentId) {
      const parent = this.#nodes.get(nextParentId);
      if (parent) this.#setChildren(nextParentId, [...parent.children, id]);
    }
  }

  #wouldCycle(id: EntityId, parentId: EntityId | null): boolean {
    if (!parentId) return false;
    let current: EntityId | null = parentId;
    const seen = new Set<EntityId>();
    while (current) {
      if (current === id) return true;
      if (seen.has(current)) return true;
      seen.add(current);
      current = this.#nodes.get(current)?.parentId ?? null;
    }
    return false;
  }
}
