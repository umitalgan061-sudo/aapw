import {
  asEntityId,
  asSequence,
  asTick,
  type EntityId,
  type InputFrame,
  type NetworkEntityState,
  type NetworkInputCommand,
  type NetworkSnapshot,
  type Sequence,
  type SnapshotDelta,
  type Tick,
  type Vec3,
} from './coreContracts';
import { hashNumbers32, hashObject32, quantize, quantizeVec3 } from './deterministicKernel';

export interface ClientPredictionState<TState> {
  readonly acknowledged: Sequence;
  readonly predicted: readonly NetworkInputCommand[];
  readonly state: TState;
}

export interface InterpolatedState {
  readonly alpha: number;
  readonly older: NetworkSnapshot;
  readonly newer: NetworkSnapshot;
}

export interface NetcodeConfig {
  readonly maxInputHistory: number;
  readonly maxSnapshotHistory: number;
  readonly interpolationDelayTicks: number;
  readonly tickRate: number;
  readonly teleportDistance: number;
}

const DEFAULT_NETCODE: NetcodeConfig = {
  maxInputHistory: 256,
  maxSnapshotHistory: 64,
  interpolationDelayTicks: 2,
  tickRate: 60,
  teleportDistance: 40,
};

export function encodeInputFrame(input: InputFrame): Uint8Array {
  const view = new DataView(new ArrayBuffer(24));
  view.setUint32(0, Number(input.sequence) >>> 0, true);
  view.setUint32(4, Number(input.tick) >>> 0, true);
  view.setInt16(8, Math.round(clampAxis(input.moveX) * 32767), true);
  view.setInt16(10, Math.round(clampAxis(input.moveZ) * 32767), true);
  view.setInt16(12, Math.round(quantize(input.lookX, 1 / 1024) * 4096), true);
  view.setInt16(14, Math.round(quantize(input.lookY, 1 / 1024) * 4096), true);
  view.setUint32(16, input.buttons >>> 0, true);
  const analog = Object.values(input.analog).sort((a, b) => a - b).at(0) ?? 0;
  view.setInt16(20, Math.round(clampAxis(analog) * 32767), true);
  view.setUint16(22, Object.keys(input.analog).length, true);
  return new Uint8Array(view.buffer);
}

export function decodeInputFrame(bytes: Uint8Array): InputFrame {
  if (bytes.byteLength < 24) throw new Error('input payload too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    sequence: asSequence(view.getUint32(0, true)),
    tick: asTick(view.getUint32(4, true)),
    moveX: view.getInt16(8, true) / 32767,
    moveZ: view.getInt16(10, true) / 32767,
    lookX: view.getInt16(12, true) / 4096,
    lookY: view.getInt16(14, true) / 4096,
    buttons: view.getUint32(16, true),
    analog: { primary: view.getInt16(20, true) / 32767 },
  };
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function quantizeNetworkState(state: NetworkEntityState): NetworkEntityState {
  return {
    entity: state.entity,
    position: quantizeVec3(state.position, 1 / 256),
    velocity: quantizeVec3(state.velocity, 1 / 256),
    rotation: {
      x: quantize(state.rotation.x, 1 / 32767),
      y: quantize(state.rotation.y, 1 / 32767),
      z: quantize(state.rotation.z, 1 / 32767),
      w: quantize(state.rotation.w, 1 / 32767),
    },
    flags: state.flags >>> 0,
  };
}

export function stateDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function createSnapshot(
  sequence: Sequence,
  tick: Tick,
  serverTimeMs: number,
  acknowledgedInput: Sequence,
  entities: readonly NetworkEntityState[],
): NetworkSnapshot {
  const normalized = [...entities].map(quantizeNetworkState).sort((a, b) => String(a.entity).localeCompare(String(b.entity)));
  const checksum = hashObject32(normalized);
  return {
    sequence,
    tick,
    serverTimeMs,
    acknowledgedInput,
    entities: normalized,
    checksum,
  };
}

export function diffSnapshots(previous: NetworkSnapshot, current: NetworkSnapshot): SnapshotDelta {
  const before = new Map(previous.entities.map((entity) => [String(entity.entity), entity]));
  const after = new Map(current.entities.map((entity) => [String(entity.entity), entity]));
  const added: NetworkEntityState[] = [];
  const changed: NetworkEntityState[] = [];
  const removed: EntityId[] = [];

  for (const [id, entity] of after) {
    const prior = before.get(id);
    if (!prior) added.push(entity);
    else if (hashObject32(prior) !== hashObject32(entity)) changed.push(entity);
  }
  for (const [id, entity] of before) {
    if (!after.has(id)) removed.push(entity.entity);
  }
  return {
    sequence: current.sequence,
    tick: current.tick,
    baseSequence: previous.sequence,
    added: added.sort((a, b) => String(a.entity).localeCompare(String(b.entity))),
    removed: removed.sort((a, b) => String(a).localeCompare(String(b))),
    changed: changed.sort((a, b) => String(a.entity).localeCompare(String(b.entity))),
  };
}

export function applySnapshotDelta(base: NetworkSnapshot, delta: SnapshotDelta, serverTimeMs: number): NetworkSnapshot {
  const entities = new Map(base.entities.map((entity) => [String(entity.entity), entity]));
  for (const entity of delta.removed) entities.delete(String(entity));
  for (const entity of delta.added) entities.set(String(entity.entity), entity);
  for (const entity of delta.changed) entities.set(String(entity.entity), entity);
  return createSnapshot(delta.sequence, delta.tick, serverTimeMs, base.acknowledgedInput, [...entities.values()]);
}

export class SnapshotBuffer {
  #capacity: number;
  #items: NetworkSnapshot[] = [];

  constructor(capacity = DEFAULT_NETCODE.maxSnapshotHistory) {
    if (capacity < 2) throw new Error('snapshot buffer too small');
    this.#capacity = capacity;
  }

  push(snapshot: NetworkSnapshot): void {
    const existing = this.#items.findIndex((entry) => entry.sequence === snapshot.sequence);
    if (existing >= 0) this.#items[existing] = structuredClone(snapshot);
    else this.#items.push(structuredClone(snapshot));
    this.#items.sort((a, b) => Number(a.tick) - Number(b.tick) || Number(a.sequence) - Number(b.sequence));
    if (this.#items.length > this.#capacity) this.#items.splice(0, this.#items.length - this.#capacity);
  }

  latest(): NetworkSnapshot | undefined {
    const value = this.#items.at(-1);
    return value ? structuredClone(value) : undefined;
  }

  atOrBefore(tick: Tick): NetworkSnapshot | undefined {
    for (let index = this.#items.length - 1; index >= 0; index -= 1) {
      if (this.#items[index]!.tick <= tick) return structuredClone(this.#items[index]!);
    }
    return undefined;
  }

  interpolation(targetTick: number): InterpolatedState | undefined {
    if (this.#items.length === 0) return undefined;
    let older = this.#items[0]!;
    let newer = this.#items.at(-1)!;
    for (let index = 0; index < this.#items.length - 1; index += 1) {
      const a = this.#items[index]!;
      const b = this.#items[index + 1]!;
      if (Number(a.tick) <= targetTick && targetTick <= Number(b.tick)) {
        older = a;
        newer = b;
        break;
      }
    }
    const span = Math.max(1, Number(newer.tick) - Number(older.tick));
    const alpha = Math.max(0, Math.min(1, (targetTick - Number(older.tick)) / span));
    return { alpha, older: structuredClone(older), newer: structuredClone(newer) };
  }

  clear(): void {
    this.#items = [];
  }

  size(): number {
    return this.#items.length;
  }
}

export function interpolateVec3(a: Vec3, b: Vec3, alpha: number): Vec3 {
  const t = Math.max(0, Math.min(1, alpha));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function interpolateEntity(a: NetworkEntityState, b: NetworkEntityState, alpha: number): NetworkEntityState {
  return {
    entity: a.entity,
    position: interpolateVec3(a.position, b.position, alpha),
    velocity: interpolateVec3(a.velocity, b.velocity, alpha),
    rotation: {
      x: a.rotation.x + (b.rotation.x - a.rotation.x) * alpha,
      y: a.rotation.y + (b.rotation.y - a.rotation.y) * alpha,
      z: a.rotation.z + (b.rotation.z - a.rotation.z) * alpha,
      w: a.rotation.w + (b.rotation.w - a.rotation.w) * alpha,
    },
    flags: alpha < 0.5 ? a.flags : b.flags,
  };
}

export interface ReconciliationDecision {
  readonly rollback: boolean;
  readonly reason: 'acknowledged' | 'missing-ack' | 'teleport' | 'prediction-drift' | 'matching';
  readonly distance: number;
}

export function decideReconciliation(
  predicted: NetworkEntityState | undefined,
  authoritative: NetworkEntityState | undefined,
  config: NetcodeConfig = DEFAULT_NETCODE,
): ReconciliationDecision {
  if (!authoritative) return { rollback: false, reason: 'acknowledged', distance: 0 };
  if (!predicted) return { rollback: true, reason: 'missing-ack', distance: 0 };
  const distance = stateDistance(predicted.position, authoritative.position);
  if (distance > config.teleportDistance) return { rollback: true, reason: 'teleport', distance };
  if (distance > 0.15) return { rollback: true, reason: 'prediction-drift', distance };
  return { rollback: false, reason: 'matching', distance };
}

export class InputCommandHistory {
  #capacity: number;
  #items: NetworkInputCommand[] = [];

  constructor(capacity = DEFAULT_NETCODE.maxInputHistory) {
    if (capacity < 2) throw new Error('input history too small');
    this.#capacity = capacity;
  }

  push(command: NetworkInputCommand): void {
    const safe: NetworkInputCommand = { ...command, payload: structuredClone(command.payload) };
    this.#items.push(safe);
    this.#items.sort((a, b) => Number(a.sequence) - Number(b.sequence));
    const deduped: NetworkInputCommand[] = [];
    for (const item of this.#items) {
      if (deduped.at(-1)?.sequence === item.sequence) deduped[deduped.length - 1] = item;
      else deduped.push(item);
    }
    this.#items = deduped.slice(-this.#capacity);
  }

  after(sequence: Sequence): readonly NetworkInputCommand[] {
    return this.#items.filter((item) => item.sequence > sequence).map((item) => structuredClone(item));
  }

  through(sequence: Sequence): void {
    this.#items = this.#items.filter((item) => item.sequence > sequence);
  }

  latest(): NetworkInputCommand | undefined {
    const latest = this.#items.at(-1);
    return latest ? structuredClone(latest) : undefined;
  }

  size(): number {
    return this.#items.length;
  }
}

export function networkDigest(entities: readonly NetworkEntityState[]): number {
  return hashNumbers32(entities
    .slice()
    .sort((a, b) => String(a.entity).localeCompare(String(b.entity)))
    .flatMap((entity) => [
      hashObject32(entity.entity),
      entity.position.x,
      entity.position.y,
      entity.position.z,
      entity.velocity.x,
      entity.velocity.y,
      entity.velocity.z,
      entity.rotation.x,
      entity.rotation.y,
      entity.rotation.z,
      entity.rotation.w,
      entity.flags,
    ]));
}

export function parseEntityId(value: string): EntityId {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error('invalid entity id');
  return asEntityId(normalized);
}
