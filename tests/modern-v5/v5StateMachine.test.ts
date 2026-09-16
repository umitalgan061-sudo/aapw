import { describe, expect, it } from 'vitest';
import { StateMachineV5, state, transition } from '../../src/3d/modern/v5/stateMachine.ts';

describe('modern-v5 generic state machine', () => {
  it('enters, updates and exits states through guarded transitions', async () => {
    const events: string[] = [];
    type Mode = 'idle' | 'run' | 'dead';
    const machine = new StateMachineV5<Mode, { alive: boolean; moving: boolean }>(
      [
        state('idle', { enter: () => events.push('enter:idle'), exit: () => events.push('exit:idle') }),
        state('run', { enter: () => events.push('enter:run'), update: () => events.push('update:run') }),
        state('dead', { enter: () => events.push('enter:dead') }),
      ],
      [
        transition('idle', 'run', 2, (context) => context.alive && context.moving),
        transition('run', 'dead', 3, (context) => !context.alive),
      ],
      'idle',
    );
    const context = { alive: true, moving: true };
    await machine.start(context);
    const first = await machine.update(context, 1 / 60);
    expect(first?.to).toBe('run');
    expect(machine.current).toBe('run');
    expect(events).toEqual(['enter:idle', 'exit:idle', 'enter:run']);
    context.alive = false;
    const second = await machine.update(context, 1 / 60);
    expect(second?.to).toBe('dead');
    expect(machine.states()).toEqual(['dead', 'idle', 'run']);
  });

  it('force transitions are explicit and idempotent', async () => {
    type Mode = 'a' | 'b';
    const machine = new StateMachineV5<Mode, { value: number }>([state('a'), state('b')], [], 'a');
    const first = await machine.force('b', { value: 1 });
    const second = await machine.force('b', { value: 2 });
    expect(first).toEqual({ from: 'a', to: 'b', accepted: true });
    expect(second).toEqual({ from: 'b', to: 'b', accepted: true });
  });
});
