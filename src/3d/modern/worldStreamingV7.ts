import {
  checksumV7,
  distanceSqV7,
  type ChunkIdV7,
  chunkIdV7,
  type RuntimeBudgetV7,
  type StreamTicketV7,
  type Vec3V7,
  type WorldCellV7,
} from './runtimeContractsV7';

export interface CellDescriptorV7 {
  readonly id: ChunkIdV7;
  readonly x: number;
  readonly z: number;
  readonly bytes: number;
  readonly generation: number;
  readonly tags: readonly string[];
}

export interface StreamingPlannerOptionsV7 {
  readonly cellSize?: number;
  readonly nearRadius?: number;
  readonly midRadius?: number;
  readonly farRadius?: number;
  readonly maxActiveCells?: number;
  readonly maxResidentBytes?: number;
  readonly now?: () => number;
}

export interface StreamingSnapshotV7 {
  readonly generation: number;
  readonly center: Vec3V7;
  readonly cells: readonly WorldCellV7[];
  readonly tickets: readonly StreamTicketV7[];
  readonly residentBytes: number;
  readonly checksum: string;
}

export interface StreamingActionV7 {
  readonly type: 'load' | 'upgrade' | 'unload' | 'cancel' | 'sleep';
  readonly chunk: ChunkIdV7;
  readonly priority: number;
  readonly reason: string;
}

const tierFor = (distance: number, options: Required<Pick<StreamingPlannerOptionsV7, 'nearRadius' | 'midRadius' | 'farRadius'>>): WorldCellV7['tier'] => {
  if (distance <= options.nearRadius * 0.25) return 'critical';
  if (distance <= options.nearRadius) return 'near';
  if (distance <= options.midRadius) return 'mid';
  if (distance <= options.farRadius) return 'far';
  return 'sleeping';
};

const priorityFor = (tier: WorldCellV7['tier'], distance: number, velocityAhead: number): number => {
  const base = tier === 'critical' ? 1000 : tier === 'near' ? 700 : tier === 'mid' ? 400 : tier === 'far' ? 120 : 10;
  return base - Math.min(distance, 500) + velocityAhead * 140;
};

const makeTicket = (chunk: ChunkIdV7, priority: number, now: number, generation: number): StreamTicketV7 => Object.freeze({
  id: `stream:${String(chunk)}:${generation}`,
  chunk,
  priority,
  issuedAt: now,
  expiresAt: now + 5000,
  generation,
});

export class WorldStreamingV7 {
  readonly cellSize: number;
  readonly nearRadius: number;
  readonly midRadius: number;
  readonly farRadius: number;
  readonly maxActiveCells: number;
  readonly maxResidentBytes: number;
  #now: () => number;
  #catalogue = new Map<ChunkIdV7, CellDescriptorV7>();
  #state = new Map<ChunkIdV7, WorldCellV7>();
  #tickets = new Map<ChunkIdV7, StreamTicketV7>();
  #generation = 0;
  #center: Vec3V7 = Object.freeze({ x: 0, y: 0, z: 0 });

  constructor(options: StreamingPlannerOptionsV7 = {}) {
    this.cellSize = Math.max(4, options.cellSize ?? 64);
    this.nearRadius = Math.max(this.cellSize, options.nearRadius ?? 140);
    this.midRadius = Math.max(this.nearRadius, options.midRadius ?? 320);
    this.farRadius = Math.max(this.midRadius, options.farRadius ?? 640);
    this.maxActiveCells = Math.max(4, Math.trunc(options.maxActiveCells ?? 256));
    this.maxResidentBytes = Math.max(1, Math.trunc(options.maxResidentBytes ?? 512 * 1024 * 1024));
    this.#now = options.now ?? (() => Date.now());
  }

  register(descriptor: CellDescriptorV7): void {
    if (!descriptor.id || !Number.isFinite(descriptor.x) || !Number.isFinite(descriptor.z)) throw new Error('Invalid world cell descriptor');
    if (!Number.isInteger(descriptor.bytes) || descriptor.bytes < 0) throw new Error('Invalid cell byte estimate');
    this.#catalogue.set(descriptor.id, Object.freeze({ ...descriptor, tags: Object.freeze([...descriptor.tags].sort()) }));
  }

  registerGrid(minX: number, maxX: number, minZ: number, maxZ: number, bytes = 1024 * 1024): void {
    const fromX = Math.floor(Math.min(minX, maxX));
    const toX = Math.ceil(Math.max(minX, maxX));
    const fromZ = Math.floor(Math.min(minZ, maxZ));
    const toZ = Math.ceil(Math.max(minZ, maxZ));
    for (let x = fromX; x <= toX; x += 1) {
      for (let z = fromZ; z <= toZ; z += 1) {
        const id = chunkIdV7(`${x}:${z}`);
        this.register({ id, x, z, bytes, generation: 1, tags: [] });
      }
    }
  }

  plan(center: Vec3V7, velocity: Vec3V7 = { x: 0, y: 0, z: 0 }): readonly StreamingActionV7[] {
    this.#generation += 1;
    this.#center = Object.freeze({ ...center });
    const candidateRows: WorldCellV7[] = [];
    for (const descriptor of this.#catalogue.values()) {
      const worldPosition = { x: descriptor.x * this.cellSize, y: 0, z: descriptor.z * this.cellSize };
      const distance = Math.sqrt(distanceSqV7(center, worldPosition));
      const tier = tierFor(distance, { nearRadius: this.nearRadius, midRadius: this.midRadius, farRadius: this.farRadius });
      const desired = tier !== 'sleeping';
      const previous = this.#state.get(descriptor.id);
      candidateRows.push(Object.freeze({
        id: descriptor.id,
        x: descriptor.x,
        z: descriptor.z,
        distance,
        tier,
        desired,
        loaded: previous?.loaded ?? false,
        resident: previous?.resident ?? false,
        bytes: descriptor.bytes,
      }));
    }
    candidateRows.sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));
    const active = candidateRows.slice(0, this.maxActiveCells);
    const activeIds = new Set(active.map((cell) => cell.id));
    const actions: StreamingActionV7[] = [];

    for (const cell of active) {
      const lookAhead = (cell.x * velocity.x + cell.z * velocity.z) / Math.max(1, Math.abs(velocity.x) + Math.abs(velocity.z));
      const priority = priorityFor(cell.tier, cell.distance, Number.isFinite(lookAhead) ? lookAhead : 0);
      if (!cell.loaded && cell.desired) {
        this.#tickets.set(cell.id, makeTicket(cell.id, priority, this.#now(), this.#generation));
        actions.push(Object.freeze({ type: 'load', chunk: cell.id, priority, reason: `${cell.tier}-interest` }));
      } else if (cell.loaded && cell.tier === 'far' && !cell.resident) {
        actions.push(Object.freeze({ type: 'upgrade', chunk: cell.id, priority, reason: 'far-prefetch' }));
      }
      this.#state.set(cell.id, cell);
    }

    for (const [id, state] of this.#state) {
      if (!activeIds.has(id) && state.loaded) actions.push(Object.freeze({ type: 'unload', chunk: id, priority: 100 - state.distance, reason: 'outside-interest-window' }));
      else if (!activeIds.has(id)) actions.push(Object.freeze({ type: 'sleep', chunk: id, priority: 0, reason: 'inactive-cell' }));
    }

    actions.sort((a, b) => b.priority - a.priority || String(a.chunk).localeCompare(String(b.chunk)));
    return Object.freeze(actions);
  }

  markLoaded(chunk: ChunkIdV7, resident = false): boolean {
    const existing = this.#state.get(chunk);
    if (!existing) return false;
    this.#state.set(chunk, Object.freeze({ ...existing, loaded: true, resident }));
    this.#tickets.delete(chunk);
    return true;
  }

  markUnloaded(chunk: ChunkIdV7): boolean {
    const existing = this.#state.get(chunk);
    if (!existing) return false;
    this.#state.set(chunk, Object.freeze({ ...existing, loaded: false, resident: false }));
    this.#tickets.delete(chunk);
    return true;
  }

  reconcile(budget: RuntimeBudgetV7): readonly StreamingActionV7[] {
    let residentBytes = this.residentBytes();
    const actions: StreamingActionV7[] = [];
    if (residentBytes <= budget.assetBytes && residentBytes <= this.maxResidentBytes) return Object.freeze(actions);
    const loaded = [...this.#state.values()]
      .filter((cell) => cell.loaded && cell.resident)
      .sort((a, b) => b.distance - a.distance || String(b.id).localeCompare(String(a.id)));
    for (const cell of loaded) {
      if (residentBytes <= budget.assetBytes && residentBytes <= this.maxResidentBytes) break;
      actions.push(Object.freeze({ type: 'unload', chunk: cell.id, priority: -cell.distance, reason: 'resident-budget' }));
      residentBytes -= cell.bytes;
    }
    return Object.freeze(actions);
  }

  snapshot(): StreamingSnapshotV7 {
    const cells = Object.freeze([...this.#state.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))));
    const tickets = Object.freeze([...this.#tickets.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)));
    return Object.freeze({ generation: this.#generation, center: this.#center, cells, tickets, residentBytes: this.residentBytes(), checksum: checksumV7({ cells, tickets, center: this.#center, generation: this.#generation }) });
  }

  residentBytes(): number {
    let total = 0;
    for (const cell of this.#state.values()) if (cell.resident) total += cell.bytes;
    return total;
  }

  cell(id: ChunkIdV7): WorldCellV7 | null { return this.#state.get(id) ?? null; }
  ticket(id: ChunkIdV7): StreamTicketV7 | null { return this.#tickets.get(id) ?? null; }
  cells(): readonly WorldCellV7[] { return Object.freeze([...this.#state.values()]); }
  clear(): void { this.#state.clear(); this.#tickets.clear(); }
}
