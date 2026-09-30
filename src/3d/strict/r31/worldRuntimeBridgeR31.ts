import type { RuntimeFrameR31, Vec3R31 } from './applicationTypesR31.ts';

export interface WorldEntityStateR31 {
  readonly id: string;
  readonly position: Vec3R31;
  readonly enabled: boolean;
  readonly layer: number;
  readonly lod: number;
  readonly chunkKey: string;
}

export interface WorldRuntimePortR31 {
  readonly sampleGround: (x: number, z: number) => number;
  readonly queryEntities: (center: Vec3R31, radius: number, layerMask?: number) => readonly WorldEntityStateR31[];
  readonly streamChunk: (chunkX: number, chunkZ: number) => void;
  readonly unloadChunk: (chunkKey: string) => void;
}

export interface WorldRuntimeDiagnosticsR31 {
  readonly queries: number;
  readonly entitiesReturned: number;
  readonly chunkLoads: number;
  readonly chunkUnloads: number;
  readonly invalidGroundSamples: number;
}

export class WorldRuntimeBridgeR31 {
  readonly #port: WorldRuntimePortR31;
  #queries = 0;
  #entitiesReturned = 0;
  #chunkLoads = 0;
  #chunkUnloads = 0;
  #invalidGroundSamples = 0;

  constructor(port: WorldRuntimePortR31) {
    this.#port = port;
  }

  groundY(x: number, z: number): number {
    const value = this.#port.sampleGround(x, z);
    if (!Number.isFinite(value)) {
      this.#invalidGroundSamples++;
      return 0;
    }
    return value;
  }

  visibleEntities(center: Vec3R31, radius: number, layerMask = 0xffff): readonly WorldEntityStateR31[] {
    this.#queries++;
    const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    const source = this.#port.queryEntities(center, safeRadius, layerMask);
    const filtered = source
      .filter((entity) => entity.enabled && Number.isFinite(entity.position.x) && Number.isFinite(entity.position.z))
      .sort((a, b) => a.lod - b.lod || a.id.localeCompare(b.id));
    this.#entitiesReturned += filtered.length;
    return Object.freeze(filtered);
  }

  ensureChunk(chunkX: number, chunkZ: number): void {
    if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) return;
    this.#port.streamChunk(Math.trunc(chunkX), Math.trunc(chunkZ));
    this.#chunkLoads++;
  }

  releaseChunk(chunkKey: string): void {
    if (!chunkKey.trim()) return;
    this.#port.unloadChunk(chunkKey);
    this.#chunkUnloads++;
  }

  tick(frame: RuntimeFrameR31): void {
    void frame;
  }

  diagnostics(): WorldRuntimeDiagnosticsR31 {
    return Object.freeze({
      queries: this.#queries,
      entitiesReturned: this.#entitiesReturned,
      chunkLoads: this.#chunkLoads,
      chunkUnloads: this.#chunkUnloads,
      invalidGroundSamples: this.#invalidGroundSamples,
    });
  }
}
