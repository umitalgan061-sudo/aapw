import { describe, expect, it } from 'vitest';
import {
  buildPhotorealismFrame,
  environmentPhotorealismHealth,
  frameToMaterialRecipe,
  placementQueryFromFrame,
  validatePhotorealismFrame,
  type EnvironmentSample,
} from '../../src/3d/world/photorealismDirector.ts';

const sample=(overrides:Partial<EnvironmentSample>={}):EnvironmentSample=>({
  worldX:120, worldZ:-80, heightMeters:34, waterLevelMeters:6, slopeDegrees:12, curvature:0.15,
  moisture:0.44, temperature:12, rockWeight:0.08, snowWeight:0, waterDistanceMeters:90,
  roadDistanceMeters:60, settlementDistanceMeters:240, forestDensity:0.68, windward:0.3, lee:0.2,
  ...overrides,
});

describe('Buzul Muhafızı photorealism director',()=>{
  it('is deterministic for identical samples',()=>{
    const a=buildPhotorealismFrame(20260922,sample());
    const b=buildPhotorealismFrame(20260922,sample());
    expect(a).toEqual(b);
    expect(a.manifest.deterministicKey).toBe(b.manifest.deterministicKey);
  });
  it('keeps trees out of deep water and steep rock',()=>{
    const water=buildPhotorealismFrame(7,sample({heightMeters:2,waterLevelMeters:6,waterDistanceMeters:0.2,forestDensity:0.9}));
    const cliff=buildPhotorealismFrame(7,sample({slopeDegrees:48,rockWeight:0.98,waterDistanceMeters:80}));
    expect(water.placement.allowTree).toBe(false);
    expect(cliff.placement.allowTree).toBe(false);
    expect(validatePhotorealismFrame(water)).not.toContain('tree-on-water');
    expect(validatePhotorealismFrame(cliff)).not.toContain('tree-on-rock');
  });
  it('creates shoreline water response without cyan block semantics',()=>{
    const f=buildPhotorealismFrame(9,sample({heightMeters:5.8,waterLevelMeters:6,waterDistanceMeters:1.5,moisture:.88}));
    expect(['wet-edge','shallow','deep']).toContain(f.water.depthClass);
    expect(f.water.shorelineFade).toBeGreaterThan(0);
    expect(f.pbr.clearcoat).toBeGreaterThanOrEqual(0);
  });
  it('emits shared material and placement provenance',()=>{
    const f=buildPhotorealismFrame(11,sample());
    expect(f.manifest.materialAuthority).toBe('MaterialAssignmentCore.js');
    expect(f.manifest.placementAuthority).toBe('WorldAssetPlacementPipeline.js');
    expect(frameToMaterialRecipe(f).provenance).toEqual(f.manifest);
    expect(placementQueryFromFrame(f).provenance).toEqual(f.manifest);
  });
  it('reports a healthy mixed sample set',()=>{
    const frames=[
      buildPhotorealismFrame(1,sample()),
      buildPhotorealismFrame(1,sample({heightMeters:4,waterDistanceMeters:1,moisture:.9})),
      buildPhotorealismFrame(1,sample({heightMeters:140,slopeDegrees:42,rockWeight:.8,temperature:-6,snowWeight:.7})),
    ];
    const health=environmentPhotorealismHealth(frames);
    expect(health.frameCount).toBe(3);
    expect(health.invalidCount).toBe(0);
    expect(health.sharedContractCoverage).toBe(3);
  });
});
