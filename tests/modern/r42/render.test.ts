import { describe, expect, it } from 'vitest';
import { RenderGovernorR42 } from '../../../src/3d/strict/r42/render.ts';

const capabilities = {
  webgpu: true,
  webgl2: true,
  maxTextureSize: 8192,
  maxSamples: 4,
  compressedTextures: true,
  devicePixelRatio: 2,
  reducedMotion: false,
  saveData: false,
} as const;

describe('R42 render governor', () => {
  it('prefers WebGPU when available', () => {
    const governor = new RenderGovernorR42('high');
    expect(governor.evaluate(capabilities, {
      frameMs: 12,
      gpuMs: 8,
      memoryPressure: 0.2,
      thermalPressure: 0.2,
      visibleObjects: 100,
      cameraCut: false,
    }).backend).toBe('webgpu');
  });

  it('steps down after sustained budget pressure', () => {
    const governor = new RenderGovernorR42('ultra');
    for (let index = 0; index < 8; index += 1) {
      governor.evaluate(capabilities, {
        frameMs: 30,
        gpuMs: 28,
        memoryPressure: 0.9,
        thermalPressure: 0.9,
        visibleObjects: 1000,
        cameraCut: false,
      });
    }
    expect(governor.tier).toBe('high');
    expect(governor.scale).toBeLessThan(1);
  });

  it('invalidates temporal history on camera cuts', () => {
    const governor = new RenderGovernorR42('balanced');
    governor.evaluate(capabilities, {
      frameMs: 10, gpuMs: 5, memoryPressure: 0.1, thermalPressure: 0.1, visibleObjects: 10, cameraCut: false,
    });
    governor.evaluate(capabilities, {
      frameMs: 10, gpuMs: 5, memoryPressure: 0.1, thermalPressure: 0.1, visibleObjects: 10, cameraCut: true,
    });
    expect(governor.historyValid).toBe(false);
  });
});
