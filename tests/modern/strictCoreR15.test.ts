import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/3d/eventBus.ts';
import { GameState } from '../../src/3d/state.ts';
import { EVENTS, QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel } from '../../src/3d/config.ts';

describe('R15 strict core contracts', () => {
  it('preserves typed EventBus subscribe/emit/unsubscribe semantics', () => {
    const bus = new EventBus();
    const received: number[] = [];
    const unsubscribe = bus.on<number>('score', (value) => received.push(value));

    bus.emit('score', 7);
    unsubscribe();
    bus.emit('score', 9);

    expect(received).toEqual([7]);
  });

  it('supports once listeners without leaking registrations', () => {
    const bus = new EventBus();
    let count = 0;
    bus.once('tick', () => { count += 1; });
    bus.emit('tick', undefined);
    bus.emit('tick', undefined);
    expect(count).toBe(1);
  });

  it('enforces typed GameState mutation and immutable snapshots', () => {
    const state = new GameState();
    state.set('loadProgress', 0.75);
    state.set('isLoading', false);
    state.set('currentPhase', 'ready');

    const snapshot = state.snapshot();
    expect(snapshot.loadProgress).toBe(0.75);
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.currentPhase).toBe('ready');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(QUALITY_LEVELS.AUTOMATIC).toBe('automatic');

    const quality: QualityLevel = QUALITY_LEVELS.HIGH;
    expect(QUALITY_PRESETS[quality]).toMatchObject({ shadowMapSize: 2048 });
    expect(EVENTS.GAME_READY).toBe('game:ready');
  });
});
