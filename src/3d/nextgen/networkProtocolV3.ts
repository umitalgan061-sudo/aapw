/** Compact, versioned network protocol primitives for deterministic multiplayer replication. */

import { clamp, quantize, quantizeVec3, roundDeterministic, stableVec3, type Vec3 } from './deterministicMath';

export const NETWORK_PROTOCOL_VERSION = 3;
export const MAX_ENTITIES_PER_SNAPSHOT = 512;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface NetworkEntityState { id: number; position: Vec3; velocity: Vec3; yaw: number; health: number; flags: number }
export interface NetworkSnapshot { version: number; serverTick: number; baselineTick: number; ackSequence: number; entities: NetworkEntityState[] }
export interface NetworkDelta { version: number; serverTick: number; baselineTick: number; ackSequence: number; created: NetworkEntityState[]; updated: Array<{ id: number; position?: Vec3; velocity?: Vec3; yaw?: number; health?: number; flags?: number }>; removed: number[] }
export interface InputCommand { sequence: number; tick: number; moveX: number; moveY: number; yaw: number; actions: number }
export interface DecodeResult<T> { value: T; bytes: number; valid: boolean; reason: string | null }

function stableEntity(entity: NetworkEntityState): NetworkEntityState { return { id: entity.id, position: quantizeVec3(entity.position, 0.001), velocity: quantizeVec3(entity.velocity, 0.001), yaw: roundDeterministic(entity.yaw, 4), health: roundDeterministic(entity.health, 3), flags: entity.flags >>> 0 }; }

export function snapshotDelta(previous: NetworkSnapshot | null, current: NetworkSnapshot): NetworkDelta {
  validateSnapshot(current);
  const previousMap = new Map(previous?.entities.map((entity) => [entity.id, stableEntity(entity)]) ?? []);
  const currentMap = new Map(current.entities.map((entity) => [entity.id, stableEntity(entity)]));
  const created: NetworkEntityState[] = []; const updated: NetworkDelta['updated'] = []; const removed: number[] = [];
  for (const entity of currentMap.values()) {
    const old = previousMap.get(entity.id);
    if (!old) { created.push(entity); continue; }
    const change: NetworkDelta['updated'][number] = { id: entity.id };
    if (distanceSq(entity.position, old.position) > 0.000001) change.position = entity.position;
    if (distanceSq(entity.velocity, old.velocity) > 0.000001) change.velocity = entity.velocity;
    if (Math.abs(entity.yaw - old.yaw) > 0.0001) change.yaw = entity.yaw;
    if (Math.abs(entity.health - old.health) > 0.001) change.health = entity.health;
    if (entity.flags !== old.flags) change.flags = entity.flags;
    if (Object.keys(change).length > 1) updated.push(change);
  }
  for (const old of previousMap.values()) if (!currentMap.has(old.id)) removed.push(old.id);
  created.sort((a, b) => a.id - b.id); updated.sort((a, b) => a.id - b.id); removed.sort((a, b) => a - b);
  return { version: NETWORK_PROTOCOL_VERSION, serverTick: current.serverTick, baselineTick: previous?.serverTick ?? current.baselineTick, ackSequence: current.ackSequence, created, updated, removed };
}

export function applyDelta(baseline: NetworkSnapshot, delta: NetworkDelta): NetworkSnapshot {
  validateSnapshot(baseline); if (delta.version !== NETWORK_PROTOCOL_VERSION) throw new Error(`unsupported network delta version ${delta.version}`);
  const entities = new Map(baseline.entities.map((entity) => [entity.id, stableEntity(entity)]));
  for (const id of delta.removed) entities.delete(id);
  for (const entity of delta.created) entities.set(entity.id, stableEntity(entity));
  for (const patch of delta.updated) { const current = entities.get(patch.id); if (!current) continue; entities.set(patch.id, stableEntity({ ...current, ...patch })); }
  const result: NetworkSnapshot = { version: NETWORK_PROTOCOL_VERSION, serverTick: delta.serverTick, baselineTick: delta.baselineTick, ackSequence: delta.ackSequence, entities: [...entities.values()].sort((a, b) => a.id - b.id) };
  validateSnapshot(result); return result;
}

export function encodeSnapshot(snapshot: NetworkSnapshot): Uint8Array { validateSnapshot(snapshot); return encodeJson(snapshot); }
export function encodeDelta(delta: NetworkDelta): Uint8Array { if (delta.version !== NETWORK_PROTOCOL_VERSION) throw new Error('unsupported delta version'); return encodeJson(delta); }
export function encodeInput(command: InputCommand): Uint8Array { if (!Number.isInteger(command.sequence) || command.sequence <= 0) throw new RangeError('invalid sequence'); if (!Number.isInteger(command.tick) || command.tick < 0) throw new RangeError('invalid tick'); const normalized = { sequence: command.sequence, tick: command.tick, moveX: quantize(clamp(command.moveX, -1, 1), 0.001), moveY: quantize(clamp(command.moveY, -1, 1), 0.001), yaw: quantize(command.yaw, 0.0001), actions: command.actions >>> 0 }; return encodeJson(normalized); }

export function decodeSnapshot(bytes: Uint8Array): DecodeResult<NetworkSnapshot> { return decodeJson<NetworkSnapshot>(bytes, validateSnapshot); }
export function decodeDelta(bytes: Uint8Array): DecodeResult<NetworkDelta> { return decodeJson<NetworkDelta>(bytes, (value) => { if (value.version !== NETWORK_PROTOCOL_VERSION) throw new Error('unsupported delta version'); }); }
export function decodeInput(bytes: Uint8Array): DecodeResult<InputCommand> { return decodeJson<InputCommand>(bytes, (value) => { if (!Number.isInteger(value.sequence) || value.sequence <= 0) throw new Error('invalid sequence'); }); }

export class SnapshotHistory {
  readonly capacity: number; #snapshots: NetworkSnapshot[] = [];
  constructor(capacity = 32) { if (capacity <= 0) throw new RangeError('capacity must be > 0'); this.capacity = capacity; }
  push(snapshot: NetworkSnapshot): void { validateSnapshot(snapshot); this.#snapshots.push(snapshot); while (this.#snapshots.length > this.capacity) this.#snapshots.shift(); }
  latest(): NetworkSnapshot | undefined { return this.#snapshots.at(-1); }
  find(tick: number): NetworkSnapshot | undefined { return this.#snapshots.find((snapshot) => snapshot.serverTick === tick); }
  values(): readonly NetworkSnapshot[] { return this.#snapshots.map((snapshot) => ({ ...snapshot, entities: snapshot.entities.map((entity) => ({ ...entity, position: { ...entity.position }, velocity: { ...entity.velocity } })) })); }
  clear(): void { this.#snapshots.length = 0; }
}

export function validateSnapshot(snapshot: NetworkSnapshot): void {
  if (snapshot.version !== NETWORK_PROTOCOL_VERSION) throw new Error(`unsupported snapshot version ${snapshot.version}`);
  if (!Number.isInteger(snapshot.serverTick) || snapshot.serverTick < 0) throw new Error('invalid serverTick');
  if (!Number.isInteger(snapshot.baselineTick) || snapshot.baselineTick < 0) throw new Error('invalid baselineTick');
  if (!Number.isInteger(snapshot.ackSequence) || snapshot.ackSequence < 0) throw new Error('invalid ackSequence');
  if (snapshot.entities.length > MAX_ENTITIES_PER_SNAPSHOT) throw new Error('entity snapshot capacity exceeded');
  let previousId = -1;
  for (const entity of snapshot.entities) { if (!Number.isInteger(entity.id) || entity.id <= previousId) throw new Error('entity ids must be strictly increasing'); previousId = entity.id; for (const axis of [entity.position.x, entity.position.y, entity.position.z, entity.velocity.x, entity.velocity.y, entity.velocity.z, entity.yaw, entity.health]) if (!Number.isFinite(axis)) throw new Error('snapshot contains non-finite value'); }
}

function encodeJson(value: unknown): Uint8Array { const bytes = new TextEncoder().encode(JSON.stringify(value)); if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error('network payload exceeds budget'); return bytes; }
function decodeJson<T>(bytes: Uint8Array, validate: (value: T) => void): DecodeResult<T> { if (bytes.byteLength > MAX_PAYLOAD_BYTES) return { value: undefined as T, bytes: bytes.byteLength, valid: false, reason: 'payload too large' }; try { const value = JSON.parse(new TextDecoder().decode(bytes)) as T; validate(value); return { value, bytes: bytes.byteLength, valid: true, reason: null }; } catch (error) { return { value: undefined as T, bytes: bytes.byteLength, valid: false, reason: error instanceof Error ? error.message : String(error) }; } }
function distanceSq(a: Vec3, b: Vec3): number { const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z; return x * x + y * y + z * z; }
export function createNetworkEntity(id: number, position: Vec3): NetworkEntityState { return { id, position: stableVec3(position, 0.001), velocity: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, flags: 0 }; }
