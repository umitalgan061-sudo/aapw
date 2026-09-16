import { DeterministicWorld } from './deterministicWorld.ts';
import { Vec3, Tick, clamp, stableNumber, hashString } from './contracts.ts';

export interface WorldCell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly biome: string;
  readonly elevation: number;
  readonly moisture: number;
  readonly temperature: number;
  readonly danger: number;
  readonly version: number;
}

export interface WorldQuery {
  readonly center: Vec3;
  readonly radius: number;
  readonly maxResults?: number;
}

export interface WorldEvent {
  readonly id: string;
  readonly tick: Tick;
  readonly kind: 'spawn' | 'despawn' | 'weather' | 'quest' | 'combat' | 'discovery';
  readonly cellKey: string;
  readonly seed: number;
}

export interface WorldSnapshot {
  readonly tick: Tick;
  readonly seed: number;
  readonly cells: readonly WorldCell[];
  readonly events: readonly WorldEvent[];
  readonly checksum: string;
}

export interface ProceduralWorldOptions {
  readonly seed: number;
  readonly cellSize?: number;
  readonly worldRadius?: number;
}

const BIOMES = ['plains', 'forest', 'mountain', 'wetland', 'coast', 'desert', 'tundra'] as const;
const cellKey = (x: number, z: number): string => `${x}:${z}`;

export class ProceduralWorld {
  readonly #seed: number;
  readonly #cellSize: number;
  readonly #radius: number;
  readonly #world: DeterministicWorld;
  readonly #cells = new Map<string, WorldCell>();
  readonly #events: WorldEvent[] = [];
  #lastTick: Tick = 0 as Tick;

  constructor(options: ProceduralWorldOptions) {
    this.#seed = options.seed >>> 0;
    this.#cellSize = Math.max(1, options.cellSize ?? 32);
    this.#radius = Math.max(1, Math.floor(options.worldRadius ?? 64));
    this.#world = new DeterministicWorld(this.#seed);
  }

  generateCell(x: number, z: number): WorldCell {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const key = cellKey(cx, cz);
    const existing = this.#cells.get(key);
    if (existing) return existing;
    const nx = cx * 0.071;
    const nz = cz * 0.067;
    const elevationNoise = this.#world.sampleNoise(nx, nz, 1.7);
    const moistureNoise = this.#world.sampleNoise(nx + 193, nz - 71, 1.2);
    const temperatureNoise = this.#world.sampleNoise(nx - 47, nz + 113, 0.8);
    const elevation = stableNumber((elevationNoise - 0.35) * 180);
    const moisture = stableNumber(moistureNoise);
    const temperature = stableNumber(clamp(temperatureNoise - elevation / 500, 0, 1));
    const biomeIndex = Math.floor((moisture * 0.55 + temperature * 0.45) * BIOMES.length) % BIOMES.length;
    const biome = BIOMES[biomeIndex]!;
    const danger = stableNumber(clamp((this.#world.sampleNoise(nx + 17, nz + 31, 0.6) + (biome === 'mountain' ? 0.2 : 0)) * 0.75, 0, 1));
    const cell: WorldCell = Object.freeze({ key, x: cx, z: cz, biome, elevation, moisture, temperature, danger, version: 1 });
    this.#cells.set(key, cell);
    return cell;
  }

  generateAround(position: Vec3, radius = this.#radius): readonly WorldCell[] {
    const cx = Math.floor(position.x / this.#cellSize);
    const cz = Math.floor(position.z / this.#cellSize);
    const r = Math.max(0, Math.floor(radius));
    const cells: WorldCell[] = [];
    for (let z = cz - r; z <= cz + r; z += 1) for (let x = cx - r; x <= cx + r; x += 1) cells.push(this.generateCell(x, z));
    return Object.freeze(cells.sort((a, b) => a.key.localeCompare(b.key)));
  }

  query(query: WorldQuery): readonly WorldCell[] {
    const radius = Math.max(0, query.radius);
    const radiusSquared = radius * radius;
    const cells: WorldCell[] = [];
    for (const cell of this.#cells.values()) {
      const px = cell.x * this.#cellSize;
      const pz = cell.z * this.#cellSize;
      const dx = px - query.center.x;
      const dz = pz - query.center.z;
      if (dx * dx + dz * dz <= radiusSquared) cells.push(cell);
    }
    cells.sort((a, b) => {
      const da = Math.hypot(a.x * this.#cellSize - query.center.x, a.z * this.#cellSize - query.center.z);
      const db = Math.hypot(b.x * this.#cellSize - query.center.x, b.z * this.#cellSize - query.center.z);
      return da - db || a.key.localeCompare(b.key);
    });
    return Object.freeze(cells.slice(0, Math.max(1, query.maxResults ?? cells.length)));
  }

  step(dtSeconds: number): void { const state = this.#world.step(dtSeconds); this.#lastTick = state.tick; if (Number(state.tick) % 120 === 0) this.emitEvent('weather', '0:0'); }

  emitEvent(kind: WorldEvent['kind'], cellKeyValue: string): WorldEvent {
    const id = hashString(`${this.#seed}:${this.#lastTick}:${kind}:${cellKeyValue}:${this.#events.length}`);
    const event: WorldEvent = Object.freeze({ id, tick: this.#lastTick, kind, cellKey: cellKeyValue, seed: this.#seed });
    this.#events.push(event);
    if (this.#events.length > 2048) this.#events.splice(0, this.#events.length - 2048);
    return event;
  }

  eventsSince(tick: Tick): readonly WorldEvent[] { return Object.freeze(this.#events.filter((event) => event.tick >= tick)); }
  cell(key: string): WorldCell | undefined { return this.#cells.get(key); }
  cells(): readonly WorldCell[] { return Object.freeze([...this.#cells.values()].sort((a, b) => a.key.localeCompare(b.key))); }
  tick(): Tick { return this.#lastTick; }
  snapshot(): WorldSnapshot { const cells = this.cells(); const events = Object.freeze([...this.#events]); const payload = { tick: this.#lastTick, seed: this.#seed, cells, events }; return Object.freeze({ ...payload, checksum: hashString(JSON.stringify(payload)) }); }
  clearOutside(position: Vec3, keepRadius: number): number { const radiusSquared = Math.max(0, keepRadius) ** 2; let removed = 0; for (const [key, cell] of this.#cells) { const distance = Math.hypot(cell.x * this.#cellSize - position.x, cell.z * this.#cellSize - position.z); if (distance > radiusSquared) { this.#cells.delete(key); removed += 1; } } return removed; }
}

export const worldHeightAt = (world: ProceduralWorld, position: Vec3): number => {
  const x = Math.floor(position.x / 32);
  const z = Math.floor(position.z / 32);
  return world.generateCell(x, z).elevation;
};
