import type { Disposable, SystemDefinition, SystemId } from './types.js';
import { SYSTEM_ID } from './types.js';
import { stableSort, compareString } from './deterministic.js';

export interface GraphNode { readonly id: SystemId; readonly phase: string; readonly priority: number; readonly before: readonly SystemId[]; readonly after: readonly SystemId[]; }
export interface GraphCycle { readonly path: readonly SystemId[]; readonly reason: string; }
export interface GraphPlan { readonly order: readonly SystemId[]; readonly cycles: readonly GraphCycle[]; readonly phases: readonly string[]; readonly revisions: number; readonly valid: boolean; }

export class DependencyGraph implements Disposable {
  private readonly nodes = new Map<SystemId, GraphNode>();
  private readonly edges = new Map<SystemId, Set<SystemId>>();
  private _disposed = false;
  private revision = 0;
  private cachedPlan: GraphPlan | undefined;
  private cachedRevision = -1;

  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.nodes.size; }
  public get graphRevision(): number { return this.revision; }

  public addSystem(system: SystemDefinition): boolean {
    if (this._disposed || this.nodes.has(system.id)) return false;
    const node: GraphNode = Object.freeze({
      id: system.id,
      phase: system.phase,
      priority: Number.isFinite(system.priority) ? system.priority : 0,
      before: Object.freeze([...(system.before ?? [])]),
      after: Object.freeze([...(system.after ?? [])]),
    });
    this.nodes.set(system.id, node);
    this.revision += 1;
    this.cachedRevision = -1;
    return true;
  }

  public upsertSystem(system: SystemDefinition): void {
    if (this._disposed) return;
    this.nodes.delete(system.id);
    this.addSystem(system);
  }

  public removeSystem(id: SystemId): boolean {
    if (this._disposed || !this.nodes.delete(id)) return false;
    this.revision += 1;
    this.cachedRevision = -1;
    return true;
  }

  public clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.revision += 1;
    this.cachedRevision = -1;
  }

  public node(id: SystemId): GraphNode | undefined { return this.nodes.get(id); }
  public has(id: SystemId): boolean { return this.nodes.has(id); }

  public plan(): GraphPlan {
    if (this.cachedPlan && this.cachedRevision === this.revision) return this.cachedPlan;
    this.rebuildEdges();
    const cycles = this.detectCycles();
    const order = cycles.length === 0 ? this.topologicalOrder() : [];
    const phases = stableSort([...new Set([...this.nodes.values()].map(node => node.phase))], compareString);
    const plan: GraphPlan = Object.freeze({ order: Object.freeze(order), cycles: Object.freeze(cycles), phases: Object.freeze(phases), revisions: this.revision, valid: cycles.length === 0 && order.length === this.nodes.size });
    this.cachedPlan = plan;
    this.cachedRevision = this.revision;
    return plan;
  }

  public dependencyChain(target: SystemId): readonly SystemId[] {
    if (!this.nodes.has(target)) return [];
    this.rebuildEdges();
    const result = new Set<SystemId>();
    const visit = (id: SystemId): void => {
      if (result.has(id)) return;
      result.add(id);
      for (const dependency of [...this.edges.entries()].filter(([, destinations]) => destinations.has(id)).map(([source]) => source)) visit(dependency);
    };
    visit(target);
    return Object.freeze(stableSort([...result], (a, b) => this.compareNodes(a, b)));
  }

  public dependents(source: SystemId): readonly SystemId[] {
    if (!this.nodes.has(source)) return [];
    this.rebuildEdges();
    const destinations = [...(this.edges.get(source) ?? [])];
    return Object.freeze(stableSort(destinations, (a, b) => this.compareNodes(a, b)));
  }

  public dispose(): void {
    if (this._disposed) return;
    this.clear();
    this._disposed = true;
  }

  private rebuildEdges(): void {
    this.edges.clear();
    for (const id of this.nodes.keys()) this.edges.set(id, new Set<SystemId>());
    for (const node of this.nodes.values()) {
      for (const before of node.before) if (this.nodes.has(before)) this.edges.get(node.id)?.add(before);
      for (const after of node.after) if (this.nodes.has(after)) this.edges.get(after)?.add(node.id);
    }
    this.addImplicitPhaseEdges();
  }

  private addImplicitPhaseEdges(): void {
    const phaseOrder = new Map<string, number>();
    const phases = stableSort([...new Set([...this.nodes.values()].map(node => node.phase))], compareString);
    phases.forEach((phase, index) => phaseOrder.set(phase, index));
    const grouped = new Map<number, SystemId[]>();
    for (const node of this.nodes.values()) {
      const order = phaseOrder.get(node.phase) ?? 0;
      const group = grouped.get(order) ?? [];
      group.push(node.id);
      grouped.set(order, group);
    }
    const orders = stableSort([...grouped.keys()], (a, b) => a - b);
    for (let i = 0; i < orders.length - 1; i += 1) {
      const current = grouped.get(orders[i]!) ?? [];
      const next = grouped.get(orders[i + 1]!) ?? [];
      for (const a of current) for (const b of next) this.edges.get(a)?.add(b);
    }
  }

  private topologicalOrder(): SystemId[] {
    const indegree = new Map<SystemId, number>();
    for (const id of this.nodes.keys()) indegree.set(id, 0);
    for (const destinations of this.edges.values()) for (const destination of destinations) indegree.set(destination, (indegree.get(destination) ?? 0) + 1);
    const ready = stableSort([...indegree.entries()].filter(([, value]) => value === 0).map(([id]) => id), (a, b) => this.compareNodes(a, b));
    const order: SystemId[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      order.push(id);
      const destinations = stableSort([...(this.edges.get(id) ?? [])], (a, b) => this.compareNodes(a, b));
      for (const destination of destinations) {
        const next = (indegree.get(destination) ?? 1) - 1;
        indegree.set(destination, next);
        if (next === 0) {
          ready.push(destination);
          ready.sort((a, b) => this.compareNodes(a, b));
        }
      }
    }
    return order;
  }

  private detectCycles(): GraphCycle[] {
    const state = new Map<SystemId, 0 | 1 | 2>();
    const stack: SystemId[] = [];
    const cycles: GraphCycle[] = [];
    const visit = (id: SystemId): void => {
      if ((state.get(id) ?? 0) === 2) return;
      if ((state.get(id) ?? 0) === 1) {
        const start = stack.indexOf(id);
        const path = Object.freeze([...(start >= 0 ? stack.slice(start) : stack), id]);
        cycles.push(Object.freeze({ path, reason: 'dependency-cycle' }));
        return;
      }
      state.set(id, 1);
      stack.push(id);
      const destinations = stableSort([...(this.edges.get(id) ?? [])], (a, b) => this.compareNodes(a, b));
      for (const destination of destinations) visit(destination);
      stack.pop();
      state.set(id, 2);
    };
    for (const id of stableSort([...this.nodes.keys()], (a, b) => this.compareNodes(a, b))) visit(id);
    return cycles;
  }

  private compareNodes(a: SystemId, b: SystemId): number {
    const left = this.nodes.get(a);
    const right = this.nodes.get(b);
    if (!left || !right) return String(a).localeCompare(String(b));
    if (left.priority !== right.priority) return right.priority - left.priority;
    if (left.phase !== right.phase) return left.phase < right.phase ? -1 : 1;
    return String(left.id).localeCompare(String(right.id));
  }
}

export const graphSystemId = (value: string): SystemId => SYSTEM_ID(value);
