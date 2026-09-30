import type { EntityId, Result, Tick, Vec3 } from './coreTypes.ts';
import { err, ok, stableSort } from './coreTypes.ts';

export interface NetworkSequence {
  readonly channel: string;
  readonly sequence: number;
  readonly acknowledged: number;
}

export interface InputCommand {
  readonly tick: Tick;
  readonly sequence: number;
  readonly action: string;
  readonly value: number;
}

export interface EntityNetState {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  readonly flags: number;
}

export interface WorldSnapshotPacket {
  readonly protocol: 'aapw-net-v2';
  readonly tick: Tick;
  readonly sequence: number;
  readonly serverTimeMs: number;
  readonly entities: readonly EntityNetState[];
  readonly checksum: string;
}

export interface WorldDeltaPacket {
  readonly protocol: 'aapw-net-v2';
  readonly tick: Tick;
  readonly baseSequence: number;
  readonly sequence: number;
  readonly upserts: readonly EntityNetState[];
  readonly removals: readonly EntityId[];
  readonly checksum: string;
}

const quantize = (value: number, step: number): number => Math.round((Number.isFinite(value) ? value : 0) / step) * step;
const canonicalEntity = (state: EntityNetState): EntityNetState => Object.freeze({
  entity: state.entity,
  position: Object.freeze({ x: quantize(state.position.x, 0.001), y: quantize(state.position.y, 0.001), z: quantize(state.position.z, 0.001) }),
  velocity: Object.freeze({ x: quantize(state.velocity.x, 0.001), y: quantize(state.velocity.y, 0.001), z: quantize(state.velocity.z, 0.001) }),
  rotation: Object.freeze({ x: quantize(state.rotation.x, 0.00001), y: quantize(state.rotation.y, 0.00001), z: quantize(state.rotation.z, 0.00001), w: quantize(state.rotation.w, 0.00001) }),
  flags: state.flags >>> 0,
});

const canonicalEntities = (entities: readonly EntityNetState[]): readonly EntityNetState[] =>
  stableSort(entities.map(canonicalEntity), (left, right) => String(left.entity).localeCompare(String(right.entity)));

const checksum = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
};

export const buildSnapshotPacket = (tick: Tick, sequence: number, serverTimeMs: number, entities: readonly EntityNetState[]): WorldSnapshotPacket => {
  const canonical = canonicalEntities(entities);
  const payload = { protocol: 'aapw-net-v2', tick, sequence, serverTimeMs: Math.max(0, Math.trunc(serverTimeMs)), entities: canonical };
  return Object.freeze({ ...payload, checksum: checksum(payload) });
};

export const buildDeltaPacket = (base: readonly EntityNetState[], next: readonly EntityNetState[], tick: Tick, baseSequence: number, sequence: number): WorldDeltaPacket => {
  const before = new Map(canonicalEntities(base).map(entity => [entity.entity, entity] as const));
  const after = new Map(canonicalEntities(next).map(entity => [entity.entity, entity] as const));
  const upserts: EntityNetState[] = [];
  const removals: EntityId[] = [];
  for (const [id, state] of after) {
    const previous = before.get(id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(state)) upserts.push(state);
  }
  for (const id of before.keys()) if (!after.has(id)) removals.push(id);
  const payload = { protocol: 'aapw-net-v2', tick, baseSequence, sequence, upserts: canonicalEntities(upserts), removals: stableSort(removals, (a, b) => String(a).localeCompare(String(b))) };
  return Object.freeze({ ...payload, checksum: checksum(payload) });
};

export const validatePacketChecksum = (packet: WorldSnapshotPacket | WorldDeltaPacket): boolean => {
  const { checksum: expected, ...payload } = packet;
  return checksum(payload) === expected;
};

export interface SnapshotStoreEntry { readonly sequence: number; readonly tick: Tick; readonly receivedAtMs: number; readonly packet: WorldSnapshotPacket; }

export class SnapshotBuffer {
  private readonly snapshots = new Map<number, SnapshotStoreEntry>();
  constructor(private readonly capacity = 64) {}

  push(packet: WorldSnapshotPacket, receivedAtMs: number): Result<void, string> {
    if (!validatePacketChecksum(packet)) return err('snapshot checksum mismatch');
    if (this.snapshots.has(packet.sequence)) return ok(undefined);
    this.snapshots.set(packet.sequence, Object.freeze({ sequence: packet.sequence, tick: packet.tick, receivedAtMs, packet }));
    while (this.snapshots.size > Math.max(4, this.capacity)) {
      const oldest = [...this.snapshots.keys()].sort((a, b) => a - b)[0];
      if (oldest !== undefined) this.snapshots.delete(oldest);
    }
    return ok(undefined);
  }

  latest(): SnapshotStoreEntry | undefined {
    const entries = [...this.snapshots.values()].sort((a, b) => b.sequence - a.sequence);
    return entries[0];
  }

  atOrBefore(tick: Tick): SnapshotStoreEntry | undefined {
    return stableSort([...this.snapshots.values()].filter(entry => entry.tick <= tick), (a, b) => b.tick - a.tick || b.sequence - a.sequence)[0];
  }

  interpolate(tick: number): readonly EntityNetState[] {
    const entries = stableSort([...this.snapshots.values()], (a, b) => a.tick - b.tick || a.sequence - b.sequence);
    if (entries.length === 0) return [];
    const exact = entries.find(entry => Number(entry.tick) === tick);
    if (exact) return exact.packet.entities;
    let before = entries[0]!;
    let after = entries.at(-1)!;
    for (let index = 0; index < entries.length - 1; index += 1) {
      if (Number(entries[index]!.tick) <= tick && Number(entries[index + 1]!.tick) >= tick) { before = entries[index]!; after = entries[index + 1]!; break; }
    }
    if (before.sequence === after.sequence) return before.packet.entities;
    const alpha = Math.max(0, Math.min(1, (tick - Number(before.tick)) / Math.max(1, Number(after.tick) - Number(before.tick))));
    const left = new Map(before.packet.entities.map(state => [state.entity, state] as const));
    const right = new Map(after.packet.entities.map(state => [state.entity, state] as const));
    const merged = [];
    for (const [id, l] of left) {
      const r = right.get(id) ?? l;
      merged.push(Object.freeze({
        ...l,
        position: { x: l.position.x + (r.position.x - l.position.x) * alpha, y: l.position.y + (r.position.y - l.position.y) * alpha, z: l.position.z + (r.position.z - l.position.z) * alpha },
        velocity: { x: l.velocity.x + (r.velocity.x - l.velocity.x) * alpha, y: l.velocity.y + (r.velocity.y - l.velocity.y) * alpha, z: l.velocity.z + (r.velocity.z - l.velocity.z) * alpha },
        rotation: { x: l.rotation.x + (r.rotation.x - l.rotation.x) * alpha, y: l.rotation.y + (r.rotation.y - l.rotation.y) * alpha, z: l.rotation.z + (r.rotation.z - l.rotation.z) * alpha, w: l.rotation.w + (r.rotation.w - l.rotation.w) * alpha },
      }));
    }
    return stableSort(merged, (a, b) => String(a.entity).localeCompare(String(b.entity)));
  }

  clear(): void { this.snapshots.clear(); }
  get size(): number { return this.snapshots.size; }
}

export class ReliableSequenceChannel {
  private nextSequenceValue = 1;
  private lastAckValue = 0;
  private readonly pending = new Map<number, { packet: unknown; sentAt: number; retries: number }>();

  constructor(private readonly retryMs = 250, private readonly maxRetries = 8) {}

  next(packet: unknown, nowMs: number): NetworkSequence & { packet: unknown } {
    const sequence = this.nextSequenceValue++;
    this.pending.set(sequence, { packet, sentAt: nowMs, retries: 0 });
    return Object.freeze({ channel: 'reliable', sequence, acknowledged: this.lastAckValue, packet });
  }

  acknowledge(sequence: number): void {
    if (sequence <= this.lastAckValue) return;
    this.lastAckValue = sequence;
    for (const key of [...this.pending.keys()]) if (key <= sequence) this.pending.delete(key);
  }

  due(nowMs: number): readonly { sequence: number; packet: unknown; retries: number }[] {
    const due = [];
    for (const [sequence, entry] of this.pending) {
      if (nowMs - entry.sentAt < this.retryMs) continue;
      if (entry.retries >= this.maxRetries) { this.pending.delete(sequence); continue; }
      entry.sentAt = nowMs;
      entry.retries += 1;
      due.push({ sequence, packet: entry.packet, retries: entry.retries });
    }
    return due;
  }

  get pendingCount(): number { return this.pending.size; }
  get acknowledged(): number { return this.lastAckValue; }
}

export interface PredictionState { readonly tick: Tick; readonly position: Vec3; readonly velocity: Vec3; }

export class ClientPredictionBuffer {
  private readonly commands: InputCommand[] = [];
  private acknowledgedTick = 0;
  constructor(private readonly capacity = 256) {}

  add(command: InputCommand): void {
    this.commands.push(Object.freeze({ ...command }));
    this.commands.sort((a, b) => Number(a.tick) - Number(b.tick) || a.sequence - b.sequence || a.action.localeCompare(b.action));
    while (this.commands.length > this.capacity) this.commands.shift();
  }

  acknowledge(tick: Tick): void {
    this.acknowledgedTick = Math.max(this.acknowledgedTick, Number(tick));
    while (this.commands.length && Number(this.commands[0]!.tick) <= this.acknowledgedTick) this.commands.shift();
  }

  pendingSince(tick: Tick): readonly InputCommand[] { return this.commands.filter(command => Number(command.tick) > Number(tick)); }
  snapshot(): readonly InputCommand[] { return [...this.commands]; }
  get acknowledged(): number { return this.acknowledgedTick; }
}

export const applyMovementCommand = (state: PredictionState, command: InputCommand, speed = 4): PredictionState => {
  const value = Math.max(-1, Math.min(1, command.value));
  if (command.action === 'move-forward' || command.action === 'move-back') {
    const direction = command.action === 'move-forward' ? 1 : -1;
    return Object.freeze({ ...state, velocity: { ...state.velocity, z: value * direction * speed }, position: { ...state.position, z: state.position.z + value * direction * speed / 60 } });
  }
  if (command.action === 'move-right' || command.action === 'move-left') {
    const direction = command.action === 'move-right' ? 1 : -1;
    return Object.freeze({ ...state, velocity: { ...state.velocity, x: value * direction * speed }, position: { ...state.position, x: state.position.x + value * direction * speed / 60 } });
  }
  return state;
};

export interface NetworkHealth { readonly rttMs: number; readonly jitterMs: number; readonly packetLoss: number; readonly interpolationDelayMs: number; readonly quality: 'excellent' | 'good' | 'degraded' | 'offline'; }

export class NetworkHealthMonitor {
  private rtt = 0;
  private jitter = 0;
  private loss = 0;
  private previousRtt = 0;
  private samples = 0;

  sampleRtt(value: number): void {
    const rtt = Math.max(0, Number.isFinite(value) ? value : 0);
    if (this.samples > 0) this.jitter += (Math.abs(rtt - this.previousRtt) - this.jitter) * 0.1;
    this.rtt += (rtt - this.rtt) * 0.15;
    this.previousRtt = rtt;
    this.samples += 1;
  }

  samplePacket(delivered: boolean): void { this.loss += ((delivered ? 0 : 1) - this.loss) * 0.05; }

  snapshot(): NetworkHealth {
    const quality = this.loss > 0.15 || this.rtt > 250 ? 'offline' : this.loss > 0.08 || this.rtt > 140 || this.jitter > 40 ? 'degraded' : this.loss > 0.03 || this.rtt > 80 || this.jitter > 20 ? 'good' : 'excellent';
    return Object.freeze({ rttMs: this.rtt, jitterMs: this.jitter, packetLoss: this.loss, interpolationDelayMs: Math.max(50, Math.min(250, this.rtt * 0.5 + this.jitter * 2)), quality });
  }
}
