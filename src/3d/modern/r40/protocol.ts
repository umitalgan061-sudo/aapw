import type { NetworkEnvelope, RuntimeCommand, Tick } from './types';
import { hashJson, stableSerialize } from './deterministic';

export interface ProtocolVersion { readonly major: number; readonly minor: number; readonly revision: number; }
export interface ProtocolFeature { readonly id: string; readonly since: number; readonly enabled: boolean; }
export interface EncodedPacket { readonly bytes: Uint8Array; readonly digest: string; readonly version: ProtocolVersion; readonly kind: NetworkEnvelope['kind']; }

const VERSION: ProtocolVersion = Object.freeze({ major: 40, minor: 1, revision: 0 });
const FEATURES: readonly ProtocolFeature[] = Object.freeze([
  Object.freeze({ id: 'quantized-transform', since: 40, enabled: true }),
  Object.freeze({ id: 'prediction-reconciliation', since: 40, enabled: true }),
  Object.freeze({ id: 'bounded-payload', since: 40, enabled: true }),
  Object.freeze({ id: 'deterministic-digest', since: 40, enabled: true }),
]);

export class R40Protocol {
  readonly version = VERSION;
  readonly features = FEATURES;
  encode(envelope: NetworkEnvelope): EncodedPacket {
    const text = stableSerialize({ protocol: envelope.protocol, sessionId: envelope.sessionId, sequence: envelope.sequence, ack: envelope.ack, sentAtTick: envelope.sentAtTick, kind: envelope.kind, payload: envelope.payload, digest: envelope.digest });
    const bytes = new TextEncoder().encode(text);
    return Object.freeze({ bytes, digest: hashJson(text), version: VERSION, kind: envelope.kind });
  }
  decode(packet: EncodedPacket): NetworkEnvelope | null {
    try {
      const raw = new TextDecoder().decode(packet.bytes);
      const value = JSON.parse(raw) as Partial<NetworkEnvelope>;
      if (value.protocol !== 40 || typeof value.sessionId !== 'string' || typeof value.sequence !== 'number' || typeof value.ack !== 'number' || typeof value.kind !== 'string') return null;
      const envelope = value as NetworkEnvelope;
      if (hashJson(envelope.payload) !== envelope.digest) return null;
      return Object.freeze(envelope);
    } catch { return null; }
  }
  commandEnvelope(command: RuntimeCommand): NetworkEnvelope {
    return Object.freeze({ protocol: 40, sessionId: command.actor ? String(command.actor) : 'system', sequence: command.sequence, ack: Math.max(0, command.sequence - 1), sentAtTick: command.tick, kind: 'input', payload: command, digest: hashJson(command) });
  }
  supports(id: string): boolean { return this.features.some((feature) => feature.id === id && feature.enabled); }
  schema(): ProtocolVersion { return this.version; }
  maxPayload(): number { return 65536; }
}
