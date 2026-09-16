export type ContentionDomainV5 = 'simulation' | 'render' | 'assets' | 'network' | 'input' | 'persistence' | 'worker';
export interface LockRequestV5 { readonly owner: string; readonly domain: ContentionDomainV5; readonly priority: number; readonly deadline: number; readonly units: number; }
export interface LockLeaseV5 { readonly token: string; readonly owner: string; readonly domain: ContentionDomainV5; readonly units: number; readonly expiresAt: number; }
export interface ContentionOptionsV5 { readonly capacity?: Partial<Record<ContentionDomainV5, number>>; readonly maxQueue?: number; readonly leaseMs?: number; readonly now?: () => number; }
export interface ContentionMetricsV5 { readonly queued: number; readonly active: number; readonly rejected: number; readonly expired: number; readonly grants: number; }

const DOMAINS: readonly ContentionDomainV5[] = ['simulation', 'render', 'assets', 'network', 'input', 'persistence', 'worker'];
const defaults: Readonly<Record<ContentionDomainV5, number>> = Object.freeze({ simulation: 4, render: 8, assets: 8, network: 4, input: 2, persistence: 2, worker: 8 });

export class ContentionCoordinatorV5 {
  readonly capacity: Readonly<Record<ContentionDomainV5, number>>; readonly maxQueue: number; readonly leaseMs: number;
  #now: () => number; #queue: LockRequestV5[] = []; #leases = new Map<string, LockLeaseV5>(); #used = new Map<ContentionDomainV5, number>(); #sequence = 0; #rejected = 0; #expired = 0; #grants = 0;
  constructor(options: ContentionOptionsV5 = {}) { this.capacity = Object.freeze(Object.fromEntries(DOMAINS.map((domain) => [domain, Math.max(1, Math.floor(options.capacity?.[domain] ?? defaults[domain]))])) as Record<ContentionDomainV5, number>); this.maxQueue = Math.max(16, Math.min(100_000, Math.floor(options.maxQueue ?? 4096))); this.leaseMs = Math.max(10, Math.min(60_000, Math.floor(options.leaseMs ?? 500))); this.#now = options.now ?? (() => Date.now()); }
  request(request: LockRequestV5): string | null { this.#expire(); const units = Math.max(1, Math.floor(request.units)); if (units > this.capacity[request.domain] || !request.owner) { this.#rejected += 1; return null; } if (this.#queue.length >= this.maxQueue) { this.#rejected += 1; return null; } const normalized = Object.freeze({ ...request, units, priority: Math.floor(request.priority), deadline: Number.isFinite(request.deadline) ? request.deadline : this.#now() + this.leaseMs }); this.#queue.push(normalized); this.#schedule(); const granted = this.#findOwnerLease(request.owner, request.domain); return granted?.token ?? null; }
  release(token: string): boolean { this.#expire(); const lease = this.#leases.get(token); if (!lease) return false; this.#leases.delete(token); this.#used.set(lease.domain, Math.max(0, (this.#used.get(lease.domain) ?? 0) - lease.units)); this.#schedule(); return true; }
  renew(token: string): boolean { this.#expire(); const lease = this.#leases.get(token); if (!lease) return false; this.#leases.set(token, Object.freeze({ ...lease, expiresAt: this.#now() + this.leaseMs })); return true; }
  leases(domain?: ContentionDomainV5): readonly LockLeaseV5[] { this.#expire(); return Object.freeze([...this.#leases.values()].filter((lease) => !domain || lease.domain === domain).sort((a, b) => a.token.localeCompare(b.token))); }
  queue(domain?: ContentionDomainV5): readonly LockRequestV5[] { return Object.freeze(this.#queue.filter((request) => !domain || request.domain === domain)); }
  available(domain: ContentionDomainV5): number { this.#expire(); return Math.max(0, this.capacity[domain] - (this.#used.get(domain) ?? 0)); }
  metrics(): ContentionMetricsV5 { this.#expire(); return Object.freeze({ queued: this.#queue.length, active: this.#leases.size, rejected: this.#rejected, expired: this.#expired, grants: this.#grants }); }
  clear(): void { this.#queue.length = 0; this.#leases.clear(); this.#used.clear(); this.#rejected = 0; this.#expired = 0; this.#grants = 0; }
  #findOwnerLease(owner: string, domain: ContentionDomainV5): LockLeaseV5 | undefined { return [...this.#leases.values()].find((lease) => lease.owner === owner && lease.domain === domain); }
  #schedule(): void { this.#queue.sort((a, b) => b.priority - a.priority || a.deadline - b.deadline || a.owner.localeCompare(b.owner)); for (let index = 0; index < this.#queue.length;) { const request = this.#queue[index]!; if (request.deadline < this.#now()) { this.#queue.splice(index, 1); this.#rejected += 1; continue; } const used = this.#used.get(request.domain) ?? 0; if (used + request.units > this.capacity[request.domain]) { index += 1; continue; } this.#queue.splice(index, 1); const token = `lease-${++this.#sequence}`; const lease = Object.freeze({ token, owner: request.owner, domain: request.domain, units: request.units, expiresAt: this.#now() + this.leaseMs }); this.#leases.set(token, lease); this.#used.set(request.domain, used + request.units); this.#grants += 1; } }
  #expire(): void { const now = this.#now(); for (const [token, lease] of this.#leases) { if (lease.expiresAt > now) continue; this.#leases.delete(token); this.#used.set(lease.domain, Math.max(0, (this.#used.get(lease.domain) ?? 0) - lease.units)); this.#expired += 1; } this.#schedule(); }
}

export function createDefaultContentionV5(now?: () => number): ContentionCoordinatorV5 { return new ContentionCoordinatorV5({ now }); }
