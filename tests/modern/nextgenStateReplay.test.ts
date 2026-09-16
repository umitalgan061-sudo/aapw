import { describe, expect, it } from 'vitest';
import { DeterministicStateMachine, state, transition } from '../../src/3d/modern/nextgen/stateMachine.ts';
import { DeterministicReplayRecorder, verifyReplay, commandsBetween, nearestCheckpoint } from '../../src/3d/modern/nextgen/replay.ts';
import { hashString, stableStringify, tickValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen state and replay', () => {
  it('performs guarded state transitions predictably', () => {
    const events: string[] = [];
    const machine = new DeterministicStateMachine('idle', [
      state('idle', { enter: () => events.push('enter:idle'), exit: () => events.push('exit:idle') }),
      state('run', { enter: () => events.push('enter:run'), exit: () => events.push('exit:run') }),
    ], [
      transition('idle', 'start', 'run'),
      transition('run', 'stop', 'idle'),
    ]);
    machine.start({}, 0);
    expect(machine.dispatch('start', {}, {}, 1)).toBe(true);
    expect(machine.current).toBe('run');
    expect(machine.dispatch('stop', {}, {}, 2)).toBe(true);
    expect(machine.current).toBe('idle');
    expect(machine.describe().transitionCount).toBe(2);
    expect(events).toEqual(['enter:idle', 'exit:idle', 'enter:run', 'exit:run', 'enter:idle']);
  });

  it('records and verifies deterministic replay logs', () => {
    const recorder = new DeterministicReplayRecorder(123, tickValue(5));
    recorder.recordCommand({ id: 'a', tick: tickValue(6), sequence: 1, kind: 'move', payload: { x: 1 }, source: 'test', checksum: 1 });
    recorder.recordCheckpoint({ tick: tickValue(5), revision: tickValue(1), entities: [], checksum: 2 });
    const log = recorder.build(tickValue(8));
    expect(verifyReplay(log).valid).toBe(true);
    expect(commandsBetween(log, tickValue(6), tickValue(7))).toHaveLength(1);
    expect(nearestCheckpoint(log, tickValue(7))?.tick).toBe(5);
  });

  it('detects replay tampering through digest mismatch', () => {
    const body = { version: 1 as const, seed: 1, startTick: tickValue(0), endTick: tickValue(1), commands: [], checkpoints: [] as never[] };
    const log = { ...body, digest: hashString(stableStringify(body)) };
    const tampered = { ...log, seed: 2 };
    expect(verifyReplay(tampered).valid).toBe(false);
    expect(verifyReplay(tampered).reason).toBe('digest_mismatch');
  });
});
