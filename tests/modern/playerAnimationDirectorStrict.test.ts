import { describe, expect, it } from 'vitest';
import {
  createPlayerAnimationDirector,
  resolvePlayerAnimationIntent,
  resolvePlayerAnimationPresentation,
  resolvePlayerAnimationTransition,
} from '../../src/3d/gameplay/playerAnimationDirector.ts';

describe('Kızıl Ufuk strict animation director', () => {
  it('resolves combat and locomotion semantics deterministically', () => {
    expect(resolvePlayerAnimationIntent({ attackKind: 'heavy' }).semanticState).toBe('heavy-attack');
    expect(resolvePlayerAnimationIntent({ guarding: true }).semanticState).toBe('guard');
    expect(resolvePlayerAnimationIntent({ planarSpeedMps: 6.2, runIntent: true }).semanticState).toBe('sprint');
    expect(resolvePlayerAnimationIntent({ planarSpeedMps: 0 }).semanticState).toBe('idle');
  });

  it('applies sprint hysteresis around the threshold', () => {
    expect(resolvePlayerAnimationTransition({ previousSemanticState: 'locomotion', planarSpeedMps: 5.5 })).toBe('locomotion');
    expect(resolvePlayerAnimationTransition({ previousSemanticState: 'locomotion', planarSpeedMps: 5.7 })).toBe('sprint');
    expect(resolvePlayerAnimationTransition({ previousSemanticState: 'sprint', planarSpeedMps: 5.4 })).toBe('sprint');
    expect(resolvePlayerAnimationTransition({ previousSemanticState: 'sprint', planarSpeedMps: 5.0 })).toBe('locomotion');
  });

  it('keeps environment/contact presentation finite and immutable', () => {
    const presentation = resolvePlayerAnimationPresentation({
      planarSpeedMps: 3.4,
      walkSpeedMps: 3.2,
      runSpeedMps: 6.5,
      leftFootGroundDeltaMeters: Number.NaN,
      rightFootGroundDeltaMeters: Number.POSITIVE_INFINITY,
      pelvisGroundDeltaMeters: -0.03,
    });
    expect(presentation.version).toBe('2026-09-30-v3');
    expect(presentation.environmentValid).toBe(true);
    expect(Number.isFinite(presentation.speedMps)).toBe(true);
    expect(Object.isFrozen(presentation)).toBe(true);
  });

  it('calls the real action callback only when semantic presentation changes', () => {
    const calls: Array<readonly [string, number]> = [];
    const director = createPlayerAnimationDirector({
      actions: { idle: 'idle', walking: 'walking', running: 'running' },
      playAction(name, scale) { calls.push([name, scale ?? 1]); },
    });
    director.update({ movementState: 'idle', planarSpeedMps: 0 });
    director.update({ movementState: 'idle', planarSpeedMps: 0 });
    director.update({ movementState: 'walk', planarSpeedMps: 3.2 });
    expect(calls.map(([name]) => name)).toEqual(['idle', 'walking']);
  });
});
