import { EntityId, Tick, Vec3, clamp, distanceSquared, hashString, mixHash, tickValue } from './types.ts';

export type StreamClass = 'critical' | 'near' | 'far' | 'background';
export type StreamState = 'unloaded' | 'queued' | 'loading' | 'resident' | 'cooldown' | 'failed';

export interface StreamCell {
  key: string;
  center: Vec3;
  radius: number;
  class: StreamClass;
  estimatedBytes: number;
  generationCostMs: number;
  dependencyKeys: readonly string[];
  state: StreamState;
  lastRequestedTick: Tick;
  lastResidentTick: Tick;
  failureCount: number;
}

export interface StreamBudget {
  frameMs: number;
  bytes: number;
  concurrent: number;
  requests: number;
}

export interface StreamInterest {
  owner: EntityId;
  position: Vec3;
  velocity: Vec3;
  viewDistance: number;
  priority: number;
}

export interface StreamDecision {
  key: string;
  score: number;
  class: StreamClass;
  action: 'load' | 'keep' | 'unload' | 'retry';
  reason: string;
}

export interface StreamStats {
  resident: number;
  queued: number;
  loading: number;
  failed: number;
  bytesResident: number;
  plannedLoads: number;
  plannedUnloads: number;
  rejectedLoads: number;
}

interface Candidate { cell: StreamCell; score: number; reason: string; }

const CLASS_WEIGHT: Record<StreamClass, number> = {
  critical: 1000,
  near: 600,
  far: 250,
  background: 50,
};

const DEFAULT_BUDGET: StreamBudget = {
  frameMs: 4,
  bytes: 96 * 1024 * 1024,
  concurrent: 4,
  requests: 24,
};

function cellKey(x: number, z: number): string { return `${x}:${z}`; }

export class WorldStreamingOrchestratorV2 {
  readonly #cells = new Map<string, StreamCell>();
  readonly #queue = new Set<string>();
  readonly #interests = new Map<EntityId, StreamInterest>();
  readonly #budget: StreamBudget;
  #tick: Tick = tickValue(0);

  constructor(budget: Partial<StreamBudget> = {}) {
    this.#budget = { ...DEFAULT_BUDGET, ...budget };
  }

  define(cell: Omit<StreamCell, 'state' | 'lastRequestedTick' | 'lastResidentTick' | 'failureCount'>): void {
    if (!cell.key.trim()) throw new RangeError('Stream cell key must not be empty');
    if (this.#cells.has(cell.key)) throw new Error(`Stream cell ${cell.key} already defined`);
    if (cell.radius < 0 || cell.estimatedBytes < 0 || cell.generationCostMs < 0) throw new RangeError('Invalid stream cell dimensions');
    this.#cells.set(cell.key, { ...cell, state: 'unloaded', lastRequestedTick: tickValue(0), lastResidentTick: tickValue(0), failureCount: 0 });
  }

  defineGrid(options: { originX: number; originZ: number; width: number; depth: number; cellSize: number; estimatedBytes?: number; generationCostMs?: number }): void {
    const bytes = options.estimatedBytes ?? 256 * 1024;
    const cost = options.generationCostMs ?? 0.5;
    for (let z = 0; z < options.depth; z += 1) {
      for (let x = 0; x < options.width; x += 1) {
        const worldX = options.originX + x * options.cellSize;
        const worldZ = options.originZ + z * options.cellSize;
        this.define({ key: cellKey(x, z), center: { x: worldX, y: 0, z: worldZ }, radius: options.cellSize * 0.71, class: 'background', estimatedBytes: bytes, generationCostMs: cost, dependencyKeys: [] });
      }
    }
  }

  setInterest(interest: StreamInterest): void {
    this.#interests.set(interest.owner, { ...interest, priority: clamp(interest.priority, 0, 1000), viewDistance: Math.max(0, interest.viewDistance), position: { ...interest.position }, velocity: { ...interest.velocity } });
  }

  removeInterest(owner: EntityId): boolean { return this.#interests.delete(owner); }

  markLoading(key: string, tick = this.#tick): boolean {
    const cell = this.#cells.get(key);
    if (!cell || cell.state === 'loading' || cell.state === 'resident') return false;
    cell.state = 'loading';
    cell.lastRequestedTick = tick;
    this.#queue.delete(key);
    return true;
  }

  markResident(key: string, tick = this.#tick): boolean {
    const cell = this.#cells.get(key);
    if (!cell) return false;
    cell.state = 'resident';
    cell.lastResidentTick = tick;
    cell.failureCount = 0;
    this.#queue.delete(key);
    return true;
  }

  markFailed(key: string): boolean {
    const cell = this.#cells.get(key);
    if (!cell) return false;
    cell.state = 'failed';
    cell.failureCount += 1;
    this.#queue.delete(key);
    return true;
  }

  markUnloaded(key: string): boolean {
    const cell = this.#cells.get(key);
    if (!cell) return false;
    cell.state = 'unloaded';
    this.#queue.delete(key);
    return true;
  }

  plan(tick: Tick): StreamDecision[] {
    this.#tick = tick;
    const candidates: Candidate[] = [];
    for (const cell of this.#cells.values()) {
      const relevance = this.#relevance(cell);
      if (cell.state === 'resident') {
        const keep = relevance >= 0.18 || cell.class === 'critical';
        if (!keep) candidates.push({ cell, score: relevance, reason: 'outside_interest_horizon' });
        continue;
      }
      if (this.#queue.has(cell.key)) continue;
      if (cell.state === 'failed' && cell.failureCount >= 3) continue;
      const score = relevance * CLASS_WEIGHT[cell.class];
      if (relevance > 0 || cell.class === 'critical') candidates.push({ cell, score, reason: relevance > 0.6 ? 'high_interest' : 'predictive_interest' });
    }
    const loads = candidates
      .filter((candidate) => candidate.cell.state !== 'resident')
      .sort((a, b) => (b.score - a.score) || a.cell.key.localeCompare(b.cell.key))
      .slice(0, this.#budget.requests);
    const unloads = candidates
      .filter((candidate) => candidate.cell.state === 'resident')
      .sort((a, b) => (a.score - b.score) || a.cell.key.localeCompare(b.cell.key))
      .slice(0, this.#budget.requests);
    const decisions: StreamDecision[] = [];
    for (const candidate of loads) {
      const action = candidate.cell.state === 'failed' ? 'retry' : 'load';
      this.#queue.add(candidate.cell.key);
      candidate.cell.state = 'queued';
      candidate.cell.lastRequestedTick = tick;
      decisions.push({ key: candidate.cell.key, score: candidate.score, class: candidate.cell.class, action, reason: candidate.reason });
    }
    for (const candidate of unloads) {
      candidate.cell.state = 'cooldown';
      decisions.push({ key: candidate.cell.key, score: candidate.score, class: candidate.cell.class, action: 'unload', reason: candidate.reason });
    }
    return decisions;
  }

  requiredDependencies(key: string): string[] {
    const cell = this.#cells.get(key);
    if (!cell) return [];
    const seen = new Set<string>();
    const visit = (candidate: string): void => {
      if (seen.has(candidate)) return;
      seen.add(candidate);
      const dependency = this.#cells.get(candidate);
      if (!dependency) return;
      for (const child of dependency.dependencyKeys) visit(child);
    };
    for (const dependency of cell.dependencyKeys) visit(dependency);
    seen.delete(key);
    return [...seen].sort();
  }

  residentWithin(position: Vec3, radius: number): StreamCell[] {
    const radiusSquared = radius * radius;
    return [...this.#cells.values()]
      .filter((cell) => cell.state === 'resident' && distanceSquared(cell.center, position) <= (radiusSquared + cell.radius * cell.radius))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  cell(key: string): StreamCell | undefined {
    const cell = this.#cells.get(key);
    return cell ? { ...cell, center: { ...cell.center }, dependencyKeys: [...cell.dependencyKeys] } : undefined;
  }

  allCells(): StreamCell[] { return [...this.#cells.values()].sort((a, b) => a.key.localeCompare(b.key)).map((cell) => ({ ...cell, center: { ...cell.center }, dependencyKeys: [...cell.dependencyKeys] })); }

  stats(): StreamStats {
    let resident = 0;
    let queued = 0;
    let loading = 0;
    let failed = 0;
    let bytesResident = 0;
    for (const cell of this.#cells.values()) {
      if (cell.state === 'resident') { resident += 1; bytesResident += cell.estimatedBytes; }
      else if (cell.state === 'queued') queued += 1;
      else if (cell.state === 'loading') loading += 1;
      else if (cell.state === 'failed') failed += 1;
    }
    const decisions = this.planPreview();
    return { resident, queued, loading, failed, bytesResident, plannedLoads: decisions.filter((entry) => entry.action === 'load' || entry.action === 'retry').length, plannedUnloads: decisions.filter((entry) => entry.action === 'unload').length, rejectedLoads: Math.max(0, this.#queue.size - this.#budget.requests) };
  }

  planPreview(): StreamDecision[] {
    const tick = this.#tick;
    const previousQueue = new Set(this.#queue);
    const previousStates = new Map([...this.#cells.values()].map((cell) => [cell.key, cell.state]));
    const result = this.plan(tick);
    for (const cell of this.#cells.values()) {
      cell.state = previousStates.get(cell.key)!;
      if (cell.state === 'queued') this.#queue.delete(cell.key);
    }
    this.#queue.clear();
    for (const key of previousQueue) this.#queue.add(key);
    return result;
  }

  digest(): number {
    let digest = hashString(String(this.#tick));
    for (const cell of this.allCells()) {
      digest = mixHash(digest, hashString(`${cell.key}:${cell.state}:${cell.failureCount}`));
      digest = mixHash(digest, Math.round(cell.center.x));
      digest = mixHash(digest, Math.round(cell.center.z));
    }
    return digest;
  }

  #relevance(cell: StreamCell): number {
    let best = 0;
    for (const interest of this.#interests.values()) {
      const predicted = { x: interest.position.x + interest.velocity.x * 0.75, y: interest.position.y, z: interest.position.z + interest.velocity.z * 0.75 };
      const distance = Math.sqrt(distanceSquared(cell.center, predicted));
      const horizon = Math.max(1, interest.viewDistance + cell.radius);
      if (distance > horizon) continue;
      const spatial = clamp(1 - distance / horizon, 0, 1);
      const classBoost = cell.class === 'critical' ? 1 : cell.class === 'near' ? 0.9 : cell.class === 'far' ? 0.65 : 0.35;
      best = Math.max(best, spatial * classBoost * (0.5 + interest.priority / 200));
    }
    return clamp(best, 0, 1);
  }
}

export function createSquareCellKey(x: number, z: number): string { return cellKey(x, z); }
