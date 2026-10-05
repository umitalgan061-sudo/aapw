import { describe, expect, it } from 'vitest';
import { RenderBudgetGovernor, RenderGraph } from '../../src/engine-ts/r43/render.ts';
import {
  NetworkSession,
  PredictionBuffer,
  SequenceWindow,
  SnapshotRing,
  applyRecordDelta,
  diffRecord,
  snapshotDigest,
} from '../../src/engine-ts/r43/network.ts';

describe('r43 render', () => {
  it('keeps render pass ordering deterministic', () => {
    const graph = new RenderGraph();
    const order: string[] = [];
    graph.add({ id: 'ui', phase: 'ui', priority: 'normal', dependencies: ['post'], execute: () => order.push('ui') });
    graph.add({ id: 'opaque', phase: 'opaque', priority: 'critical', execute: () => order.push('opaque') });
    graph.add({ id: 'post', phase: 'post', priority: 'high', dependencies: ['opaque'], execute: () => order.push('post') });

    const report = graph.execute({
      frame: 1,
      quality: {
        tier: 'high',
        renderScale: 1,
        particleScale: 1,
        shadowScale: 1,
        reason: 'test',
      },
      submit: () => {},
    }, 8);

    expect(order).toEqual(['opaque', 'post', 'ui']);
    expect(report.executed).toEqual(['opaque', 'post', 'ui']);
    expect(report.overBudget).toBe(false);
  });

  it('skips non-critical work once the render budget is consumed', () => {
    const graph = new RenderGraph();
    let normalExecuted = false;
    graph.add({ id: 'critical', phase: 'opaque', priority: 'critical', execute: () => {} });
    graph.add({ id: 'normal', phase: 'opaque', priority: 'normal', execute: () => { normalExecuted = true; } });
    const report = graph.execute({
      frame: 1,
      quality: {
        tier: 'ultra',
        renderScale: 1,
        particleScale: 1,
        shadowScale: 1,
        reason: 'test',
      },
      submit: () => {},
    }, 0.5);
    expect(normalExecuted).toBe(false);
    expect(report.skipped).toContain('normal');
  });

  it('adjusts dynamic resolution under sustained pressure', () => {
    const governor = new RenderBudgetGovernor('high', 0.5, 1);
    let decision = governor.observe(30, 16.67, 1 / 60);
    for (let i = 0; i < 30; i += 1) decision = governor.observe(30, 16.67, 1 / 60);
    expect(decision.renderScale).toBeLessThan(1);
    expect(decision.reason).toBe('frame-pressure');
  });

  it('recovers quality when frame headroom returns', () => {
    const governor = new RenderBudgetGovernor('low', 0.5, 1);
    governor.force('safe', 0.6);
    let decision = governor.observe(8, 16.67, 1 / 60);
    for (let i = 0; i < 80; i += 1) decision = governor.observe(8, 16.67, 1 / 60);
    expect(decision.renderScale).toBeGreaterThan(0.6);
  });
});

describe('r43 network', () => {
  it('tracks duplicates and stale packets', () => {
    const window = new SequenceWindow(8);
    expect(window.accept(0).accepted).toBe(true);
    expect(window.accept(0).duplicate).toBe(true);
    expect(window.accept(1).accepted).toBe(true);
    for (let i = 2; i < 12; i += 1) window.accept(i);
    expect(window.accept(0).tooOld).toBe(true);
  });

  it('creates and applies deterministic record deltas', () => {
    const before = { hp: 100, gold: 10, name: 'A' };
    const after = { hp: 80, gold: 10, title: 'Knight' };
    const delta = diffRecord(before, after);
    expect(delta.removed).toEqual(['name']);
    expect(delta.changed).toEqual({ hp: 80, title: 'Knight' });
    expect(applyRecordDelta(before, delta)).toEqual(after);
  });

  it('bounds snapshot rings', () => {
    const ring = new SnapshotRing<number>(8);
    for (let i = 0; i < 12; i += 1) {
      ring.push({
        sessionId: 's',
        sequence: i,
        acknowledgedSequence: i - 1,
        tick: i,
        sentAtMs: i,
        payload: i,
      });
    }
    expect(ring.size()).toBe(8);
    expect(ring.latest()?.payload).toBe(11);
  });

  it('replays prediction frames in ascending order', () => {
    const buffer = new PredictionBuffer<number, number>(8);
    buffer.push({ frame: 3, input: 3, state: 3 });
    buffer.push({ frame: 1, input: 1, state: 1 });
    buffer.push({ frame: 2, input: 2, state: 2 });
    const result = buffer.replayFrom(1, 0, (state, input) => state + input);
    expect(result).toBe(6);
    buffer.acknowledge(2);
    expect(buffer.size()).toBe(1);
  });

  it('rejects a foreign session and accepts the matching one', () => {
    const session = new NetworkSession({
      sessionId: 'demo',
      snapshotHz: 20,
      maxPayloadBytes: 1024,
    });
    const packet = session.createEnvelope({ hello: 'world' }, 10, 100, -1);
    expect(session.accept({ ...packet, sessionId: 'foreign' }).ok).toBe(false);
    expect(session.accept(packet).ok).toBe(true);
  });

  it('provides a stable snapshot digest', () => {
    const snapshot = {
      version: 1,
      frame: 5,
      tick: 7,
      simTimeSeconds: 0.1,
      entities: [],
      digest: 'ignore-me',
    };
    expect(snapshotDigest(snapshot)).toMatch(/^[0-9a-f]{8}$/);
  });
});
