import { describe, expect, it } from 'vitest';
import { createDefaultInputMapperV3, InputIntentMapperV3 } from '../../src/3d/modern/inputIntentV3.ts';
import { RenderProxyV3 } from '../../src/3d/modern/renderProxyV3.ts';

describe('Input intent v3', () => {
  it('maps keyboard-like button state to semantic actions', () => {
    const mapper = createDefaultInputMapperV3();
    const frame = mapper.map({ device: 'keyboard', timestampTick: 10, axes: {}, buttons: { Space: true, ShiftLeft: false } });
    expect(frame.tick).toBe(10);
    expect(frame.intents.find((intent) => intent.action === 'jump')).toMatchObject({ pressed: true, value: 1 });
  });

  it('maps axes with a dead zone and optional inversion', () => {
    const mapper = new InputIntentMapperV3([
      { action: 'moveX', axes: ['horizontal'], deadZone: 0.1 },
      { action: 'lookY', axes: ['lookY'], deadZone: 0.05, invert: true },
    ]);
    const frame = mapper.map({ device: 'gamepad', timestampTick: 4, axes: { horizontal: 0.4, lookY: 0.5 }, buttons: {} });
    expect(frame.intents.find((intent) => intent.action === 'moveX')?.value).toBeCloseTo((0.4 - 0.1) / 0.9, 5);
    expect(frame.intents.find((intent) => intent.action === 'lookY')?.value).toBeLessThan(0);
  });

  it('exposes repeat state for held buttons', () => {
    const mapper = new InputIntentMapperV3([{ action: 'attack', buttons: ['MouseLeft'] }]);
    const first = mapper.map({ device: 'mouse', timestampTick: 1, axes: {}, buttons: { MouseLeft: true } });
    const second = mapper.map({ device: 'mouse', timestampTick: 2, axes: {}, buttons: { MouseLeft: true } });
    expect(first.intents[0]?.repeated).toBe(false);
    expect(second.intents[0]?.repeated).toBe(true);
  });

  it('resets repeat history explicitly', () => {
    const mapper = new InputIntentMapperV3([{ action: 'jump', buttons: ['Space'] }]);
    mapper.map({ device: 'keyboard', timestampTick: 1, axes: {}, buttons: { Space: true } });
    mapper.reset();
    const frame = mapper.map({ device: 'keyboard', timestampTick: 2, axes: {}, buttons: { Space: true } });
    expect(frame.intents[0]?.repeated).toBe(false);
  });

  it('ignores duplicate action mappings deterministically', () => {
    const mapper = new InputIntentMapperV3([
      { action: 'jump', buttons: ['Space'] },
      { action: 'jump', buttons: ['GamepadA'] },
    ]);
    const frame = mapper.map({ device: 'keyboard', timestampTick: 1, axes: {}, buttons: { Space: true, GamepadA: true } });
    expect(frame.intents.filter((intent) => intent.action === 'jump')).toHaveLength(1);
  });
});

describe('Render proxy v3', () => {
  it('emits sequence-ordered presentation commands', () => {
    const proxy = new RenderProxyV3();
    const a = proxy.emitTransform(1, { x: 1, y: 2, z: 3, yaw: 0, pitch: 0, scale: 1 });
    const b = proxy.emitAnimation(1, 'run');
    expect(b.sequence).toBe(a.sequence + 1);
    expect(proxy.peek()).toHaveLength(2);
  });

  it('drains commands without mutating command payloads after emit', () => {
    const proxy = new RenderProxyV3();
    const transform = { x: 1, y: 2, z: 3, yaw: 0, pitch: 0, scale: 1 };
    proxy.emitTransform(7, transform);
    transform.x = 999;
    const batch = proxy.drain(5, 10);
    expect(batch.commands[0]?.payload.transform).toMatchObject({ x: 1 });
  });

  it('drops low-priority work when the queue exceeds capacity', () => {
    const proxy = new RenderProxyV3(64);
    for (let index = 0; index < 80; index += 1) proxy.emitEffect(index, 'dust', 1, index === 79 ? 100 : 1);
    expect(proxy.peek().length).toBeLessThanOrEqual(64);
    expect(proxy.metrics().dropped).toBeGreaterThan(0);
  });

  it('preserves higher-priority commands under pressure', () => {
    const proxy = new RenderProxyV3(64);
    proxy.emitEffect(999, 'boss', 1, 1000);
    for (let index = 0; index < 90; index += 1) proxy.emitEffect(index, 'dust', 1, 0);
    expect(proxy.peek().some((command) => command.entityId === 999)).toBe(true);
  });

  it('rejects malformed presentation commands', () => {
    const proxy = new RenderProxyV3();
    expect(() => proxy.emit({ entityId: -1, kind: 'effect', layer: 'fx', priority: 1, payload: {} })).toThrow();
    expect(() => proxy.emit({ entityId: 1, kind: 'effect', layer: 'fx', priority: 1, payload: { value: Number.NaN } })).toThrow();
  });
});
