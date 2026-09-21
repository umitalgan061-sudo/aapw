import { sanitizeId } from '../runtimeSecurityV2.ts';

export type ConnectionState = 'offline' | 'connecting' | 'connected' | 'degraded' | 'closing' | 'closed';
export interface NetworkPeer { readonly id: string; readonly role: 'host' | 'client' | 'spectator'; readonly lastSeenTick: number; readonly rttMs: number; readonly packetLoss: number; readonly interestRadius: number; readonly reliable: boolean; }
export interface NetworkInput { readonly tick: number; readonly sequence: number; readonly payload: unknown; }
export interface NetworkSnapshotRecord { readonly tick: number; readonly createdAtMs: number; readonly bytes: number; readonly entityCount: number; readonly digest: string; }
export interface NetworkSessionMetrics { readonly state: ConnectionState; readonly peers: number; readonly rttMs: number; readonly packetLoss: number; readonly sentPackets: number; readonly receivedPackets: number; readonly droppedPackets: number; readonly acknowledgedTick: number; readonly bufferedInputs: number; readonly snapshots: number; }
export interface NetworkSessionOptions { readonly id?: string; readonly maxPeers?: number; readonly maxInputs?: number; readonly maxSnapshots?: number; readonly now?: () => number; }

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export class NetworkSessionTimeline {
  readonly #id: string;
  readonly #maxPeers: number;
  readonly #maxInputs: number;
  readonly #maxSnapshots: number;
  readonly #now: () => number;
  readonly #peers = new Map<string, NetworkPeer>();
  readonly #inputs: NetworkInput[] = [];
  readonly #snapshots: NetworkSnapshotRecord[] = [];
  #state: ConnectionState = 'offline';
  #sent = 0;
  #received = 0;
  #dropped = 0;
  #acknowledgedTick = 0;

  constructor(options: NetworkSessionOptions = {}) {
    this.#id = sanitizeId(options.id ?? 'local-session');
    this.#maxPeers = Math.max(1, Math.floor(options.maxPeers ?? 64));
    this.#maxInputs = Math.max(32, Math.floor(options.maxInputs ?? 4096));
    this.#maxSnapshots = Math.max(8, Math.floor(options.maxSnapshots ?? 180));
    this.#now = options.now ?? (() => Date.now());
  }

  get id(): string { return this.#id; }
  state(): ConnectionState { return this.#state; }
  transition(next: ConnectionState): boolean {
    const allowed: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = { offline: ['connecting', 'closed'], connecting: ['connected', 'offline', 'closed'], connected: ['degraded', 'closing', 'closed'], degraded: ['connected', 'closing', 'closed'], closing: ['closed'], closed: ['connecting'] };
    if (!allowed[this.#state].includes(next)) return false;
    this.#state = next;
    return true;
  }

  upsertPeer(peer: Omit<NetworkPeer, 'id'> & { id: string }): NetworkPeer {
    const id = sanitizeId(peer.id);
    if (!this.#peers.has(id) && this.#peers.size >= this.#maxPeers) throw new Error('Network peer capacity reached.');
    const next = Object.freeze({ id, role: peer.role, lastSeenTick: Math.max(0, Math.floor(peer.lastSeenTick)), rttMs: clamp(peer.rttMs, 0, 5000), packetLoss: clamp(peer.packetLoss, 0, 1), interestRadius: clamp(peer.interestRadius, 16, 10000), reliable: Boolean(peer.reliable) });
    this.#peers.set(id, next);
    return next;
  }

  removePeer(id: string): boolean { return this.#peers.delete(sanitizeId(id)); }
  peers(): readonly NetworkPeer[] { return Object.freeze([...this.#peers.values()]); }

  queueInput(input: NetworkInput): boolean {
    if (!Number.isFinite(input.tick) || !Number.isFinite(input.sequence)) return false;
    if (this.#inputs.length >= this.#maxInputs) { this.#inputs.shift(); this.#dropped += 1; }
    this.#inputs.push(Object.freeze({ tick: Math.max(0, Math.floor(input.tick)), sequence: Math.max(0, Math.floor(input.sequence)), payload: input.payload }));
    return true;
  }
  consumeInputsThrough(tick: number): readonly NetworkInput[] {
    const cutoff = Math.max(0, Math.floor(tick));
    const index = this.#inputs.findLastIndex((input) => input.tick <= cutoff);
    if (index < 0) return Object.freeze([]);
    const result = this.#inputs.splice(0, index + 1);
    return Object.freeze(result);
  }

  recordSnapshot(snapshot: Omit<NetworkSnapshotRecord, 'createdAtMs'>): NetworkSnapshotRecord {
    const next = Object.freeze({ ...snapshot, tick: Math.max(0, Math.floor(snapshot.tick)), createdAtMs: this.#now(), bytes: Math.max(0, Math.floor(snapshot.bytes)), entityCount: Math.max(0, Math.floor(snapshot.entityCount)) });
    this.#snapshots.push(next);
    while (this.#snapshots.length > this.#maxSnapshots) this.#snapshots.shift();
    this.#acknowledgedTick = Math.max(this.#acknowledgedTick, next.tick);
    this.#sent += 1;
    return next;
  }

  receivePacket(): void { this.#received += 1; }
  dropPacket(): void { this.#dropped += 1; }
  acknowledge(tick: number): void { this.#acknowledgedTick = Math.max(this.#acknowledgedTick, Math.floor(tick)); }

  metrics(): NetworkSessionMetrics {
    const peers = this.peers();
    const rtt = peers.length ? peers.reduce((sum, peer) => sum + peer.rttMs, 0) / peers.length : 0;
    const loss = peers.length ? peers.reduce((sum, peer) => sum + peer.packetLoss, 0) / peers.length : this.#received + this.#dropped ? this.#dropped / Math.max(1, this.#received + this.#dropped) : 0;
    return Object.freeze({ state: this.#state, peers: peers.length, rttMs: Number(rtt.toFixed(2)), packetLoss: Number(clamp(loss, 0, 1).toFixed(4)), sentPackets: this.#sent, receivedPackets: this.#received, droppedPackets: this.#dropped, acknowledgedTick: this.#acknowledgedTick, bufferedInputs: this.#inputs.length, snapshots: this.#snapshots.length });
  }

  reset(): void { this.#peers.clear(); this.#inputs.length = 0; this.#snapshots.length = 0; this.#sent = 0; this.#received = 0; this.#dropped = 0; this.#acknowledgedTick = 0; this.#state = 'offline'; }
}

export const classifyConnection = (rttMs: number, packetLoss: number): ConnectionState => {
  if (packetLoss >= 0.2 || rttMs >= 750) return 'degraded';
  if (packetLoss >= 0.05 || rttMs >= 250) return 'degraded';
  return 'connected';
};
