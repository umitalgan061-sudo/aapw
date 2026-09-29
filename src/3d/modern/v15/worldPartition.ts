import {
  clampV15,
  chunkIdV15,
  distanceV15,
  tickV15,
  type ChunkIdV15,
  type ChunkRecordV15,
  type ChunkSpecV15,
  type StreamDecisionV15,
  type StreamInterestV15,
} from "./types.ts";

export interface WorldPartitionBudgetV15 {
  readonly maxResidentChunks: number;
  readonly maxConcurrentLoads: number;
  readonly maxLoadsPerPlan: number;
  readonly maxUnloadsPerPlan: number;
  readonly prefetchLookaheadSeconds: number;
}

interface InternalInterestV15 extends StreamInterestV15 {
  readonly lastPosition: Readonly<{ x: number; y: number; z: number }>;
}

const DEFAULT_BUDGET: WorldPartitionBudgetV15 = Object.freeze({
  maxResidentChunks: 256,
  maxConcurrentLoads: 6,
  maxLoadsPerPlan: 16,
  maxUnloadsPerPlan: 16,
  prefetchLookaheadSeconds: 0.8,
});

function gridKey(x: number, z: number): string { return Math.trunc(x) + ":" + Math.trunc(z); }

export class PredictiveWorldPartitionV15 {
  readonly #budget: WorldPartitionBudgetV15;
  readonly #chunks = new Map<ChunkIdV15, ChunkRecordV15>();
  readonly #interests = new Map<string, InternalInterestV15>();
  readonly #loading = new Set<ChunkIdV15>();
  #tick = tickV15(0);

  constructor(budget: Partial<WorldPartitionBudgetV15> = {}) {
    this.#budget = Object.freeze({
      ...DEFAULT_BUDGET,
      ...budget,
      maxResidentChunks: Math.max(1, Math.floor(budget.maxResidentChunks ?? DEFAULT_BUDGET.maxResidentChunks)),
      maxConcurrentLoads: Math.max(1, Math.floor(budget.maxConcurrentLoads ?? DEFAULT_BUDGET.maxConcurrentLoads)),
      maxLoadsPerPlan: Math.max(1, Math.floor(budget.maxLoadsPerPlan ?? DEFAULT_BUDGET.maxLoadsPerPlan)),
      maxUnloadsPerPlan: Math.max(1, Math.floor(budget.maxUnloadsPerPlan ?? DEFAULT_BUDGET.maxUnloadsPerPlan)),
      prefetchLookaheadSeconds: Math.max(0, Math.min(5, budget.prefetchLookaheadSeconds ?? DEFAULT_BUDGET.prefetchLookaheadSeconds)),
    });
  }

  defineGrid(options: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly chunkSizeMeters: number; readonly estimatedBytes?: number; readonly generationMs?: number; readonly biome?: string }): number {
    let count = 0;
    const minX = Math.trunc(options.minX);
    const maxX = Math.trunc(options.maxX);
    const minZ = Math.trunc(options.minZ);
    const maxZ = Math.trunc(options.maxZ);
    const estimatedBytes = Math.max(0, Math.floor(options.estimatedBytes ?? 512 * 1024));
    const generationMs = Math.max(0, options.generationMs ?? 1);
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.define({
          id: chunkIdV15(gridKey(x, z)),
          x, z,
          radiusMeters: options.chunkSizeMeters * 0.72,
          estimatedBytes,
          generationMs,
          critical: x === 0 && z === 0,
          biome: options.biome ?? "unknown",
        })) count += 1;
      }
    }
    return count;
  }

  define(spec: ChunkSpecV15): boolean {
    if (this.#chunks.has(spec.id)) return false;
    if (!Number.isFinite(spec.x) || !Number.isFinite(spec.z) || spec.radiusMeters < 0 || spec.estimatedBytes < 0 || spec.generationMs < 0) throw new RangeError("invalid chunk spec");
    this.#chunks.set(spec.id, Object.freeze({
      ...spec,
      state: "absent",
      score: 0,
      lastDesiredTick: tickV15(0),
      lastResidentTick: tickV15(0),
    }));
    return true;
  }

  setInterest(interest: StreamInterestV15): void {
    const previous = this.#interests.get(interest.id);
    this.#interests.set(interest.id, {
      ...interest,
      priority: clampV15(interest.priority, 0, 1_000),
      viewDistance: Math.max(0, interest.viewDistance),
      position: { ...interest.position },
      velocity: { ...interest.velocity },
      lastPosition: previous?.position ? { ...previous.position } : { ...interest.position },
    });
  }

  removeInterest(id: string): boolean { return this.#interests.delete(id); }

  plan(tick: number): readonly StreamDecisionV15[] {
    this.#tick = tickV15(Math.max(0, Math.floor(tick)));
    const scored = [...this.#chunks.values()].map(chunk => ({ chunk, score: this.#score(chunk) }));
    const decisions: StreamDecisionV15[] = [];
    const loads = scored
      .filter(({ chunk, score }) => chunk.state !== "resident" && score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, this.#budget.maxLoadsPerPlan);

    for (const { chunk, score } of loads) {
      const action: StreamDecisionV15["action"] = chunk.state === "cooldown" ? "prefetch" : "load";
      this.#chunks.set(chunk.id, Object.freeze({
        ...chunk,
        state: chunk.state === "cooldown" || chunk.state === "absent" ? "desired" : chunk.state,
        score,
        lastDesiredTick: this.#tick,
      }));
      decisions.push(Object.freeze({
        chunk: chunk.id,
        action,
        score: Number(score.toFixed(4)),
        reason: this.#reason(chunk, score),
      }));
    }

    const residents = scored
      .filter(({ chunk }) => chunk.state === "resident")
      .sort((a, b) => a.score - b.score || a.chunk.id.localeCompare(b.chunk.id));
    const overflow = Math.max(0, residents.length - this.#budget.maxResidentChunks + this.#loading.size);
    for (const { chunk, score } of residents.slice(0, Math.min(this.#budget.maxUnloadsPerPlan, overflow))) {
      if (chunk.critical || this.#isPinned(chunk)) continue;
      this.#setState(chunk.id, "cooldown");
      decisions.push(Object.freeze({
        chunk: chunk.id,
        action: "unload",
        score: Number(score.toFixed(4)),
        reason: "resident-budget",
      }));
    }
    return Object.freeze(decisions);
  }

  beginLoad(id: ChunkIdV15): boolean {
    if (this.#loading.size >= this.#budget.maxConcurrentLoads) return false;
    const chunk = this.#chunks.get(id);
    if (!chunk || chunk.state === "resident" || chunk.state === "loading") return false;
    this.#loading.add(id);
    this.#setState(id, "loading");
    return true;
  }

  completeLoad(id: ChunkIdV15): boolean {
    const chunk = this.#chunks.get(id);
    if (!chunk || !this.#loading.delete(id)) return false;
    this.#setState(id, "resident");
    const current = this.#chunks.get(id);
    if (current) this.#chunks.set(id, Object.freeze({ ...current, lastResidentTick: this.#tick }));
    return true;
  }

  failLoad(id: ChunkIdV15): boolean {
    if (!this.#loading.delete(id)) return false;
    this.#setState(id, "cooldown");
    return true;
  }

  forceResident(id: ChunkIdV15): boolean {
    const chunk = this.#chunks.get(id);
    if (!chunk) return false;
    if (chunk.state === "resident") return true;
    if (this.residentIds().length >= this.#budget.maxResidentChunks) {
      const victim = [...this.#chunks.values()]
        .filter(c => c.state === "resident" && !c.critical && !this.#isPinned(c))
        .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0];
      if (!victim) return false;
      this.#setState(victim.id, "cooldown");
    }
    this.#loading.delete(id);
    this.#setState(id, "resident");
    return true;
  }

  setState(id: ChunkIdV15, state: ChunkRecordV15["state"]): boolean {
    if (!this.#chunks.has(id)) return false;
    if (state !== "resident" && this.#chunks.get(id)?.critical && state === "cooldown") return false;
    this.#setState(id, state);
    return true;
  }

  chunk(id: ChunkIdV15): ChunkRecordV15 | undefined {
    const chunk = this.#chunks.get(id);
    return chunk ? this.#clone(chunk) : undefined;
  }

  residentIds(): readonly ChunkIdV15[] {
    return Object.freeze([...this.#chunks.values()].filter(c => c.state === "resident").map(c => c.id).sort((a, b) => a.localeCompare(b)));
  }

  loadingIds(): readonly ChunkIdV15[] {
    return Object.freeze([...this.#loading].sort((a, b) => a.localeCompare(b)));
  }

  desiredIds(): readonly ChunkIdV15[] {
    return Object.freeze([...this.#chunks.values()].filter(c => c.state === "desired" || c.state === "queued" || c.state === "loading").map(c => c.id).sort((a, b) => a.localeCompare(b)));
  }

  stats(): Readonly<{ defined: number; resident: number; loading: number; desired: number; bytesResident: number; maxResident: number; utilization: number }> {
    let resident = 0;
    let loading = 0;
    let desired = 0;
    let bytes = 0;
    for (const chunk of this.#chunks.values()) {
      if (chunk.state === "resident") { resident += 1; bytes += chunk.estimatedBytes; }
      if (chunk.state === "loading") loading += 1;
      if (chunk.state === "desired" || chunk.state === "queued" || chunk.state === "loading") desired += 1;
    }
    return Object.freeze({
      defined: this.#chunks.size,
      resident,
      loading,
      desired,
      bytesResident: bytes,
      maxResident: this.#budget.maxResidentChunks,
      utilization: this.#budget.maxResidentChunks === 0 ? 0 : resident / this.#budget.maxResidentChunks,
    });
  }

  serialize(): readonly ChunkRecordV15[] {
    return Object.freeze([...this.#chunks.values()].sort((a, b) => a.id.localeCompare(b.id)).map(c => this.#clone(c)));
  }

  restore(records: readonly ChunkRecordV15[]): void {
    this.#chunks.clear();
    this.#loading.clear();
    for (const record of records) this.#chunks.set(record.id, this.#clone(record));
  }

  digest(): number {
    let value = 2166136261;
    for (const chunk of this.serialize()) {
      const line = String(chunk.id) + "|" + chunk.state + "|" + chunk.score.toFixed(4) + "|" + chunk.lastDesiredTick + "|" + chunk.lastResidentTick;
      for (let index = 0; index < line.length; index += 1) {
        value ^= line.charCodeAt(index);
        value = Math.imul(value, 16777619);
      }
    }
    return value >>> 0;
  }

  #score(chunk: ChunkRecordV15): number {
    let best = chunk.critical ? 0.35 : 0;
    const center = { x: chunk.x * 500 + 250, y: 0, z: chunk.z * 500 + 250 };
    for (const interest of this.#interests.values()) {
      const predicted = {
        x: interest.position.x + interest.velocity.x * this.#budget.prefetchLookaheadSeconds,
        y: interest.position.y,
        z: interest.position.z + interest.velocity.z * this.#budget.prefetchLookaheadSeconds,
      };
      const distance = distanceV15(center, predicted);
      const horizon = Math.max(1, interest.viewDistance + chunk.radiusMeters);
      if (distance > horizon) continue;
      const spatial = clampV15(1 - distance / horizon, 0, 1);
      const speed = clampV15(Math.hypot(interest.velocity.x, interest.velocity.z) / 20, 0, 1) * 0.18;
      const priority = 0.25 + interest.priority / 1_000;
      best = Math.max(best, spatial * (priority + speed + (chunk.critical ? 0.35 : 0)));
    }
    return clampV15(best, 0, 1);
  }

  #reason(chunk: ChunkRecordV15, score: number): string {
    if (chunk.critical) return "critical-world-cell";
    if (score >= 0.75) return "high-spatial-interest";
    if (score >= 0.4) return "predictive-interest";
    return "peripheral-prefetch";
  }

  #setState(id: ChunkIdV15, state: ChunkRecordV15["state"]): void {
    const chunk = this.#chunks.get(id);
    if (!chunk) return;
    this.#chunks.set(id, Object.freeze({ ...chunk, state }));
  }

  #isPinned(chunk: ChunkRecordV15): boolean {
    const center = { x: chunk.x * 500 + 250, y: 0, z: chunk.z * 500 + 250 };
    for (const interest of this.#interests.values()) {
      if (distanceV15(center, interest.position) <= Math.max(50, interest.viewDistance * 0.15)) return true;
    }
    return false;
  }

  #clone(chunk: ChunkRecordV15): ChunkRecordV15 { return Object.freeze({ ...chunk }); }
}
