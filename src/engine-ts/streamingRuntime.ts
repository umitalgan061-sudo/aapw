import type { Disposable, EntityId } from './coreTypes.js';
import { stableSort } from './coreTypes.js';

export type StreamState = 'cold' | 'queued' | 'loading' | 'resident' | 'cooling' | 'unloaded';
export interface StreamItem { readonly id: EntityId; readonly priority: number; readonly bytes: number; readonly distance: number; readonly state: StreamState; readonly required: boolean; readonly lastUsedAt: number; }
export interface StreamRequest { readonly id: EntityId; readonly priority: number; readonly reason: 'visible' | 'prefetch' | 'dependency' | 'restore'; }
export interface StreamBudget { readonly maxBytes: number; readonly maxConcurrent: number; readonly targetFrameMs: number; }
export interface StreamStats { readonly items: number; readonly queued: number; readonly loading: number; readonly resident: number; readonly residentBytes: number; readonly dropped: number; }

export class StreamingRuntime implements Disposable {
  readonly budget: StreamBudget;
  #items = new Map<EntityId, StreamItem>();
  #queue: StreamRequest[] = [];
  #active = new Set<EntityId>();
  #residentBytes = 0;
  #dropped = 0;
  #now: () => number;
  #disposed = false;

  constructor(budget: Partial<StreamBudget> = {}, now: () => number = () => Date.now()) { this.budget = Object.freeze({ maxBytes: 256 * 1024 * 1024, maxConcurrent: 4, targetFrameMs: 16.67, ...budget }); this.#now = now; }

  register(item: Omit<StreamItem, 'state' | 'lastUsedAt'>): boolean {
    if (this.#disposed || this.#items.has(item.id) || item.bytes < 0) return false;
    this.#items.set(item.id, Object.freeze({ ...item, state: 'cold', lastUsedAt: this.#now() })); return true;
  }
  request(request: StreamRequest): boolean {
    const item = this.#items.get(request.id); if (!item || this.#disposed || this.#active.has(request.id)) return false;
    if (this.#queue.some(existing => existing.id === request.id)) return false;
    this.#queue.push(Object.freeze({ ...request, priority: request.priority + (request.reason === 'visible' ? 100 : request.reason === 'dependency' ? 60 : 0) }));
    this.#queue = stableSort(this.#queue, (a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
    this.#items.set(request.id, Object.freeze({ ...item, state: 'queued', lastUsedAt: this.#now() })); return true;
  }
  begin(): readonly EntityId[] { if (this.#disposed) return []; const started: EntityId[] = []; while (this.#active.size < this.budget.maxConcurrent && this.#queue.length) { const next = this.#queue.shift()!; const item = this.#items.get(next.id); if (!item) continue; this.#active.add(next.id); this.#items.set(next.id, Object.freeze({ ...item, state: 'loading' })); started.push(next.id); } return Object.freeze(started); }
  complete(id: EntityId, success: boolean): boolean { const item = this.#items.get(id); if (!item || !this.#active.has(id)) return false; this.#active.delete(id); if (success) { this.#residentBytes += item.bytes; this.#items.set(id, Object.freeze({ ...item, state: 'resident', lastUsedAt: this.#now() })); } else { this.#items.set(id, Object.freeze({ ...item, state: 'cold', lastUsedAt: this.#now() })); this.#dropped += 1; } this.evictToBudget(); return true; }
  touch(id: EntityId, distance = 0, priority?: number): void { const item = this.#items.get(id); if (!item) return; this.#items.set(id, Object.freeze({ ...item, distance, priority: priority ?? item.priority, lastUsedAt: this.#now() })); }
  evictToBudget(target = this.budget.maxBytes): number { const candidates = stableSort([...this.#items.values()].filter(item => item.state === 'resident' && !item.required && !this.#active.has(item.id)), (a, b) => a.lastUsedAt - b.lastUsedAt || a.priority - b.priority); let count = 0; for (const item of candidates) { if (this.#residentBytes <= target) break; this.#items.set(item.id, Object.freeze({ ...item, state: 'unloaded' })); this.#residentBytes = Math.max(0, this.#residentBytes - item.bytes); count += 1; } return count; }
  items(): readonly StreamItem[] { return Object.freeze(stableSort([...this.#items.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): StreamStats { let queued = 0; let loading = 0; let resident = 0; for (const item of this.#items.values()) { if (item.state === 'queued') queued += 1; else if (item.state === 'loading') loading += 1; else if (item.state === 'resident') resident += 1; } return Object.freeze({ items: this.#items.size, queued, loading, resident, residentBytes: this.#residentBytes, dropped: this.#dropped }); }
  dispose(): void { this.#disposed = true; this.#items.clear(); this.#queue.length = 0; this.#active.clear(); this.#residentBytes = 0; }
}
