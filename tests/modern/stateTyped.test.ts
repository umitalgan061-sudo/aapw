import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/3d/state.ts';

describe('typed GameState', () => {
  it('emits strongly shaped state changes without exposing mutable storage', () => {
    const state = new GameState();
    const changes: number[] = [];
    const unsubscribe = state.subscribe('loadProgress', change => changes.push(change.value));
    expect(state.patchProgress(1.4)).toBe(true);
    expect(state.get('loadProgress')).toBe(1);
    expect(changes).toEqual([1]);
    unsubscribe();
    state.patchProgress(0.5);
    expect(changes).toEqual([1]);
  });

  it('supports semantic lifecycle transitions', () => {
    const state = new GameState();
    state.beginLoading();
    expect(state.get('currentPhase')).toBe('loading');
    state.finishLoading();
    expect(state.get('currentPhase')).toBe('ready');
    state.beginPlay();
    expect(state.get('currentPhase')).toBe('playing');
    state.pause();
    expect(state.get('currentPhase')).toBe('paused');
    state.resume();
    expect(state.get('currentPhase')).toBe('playing');
  });
});
