import { describe, expect, it } from 'vitest';
import { R16InputRuntime } from '../../../src/3d/modern/r16/inputRuntime.js';

describe('R16 input runtime', () => {
  it('normalizes digital state across ticks', () => {
    const input = new R16InputRuntime();
    expect(input.register({ action:'jump',device:'keyboard',code:'Space',phase:'pressed' }).ok).toBe(true);
    expect(input.register({ action:'jump',device:'keyboard',code:'Space',phase:'released' }).ok).toBe(true);
    input.beginTick(1);
    expect(input.pushDigital('jump','pressed','keyboard','Space').ok).toBe(true);
    expect(input.snapshot().pressed).toEqual(['jump']);
    expect(input.snapshot().held).toEqual(['jump']);
    input.beginTick(2);
    expect(input.pushDigital('jump','released','keyboard','Space').ok).toBe(true);
    expect(input.snapshot().released).toEqual(['jump']);
    expect(input.snapshot().held).toEqual([]);
  });

  it('applies analog deadzones and bounds queue growth', () => {
    const input = new R16InputRuntime({ maxQueueSize: 2 });
    input.register({ action:'cameraLook',device:'mouse',code:'MouseX',phase:'analog' });
    input.beginTick(3);
    expect(input.pushAnalog('cameraLook','mouse','MouseX',0.01,0).ok).toBe(true);
    expect(input.pushAnalog('cameraLook','mouse','MouseX',1,0).ok).toBe(true);
    expect(input.pushAnalog('cameraLook','mouse','MouseX',1,0).ok).toBe(true);
    expect(input.stats().queued).toBe(2);
    expect(input.stats().dropped).toBe(1);
  });
});
