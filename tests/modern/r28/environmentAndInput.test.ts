import { describe, expect, it } from 'vitest';
import { clampDevicePixelRatio, profileRuntimeEnvironment, readBrowserCapabilities, type BrowserCapabilities } from '../../../src/3d/modern/r28/environment.ts';
import { DomInputSampler } from '../../../src/3d/modern/r28/inputDom.ts';

describe('R28 environment and input', () => {
  it('returns a safe server-side capability profile', () => {
    const capabilities = readBrowserCapabilities();
    expect(capabilities.hardwareConcurrency).toBeGreaterThan(0);
    expect(capabilities.touch).toBe(false);
  });

  it('derives a stable quality hint from explicit capabilities', () => {
    const high: BrowserCapabilities = {
      secureContext: true,
      webgl: true,
      webgpu: true,
      worker: true,
      sharedArrayBuffer: true,
      hardwareConcurrency: 16,
      deviceMemoryGb: 16,
      touch: false,
      saveStorage: true,
    };
    const constrained = { ...high, hardwareConcurrency: 2, deviceMemoryGb: 2, touch: true };
    expect(profileRuntimeEnvironment(high).qualityHint).toBe(4);
    expect(profileRuntimeEnvironment(constrained).qualityHint).toBe(1);
    expect(profileRuntimeEnvironment({ ...high, webgl: false }).qualityHint).toBe(0);
  });

  it('caps device pixel ratio according to quality level', () => {
    expect(clampDevicePixelRatio(4, 4)).toBe(2.5);
    expect(clampDevicePixelRatio(4, 2)).toBe(1.75);
    expect(clampDevicePixelRatio(Number.NaN, 0)).toBe(1);
  });

  it('builds a neutral input frame without requiring a DOM bind', () => {
    const sampler = new DomInputSampler({ deadzone: 0.1 });
    const input = sampler.sample(12);
    expect(input.tick).toBe(12);
    expect(input.move).toEqual({ x: 0, y: 0 });
    expect(input.buttons).toEqual([]);
    sampler.setAnalog('sprint', 0.05);
    expect(sampler.sample(13).analog).toEqual({});
    sampler.setAnalog('sprint', 0.8);
    expect(sampler.sample(14).analog.sprint).toBe(0.8);
    sampler.dispose();
  });
});
