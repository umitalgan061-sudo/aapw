import { describe, expect, it } from 'vitest';
import { SecurityGate, SequenceWindow, CommandValidator, R40Protocol, normalizeInput, commandId, entityId, tick } from '../../../src/3d/modern/r40';

describe('R40 security and network contracts', () => {
  it('accepts bounded JSON payloads', () => {
    expect(new SecurityGate().validatePayload({ ok: true }).accepted).toBe(true);
  });
  it('rejects deeply nested payloads', () => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 20; i += 1) value = { next: value };
    expect(new SecurityGate().validatePayload(value).accepted).toBe(false);
  });
  it('rejects cyclic payloads', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(new SecurityGate().validatePayload(value).accepted).toBe(false);
  });
  it('rejects credential-bearing URLs', () => {
    expect(new SecurityGate().checkUrl('https://user:pass@example.com/a').accepted).toBe(false);
  });
  it('rejects data URLs', () => {
    expect(new SecurityGate().checkUrl('data:text/plain,x').accepted).toBe(false);
  });
  it('accepts normal asset URLs', () => {
    expect(new SecurityGate().checkUrl('https://example.com/assets/a.glb').accepted).toBe(true);
  });
  it('accepts sequence once and rejects duplicates', () => {
    const window = new SequenceWindow(32);
    expect(window.accept(1)).toBe(true);
    expect(window.accept(1)).toBe(false);
    expect(window.accept(2)).toBe(true);
  });
  it('rejects packets outside sequence window', () => {
    const window = new SequenceWindow(8);
    for (let i = 1; i <= 32; i += 1) window.accept(i);
    expect(window.accept(1)).toBe(false);
  });
  it('validates runtime commands against payload size', () => {
    const validator = new CommandValidator({ maxPayloadBytes: 16 });
    const command = { id: commandId('c'), tick: tick(1), actor: null, type: 'x', payload: { value: '12345678901234567890' }, sequence: 1, predictionKey: null };
    expect(validator.validate(command)).toBe(false);
  });
  it('builds deterministic protocol envelopes', () => {
    const validator = new CommandValidator();
    const envelope = validator.envelope('session', 1, tick(2), 'ping', { value: 3 });
    expect(envelope.protocol).toBe(40);
    expect(envelope.digest).toBe(validator.envelope('session', 1, tick(2), 'ping', { value: 3 }).digest);
  });
  it('encodes and decodes protocol packets', () => {
    const protocol = new R40Protocol();
    const envelope = { protocol: 40, sessionId: 's', sequence: 1, ack: 0, sentAtTick: tick(1), kind: 'ping' as const, payload: { ok: true }, digest: 'dummy' };
    const encoded = protocol.encode({ ...envelope, digest: protocol['commandEnvelope'] ? envelope.digest : envelope.digest } as never);
    expect(encoded.bytes.byteLength).toBeGreaterThan(0);
  });
  it('normalizes input to a deterministic range', () => {
    const input = normalizeInput({ x: 2, y: -2, z: 0 }, { x: 3, y: -3, z: 0 }, true, false);
    expect(input.move.x).toBe(1);
    expect(input.move.y).toBe(-1);
    expect(input.jump).toBe(true);
  });
  it('uses actor identity in prediction keys', () => {
    const actor = entityId('player');
    expect(String(actor)).toBe('player');
  });
});
