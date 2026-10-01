/**
 * Deterministic environment batch executor.
 *
 * It batches nearby observations into a single controller pass, rejects unsafe
 * placements before scene attach, and exposes a stable summary for perf/telemetry.
 */
import type { CanonicalEnvironmentObservation } from './photorealismEnvironmentPass.ts';
import type { RuntimeTarget, RuntimeControllerReceipt } from './photorealismRuntimeController.ts';

export interface BatchObservation {
  readonly id:string;
  readonly observation:CanonicalEnvironmentObservation;
  readonly priority:number;
}
export interface BatchResult {
  readonly batchKey:string;
  readonly processed:number;
  readonly accepted:number;
  readonly rejected:number;
  readonly receipts:readonly RuntimeControllerReceipt[];
  readonly rejectionReasons:readonly string[];
  readonly maxParityErrorMeters:number;
  readonly visibleFailureCount:number;
  readonly budgetClampedCount:number;
}

const finite=(value:number,fallback=0):number=>Number.isFinite(value)?value:fallback;
const clamp=(value:number,min=0,max=1):number=>Math.max(min,Math.min(max,finite(value,min)));

function stableSort(items:readonly BatchObservation[]):readonly BatchObservation[] {
  return Object.freeze([...items].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)));
}

export function createPhotorealismBatchExecutor(controller:{applyObservation:(observation:CanonicalEnvironmentObservation,targets:readonly RuntimeTarget[])=>RuntimeControllerReceipt},options?:{maxBatchSize?:number}):Readonly<{execute:(batchId:string,observations:readonly BatchObservation[],targets:readonly RuntimeTarget[])=>BatchResult}> {
  const maxBatchSize=Math.max(1,Math.min(64,Math.trunc(options?.maxBatchSize??16)));
  return Object.freeze({
    execute(batchId:string,observations:readonly BatchObservation[],targets:readonly RuntimeTarget[]):BatchResult{
      const selected=stableSort(observations).slice(0,maxBatchSize);
      const receipts:RuntimeControllerReceipt[]=[];
      const rejectionReasons:string[]=[];
      let maxParity=0; let visibleFailures=0; let budgetClamped=0; let accepted=0;
      for(const item of selected){
        const receipt=controller.applyObservation(item.observation,targets);
        receipts.push(receipt);
        if(receipt.accepted) accepted+=1; else rejectionReasons.push(`${item.id}:${receipt.rejectedReason??'rejected'}`);
        for(const issue of item.observation.visibleGridSeam||item.observation.visibleRectangularWater?[1]:[]) void issue;
        const parity=Math.abs(finite(item.observation.renderedHeightMeters)-finite(item.observation.colliderHeightMeters));
        maxParity=Math.max(maxParity,parity);
        visibleFailures+=receipt.issueCodes.length;
        if(receipt.budgetClamped) budgetClamped+=1;
      }
      return Object.freeze({batchKey:`buzul|batch-v1|${batchId}|${selected.length}`,processed:selected.length,accepted,rejected:selected.length-accepted,receipts:Object.freeze(receipts),rejectionReasons:Object.freeze(rejectionReasons),maxParityErrorMeters:clamp(maxParity,0,1000),visibleFailureCount:visibleFailures,budgetClampedCount:budgetClamped});
    },
  });
}

export function batchAcceptance(result:BatchResult):boolean {
  return result.processed>0&&result.rejected===0&&result.visibleFailureCount===0&&result.maxParityErrorMeters<=.35;
}
