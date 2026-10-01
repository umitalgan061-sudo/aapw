import type { EntityId, NetworkEnvelope, PredictionState, Revision, RuntimeCommand, Tick, Transform, Vec3, WorldDelta } from './types';
import { clamp, hashJson, quantizeVec3, stableSort } from './deterministic';

export interface NetworkLimits { readonly maxPayloadBytes: number; readonly maxWindow: number; readonly maxSnapshots: number; readonly maxCorrections: number; }
const DEFAULT_LIMITS: NetworkLimits = Object.freeze({ maxPayloadBytes: 65536, maxWindow: 256, maxSnapshots: 32, maxCorrections: 64 });

export class SequenceWindow {
  readonly size: number; #highest = 0; #received = new Set<number>();
  constructor(size = 256) { this.size = Math.max(8, Math.trunc(size)); }
  accept(sequence: number): boolean {
    const n = Math.trunc(sequence); if (n <= 0) return false;
    if (n <= this.#highest - this.size) return false;
    if (this.#received.has(n)) return false;
    this.#received.add(n); if (n > this.#highest) this.#highest = n;
    for (const old of this.#received) if (old < this.#highest - this.size) this.#received.delete(old);
    return true;
  }
  highest(): number { return this.#highest; }
  has(sequence: number): boolean { return this.#received.has(sequence); }
  reset(): void { this.#highest = 0; this.#received.clear(); }
}

export class CommandValidator {
  readonly limits: NetworkLimits;
  constructor(limits: Partial<NetworkLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }
  validate(command: RuntimeCommand): boolean {
    if (!command.id || !command.type || command.type.length > 128) return false;
    if (!Number.isFinite(command.sequence) || command.sequence < 0) return false;
    const serialized = JSON.stringify(command.payload);
    return typeof serialized === 'string' && serialized.length <= this.limits.maxPayloadBytes;
  }
  envelope(sessionId: string, sequence: number, tick: Tick, kind: NetworkEnvelope['kind'], payload: unknown, ack = 0): NetworkEnvelope {
    const text = JSON.stringify(payload);
    if (text.length > this.limits.maxPayloadBytes) throw new RangeError('network payload exceeds bounded protocol');
    return Object.freeze({ protocol: 40, sessionId: sessionId.slice(0, 128), sequence: Math.max(0, Math.trunc(sequence)), ack: Math.max(0, Math.trunc(ack)), sentAtTick: tick, kind, payload, digest: hashJson(payload) });
  }
}

interface PredictionRecord<T> { readonly sequence: number; readonly tick: Tick; readonly command: RuntimeCommand; readonly predicted: T; }
export class PredictionBuffer<T> {
  readonly maxEntries: number; #entries: PredictionRecord<T>[] = [];
  constructor(maxEntries = 128) { this.maxEntries = Math.max(1, Math.trunc(maxEntries)); }
  push(command: RuntimeCommand, predicted: T): void {
    this.#entries.push(Object.freeze({ sequence: command.sequence, tick: command.tick, command, predicted }));
    if (this.#entries.length > this.maxEntries) this.#entries.shift();
  }
  acknowledge(sequence: number): void { while (this.#entries.length && this.#entries[0]!.sequence <= sequence) this.#entries.shift(); }
  reconcile(authoritative: T, tick: Tick, distance: (a: T, b: T) => number): PredictionState<T> {
    const latest = this.#entries[this.#entries.length - 1];
    if (!latest) return Object.freeze({ inputSequence: 0, tick, predicted: authoritative, authoritative, error: 0 });
    const error = clamp(distance(latest.predicted, authoritative), 0, Number.MAX_SAFE_INTEGER);
    return Object.freeze({ inputSequence: latest.sequence, tick, predicted: latest.predicted, authoritative, error });
  }
  replay(afterSequence: number): readonly RuntimeCommand[] { return Object.freeze(this.#entries.filter((e) => e.sequence > afterSequence).map((e) => e.command)); }
  clear(): void { this.#entries.length = 0; }
  size(): number { return this.#entries.length; }
}

export class TransformReconciler {
  readonly maxCorrectionMeters: number;
  constructor(maxCorrectionMeters = 4) { this.maxCorrectionMeters = Math.max(0.01, maxCorrectionMeters); }
  blend(predicted: Transform, authoritative: Transform, alpha: number): Transform {
    const t = clamp(alpha, 0, 1);
    const dx = authoritative.position.x - predicted.position.x, dy = authoritative.position.y - predicted.position.y, dz = authoritative.position.z - predicted.position.z;
    const distance = Math.hypot(dx, dy, dz);
    const gain = distance > this.maxCorrectionMeters ? 1 : t;
    return Object.freeze({
      position: Object.freeze({ x: predicted.position.x + dx * gain, y: predicted.position.y + dy * gain, z: predicted.position.z + dz * gain }),
      rotation: Object.freeze({ x: predicted.rotation.x + (authoritative.rotation.x - predicted.rotation.x) * gain, y: predicted.rotation.y + (authoritative.rotation.y - predicted.rotation.y) * gain,
        z: predicted.rotation.z + (authoritative.rotation.z - predicted.rotation.z) * gain, w: predicted.rotation.w + (authoritative.rotation.w - predicted.rotation.w) * gain }),
      scale: predicted.scale,
    });
  }
}

export class DeltaApplier {
  readonly maxEntitiesPerBatch: number;
  #revisions = new Map<EntityId, number>();
  constructor(maxEntitiesPerBatch = 2048) { this.maxEntitiesPerBatch = Math.max(1, Math.trunc(maxEntitiesPerBatch)); }
  apply(deltas: readonly WorldDelta[], target: Map<EntityId, { transform: Transform; revision: Revision }>): number {
    let changed = 0;
    for (const delta of stableSort(deltas, (a, b) => Number(a.revision) - Number(b.revision) || a.entityId.localeCompare(b.entityId)).slice(0, this.maxEntitiesPerBatch)) {
      const known = this.#revisions.get(delta.entityId) ?? -1;
      if (Number(delta.revision) <= known || hashJson(delta).length === 0) continue;
      const current = target.get(delta.entityId);
      if (delta.transform && (!current || Number(delta.revision) >= Number(current.revision))) {
        target.set(delta.entityId, { transform: delta.transform, revision: delta.revision }); changed += 1;
      }
      this.#revisions.set(delta.entityId, Number(delta.revision));
    }
    return changed;
  }
  forget(id: EntityId): void { this.#revisions.delete(id); }
  clear(): void { this.#revisions.clear(); }
}

export interface InputSamplerResult { readonly move: Vec3; readonly look: Vec3; readonly jump: boolean; readonly sprint: boolean; }
export function normalizeInput(move: Vec3, look: Vec3, jump: boolean, sprint: boolean): InputSamplerResult {
  const normalized = quantizeVec3({ x: clamp(move.x, -1, 1), y: clamp(move.y, -1, 1), z: clamp(move.z, -1, 1) }, 1 / 256);
  return Object.freeze({ move: normalized, look: quantizeVec3({ x: clamp(look.x, -1, 1), y: clamp(look.y, -1, 1), z: clamp(look.z, -1, 1) }, 1 / 256), jump: Boolean(jump), sprint: Boolean(sprint) });
}
