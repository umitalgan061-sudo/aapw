import { describe, expect, it } from 'vitest';
import { CombatAuthority, makeCombatActor, makeCombatTarget } from '../../src/3d/modern/combatAuthority.ts';

describe('CombatAuthority deterministic attack lifecycle', () => {
  it('keeps heavy attack definition through every phase', () => {
    const combat = new CombatAuthority(undefined, { now: () => 999999 });
    combat.registerActor(Object.freeze({ ...makeCombatActor('hero', 'player'), x: 0, z: 0, yaw: 0 }));
    combat.registerTarget(Object.freeze({ ...makeCombatTarget('ogre', 'enemy'), x: 0, z: 2.5, health: 100 }));

    const started = combat.startAttack('hero', true);
    expect(started[0]?.attackId).toBe('heavy');
    expect(started[0]?.attackInstanceId).toBe(1);

    const active = combat.step(360);
    expect(active.some((event) => event.type === 'attackActive' && event.attackId === 'heavy')).toBe(true);
    const hit = active.find((event) => event.type === 'hit');
    expect(hit?.attackId).toBe('heavy');
    expect(hit?.hit?.damage).toBe(28);

    const actor = combat.actor('hero');
    expect(actor?.currentAttackId).toBe('heavy');
    expect(actor?.phase).toBe('active');

    const finished = combat.step(700);
    expect(finished.some((event) => event.type === 'attackFinished' && event.attackId === 'heavy')).toBe(true);
    expect(combat.actor('hero')?.state).toBe('idle');
  });

  it('handles a large frame delta without skipping the active hit window', () => {
    const combat = new CombatAuthority();
    combat.registerActor(makeCombatActor('hero', 'player'));
    combat.registerTarget(Object.freeze({ ...makeCombatTarget('target', 'enemy'), x: 0, z: 1 }));
    combat.startAttack('hero', false);

    const events = combat.step(100);
    expect(events.some((event) => event.type === 'attackActive')).toBe(false);
    expect(events.some((event) => event.type === 'hit')).toBe(false);

    const crossed = combat.step(200);
    expect(crossed.some((event) => event.type === 'attackActive')).toBe(true);
    expect(crossed.some((event) => event.type === 'hit')).toBe(true);
  });

  it('does not use wall-clock time as a hit identity', () => {
    let now = 1;
    const combat = new CombatAuthority(undefined, { now: () => now });
    combat.registerActor(makeCombatActor('hero', 'player'));
    combat.registerTarget(Object.freeze({ ...makeCombatTarget('target', 'enemy'), x: 0, z: 1 }));

    combat.startAttack('hero');
    now = 100;
    const first = combat.step(200);
    now = 200;
    const followUp = combat.step(1);

    expect(first.filter((event) => event.type === 'hit')).toHaveLength(1);
    expect(followUp.filter((event) => event.type === 'hit')).toHaveLength(0);
  });
});
