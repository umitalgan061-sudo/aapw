import { AssetPriority, StreamCell, StreamingJob, Tick, asTick, clamp, distance3, Vec3, stableNumber, hashString } from './contracts.ts';

export interface CellManifestEntry {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly estimatedBytes: number;
  readonly assetIds: readonly string[];
}

export interface StreamingPolicy {
  readonly loadRadius: number;
  readonly unloadRadius: number;
  readonly criticalRadius: number;
  readonly maxConcurrent: number;
  readonly maxLoadsPerFrame: number;
  readonly maxUnloadsPerFrame: number;
  readonly maxResidentBytes: number;
  readonly prefetchVelocitySeconds: number;
}

export interface StreamingMetrics {
  readonly frame: number;
  readonly queued: number;
  readonly loading: number;
  readonly resident: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly loadedBytes: number;
  readonly peakBytes: number;
}

export interface StreamLoader<T> {
  load(cell: CellManifestEntry, signal: AbortSignal): Promise<T>;
  unload?(cell: CellManifestEntry, value: T): void;
}

interface Resident<T> { readonly cell: CellManifestEntry; readonly value: T; readonly bytes: number; lastUsedTick: Tick; priority: AssetPriority }

const priorityValue: Record<AssetPriority, number> = { critical: 5, near: 4, normal: 3, far: 2, background: 1 };

export const classifyCellPriority = (distance: number, policy: StreamingPolicy): AssetPriority => {
  if (distance <= policy.criticalRadius) return 'critical';
  if (distance <= policy.loadRadius * 0.55) return 'near';
  if (distance <= policy.loadRadius * 0.8) return 'normal';
  if (distance <= policy.loadRadius) return 'far';
  return 'background';
};

export const makeCellKey = (x: number, z: number): string => `${Math.floor(x)}:${Math.floor(z)}`;

export class StreamingCoordinator<T> {
  readonly #manifest = new Map<string, CellManifestEntry>();
  readonly #queue = new Map<string, StreamingJob>();
  readonly #loading = new Map<string, { readonly job: StreamingJob; readonly controller: AbortController; readonly promise: Promise<void> }>();
  readonly #resident = new Map<string, Resident<T>>();
  readonly #loader: StreamLoader<T>;
  readonly #policy: StreamingPolicy;
  #tick = asTick(0);
  #frame = 0;
  #cancelled = 0;
  #failed = 0;
  #peakBytes = 0;

  constructor(loader: StreamLoader<T>, policy: StreamingPolicy) {
    this.#loader = loader;
    this.#policy = Object.freeze({ ...policy, loadRadius: Math.max(1, policy.loadRadius), unloadRadius: Math.max(policy.loadRadius, policy.unloadRadius), maxConcurrent: Math.max(1, Math.floor(policy.maxConcurrent)), maxLoadsPerFrame: Math.max(1, Math.floor(policy.maxLoadsPerFrame)), maxUnloadsPerFrame: Math.max(1, Math.floor(policy.maxUnloadsPerFrame)), maxResidentBytes: Math.max(1, policy.maxResidentBytes), prefetchVelocitySeconds: Math.max(0, policy.prefetchVelocitySeconds) });
  }

  registerCell(entry: CellManifestEntry): void {
    if (!entry.key.trim()) throw new Error('stream cell key required');
    this.#manifest.set(entry.key, Object.freeze({ ...entry, assetIds: Object.freeze([...entry.assetIds]) }));
  }

  registerGrid(entries: readonly CellManifestEntry[]): void { for (const entry of entries) this.registerCell(entry); }

  plan(center: Vec3, velocity: Vec3 = { x: 0, y: 0, z: 0 }): readonly StreamingJob[] {
    this.#frame += 1;
    const projected = { x: center.x + velocity.x * this.#policy.prefetchVelocitySeconds, y: center.y, z: center.z + velocity.z * this.#policy.prefetchVelocitySeconds };
    const candidates: StreamingJob[] = [];
    for (const cell of this.#manifest.values()) {
      const distance = Math.hypot(cell.x - projected.x, cell.z - projected.z);
      const priority = classifyCellPriority(distance, this.#policy);
      if (priority === 'background' || distance > this.#policy.loadRadius + 1) continue;
      if (this.#resident.has(cell.key) || this.#loading.has(cell.key)) continue;
      const existing = this.#queue.get(cell.key);
      if (existing) continue;
      const job: StreamingJob = Object.freeze({ id: hashString(`${cell.key}:${this.#frame}`), cell: Object.freeze({ key: cell.key, x: cell.x, z: cell.z, distance: stableNumber(distance), priority }), estimatedBytes: Math.max(0, cell.estimatedBytes), createdAtTick: this.#tick, deadlineTick: asTick(this.#tick + (priority === 'critical' ? 2 : priority === 'near' ? 8 : 20)), status: 'queued' });
      this.#queue.set(cell.key, job);
      candidates.push(job);
    }
    this.#cancelOutside(center);
    return Object.freeze(candidates.sort((a, b) => priorityValue[b.cell.priority] - priorityValue[a.cell.priority] || a.cell.distance - b.cell.distance || a.cell.key.localeCompare(b.cell.key)));
  }

  async pump(tick: Tick = this.#tick): Promise<void> {
    this.#tick = tick;
    const available = Math.max(0, this.#policy.maxConcurrent - this.#loading.size);
    const candidates = [...this.#queue.values()].sort((a, b) => priorityValue[b.cell.priority] - priorityValue[a.cell.priority] || a.deadlineTick - b.deadlineTick || a.id.localeCompare(b.id)).slice(0, Math.min(this.#policy.maxLoadsPerFrame, available));
    await Promise.all(candidates.map((job) => this.#start(job)));
    this.#evictIfNecessary();
  }

  private async #start(job: StreamingJob): Promise<void> {
    const cell = this.#manifest.get(job.cell.key);
    if (!cell) { this.#queue.delete(job.cell.key); return; }
    this.#queue.delete(job.cell.key);
    const controller = new AbortController();
    const loadingJob = Object.freeze({ ...job, status: 'loading' as const });
    const promise = this.#loader.load(cell, controller.signal).then((value) => {
      if (controller.signal.aborted) { this.#cancelled += 1; this.#loader.unload?.(cell, value); return; }
      const resident: Resident<T> = { cell, value, bytes: Math.max(0, cell.estimatedBytes), lastUsedTick: this.#tick, priority: job.cell.priority };
      this.#resident.set(cell.key, resident);
      this.#peakBytes = Math.max(this.#peakBytes, this.residentBytes());
    }).catch(() => { if (!controller.signal.aborted) this.#failed += 1; }).finally(() => this.#loading.delete(cell.key));
    this.#loading.set(cell.key, { job: loadingJob, controller, promise });
    await promise;
  }

  touch(key: string, tick = this.#tick): boolean {
    const resident = this.#resident.get(key);
    if (!resident) return false;
    resident.lastUsedTick = tick;
    return true;
  }

  unload(key: string): boolean {
    const resident = this.#resident.get(key);
    const cell = this.#manifest.get(key);
    if (!resident || !cell) return false;
    this.#loader.unload?.(cell, resident.value);
    this.#resident.delete(key);
    return true;
  }

  cancel(key: string): boolean {
    const loading = this.#loading.get(key);
    if (loading) { loading.controller.abort(); this.#cancelled += 1; return true; }
    const queued = this.#queue.delete(key);
    if (queued) this.#cancelled += 1;
    return queued;
  }

  private #cancelOutside(center: Vec3): void {
    const max = this.#policy.unloadRadius;
    for (const [key, loading] of this.#loading) {
      const cell = this.#manifest.get(key);
      if (!cell) continue;
      if (Math.hypot(cell.x - center.x, cell.z - center.z) > max) loading.controller.abort();
    }
    for (const [key, job] of this.#queue) if (job.cell.distance > max) this.#queue.delete(key);
  }

  private #evictIfNecessary(): void {
    let excess = this.residentBytes() - this.#policy.maxResidentBytes;
    if (excess <= 0) return;
    const victims = [...this.#resident.entries()].sort((a, b) => priorityValue[a[1].priority] - priorityValue[b[1].priority] || a[1].lastUsedTick - b[1].lastUsedTick || a[0].localeCompare(b[0]));
    for (const [key, resident] of victims) {
      if (excess <= 0) break;
      excess -= resident.bytes;
      this.unload(key);
    }
  }

  residentBytes(): number { let bytes = 0; for (const resident of this.#resident.values()) bytes += resident.bytes; return bytes; }
  residentKeys(): readonly string[] { return Object.freeze([...this.#resident.keys()].sort()); }
  queuedKeys(): readonly string[] { return Object.freeze([...this.#queue.keys()].sort()); }
  metrics(): StreamingMetrics { return Object.freeze({ frame: this.#frame, queued: this.#queue.size, loading: this.#loading.size, resident: this.#resident.size, cancelled: this.#cancelled, failed: this.#failed, loadedBytes: this.residentBytes(), peakBytes: this.#peakBytes }); }
  dispose(): void { for (const loading of this.#loading.values()) loading.controller.abort(); for (const resident of this.#resident.values()) this.#loader.unload?.(resident.cell, resident.value); this.#loading.clear(); this.#queue.clear(); this.#resident.clear(); }
}

export const buildSquareManifest = (radius: number, cellSize: number, estimatedBytes = 1024): readonly CellManifestEntry[] => {
  const cells: CellManifestEntry[] = [];
  const r = Math.max(0, Math.floor(radius));
  for (let z = -r; z <= r; z += 1) for (let x = -r; x <= r; x += 1) {
    cells.push(Object.freeze({ key: makeCellKey(x, z), x: x * cellSize, z: z * cellSize, radius: cellSize * 0.707, estimatedBytes, assetIds: Object.freeze([]) }));
  }
  return Object.freeze(cells);
};

export const cellDistance = (cell: CellManifestEntry, position: Vec3): number => distance3({ x: cell.x, y: 0, z: cell.z }, position);
