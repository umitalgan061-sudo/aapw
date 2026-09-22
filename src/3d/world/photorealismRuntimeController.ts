/**
 * Buzul Muhafızı — deterministic runtime controller for the photorealism pass.
 *
 * This is an orchestration boundary only. Existing scene, renderer, material and
 * placement authorities remain owners of mutation. The controller consumes the
 * P0→P5 plan and emits a frozen execution receipt plus bounded callbacks.
 */
import type { EnvironmentPassPlan, CanonicalEnvironmentObservation } from './photorealismEnvironmentPass.ts';
import { buildEnvironmentPassPlan } from './photorealismEnvironmentPass.ts';

export type RuntimeTargetKind = 'renderer'|'fog'|'sun'|'moon'|'material'|'placement'|'vegetation'|'water';
export type RuntimeOperation =
  | 'set-exposure'
  | 'set-fog-density'
  | 'set-aerial-perspective'
  | 'set-light-energy'
  | 'set-sky-luminance'
  | 'apply-material-recipe'
  | 'apply-water-policy'
  | 'apply-vegetation-budget'
  | 'apply-placement-query';

export interface RuntimeTarget {
  readonly id: string;
  readonly kind: RuntimeTargetKind;
  readonly apply: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
}

export interface RuntimeExecution {
  readonly targetId: string;
  readonly targetKind: RuntimeTargetKind;
  readonly operation: RuntimeOperation;
  readonly value: number|boolean|Readonly<Record<string, unknown>>;
}

export interface RuntimeControllerOptions {
  readonly seed: number;
  readonly maxOperationsPerFrame?: number;
  readonly rejectVisibleFailures?: boolean;
}

export interface RuntimeControllerReceipt {
  readonly deterministicKey: string;
  readonly planKey: string;
  readonly accepted: boolean;
  readonly rejectedReason: string|null;
  readonly operations: readonly RuntimeExecution[];
  readonly issueCodes: readonly string[];
  readonly operationCount: number;
  readonly budgetClamped: boolean;
}

const clamp = (value:number,min=0,max=1):number => Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
const finite = (value:number,fallback:number):number => Number.isFinite(value)?value:fallback;
const freezeRecord = <T extends Readonly<Record<string, unknown>>>(value:T):T => Object.freeze(value);

function pushExecution(
  executions:RuntimeExecution[],
  target:RuntimeTarget|undefined,
  operation:RuntimeOperation,
  value:number|boolean|Readonly<Record<string, unknown>>,
):void {
  if (!target) return;
  executions.push(Object.freeze({targetId:target.id,targetKind:target.kind,operation,value}));
}

function buildOperations(plan:EnvironmentPassPlan, targets:readonly RuntimeTarget[]):RuntimeExecution[] {
  const byKind = new Map<RuntimeTargetKind,RuntimeTarget>();
  for (const target of targets) byKind.set(target.kind,target);
  const out:RuntimeExecution[]=[];
  pushExecution(out,byKind.get('renderer'),'set-exposure',plan.p5.exposure);
  pushExecution(out,byKind.get('fog'),'set-fog-density',plan.p5.fogDensity);
  pushExecution(out,byKind.get('fog'),'set-aerial-perspective',plan.p5.aerialPerspective);
  pushExecution(out,byKind.get('sun'),'set-light-energy',clamp(plan.frame.atmosphere.sunEnergy,0,8));
  pushExecution(out,byKind.get('moon'),'set-light-energy',clamp(plan.frame.atmosphere.moonEnergy,0,3));
  pushExecution(out,byKind.get('renderer'),'set-sky-luminance',clamp(plan.p5.skyLuminance,0,2));
  pushExecution(out,byKind.get('material'),'apply-material-recipe',freezeRecord({recipe:plan.materialRecipe,p0:plan.p0,p1:plan.p1,p2:plan.p2,p4:plan.p4}));
  pushExecution(out,byKind.get('water'),'apply-water-policy',freezeRecord({shorelineFade:plan.p4.shorelineFade,foamWidthMeters:plan.p4.foamWidthMeters,depthBlendMeters:plan.p4.depthBlendMeters,normalScale:plan.p4.normalScale,moireSuppression:plan.p4.moireSuppression,suppressRectangularWater:plan.p0.suppressRectangularWater}));
  pushExecution(out,byKind.get('vegetation'),'apply-vegetation-budget',freezeRecord({canopyDensity:plan.p3.canopyDensity,understoryDensity:plan.p3.understoryDensity,shrubDensity:plan.p3.shrubDensity,grassDensity:plan.p3.grassDensity,instanceBatchSize:plan.p3.instanceBatchSize,lodBias:plan.p3.lodBias,clearingRadiusMeters:plan.p3.clearingRadiusMeters}));
  pushExecution(out,byKind.get('placement'),'apply-placement-query',freezeRecord(plan.placementQuery));
  return out;
}

function applyExecutions(executions:readonly RuntimeExecution[],targets:readonly RuntimeTarget[]):void {
  const map=new Map(targets.map(target=>[target.id,target]));
  for(const execution of executions){
    const target=map.get(execution.targetId);
    if(target) target.apply(execution.operation,execution.value);
  }
}

export function createPhotorealismRuntimeController(options:RuntimeControllerOptions){
  const maxOperations=Math.max(1,Math.trunc(options.maxOperationsPerFrame??32));
  const rejectVisibleFailures=options.rejectVisibleFailures??true;
  let lastReceipt:RuntimeControllerReceipt|null=null;
  return Object.freeze({
    plan(observation:CanonicalEnvironmentObservation):EnvironmentPassPlan{
      return buildEnvironmentPassPlan(options.seed,observation);
    },
    apply(plan:EnvironmentPassPlan,targets:readonly RuntimeTarget[]):RuntimeControllerReceipt{
      const issueCodes=Object.freeze(plan.issues.map(issue=>issue.code));
      const rejected=rejectVisibleFailures&&plan.health.visibleFailureCount>0;
      const all=buildOperations(plan,targets);
      const budgetClamped=all.length>maxOperations;
      const operations=Object.freeze(all.slice(0,maxOperations));
      if(!rejected) applyExecutions(operations,targets);
      const receipt=Object.freeze({
        deterministicKey:`buzul|runtime-controller-v1|${Math.trunc(options.seed)}|${plan.deterministicKey}`,
        planKey:plan.deterministicKey,
        accepted:!rejected,
        rejectedReason:rejected?'visible-failure-gate':null,
        operations,
        issueCodes,
        operationCount:operations.length,
        budgetClamped,
      });
      lastReceipt=receipt;
      return receipt;
    },
    applyObservation(observation:CanonicalEnvironmentObservation,targets:readonly RuntimeTarget[]):RuntimeControllerReceipt{
      const plan=buildEnvironmentPassPlan(options.seed,observation);
      return this.apply(plan,targets);
    },
    getLastReceipt():RuntimeControllerReceipt|null{return lastReceipt;},
    budget:{maxOperationsPerFrame:maxOperations,rejectVisibleFailures},
  });
}

export function isRuntimeControllerReceipt(value:unknown):value is RuntimeControllerReceipt {
  if(!value||typeof value!=='object') return false;
  const candidate=value as Partial<RuntimeControllerReceipt>;
  return typeof candidate.deterministicKey==='string'&&typeof candidate.planKey==='string'&&typeof candidate.accepted==='boolean'&&Array.isArray(candidate.operations)&&Array.isArray(candidate.issueCodes)&&typeof candidate.operationCount==='number';
}

export function controllerHealth(receipt:RuntimeControllerReceipt|null):Readonly<{known:boolean;accepted:boolean;operationCount:number;rejectedReason:string|null}> {
  if(!receipt) return Object.freeze({known:false,accepted:false,operationCount:0,rejectedReason:null});
  return Object.freeze({known:true,accepted:receipt.accepted,operationCount:receipt.operationCount,rejectedReason:receipt.rejectedReason});
}

export function normalizeRuntimeBudget(value:unknown,fallback=32):number {
  const numeric=typeof value==='number'?value:Number(value);
  return Math.max(1,Math.min(64,Math.trunc(finite(numeric,fallback))));
}
