import { describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/3d/config.ts';
import {
  EventBus,
  gameEvents,
  type AssetProgressEvent,
  type GameReadyEvent,
  type GameEventMap,
} from '../../src/3d/eventBus.ts';

describe('typed runtime EventBus', () => {
  it('infers known payloads and supports void events', () => {
    const bus = new EventBus<GameEventMap>();
    const ratios: number[] = [];
    const phases: string[] = [];
    let ready = 0;

    bus.on(EVENTS.ASSET_PROGRESS, (payload: AssetProgressEvent) => ratios.push(payload.ratio));
    bus.on(EVENTS.GAME_READY, (payload: GameReadyEvent) => phases.push(payload.phase));
    bus.on(EVENTS.ASSETS_READY, () => { ready += 1; });

    bus.emit(EVENTS.ASSET_PROGRESS, { url: 'a.fbx', loaded: 1, total: 2, ratio: 0.5 });
    bus.emit(EVENTS.GAME_READY, { phase: 'scene' });
    bus.emit(EVENTS.ASSETS_READY);

    expect(ratios).toEqual([0.5]);
    expect(phases).toEqual(['scene']);
    expect(ready).toBe(1);
  });

  it('keeps one-shot listeners one-shot and diagnostics deterministic', () => {
    const bus = new EventBus<GameEventMap>();
    const phases: string[] = [];
    const subscription = bus.once(EVENTS.GAME_READY, payload => phases.push(payload.phase));

    expect(Object.isFrozen(subscription)).toBe(true);
    bus.emit(EVENTS.GAME_READY, { phase: 'first' });
    bus.emit(EVENTS.GAME_READY, { phase: 'second' });

    expect(phases).toEqual(['first']);
    expect(bus.diagnostics()).toEqual({
      eventCount: 0,
      listenerCount: 0,
      events: [],
    });
  });

  it('isolates listener exceptions and fails closed after disposal', () => {
    const bus = new EventBus<GameEventMap>();
    const original = console.error;
    const errors: unknown[] = [];
    const phases: string[] = [];
    console.error = (...args) => errors.push(args);

    try {
      bus.on(EVENTS.GAME_READY, () => { throw new Error('expected'); });
      bus.on(EVENTS.GAME_READY, payload => phases.push(payload.phase));
      bus.emit(EVENTS.GAME_READY, { phase: 'survives' });
    } finally {
      console.error = original;
    }

    expect(phases).toEqual(['survives']);
    expect(errors).toHaveLength(1);

    bus.dispose();
    expect(bus.isDisposed).toBe(true);
    expect(bus.listenerCount()).toBe(0);
    expect(() => bus.on(EVENTS.GAME_READY, () => {})).toThrow('disposed');
    expect(gameEvents.isDisposed).toBe(false);
  });
});
