import { describe, expect, it } from 'vitest';
import { StreamingCachePolicyV2, scoreStreamingAdmission } from '../../src/3d/modern/streamingCachePolicyV2.ts';
import { QuestAuthorityV2, insideQuestTrigger } from '../../src/3d/modern/questAuthorityV2.ts';
import { ReplayCheckpointBuffer, ReplayVerifierV2 } from '../../src/3d/modern/replayVerifierV2.ts';
import { benchmarkDigest } from '../../src/3d/modern/runtimeBenchmarksV2.ts';

describe('streaming cache policy v2', () => {
  it('retains critical entries under pressure', () => {
    const cache = new StreamingCachePolicyV2({ maxBytes: 1000, reserveCriticalBytes: 300, reserveNearBytes: 700, maxEntries: 10 });
    expect(cache.reserve({ key: 'critical', bytes: 300, className: 'critical', lastUsedFrame: 1, pinned: false })).toBe(true);
    expect(cache.reserve({ key: 'far-a', bytes: 500, className: 'far', lastUsedFrame: 2, pinned: false })).toBe(true);
    cache.reserve({ key: 'near-b', bytes: 400, className: 'near', lastUsedFrame: 3, pinned: false });
    expect(cache.has('critical')).toBe(true);
    expect(cache.metrics().bytes).toBeLessThanOrEqual(1000);
  });

  it('scores pinned and critical streaming requests deterministically', () => {
    const request = { key: 'x', bytes: 1000, className: 'near' as const, distance: 50, priority: 8 };
    expect(scoreStreamingAdmission(request)).toEqual(scoreStreamingAdmission({ ...request }));
    expect(scoreStreamingAdmission({ ...request, className: 'critical' }).admitted).toBe(true);
    expect(scoreStreamingAdmission({ ...request, pinned: true }).admitted).toBe(true);
  });
});

describe('quest authority v2', () => {
  it('enforces prerequisites and completes required objectives', () => {
    const quests = new QuestAuthorityV2();
    quests.register({ id: 'intro', title: 'Intro', description: 'Start', level: 1, prerequisites: [], rewards: { gold: 10 }, objectives: [{ id: 'reach', kind: 'reach', target: 'camp', amount: 1, progress: 0, optional: false }] });
    quests.register({ id: 'next', title: 'Next', description: 'Follow', level: 2, prerequisites: ['intro'], rewards: { gold: 20 }, objectives: [{ id: 'defeat', kind: 'defeat', target: 'raider', amount: 2, progress: 0, optional: false }] });
    expect(quests.accept('next', 0)).toBeNull();
    quests.accept('intro', 1);
    quests.progress('intro', 'reach', 1, 2);
    expect(quests.get('intro')?.status).toBe('completed');
    expect(quests.accept('next', 3)?.status).toBe('active');
    quests.progress('next', 'defeat', 2, 4);
    expect(quests.get('next')?.status).toBe('completed');
  });

  it('keeps quest trigger checks geometric and bounded', () => {
    expect(insideQuestTrigger({ x: 1, y: 0, z: 1 }, { questId: 'q', objectiveId: 'o', center: { x: 0, y: 0, z: 0 }, radius: 2 })).toBe(true);
    expect(insideQuestTrigger({ x: 3, y: 0, z: 0 }, { questId: 'q', objectiveId: 'o', center: { x: 0, y: 0, z: 0 }, radius: 2 })).toBe(false);
  });
});

describe('replay verification v2', () => {
  it('detects a changed simulation result', () => {
    const verifier = new ReplayVerifierV2<number, number>();
    const runner = { seed: () => 0, step: (state: number, input: number) => state + input, digest: (state: number) => String(state) };
    const result = verifier.verify([{ tick: 0, input: 1, expectedDigest: '1' }, { tick: 1, input: 2, expectedDigest: '3' }], runner);
    expect(result.valid).toBe(true);
    const mismatch = verifier.verify([{ tick: 0, input: 1, expectedDigest: '9' }], runner);
    expect(mismatch.valid).toBe(false);
    expect(mismatch.mismatches[0]?.actualDigest).toBe('1');
  });

  it('keeps checkpoint memory bounded and searches nearest checkpoint', () => {
    const checkpoints = new ReplayCheckpointBuffer<number>(3);
    checkpoints.push({ tick: 1, digest: 'a', state: 1 });
    checkpoints.push({ tick: 3, digest: 'b', state: 3 });
    checkpoints.push({ tick: 5, digest: 'c', state: 5 });
    checkpoints.push({ tick: 7, digest: 'd', state: 7 });
    expect(checkpoints.values()).toHaveLength(3);
    expect(checkpoints.nearest(6)?.tick).toBe(5);
    expect(checkpoints.latest()?.tick).toBe(7);
  });
});

describe('runtime benchmark primitives', () => {
  it('produces a deterministic benchmark digest with a fake clock', () => {
    let time = 0;
    const sample = benchmarkDigest({ now: () => (time += 0.01) }, 8);
    expect(sample.iterations).toBe(8);
    expect(sample.digest).toBe(ReplayVerifierV2.fingerprint(Array.from({ length: 8 }, (_, index) => ({ index }))));
  });
});
