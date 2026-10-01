import { describe, expect, it } from 'vitest';
import { RecoveryCoordinator, RuntimeWorkerBridge, MigrationLedger, R40Protocol, tick, hashJson } from '../../../src/3d/modern/r40';

describe('R40 recovery, worker and migration boundaries', () => {
  it('starts a bounded recovery sequence', () => {
    const coordinator = new RecoveryCoordinator(2, 5);
    const plan = coordinator.diagnose('network', 'timeout', 'error', tick(10));
    expect(plan?.stage).toBe('diagnose');
    expect(plan?.attempt).toBe(1);
  });
  it('advances recovery in a fixed order', () => {
    const coordinator = new RecoveryCoordinator(3, 1);
    coordinator.diagnose('save', 'corruption', 'error', tick(10));
    expect(coordinator.advance('save')).toBe('quiesce');
    expect(coordinator.advance('save')).toBe('reset');
    expect(coordinator.advance('save')).toBe('replay');
    expect(coordinator.advance('save')).toBe('resume');
    expect(coordinator.advance('save')).toBe('complete');
  });
  it('blocks excessive recovery attempts', () => {
    const coordinator = new RecoveryCoordinator(1, 0);
    expect(coordinator.diagnose('renderer', 'failure', 'fatal', tick(1))).not.toBeNull();
    coordinator.fail('renderer');
    expect(coordinator.diagnose('renderer', 'failure', 'fatal', tick(2))).toBeNull();
    expect(coordinator.stage('renderer')).toBe('blocked');
  });
  it('supports worker message bounds', () => {
    const bridge = new RuntimeWorkerBridge({ maxMessages: 1, maxBytes: 256 });
    const message = bridge.ping(tick(1));
    expect(bridge.post(message)).toBe(true);
    expect(bridge.post(message)).toBe(false);
    expect(bridge.receive()).toHaveLength(1);
  });
  it('counts worker handler failures separately', () => {
    const bridge = new RuntimeWorkerBridge();
    bridge.post(bridge.ping(tick(1)));
    expect(bridge.drain(() => { throw new Error('worker fault'); })).toBe(0);
    expect(bridge.stats().dropped).toBe(1);
  });
  it('tracks migration parity', () => {
    const ledger = new MigrationLedger();
    ledger.register({ id: 'player', legacyPath: 'src/3d/player.js', typedPath: 'src/3d/modern/r40/player.ts', status: 'shadow', parityRuns: 0, mismatches: 0, owner: 'gameplay', notes: [] });
    expect(ledger.parity({ surfaceId: 'player', match: true, expectedDigest: 'a', actualDigest: 'a', tick: 1 })?.status).toBe('parity');
  });
  it('promotes only after a successful parity run', () => {
    const ledger = new MigrationLedger();
    ledger.register({ id: 'camera', legacyPath: 'src/3d/camera.js', typedPath: 'src/3d/modern/r40/camera.ts', status: 'shadow', parityRuns: 0, mismatches: 0, owner: 'render', notes: [] });
    ledger.parity({ surfaceId: 'camera', match: true, expectedDigest: 'a', actualDigest: 'a', tick: 1 });
    expect(ledger.promote('camera')?.status).toBe('typed');
  });
  it('blocks a mismatched parity surface', () => {
    const ledger = new MigrationLedger();
    ledger.register({ id: 'audio', legacyPath: 'src/3d/audio/audioManager.js', typedPath: 'src/3d/modern/r40/audio.ts', status: 'shadow', parityRuns: 0, mismatches: 0, owner: 'audio', notes: [] });
    expect(ledger.parity({ surfaceId: 'audio', match: false, expectedDigest: 'a', actualDigest: 'b', tick: 1 })?.status).toBe('blocked');
    expect(ledger.promote('audio')).toBeNull();
  });
  it('reports migration counts', () => {
    const ledger = new MigrationLedger();
    ledger.register({ id: 'a', legacyPath: 'a', typedPath: 'ta', status: 'legacy', parityRuns: 0, mismatches: 0, owner: 'x', notes: [] });
    ledger.register({ id: 'b', legacyPath: 'b', typedPath: 'tb', status: 'typed', parityRuns: 1, mismatches: 0, owner: 'x', notes: [] });
    expect(ledger.stats()).toEqual({ total: 2, typed: 1, parity: 0, blocked: 0, legacy: 1 });
  });
  it('round-trips a protocol envelope through JSON bytes', () => {
    const protocol = new R40Protocol();
    const payload = { value: 1 };
    const envelope = { protocol: 40, sessionId: 's', sequence: 1, ack: 0, sentAtTick: tick(1), kind: 'ping' as const, payload, digest: hashJson(payload) };
    const encoded = protocol.encode(envelope);
    expect(protocol.decode(encoded)?.payload).toEqual(payload);
  });
});
