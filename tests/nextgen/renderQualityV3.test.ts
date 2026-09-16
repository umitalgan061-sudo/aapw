import { describe, expect, it } from 'vitest';
import { classifyGpu, resolveRenderFeatures, validateRenderFeatures } from '../../src/3d/nextgen/renderQualityV3';

describe('render quality policy', () => {
  const highGpu = { maxTextureSize: 8192, maxSamples: 4, webgl2: true, floatColorBuffer: true, instancing: true, anisotropy: 16 };

  it('classifies GPU capability tiers deterministically', () => {
    expect(classifyGpu(highGpu)).toBe('high');
    expect(classifyGpu({ ...highGpu, webgl2: false })).toBe('low');
  });

  it('disables expensive effects on constrained quality presets', () => {
    const battery = resolveRenderFeatures('battery', highGpu);
    const cinematic = resolveRenderFeatures('cinematic', { ...highGpu, maxTextureSize: 16384, maxSamples: 8, anisotropy: 16 });
    expect(battery.ssr).toBe(false);
    expect(battery.volumetrics).toBe(false);
    expect(cinematic.pixelRatioCap).toBeGreaterThan(battery.pixelRatioCap);
  });

  it('preserves feature dependencies', () => {
    const features = resolveRenderFeatures('cinematic', { ...highGpu, maxTextureSize: 16384, maxSamples: 8, anisotropy: 16 });
    expect(validateRenderFeatures(features)).toEqual([]);
  });
});
