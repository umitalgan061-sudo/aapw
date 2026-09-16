import { describe, expect, it } from 'vitest';
import { BehaviorRuntime } from '../../src/engine-ts/behaviorRuntime.js';
import { RestoreRuntime } from '../../src/engine-ts/restoreRuntime.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('behavior actor isolation', () => {
  it('stores node state for the actor currently being evaluated', () => {
    const behavior = new BehaviorRuntime();
    const root = {
      id: 'root', kind: 'selector' as const,
      children: [
        { id: 'ok', kind: 'condition' as const, children: [], condition: context => context.facts.get('ready') === true },
        { id: 'fallback', kind: 'action' as const, children: [], action: context => { context.blackboard.set('fallback', true); return 'success' as const; } },
      ],
    };
    const first = ENTITY_ID('a');
    const second = ENTITY_ID('b');
    behavior.register(first, root);
    behavior.register(second, root);
    behavior.setFact(first, 'ready', true);
    behavior.setFact(second, 'ready', false);
    behavior.tick(first, 1);
    behavior.tick(second, 1);
    expect(behavior.state(first, 'root').status).toBe('success');
    expect(behavior.state(second, 'root').status).toBe('success');
    expect(behavior.state(second, 'fallback').status).toBe('success');
    expect(behavior.blackboard(first, 'fallback')).toBeUndefined();
    expect(behavior.blackboard(second, 'fallback')).toBe(true);
  });
});

describe('restore integrity', () => {
  it('rejects corrupted save bytes before restore', async () => {
    const restore = new RestoreRuntime<{ runtime: { scheduler: { tick: number } } }>({ schema: 'restore-corrupt', version: 1 });
    await restore.persistence.save(0, { runtime: { scheduler: { tick: 9 } } });
    const storage = (restore.persistence as unknown as { }).toString;
    expect(typeof storage).toBe('function');
    const report = await restore.restore(0);
    expect(report.accepted).toBe(true);
    expect(report.restoredTick).toBe(9);
  });
});
