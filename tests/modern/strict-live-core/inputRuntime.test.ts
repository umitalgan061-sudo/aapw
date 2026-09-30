import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUT_POLICY,
  StrictInputRuntime,
  bindingActionsForKey,
  buildGamepadInputSample,
  buildKeyboardSample,
  buildTouchSample,
  calculateActionEdges,
  mergeInputIntents,
  normalizeGamepadAxis,
  normalizeInputSample,
  normalizeTrigger,
} from '../../../src/3d/strict/inputRuntime.ts';

describe('inputRuntime', () => {
  it('maps standard keyboard bindings', () => {
    expect(bindingActionsForKey('KeyW')).toEqual(['move']);
    expect(bindingActionsForKey('Space')).toEqual(['jump']);
    expect(bindingActionsForKey('Unknown')).toEqual([]);
  });
  it('builds keyboard samples from edge lists', () => {
    const sample = buildKeyboardSample(['Space'], ['KeyW', 'ShiftLeft'], []);
    expect(sample.source).toBe('keyboard');
    expect(sample.held).toEqual(['move', 'sprint']);
    expect(sample.pressed).toEqual(['jump']);
  });
  it('builds touch semantic samples', () => {
    const sample = buildTouchSample(.5, -.25, .2, -.1, {
      pressed: ['light'],
      held: ['guard'],
    }, 1);
    expect(sample.source).toBe('touch');
    expect(sample.pressed).toEqual(['light']);
    expect(sample.held).toEqual(['guard']);
  });
  it('normalizes axes and triggers', () => {
    expect(normalizeGamepadAxis(.01)).toBe(0);
    expect(normalizeTrigger(.01)).toBe(0);
    expect(normalizeTrigger(1)).toBe(1);
  });
  it('builds semantic gamepad actions', () => {
    const gamepad = {
      connected: true,
      index: 0,
      axes: [.8, 0, .2, -.1],
      buttons: Array.from({ length: 12 }, (_, index) => index === 2),
      buttonValues: Array.from({ length: 12 }, (_, index) => index === 7 ? .8 : 0),
    };
    const sample = buildGamepadInputSample(gamepad, [], 2);
    expect(sample.held).toContain('light');
    expect(sample.pressed).toContain('light');
    expect(sample.moveX).toBeGreaterThan(0);
    expect(sample.zoom).toBeGreaterThan(0);
  });
  it('calculates pressed and released actions', () => {
    const previous = new Set(['guard', 'sprint'] as const);
    const current = new Set(['sprint', 'light'] as const);
    const edges = calculateActionEdges(previous, current);
    expect(edges.pressed.has('light')).toBe(true);
    expect(edges.released.has('guard')).toBe(true);
  });
  it('rejects backwards timestamps', () => {
    const runtime = new StrictInputRuntime();
    expect(runtime.submit({ source: 'keyboard', timestampSeconds: 2 }).ok).toBe(true);
    const result = runtime.submit({ source: 'keyboard', timestampSeconds: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });
  it('adds missing held edge transitions', () => {
    const runtime = new StrictInputRuntime();
    expect(runtime.submit({ source: 'keyboard', held: ['guard'], timestampSeconds: 1 }).ok).toBe(true);
    const second = runtime.submit({ source: 'keyboard', held: [], timestampSeconds: 2 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.intent.released.has('guard')).toBe(true);
  });
  it('limits look and zoom rates', () => {
    const result = normalizeInputSample({
      source: 'mouse',
      lookX: 1,
      lookY: 1,
      zoom: 100,
      timestampSeconds: 1,
    }, 1, DEFAULT_INPUT_POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(result.value.look.x)).toBeLessThanOrEqual(DEFAULT_INPUT_POLICY.maxLookRate);
    expect(Math.abs(result.value.cameraZoom)).toBeLessThanOrEqual(DEFAULT_INPUT_POLICY.maxZoomRate);
  });
  it('merges synthetic intents', () => {
    const aResult = normalizeInputSample({ source: 'synthetic', moveX: .5, timestampSeconds: 1 }, 1);
    const bResult = normalizeInputSample({ source: 'synthetic', moveY: .25, timestampSeconds: 1 }, 2);
    expect(aResult.ok && bResult.ok).toBe(true);
    if (!aResult.ok || !bResult.ok) return;
    const merged = mergeInputIntents(aResult.value, bResult.value, 3);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.sequence).toBe(3);
    expect(merged.value.source).toBe('synthetic');
  });
});