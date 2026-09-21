import type { Disposable } from './types.js';
import { clamp, stableSort } from './deterministic.js';

export type ResourceKind = 'cpu' | 'gpu' | 'memory' | 'entities' | 'events' | 'commands' | 'audio' | 'network';
export interface ResourceRequest {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly amount: number;
  readonly priority: number;
  readonly critical?: boolean;
  readonly pinned?: boolean;
  readonly group?: string;
}
export interface ResourceGrant {
  readonly requestId: string;
  readonly kind: ResourceKind;
  readonly requested: number;
  readonly granted: number;
  readonly accepted: boolean;
  readonly reason: string;
  readonly revision: number;
}
export interface ResourceQuota {
  readonly kind: ResourceKind;
  readonly capacity: number;
  readonly reserved: number;
  readonly used: number;
  readonly available: number;
  readonly utilization: number;
}
export interface ResourceSchedule {
  readonly grants: readonly ResourceGrant[];
  readonly quotas: readonly ResourceQuota[];
  readonly accepted: number;
  readonly rejected: number;
  readonly revision: number;
}

const RESOURCE_KINDS: readonly ResourceKind[] = Object.freeze(['cpu', 'gpu', 'memory', 'entities', 'events', 'commands', 'audio', 'network']);

export class ResourceScheduler implements Disposable {
  private readonly capacity = new Map<ResourceKind, number>();
  private readonly reserved = new Map<ResourceKind, number>();
  private readonly used = new Map<ResourceKind, number>();
  private readonly history: ResourceGrant[] = [];
  private readonly maxHistory: number;
  private revision = 0;
  private _disposed = false;

  public constructor(options: { maxHistory?: number; capacities?: Partial<Record<ResourceKind, number>> } = {}) {
    this.maxHistory = Math.max(32, Math.trunc(options.maxHistory ?? 2048));
    const defaults: Record<ResourceKind, number> = { cpu: 16.6, gpu: 16.6, memory: 512 * 1024 * 1024, entities: 200000, events: 4096, commands: 4096, audio: 128, network: 256 };
    for (const kind of RESOURCE_KINDS) {
      this.capacity.set(kind, Math.max(0, Number(options.capacities?.[kind] ?? defaults[kind])));
      this.reserved.set(kind, 0);
      this.used.set(kind, 0);
    }
  }

  public get disposed(): boolean { return this._disposed; }
  public setCapacity(kind: ResourceKind, capacity: number): boolean {
    if (this._disposed || !Number.isFinite(capacity) || capacity < 0) return false;
    this.capacity.set(kind, capacity);
    this.revision += 1;
    return true;
  }

  public reserve(kind: ResourceKind, amount: number): boolean {
    if (this._disposed || !Number.isFinite(amount) || amount < 0) return false;
    const next = (this.reserved.get(kind) ?? 0) + amount;
    if (next + (this.used.get(kind) ?? 0) > (this.capacity.get(kind) ?? 0)) return false;
    this.reserved.set(kind, next);
    this.revision += 1;
    return true;
  }

  public releaseReservation(kind: ResourceKind, amount: number): void {
    if (this._disposed) return;
    this.reserved.set(kind, Math.max(0, (this.reserved.get(kind) ?? 0) - Math.max(0, amount)));
    this.revision += 1;
  }

  public schedule(requests: readonly ResourceRequest[]): ResourceSchedule {
    if (this._disposed) return Object.freeze({ grants: [], quotas: [], accepted: 0, rejected: requests.length, revision: this.revision });
    const projected = new Map(this.used);
    const grants: ResourceGrant[] = [];
    const ordered = stableSort(requests, (a, b) => {
      if (Boolean(b.critical) !== Boolean(a.critical)) return Boolean(b.critical) ? 1 : -1;
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return Boolean(b.pinned) ? 1 : -1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.id.localeCompare(b.id);
    });
    for (const request of ordered) {
      const amount = Math.max(0, Number.isFinite(request.amount) ? request.amount : 0);
      const capacity = this.capacity.get(request.kind) ?? 0;
      const reserved = this.reserved.get(request.kind) ?? 0;
      const used = projected.get(request.kind) ?? 0;
      const available = Math.max(0, capacity - reserved - used);
      const grant = request.critical ? amount <= available ? amount : 0 : Math.min(amount, available);
      const accepted = request.critical ? grant === amount : grant > 0 || amount === 0;
      const reason = accepted ? 'granted' : request.critical ? 'critical-budget-shortfall' : 'quota-exhausted';
      projected.set(request.kind, used + grant);
      const result: ResourceGrant = Object.freeze({ requestId: request.id, kind: request.kind, requested: amount, granted: grant, accepted, reason, revision: this.revision + 1 });
      grants.push(result);
      this.history.push(result);
      while (this.history.length > this.maxHistory) this.history.shift();
    }
    this.used.clear();
    for (const kind of RESOURCE_KINDS) this.used.set(kind, projected.get(kind) ?? 0);
    this.revision += 1;
    const accepted = grants.filter(grant => grant.accepted).length;
    return Object.freeze({ grants: Object.freeze(grants), quotas: this.quotas(), accepted, rejected: grants.length - accepted, revision: this.revision });
  }

  public quotas(): readonly ResourceQuota[] {
    return Object.freeze(RESOURCE_KINDS.map(kind => {
      const capacity = this.capacity.get(kind) ?? 0;
      const reserved = this.reserved.get(kind) ?? 0;
      const used = this.used.get(kind) ?? 0;
      return Object.freeze({ kind, capacity, reserved, used, available: Math.max(0, capacity - reserved - used), utilization: capacity > 0 ? clamp((reserved + used) / capacity, 0, 1) : 1 });
    }));
  }

  public utilization(kind: ResourceKind): number { const quota = this.quotas().find(item => item.kind === kind); return quota?.utilization ?? 1; }
  public history(kind?: ResourceKind): readonly ResourceGrant[] { return Object.freeze(this.history.filter(grant => kind === undefined || grant.kind === kind).map(grant => Object.freeze({ ...grant }))); }

  public rebalance(targetUtilization = 0.82): readonly ResourceKind[] {
    if (this._disposed) return [];
    const target = clamp(targetUtilization, 0.1, 0.99);
    const reduced: ResourceKind[] = [];
    for (const quota of this.quotas()) {
      if (quota.utilization <= target || quota.used <= 0) continue;
      this.used.set(quota.kind, quota.used * target / Math.max(0.01, quota.utilization));
      reduced.push(quota.kind);
    }
    if (reduced.length) this.revision += 1;
    return Object.freeze(reduced);
  }

  public resetFrameUsage(): void {
    if (this._disposed) return;
    for (const kind of RESOURCE_KINDS) this.used.set(kind, 0);
    this.revision += 1;
  }

  public clear(): void {
    for (const kind of RESOURCE_KINDS) { this.reserved.set(kind, 0); this.used.set(kind, 0); }
    this.history.length = 0;
    this.revision += 1;
  }
  public dispose(): void { if (this._disposed) return; this.clear(); this.capacity.clear(); this.reserved.clear(); this.used.clear(); this._disposed = true; }
}
