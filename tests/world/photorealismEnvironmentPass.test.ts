import { describe, expect, it } from 'vitest';
import { buildPhotorealismFrame } from '../../src/3d/world/photorealismDirector.ts';
import { buildEnvironmentPassPlan, mergeEnvironmentPassPlans } from '../../src/3d/world/photorealismEnvironmentPass.ts';
import { buildDeterministicClusterSeeds, planEnvironmentCluster, summarizeClusterPlans } from '../../src/3d/world/photorealismAssetClusterPlanner.ts';

const sample=(overrides:Partial<Parameters<typeof buildPhotorealismFrame>[1]>={})=>({
  worldX:120,worldZ:-80,heightMeters:180,waterLevelMeters:0,slopeDegrees:24,curvature:.18,moisture:.42,temperature:7,rockWeight:.26,snowWeight:.04,waterDistanceMeters:38,roadDistanceMeters:44,settlementDistanceMeters:260,forestDensity:.78,windward:.35,lee:.12,...overrides,
});

const asset=(id:string,family:any)=>({id,family,sourcePath:`assets/models/${family}/${id}.glb`,materialSlots:family==='tree'?['trunk','bark','leaves']:['rock','moss'],lods:['hero','near','mid','far','impostor'],boundsRadiusMeters:family==='tree'?2:1,minSlope:0,maxSlope:48,minHeight:-1000,maxHeight:3000,requiresDryGround:family!=='rock',supportsInstancing:true} as const);

describe('photorealism environment pass',()=>{
  it('is deterministic for the same canonical observation',()=>{
    const observation={sample:sample(),renderedHeightMeters:180,colliderHeightMeters:180,shorelineGradient:.76,waterNormalRepeat:.22,skyLuminance:.72,visibleGridSeam:false,visibleRectangularWater:false,visibleSmoothWall:false,visibleFlatGround:false,visibleSnowSheet:false,visibleSparseCanopy:false,visibleRoadRibbon:false,visibleFloatingAsset:false,visibleMaterialMismatch:false};
    const a=buildEnvironmentPassPlan(42,observation); const b=buildEnvironmentPassPlan(42,observation);
    expect(a).toEqual(b); expect(a.health.acceptanceReady).toBe(true); expect(a.issues).toHaveLength(0);
  });
  it('prioritizes P0 visible failures before lower priorities',()=>{
    const observation={sample:sample({waterDistanceMeters:4}),renderedHeightMeters:181,colliderHeightMeters:180,shorelineGradient:.04,waterNormalRepeat:.94,skyLuminance:.08,visibleGridSeam:true,visibleRectangularWater:true,visibleSmoothWall:true,visibleFlatGround:true,visibleSnowSheet:false,visibleSparseCanopy:true,visibleRoadRibbon:true,visibleFloatingAsset:false,visibleMaterialMismatch:true};
    const plan=buildEnvironmentPassPlan(42,observation);
    expect(plan.issues[0]?.priority).toBe('P0'); expect(plan.health.acceptanceReady).toBe(false); expect(plan.p0.suppressRectangularWater).toBe(true); expect(plan.p5.blackSkyGuard).toBe(true);
  });
  it('keeps rendered and collider parity measurable',()=>{
    const observation={sample:sample(),renderedHeightMeters:181,colliderHeightMeters:180,shorelineGradient:.8,waterNormalRepeat:.2,skyLuminance:.8,visibleGridSeam:false,visibleRectangularWater:false,visibleSmoothWall:false,visibleFlatGround:false,visibleSnowSheet:false,visibleSparseCanopy:false,visibleRoadRibbon:false,visibleFloatingAsset:false,visibleMaterialMismatch:false};
    const plan=buildEnvironmentPassPlan(1,observation); expect(plan.health.parityErrorMeters).toBe(1); expect(plan.health.acceptanceReady).toBe(false);
  });
  it('merges deterministic acceptance summaries across samples',()=>{
    const clean={sample:sample(),renderedHeightMeters:180,colliderHeightMeters:180,shorelineGradient:.8,waterNormalRepeat:.2,skyLuminance:.8,visibleGridSeam:false,visibleRectangularWater:false,visibleSmoothWall:false,visibleFlatGround:false,visibleSnowSheet:false,visibleSparseCanopy:false,visibleRoadRibbon:false,visibleFloatingAsset:false,visibleMaterialMismatch:false};
    const dirty={...clean,visibleGridSeam:true};
    const summary=mergeEnvironmentPassPlans([buildEnvironmentPassPlan(1,clean),buildEnvironmentPassPlan(1,dirty)]);
    expect(summary.count).toBe(2); expect(summary.acceptanceReady).toBe(false); expect(summary.priorities.P0).toBeGreaterThan(0);
  });
});

describe('asset-first cluster planning',()=>{
  it('creates deterministic grounded instance plans with LOD and batch keys',()=>{
    const observation={sample:sample(),renderedHeightMeters:180,colliderHeightMeters:180,shorelineGradient:.8,waterNormalRepeat:.2,skyLuminance:.8,visibleGridSeam:false,visibleRectangularWater:false,visibleSmoothWall:false,visibleFlatGround:false,visibleSnowSheet:false,visibleSparseCanopy:false,visibleRoadRibbon:false,visibleFloatingAsset:false,visibleMaterialMismatch:false};
    const pass=buildEnvironmentPassPlan(7,observation); const frame=buildPhotorealismFrame(7,observation.sample);
    const seeds=buildDeterministicClusterSeeds(7,'tree',[{sample:observation.sample,frame},{sample:sample({worldX:180,worldZ:-10,forestDensity:.92}),frame}],pass);
    const plan=planEnvironmentCluster(7,'tree',[asset('pine-a','tree'),asset('pine-b','tree')],seeds,pass);
    expect(plan.deterministicKey).toContain('asset-cluster-v1'); expect(plan.manifestSource).toContain('WorldAssetPlacementPipeline.js');
    expect(plan.instances.every(item=>item.family==='tree')).toBe(true); expect(plan.instances.every(item=>item.instanceBatchKey.includes('MaterialAssignmentCore.js'))).toBe(true);
  });
  it('rejects water placement and summarizes LODs',()=>{
    const waterSample=sample({heightMeters:-5,waterLevelMeters:0,waterDistanceMeters:0.2}); const frame=buildPhotorealismFrame(11,waterSample);
    const observation={sample:waterSample,renderedHeightMeters:-5,colliderHeightMeters:-5,shorelineGradient:.7,waterNormalRepeat:.1,skyLuminance:.7,visibleGridSeam:false,visibleRectangularWater:false,visibleSmoothWall:false,visibleFlatGround:false,visibleSnowSheet:false,visibleSparseCanopy:false,visibleRoadRibbon:false,visibleFloatingAsset:false,visibleMaterialMismatch:false};
    const pass=buildEnvironmentPassPlan(11,observation); const seeds=buildDeterministicClusterSeeds(11,'tree',[{sample:waterSample,frame}],pass); const plan=planEnvironmentCluster(11,'tree',[asset('pine-a','tree')],seeds,pass); const summary=summarizeClusterPlans([plan]);
    expect(plan.instances).toHaveLength(0); expect(plan.rejected).toBeGreaterThan(0); expect(summary.instances).toBe(0);
  });
});
