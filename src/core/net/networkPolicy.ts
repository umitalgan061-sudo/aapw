import { clamp, freeze } from '../domain/contracts.ts';

export type NetworkMode = 'offline' | 'local' | 'online';
export type NetworkPriority = 'critical' | 'high' | 'normal' | 'low';

export interface NetworkRequest {
  readonly id: string;
  readonly channel: string;
  readonly payload: unknown;
  readonly priority: NetworkPriority;
  readonly reliable: boolean;
  readonly createdAt: number;
  readonly expiresAt?: number;
}

export interface NetworkEnvelope {
  readonly version: 1;
  readonly sessionId: string;
  readonly sequence: number;
  readonly channel: string;
  readonly sentAt: number;
  readonly payload: unknown;
}

export interface NetworkPolicyOptions {
  readonly maxQueue?: number;
  readonly maxPayloadBytes?: number;
  readonly maxRequestsPerSecond?: number;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
}

export interface NetworkMetrics {
  readonly mode: NetworkMode;
  readonly queued: number;
  readonly sent: number;
  readonly dropped: number;
  readonly retries: number;
  readonly bytesEstimated: number;
  readonly rttMs: number | null;
}

export class NetworkPolicy {
  readonly #maxQueue: number;
  readonly #maxPayloadBytes: number;
  readonly #maxRequestsPerSecond: number;
  readonly #heartbeatMs: number;
  readonly #now: () => number;
  readonly #queue: NetworkRequest[] = [];
  readonly #recentRequests: number[] = [];
  #mode: NetworkMode = 'offline';
  #sessionId = 'offline';
  #sequence = 0;
  #sent = 0;
  #dropped = 0;
  #retries = 0;
  #bytes = 0;
  #rtt: number | null = null;

  constructor(options: NetworkPolicyOptions = {}) {
    this.#maxQueue = Math.max(16, Math.floor(options.maxQueue ?? 1024));
    this.#maxPayloadBytes = Math.max(1024, Math.floor(options.maxPayloadBytes ?? 256 * 1024));
    this.#maxRequestsPerSecond = Math.max(1, Math.floor(options.maxRequestsPerSecond ?? 30));
    this.#heartbeatMs = Math.max(1000, Math.floor(options.heartbeatMs ?? 10_000));
    this.#now = options.now ?? (() => performance.now());
  }

  connect(sessionId: string, mode: NetworkMode): void {
    this.#sessionId = sessionId.trim().slice(0, 128) || 'session';
    this.#mode = mode;
  }

  disconnect(): void {
    this.#mode = 'offline';
    this.#sessionId = 'offline';
    this.#queue.length = 0;
  }

  enqueue(request: Omit<NetworkRequest, 'createdAt'>): boolean {
    if (this.#mode === 'offline') return false;
    const payloadBytes = estimateBytes(request.payload);
    if (payloadBytes > this.#maxPayloadBytes) { this.#dropped += 1; return false; }
    this.#pruneRateWindow();
    const now = this.#now();
    if (this.#recentRequests.length >= this.#maxRequestsPerSecond && request.priority === 'low') { this.#dropped += 1; return false; }
    if (this.#queue.length >= this.#maxQueue) {
      const index = this.#findEvictionIndex();
      if (index < 0) { this.#dropped += 1; return false; }
      this.#queue.splice(index, 1);
      this.#dropped += 1;
    }
    this.#queue.push(freeze({ ...request, createdAt: now }));
    return true;
  }

  flush(send: (envelope: NetworkEnvelope) => void, budget = 8): number {
    if (this.#mode === 'offline') return 0;
    this.#pruneRateWindow();
    let sent = 0;
    while (sent < Math.max(1, Math.floor(budget)) && this.#queue.length) {
      const request = this.#queue.shift();
      if (!request) break;
      const now = this.#now();
      if (request.expiresAt !== undefined && request.expiresAt < now) { this.#dropped += 1; continue; }
      if (this.#recentRequests.length >= this.#maxRequestsPerSecond && request.priority !== 'critical') {
        this.#queue.unshift(request);
        break;
      }
      const envelope: NetworkEnvelope = freeze({ version: 1, sessionId: this.#sessionId, sequence: ++this.#sequence, channel: request.channel.slice(0, 96), sentAt: now, payload: request.payload });
      send(envelope);
      this.#recentRequests.push(now);
      this.#sent += 1;
      this.#bytes += estimateBytes(envelope.payload);
      sent += 1;
    }
    return sent;
  }

  acknowledge(sentAt: number): void {
    const rtt = Math.max(0, this.#now() - sentAt);
    this.#rtt = this.#rtt === null ? rtt : this.#rtt * 0.8 + rtt * 0.2;
  }

  retry(count = 1): void { this.#retries = Math.min(1_000_000, this.#retries + Math.max(0, Math.floor(count))); }

  shouldHeartbeat(lastHeartbeatAt: number): boolean { return this.#now() - lastHeartbeatAt >= this.#heartbeatMs; }

  metrics(): NetworkMetrics {
    return freeze({ mode: this.#mode, queued: this.#queue.length, sent: this.#sent, dropped: this.#dropped, retries: this.#retries, bytesEstimated: this.#bytes, rttMs: this.#rtt === null ? null : Number(this.#rtt.toFixed(2)) });
  }

  queueSnapshot(): readonly NetworkRequest[] { return [...this.#queue]; }

  clearQueue(): void { this.#queue.length = 0; }

  #pruneRateWindow(): void {
    const cutoff = this.#now() - 1000;
    while (this.#recentRequests[0] !== undefined && (this.#recentRequests[0] ?? 0) < cutoff) this.#recentRequests.shift();
  }

  #findEvictionIndex(): number {
    const weights: Record<NetworkPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };
    let selected = -1;
    let weight = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.#queue.length; index += 1) {
      const candidate = this.#queue[index];
      if (!candidate) continue;
      const candidateWeight = weights[candidate.priority];
      if (candidateWeight < weight) { weight = candidateWeight; selected = index; }
    }
    return selected;
  }
}

const estimateBytes = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; }
};

export interface InterpolationState<T> {
  readonly value: T;
  readonly updatedAt: number;
}

export const interpolateNumber = (from: number, to: number, alpha: number): number => from + (to - from) * clamp(alpha, 0, 1);

export const smoothNetworkValue = (state: InterpolationState<number>, target: number, now: number, halfLifeMs = 100): InterpolationState<number> => {
  const dt = Math.max(0, now - state.updatedAt);
  const alpha = 1 - Math.pow(0.5, dt / Math.max(1, halfLifeMs));
  return freeze({ value: interpolateNumber(state.value, target, alpha), updatedAt: now });
};
