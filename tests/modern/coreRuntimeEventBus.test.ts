import { describe, expect, it, vi } from 'vitest';
import { EVENTS, QUALITY_LEVELS, WORLD_DEFAULTS } from '../../src/3d/config.ts';
import {
  EventBus,
  gameEvents,
  type AssetProgressEvent,
  type GameReadyEvent,
} from '../../src/3d/eventBus.ts';

type TestEvents = {
  [EVENTS.ASSET_PROGRESS]: AssetProgressEvent;
  [EVENTS.GAME_READY]: GameReadyEvent;
  [EVENTS.ASSETS_READY]: void;
};

describe('Kızıl Ufuk core runtime TypeScript boundary', () => {
  it('keeps the migrated configuration deterministic and immutable', () => {
    expect(QUALITY_LEVELS.AUTOMATIC).toBe('automatic');
    expect(WORLD_DEFAULTS.WORLD_SEED).toBe(1337);
    expect(Object.isFrozen(QUALITY_LEVELS)).toBe(true);
    expect(Object.isFrozen(WORLD_DEFAULTS)).toBe(true);
  });

  it('provides typed payload inference for known events', () => {
    const bus = new EventBus<TestEvents>();
    const ratios: number[] = [];
    const phases: string[] = [];

    bus.on(EVENTS.ASSET_PROGRESS, payload => ratios.push(payload.ratio));
    bus.on(EVENTS.GAME_READY, payload => phases.push(payload.phase));

    bus.emit(EVENTS.ASSET_PROGRESS, { url: 'assets/test.fbx', loaded: 3, total: 4, ratio: 0.75 });
    bus.emit(EVENTS.GAME_READY, { phase: 'phase1-scene' });

    expect(ratios).toEqual([0.75]);
    expect(phases).toEqual(['phase1-scene']);
  });

  it('runs once handlers exactly once and returns stable immutable subscriptions', () => {
    const bus = new EventBus<TestEvents>();
    const phases: string[] = [];

    const subscription = bus.once(EVENTS.GAME_READY, payload => phases.push(payload.phase));

    expect(Object.isFrozen(subscription)).toBe(true);
    bus.emit(EVENTS.GAME_READY, { phase: 'first' });
    bus.emit(EVENTS.GAME_READY, { phase: 'second' });

    expect(phases).toEqual(['first']);
    expect(bus.listenerCount(EVENTS.GAME_READY)).toBe(0);
  });

  it('isolates listener failures and exposes deterministic diagnostics', () => {
    const bus = new EventBus<TestEvents>();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const phases: string[] = [];

    bus.on(EVENTS.GAME_READY, () => {
      throw new Error('expected listener failure');
    });
    bus.on(EVENTS.GAME_READY, payload => phases.push(payload.phase));

    bus.emit(EVENTS.GAME_READY, { phase: 'survives' });

    expect(phases).toEqual(['survives']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(bus.diagnostics()).toEqual({
      eventCount: 1,
      listenerCount: 2,
      events: [{ name: EVENTS.GAME_READY, listeners: 2 }],
    });
    error.mockRestore();
  });

  it('fails closed after disposal while preserving singleton availability', () => {
    const bus = new EventBus<TestEvents>();
    bus.on(EVENTS.ASSET_PROGRESS, () => {});

    bus.dispose();

    expect(bus.isDisposed).toBe(true);
    expect(bus.listenerCount()).toBe(0);
    expect(() => bus.on(EVENTS.GAME_READY, () => {})).toThrow('disposed');
    expect(gameEvents.isDisposed).toBe(false);
  });
});
