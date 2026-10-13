import { describe, expect, it } from 'vitest';
import { buildPhotorealismFrame } from '../../src/3d/world/photorealismDirector.ts';
import { applyPhotorealismFrameToScene, sceneBridgeIsSafe } from '../../src/3d/world/photorealismSceneBridge.ts';

describe('photorealism scene bridge', () => {
  it('applies atmosphere, PBR and provenance without DOM access', () => {
    const fog: { density?: number } = {};
    const renderer: { toneMappingExposure?: number } = {};
    const sun: { intensity?: number } = {};
    const moon: { intensity?: number } = {};
    const material = {
      color: { setRGB: (r: number, g: number, b: number) => { material.rgb = [r, g, b]; } },
      normalScale: { set: (x: number, y: number) => { material.normal = [x, y]; } },
      userData: {} as Record<string, unknown>,
      rgb: [] as number[],
      normal: [] as number[],
      roughness: 0,
      metalness: 0,
      aoMapIntensity: 0,
      clearcoat: 0,
      transmission: 0,
    };
    const frame = buildPhotorealismFrame(20260922, {
      worldX: 120,
      worldZ: -80,
      heightMeters: 14,
      waterLevelMeters: 0,
      slopeDegrees: 18,
      curvature: 0.1,
      moisture: 0.42,
      temperature: 8,
      rockWeight: 0.25,
      snowWeight: 0,
      waterDistanceMeters: 45,
      roadDistanceMeters: 100,
      settlementDistanceMeters: 200,
      forestDensity: 0.7,
      windward: 0.2,
      lee: 0.1,
    });
    const receipt = applyPhotorealismFrameToScene(frame, { fog, renderer, sun, moon, material });
    expect(sceneBridgeIsSafe(receipt)).toBe(true);
    expect(receipt.applied).toContain('fog-density');
    expect(receipt.applied).toContain('material-provenance');
    expect(fog.density).toBe(frame.atmosphere.fogDensity);
    expect(material.userData.photorealism).toBeTruthy();
    expect(receipt.deterministicKey).toBe(frame.manifest.deterministicKey);
  });

  it('fails closed when only partial targets are supplied', () => {
    const frame = buildPhotorealismFrame(1, {
      worldX: 0, worldZ: 0, heightMeters: 0, waterLevelMeters: 0, slopeDegrees: 0,
      curvature: 0, moisture: 0, temperature: 10, rockWeight: 0, snowWeight: 0,
      waterDistanceMeters: 999, roadDistanceMeters: 999, settlementDistanceMeters: 999,
      forestDensity: 0, windward: 0, lee: 0,
    });
    const receipt = applyPhotorealismFrameToScene(frame, {});
    expect(receipt.applied).toHaveLength(0);
    expect(receipt.skipped.length).toBeGreaterThan(0);
    expect(sceneBridgeIsSafe(receipt)).toBe(false);
  });
});
