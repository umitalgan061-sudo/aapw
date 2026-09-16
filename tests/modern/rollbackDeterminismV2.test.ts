import { describe, expect, it } from 'vitest';
import { ReplayCheckpointBuffer, ReplayVerifierV2 } from '../../src/3d/modern/replayVerifierV2.ts';
import { RollbackController } from '../../src/3d/modern/rollbackControllerV2.ts';

describe('rollback determinism v2', () => {
  it('replays an identical input stream to the same final digest', () => {
    const verifier = new ReplayVerifierV2<number, number>();
    const runner = { seed: () => 10, step: (state: number, input: number) => state + input, digest: (state: number) => String(state) };
    const inputs = [1, 2, 3, 4].map((input, tick) => ({ tick, input, expectedDigest: String(10 + [1, 3, 6, 10][tick]) }));
    const result = verifier.verify(inputs, runner);
    expect(result.valid).toBe(true);
    expect(result.finalDigest).toBe('20');
  });

  it('keeps rollback history bounded and exposes a stable checkpoint', () => {
    const checkpoints = new ReplayCheckpointBuffer<number>(2);
    checkpoints.push({ tick: 4, digest: '4', state: 4 });
    checkpoints.push({ tick: 5, digest: '5', state: 5 });
    checkpoints.push({ tick: 6, digest: '6', state: 6 });
    expect(checkpoints.values().map((item) => item.tick)).toEqual([5, 6]);
    const rollback = new RollbackController<number, number>({ capacity: 4 });
    rollback.record({ tick: 0, state: 0, digest: '0' }, 1);
    rollback.record({ tick: 1, state: 1, digest: '1' }, 1);
    rollback.record({ tick: 2, state: 2, digest: '2' }, 1);
    expect(rollback.plan(1, 'desync')?.replayCount).toBe(1);
  });
});
