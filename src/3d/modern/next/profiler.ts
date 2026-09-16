interface NodeData { name: string; calls: number; totalMs: number; selfMs: number; maxMs: number; parent?: NodeData; children: Map<string, NodeData>; }

export interface ProfileNode {
  readonly name: string;
  readonly calls: number;
  readonly totalMs: number;
  readonly selfMs: number;
  readonly maxMs: number;
  readonly children: readonly ProfileNode[];
}

export interface ProfileReport { readonly frameMs: number; readonly roots: readonly ProfileNode[]; }

const now = (): number => globalThis.performance?.now?.() ?? 0;

export class HierarchicalProfiler {
  #roots = new Map<string, NodeData>();
  #stack: Array<{ node: NodeData; startedAt: number; childMs: number }> = [];
  #frameStartedAt = now();
  #enabled = true;

  setEnabled(enabled: boolean): void { this.#enabled = enabled; if (!enabled) this.#stack.length = 0; }
  get enabled(): boolean { return this.#enabled; }

  begin(name: string): void {
    if (!this.#enabled) return;
    const normalized = name.trim() || 'unnamed';
    const parent = this.#stack.at(-1)?.node;
    const map = parent?.children ?? this.#roots;
    let node = map.get(normalized);
    if (!node) {
      node = { name: normalized, calls: 0, totalMs: 0, selfMs: 0, maxMs: 0, parent, children: new Map() };
      map.set(normalized, node);
    }
    node.calls += 1;
    this.#stack.push({ node, startedAt: now(), childMs: 0 });
  }

  end(): void {
    if (!this.#enabled) return;
    const frame = this.#stack.pop();
    if (!frame) return;
    const duration = Math.max(0, now() - frame.startedAt);
    frame.node.totalMs += duration;
    frame.node.selfMs += Math.max(0, duration - frame.childMs);
    frame.node.maxMs = Math.max(frame.node.maxMs, duration);
    const parent = this.#stack.at(-1);
    if (parent) parent.childMs += duration;
  }

  measure<T>(name: string, callback: () => T): T {
    this.begin(name);
    try { return callback(); } finally { this.end(); }
  }

  async measureAsync<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.begin(name);
    try { return await callback(); } finally { this.end(); }
  }

  beginFrame(): void { this.#frameStartedAt = now(); this.resetNodes(); }
  endFrame(): ProfileReport { while (this.#stack.length) this.end(); return { frameMs: Math.max(0, now() - this.#frameStartedAt), roots: this.#buildNodes(this.#roots) }; }
  resetNodes(): void { this.#roots.clear(); this.#stack.length = 0; }

  #buildNodes(nodes: Map<string, NodeData>): ProfileNode[] {
    return [...nodes.values()].sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name)).map((node) => ({ name: node.name, calls: node.calls, totalMs: node.totalMs, selfMs: node.selfMs, maxMs: node.maxMs, children: this.#buildNodes(node.children) }));
  }
}

export interface CounterSnapshot { readonly name: string; readonly value: number; }
export class CounterRegistry {
  #values = new Map<string, number>();
  increment(name: string, amount = 1): number { const key = name.trim(); const next = (this.#values.get(key) ?? 0) + amount; this.#values.set(key, next); return next; }
  set(name: string, value: number): void { this.#values.set(name.trim(), Number.isFinite(value) ? value : 0); }
  get(name: string): number { return this.#values.get(name.trim()) ?? 0; }
  reset(name?: string): void { if (name === undefined) this.#values.clear(); else this.#values.delete(name.trim()); }
  snapshot(): CounterSnapshot[] { return [...this.#values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value })); }
}
