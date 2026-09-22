import { describe, expect, it } from 'vitest';
import { buildEnvironmentPassPlan } from '../../src/3d/world/photorealismEnvironmentPass.ts';
import { createPhotorealismRuntimeController, controllerHealth, isRuntimeControllerReceipt } from '../../src/3d/world/photorealismRuntimeController.ts';
import { createPhotorealismBatchExecutor, batchAcceptance } from '../../src/3d/world/photorealismBatchExecutor.ts';
import type { CanonicalEnvironmentObservation } from '../../src/3d/world/photorealismEnvironmentPass.ts';

const baseSample={
  worldX:12,worldZ:-8,slopeDegrees:9,curvature:.18,moisture:.42,temperature:.28,
  forestDensity:.72,roadDistanceMeters:54,waterDistanceMeters:120,waterLevelMeters:0,
  rockWeight:.22,screeWeight:.12,snowWeight:.16,biome:'temperate',surfaceClass:'grass',
} as const;

function observation(overrides:Partial<CanonicalEnvironmentObservation>={}):CanonicalEnvironmentObservation{
  return {
    sample:{...baseSample,...overrides.sample},renderedHeightMeters:40,colliderHeightMeters:40,
    shorelineGradient:.66,waterNormalRepeat:.22,skyLuminance:.72,visibleGridSeam:false,
    visibleRectangularWater:false,visibleSmoothWall:false,visibleFlatGround:false,visibleSnowSheet:false,
    visibleSparseCanopy:false,visibleRoadRibbon:false,visibleFloatingAsset:false,visibleMaterialMismatch:false,
    ...overrides,
  };
}

function targets(log:Array<unknown>){
  const make=(id:string,kind:any)=>({id,kind,apply:(operation:any,value:any)=>log.push({id,operation,value})});
  return [make('renderer','renderer'),make('fog','fog'),make('sun','sun'),make('moon','moon'),make('material','material'),make('water','water'),make('vegetation','vegetation'),make('placement','placement')];
}

describe('photorealism runtime controller',()=>{
  it('produces deterministic plan and receipt keys',()=>{
    const first=buildEnvironmentPassPlan(20260922,observation());
    const second=buildEnvironmentPassPlan(20260922,observation());
    expect(first.deterministicKey).toBe(second.deterministicKey);
    const controller=createPhotorealismRuntimeController({seed:20260922});
    const a=controller.apply(first,targets([]));
    const b=controller.apply(second,targets([]));
    expect(a.deterministicKey).toBe(b.deterministicKey);
    expect(isRuntimeControllerReceipt(a)).toBe(true);
  });

  it('rejects visible P0 failures before scene mutation',()=>{
    const log:unknown[]=[];
    const controller=createPhotorealismRuntimeController({seed:7,rejectVisibleFailures:true});
    const receipt=controller.applyObservation(observation({visibleRectangularWater:true}),targets(log));
    expect(receipt.accepted).toBe(false);
    expect(receipt.rejectedReason).toBe('visible-failure-gate');
    expect(log).toHaveLength(0);
    expect(controllerHealth(receipt).accepted).toBe(false);
  });

  it('rejects duplicate target kinds before scene mutation',()=>{
    const log:unknown[]=[];
    const controller=createPhotorealismRuntimeController({seed:8,rejectVisibleFailures:false});
    const duplicateTargets=[...targets(log),{id:'renderer-2',kind:'renderer',apply:()=>log.push('unexpected')}];
    const receipt=controller.applyObservation(observation(),duplicateTargets as any);
    expect(receipt.accepted).toBe(false);
    expect(receipt.rejectedReason).toBe('duplicate-target-kind');
    expect(receipt.operationCount).toBe(0);
    expect(log).toHaveLength(0);
  });

  it('applies bounded operations and clamps the operation budget',()=>{
    const log:unknown[]=[];
    const controller=createPhotorealismRuntimeController({seed:9,maxOperationsPerFrame:3,rejectVisibleFailures:false});
    const receipt=controller.applyObservation(observation(),targets(log));
    expect(receipt.operationCount).toBe(3);
    expect(receipt.budgetClamped).toBe(true);
    expect(log).toHaveLength(3);
  });

  it('executes high-priority observations first and reports batch health',()=>{
    const controller=createPhotorealismRuntimeController({seed:4,rejectVisibleFailures:false});
    const executor=createPhotorealismBatchExecutor(controller,{maxBatchSize:2});
    const result=executor.execute('near-center',[
      {id:'low',priority:1,observation:observation()},
      {id:'high',priority:5,observation:observation({visibleMaterialMismatch:true})},
      {id:'ignored',priority:0,observation:observation()},
    ],targets([]));
    expect(result.processed).toBe(2);
    expect(result.batchKey).toContain('near-center');
    expect(batchAcceptance(result)).toBe(false);
  });
});
