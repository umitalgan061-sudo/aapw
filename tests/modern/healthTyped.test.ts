import { describe, expect, it } from 'vitest';
import {
  createHealthSnapshot,
  createHealthState,
  readDamageResolution,
  stageDamageResolution,
  type HealthEventBus,
  type HealthChangeReceipt,
  type HealthEventPayload,
  type HealthDeathReceipt,
} from '../../src/3d/gameplay/health.ts';

class TestBus implements HealthEventBus {
  private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();
  readonly emitted: Array<{ readonly name: string; readonly payload: unknown }> = [];

  on(eventName: string, handler: (payload: unknown) => void): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  off(eventName: string, handler: (payload: unknown) => void): void {
    const list = this.handlers.get(eventName) ?? [];
    this.handlers.set(eventName, list.filter((candidate) => candidate !== handler));
  }

  emit(eventName: string, payload?: unknown): void {
    this.emitted.push({ name: eventName, payload });
    for (const handler of this.handlers.get(eventName) ?? []) handler(payload);
  }
}

describe('Kızıl Ufuk typed health contract', () => {
  it('normalizes health snapshots into a finite immutable contract', () => {
    expect(createHealthSnapshot(Number.NaN, 100, false, -4)).toEqual({
      current: 0,
      max: 100,
      ratio: 0,
      defeated: false,
      revision: 0,
    });
    const snapshot = createHealthSnapshot(125, 100, true, 7);
    expect(snapshot).toEqual({ current: 100, max: 100, ratio: 1, defeated: true, revision: 7 });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('keeps immutable snapshots and monotonic revisions', () => {
    const bus = new TestBus();
    const health = createHealthState({
      eventsBus: bus,
      maxHealth: 100,
      damageEventName: 'damage',
      healthChangedEventName: 'health',
      diedEventName: 'died',
    });

    const initial = health.getSnapshot();
    expect(initial).toEqual({ current: 100, max: 100, ratio: 1, defeated: false, revision: 0 });
    expect(Object.isFrozen(initial)).toBe(true);

    bus.emit('damage', { amount: 35, sourceId: 'sword-01' });
    expect(health.getSnapshot()).toMatchObject({ current: 65, ratio: 0.65, revision: 1, defeated: false });

    health.heal(20);
    expect(health.getSnapshot()).toMatchObject({ current: 85, ratio: 0.85, revision: 2, defeated: false });

    health.reset();
    expect(health.getSnapshot()).toMatchObject({ current: 100, ratio: 1, revision: 3, defeated: false });
    health.dispose();
  });

  it('preserves staged mitigation metadata and exact applied damage', async () => {
    const bus = new TestBus();
    const health = createHealthState({
      eventsBus: bus,
      maxHealth: 50,
      damageEventName: 'damage',
      healthChangedEventName: 'health',
      diedEventName: 'died',
    });

    const payload: HealthEventPayload = { amount: 40, sourceId: 'axe-02' };
    const staged = stageDamageResolution(payload, {
      rawAmount: 60,
      amount: 40,
      blockedAmount: 20,
      mitigation: 'guard',
      sourceId: 'axe-02',
    });

    expect(staged?.blockedAmount).toBe(20);
    expect(readDamageResolution(payload)).toBe(staged);

    bus.emit('damage', payload);
    expect(payload.appliedAmount).toBe(40);

    const healthEvent = bus.emitted.filter((entry) => entry.name === 'health').at(-1)?.payload as HealthChangeReceipt;
    expect(healthEvent).toMatchObject({ current: 10, appliedAmount: 40, sourceId: 'axe-02', revision: 1 });

    await Promise.resolve();
    await Promise.resolve();
    expect(readDamageResolution(payload)).toBeNull();
    health.dispose();
  });

  it('emits a single typed death receipt and rejects invalid health inputs', () => {
    const bus = new TestBus();
    expect(() => createHealthState({
      eventsBus: bus,
      maxHealth: Number.NaN,
      damageEventName: 'damage',
      healthChangedEventName: 'health',
      diedEventName: 'died',
    })).toThrow(RangeError);

    const health = createHealthState({
      eventsBus: bus,
      maxHealth: 10,
      damageEventName: 'damage',
      healthChangedEventName: 'health',
      diedEventName: 'died',
    });

    bus.emit('damage', { amount: 50, sourceId: 'fall' });
    bus.emit('damage', { amount: 10, sourceId: 'fall-again' });

    const deathEvents = bus.emitted.filter((entry) => entry.name === 'died');
    expect(deathEvents).toHaveLength(1);
    const deathEvent = deathEvents[0];
    expect(deathEvent).toBeDefined();
    expect((deathEvent?.payload as HealthDeathReceipt)).toMatchObject({
      current: 0,
      maxHealth: 10,
      appliedAmount: 10,
      sourceId: 'fall',
      revision: 1,
    });
    expect(health.getSnapshot()).toMatchObject({ current: 0, defeated: true, revision: 1 });
    health.dispose();
  });
});
