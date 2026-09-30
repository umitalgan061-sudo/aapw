import { stableDigest } from './deterministic.ts';

export type AssetGraphState =
  | 'declared'
  | 'queued'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export type AssetGraphPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface AssetGraphNode {
  readonly id: string;
  readonly url: string;
  readonly kind: string;
  readonly dependencies: readonly string[];
  readonly priority: AssetGraphPriority;
  readonly estimatedBytes: number;
  readonly optional: boolean;
  readonly state: AssetGraphState;
  readonly revision: number;
  readonly attempts: number;
  readonly error: string | null;
}

export interface AssetGraphBudget {
  readonly maxConcurrent: number;
  readonly maxResidentBytes: number;
  readonly maxInFlightBytes: number;
  readonly maxRetries: number;
}

export interface AssetLoadPlanItem {
  readonly id: string;
  readonly priority: AssetGraphPriority;
  readonly dependencies: readonly string[];
  readonly estimatedBytes: number;
  readonly reason: 'ready' | 'dependency' | 'priority' | 'prefetch';
}

export interface AssetGraphSnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly nodes: readonly AssetGraphNode[];
  readonly digest: string;
}

const priorityWeight = (priority: AssetGraphPriority): number =>
  ({ critical: 5, high: 4, normal: 3, low: 2, background: 1 })[priority];

const cleanId = (value: string): string => value.trim().slice(0, 128);
const cleanUrl = (value: string): string => value.trim().slice(0, 2048);
const safeBytes = (value: number): number => Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);

export class AssetGraphV3 {
  readonly #nodes = new Map<string, AssetGraphNode>();
  readonly #dependents = new Map<string, Set<string>>();
  readonly #budget: AssetGraphBudget;
  #residentBytes = 0;
  #inFlightBytes = 0;
  #inFlight = 0;
  #revision = 0;

  constructor(budget: Partial<AssetGraphBudget> = {}) {
    this.#budget = Object.freeze({
      maxConcurrent: Math.max(1, Math.floor(budget.maxConcurrent ?? 8)),
      maxResidentBytes: Math.max(1024, safeBytes(budget.maxResidentBytes ?? 512 * 1024 * 1024)),
      maxInFlightBytes: Math.max(1024, safeBytes(budget.maxInFlightBytes ?? 128 * 1024 * 1024)),
      maxRetries: Math.max(0, Math.floor(budget.maxRetries ?? 2)),
    });
  }

  declare(node: Omit<AssetGraphNode, 'state' | 'revision' | 'attempts' | 'error'>): AssetGraphNode {
    const id = cleanId(node.id);
    if (!id) throw new Error('Asset id cannot be empty.');
    if (this.#nodes.has(id)) throw new Error(`Asset ${id} already exists.`);
    const normalized = Object.freeze({
      id,
      url: cleanUrl(node.url),
      kind: String(node.kind).trim().slice(0, 64),
      dependencies: Object.freeze([...new Set(node.dependencies.map(cleanId).filter(Boolean))].sort()),
      priority: node.priority,
      estimatedBytes: safeBytes(node.estimatedBytes),
      optional: node.optional === true,
      state: 'declared' as const,
      revision: ++this.#revision,
      attempts: 0,
      error: null,
    });
    this.#assertNoCycle(id, normalized.dependencies);
    this.#nodes.set(id, normalized);
    for (const dependency of normalized.dependencies) {
      const set = this.#dependents.get(dependency) ?? new Set<string>();
      set.add(id);
      this.#dependents.set(dependency, set);
    }
    return normalized;
  }

  get(id: string): AssetGraphNode | undefined {
    return this.#nodes.get(cleanId(id));
  }

  all(): readonly AssetGraphNode[] {
    return Object.freeze([...this.#nodes.values()].sort((a, b) =>
      priorityWeight(b.priority) - priorityWeight(a.priority) || a.id.localeCompare(b.id),
    ));
  }

  state(id: string): AssetGraphState | undefined {
    return this.get(id)?.state;
  }

  plan(limit = this.#budget.maxConcurrent): readonly AssetLoadPlanItem[] {
    const candidates: AssetLoadPlanItem[] = [];
    for (const node of this.#nodes.values()) {
      if (!this.#canQueue(node)) continue;
      const blockedDependency = node.dependencies.find((dependency) => {
        const state = this.#nodes.get(dependency)?.state;
        return state === 'failed' || state === 'blocked' || state === undefined;
      });
      if (blockedDependency) continue;
      const unresolved = node.dependencies.filter((dependency) => this.#nodes.get(dependency)?.state !== 'ready');
      const reason: AssetLoadPlanItem['reason'] =
        unresolved.length > 0 ? 'dependency' : node.priority === 'background' ? 'prefetch' : 'priority';
      candidates.push(Object.freeze({
        id: node.id,
        priority: node.priority,
        dependencies: Object.freeze(unresolved),
        estimatedBytes: node.estimatedBytes,
        reason,
      }));
    }
    candidates.sort((a, b) =>
      priorityWeight(b.priority) - priorityWeight(a.priority)
      || a.dependencies.length - b.dependencies.length
      || a.estimatedBytes - b.estimatedBytes
      || a.id.localeCompare(b.id),
    );
    return Object.freeze(candidates.slice(0, Math.max(0, Math.floor(limit))));
  }

  begin(id: string): AssetGraphNode | null {
    const current = this.#nodes.get(cleanId(id));
    if (!current || !this.#canQueue(current)) return null;
    if (this.#inFlight >= this.#budget.maxConcurrent) return null;
    if (this.#inFlightBytes + current.estimatedBytes > this.#budget.maxInFlightBytes) return null;
    if (!this.#dependenciesReadyForLoad(current)) return null;
    const next = this.#replace(current, {
      state: 'loading',
      attempts: current.attempts + 1,
      error: null,
    });
    this.#inFlight += 1;
    this.#inFlightBytes += current.estimatedBytes;
    return next;
  }

  complete(id: string, actualBytes?: number): AssetGraphNode | null {
    const current = this.#nodes.get(cleanId(id));
    if (!current || current.state !== 'loading') return null;
    const bytes = safeBytes(actualBytes ?? current.estimatedBytes);
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    this.#inFlightBytes = Math.max(0, this.#inFlightBytes - current.estimatedBytes);
    const nextResident = this.#residentBytes + bytes;
    if (nextResident > this.#budget.maxResidentBytes && !current.optional) {
      const next = this.#replace(current, {
        state: 'failed',
        error: 'resident budget exceeded',
      });
      this.#propagateBlocked(current.id);
      return next;
    }
    this.#residentBytes = nextResident;
    return this.#replace(current, {
      state: 'ready',
      estimatedBytes: bytes,
      error: null,
    });
  }

  fail(id: string, error: unknown, retry = true): AssetGraphNode | null {
    const current = this.#nodes.get(cleanId(id));
    if (!current || current.state !== 'loading') return null;
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    this.#inFlightBytes = Math.max(0, this.#inFlightBytes - current.estimatedBytes);
    const message = String(error instanceof Error ? error.message : error).slice(0, 512);
    const canRetry = retry && current.attempts <= this.#budget.maxRetries;
    const next = this.#replace(current, {
      state: canRetry ? 'queued' : 'failed',
      error: message,
    });
    if (!canRetry) this.#propagateBlocked(current.id);
    return next;
  }

  cancel(id: string): AssetGraphNode | null {
    const current = this.#nodes.get(cleanId(id));
    if (!current || !['declared', 'queued', 'loading'].includes(current.state)) return null;
    if (current.state === 'loading') {
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#inFlightBytes = Math.max(0, this.#inFlightBytes - current.estimatedBytes);
    }
    return this.#replace(current, { state: 'cancelled', error: null });
  }

  queue(id: string): AssetGraphNode | null {
    const current = this.#nodes.get(cleanId(id));
    if (!current || !['declared', 'cancelled', 'failed'].includes(current.state)) return null;
    return this.#replace(current, { state: 'queued', error: null });
  }

  invalidate(id: string): readonly AssetGraphNode[] {
    const root = this.#nodes.get(cleanId(id));
    if (!root) return Object.freeze([]);
    const affected = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const dependent of [...(this.#dependents.get(current) ?? [])].sort()) {
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        queue.push(dependent);
      }
    }

    let releasedBytes = 0;
    const changed = [...affected].sort().map((nodeId) => {
      const node = this.#nodes.get(nodeId)!;
      if (node.state === 'ready') releasedBytes += node.estimatedBytes;
      return this.#replace(node, {
        state: node.optional ? 'declared' : 'queued',
        error: null,
      });
    });
    this.#residentBytes = Math.max(0, this.#residentBytes - releasedBytes);
    return Object.freeze(changed);
  }

  evict(id: string): boolean {
    const node = this.#nodes.get(cleanId(id));
    if (!node || node.state !== 'ready' || this.#hasReadyDependents(node.id)) return false;
    this.#residentBytes = Math.max(0, this.#residentBytes - node.estimatedBytes);
    this.#replace(node, { state: 'declared', error: null });
    return true;
  }

  cascadeEvict(ids: readonly string[]): number {
    const ordered = [...new Set(ids.map(cleanId))].sort();
    let count = 0;
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of ordered) {
        if (this.evict(id)) {
          count += 1;
          progress = true;
        }
      }
    }
    return count;
  }

  residentBytes(): number {
    return this.#residentBytes;
  }

  inFlightBytes(): number {
    return this.#inFlightBytes;
  }

  inFlightCount(): number {
    return this.#inFlight;
  }

  budget(): AssetGraphBudget {
    return this.#budget;
  }

  snapshot(): AssetGraphSnapshot {
    const nodes = this.all();
    const payload = {
      version: 1 as const,
      revision: this.#revision,
      nodes,
    };
    return Object.freeze({
      ...payload,
      digest: stableDigest(payload),
    });
  }

  restore(snapshot: AssetGraphSnapshot): void {
    if (snapshot.version !== 1) throw new Error('Unsupported asset graph snapshot version.');
    this.#nodes.clear();
    this.#dependents.clear();
    this.#residentBytes = 0;
    this.#inFlightBytes = 0;
    this.#inFlight = 0;
    this.#revision = snapshot.revision;
    for (const source of snapshot.nodes) {
      const node = Object.freeze({ ...source, dependencies: Object.freeze([...source.dependencies]) });
      this.#nodes.set(node.id, node);
      if (node.state === 'ready') this.#residentBytes += node.estimatedBytes;
      if (node.state === 'loading') {
        this.#inFlight += 1;
        this.#inFlightBytes += node.estimatedBytes;
      }
      for (const dependency of node.dependencies) {
        const set = this.#dependents.get(dependency) ?? new Set<string>();
        set.add(node.id);
        this.#dependents.set(dependency, set);
      }
    }
  }

  digest(): string {
    return this.snapshot().digest;
  }

  stats(): Readonly<{
    nodes: number;
    ready: number;
    loading: number;
    queued: number;
    failed: number;
    blocked: number;
    cancelled: number;
    residentBytes: number;
    inFlightBytes: number;
  }> {
    const counts = { ready: 0, loading: 0, queued: 0, failed: 0, blocked: 0, cancelled: 0 };
    for (const node of this.#nodes.values()) {
      if (node.state in counts) counts[node.state as keyof typeof counts] += 1;
    }
    return Object.freeze({
      nodes: this.#nodes.size,
      ...counts,
      residentBytes: this.#residentBytes,
      inFlightBytes: this.#inFlightBytes,
    });
  }

  #canQueue(node: AssetGraphNode): boolean {
    return ['declared', 'queued'].includes(node.state);
  }

  #dependenciesReadyForLoad(node: AssetGraphNode): boolean {
    return node.dependencies.every((dependency) => this.#nodes.get(dependency)?.state === 'ready');
  }

  #replace(node: AssetGraphNode, patch: Partial<AssetGraphNode>): AssetGraphNode {
    const next = Object.freeze({ ...node, ...patch, revision: ++this.#revision });
    this.#nodes.set(node.id, next);
    return next;
  }

  #propagateBlocked(id: string): void {
    const queue = [id];
    const visited = new Set(queue);
    while (queue.length) {
      const current = queue.shift()!;
      for (const dependentId of [...(this.#dependents.get(current) ?? [])].sort()) {
        if (visited.has(dependentId)) continue;
        visited.add(dependentId);
        const dependent = this.#nodes.get(dependentId);
        if (!dependent || dependent.state === 'ready') continue;
        this.#replace(dependent, { state: 'blocked', error: `dependency ${current} unavailable` });
        queue.push(dependentId);
      }
    }
  }

  #hasReadyDependents(id: string): boolean {
    for (const dependent of this.#dependents.get(id) ?? []) {
      if (this.#nodes.get(dependent)?.state === 'ready') return true;
    }
    return false;
  }

  #assertNoCycle(id: string, dependencies: readonly string[]): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) throw new Error(`Asset dependency cycle detected at ${nodeId}.`);
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      for (const dependency of this.#nodes.get(nodeId)?.dependencies ?? (nodeId === id ? dependencies : [])) visit(dependency);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    visit(id);
  }
}

