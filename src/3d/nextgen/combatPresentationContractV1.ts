/** Cross-module acceptance contract for the next-generation combat presentation stack. */
import type { CombatPresentationFrame } from './combatPresentationV1';
import type { CombatPresentationDispatch } from './combatPresentationQueueV1';
import type { CombatPresentationAssetAudit } from './combatPresentationAssetsV1';
import type { CombatAccessibilitySignal } from './combatPresentationAccessibilityV1';
import type { CombatPresentationQualityDecision } from './combatPresentationQualityV1';
import type { CombatPresentationTelemetrySummary } from './combatPresentationTelemetryV1';
import type { CombatReactionIntent } from './combatPresentationReactionV1';
import type { CombatSpatialAudioState } from './combatPresentationSpatialAudioV1';
import type { CombatTimelineSample } from './combatPresentationTimelineV1';

export interface CombatPresentationContractInput {
  readonly frame: CombatPresentationFrame;
  readonly dispatches: readonly CombatPresentationDispatch[];
  readonly accessibility: readonly CombatAccessibilitySignal[];
  readonly assetAudit: CombatPresentationAssetAudit;
  readonly quality: CombatPresentationQualityDecision;
  readonly telemetry: CombatPresentationTelemetrySummary;
  readonly timelineSamples?: readonly CombatTimelineSample[];
  readonly maxFrameCues?: number;
  readonly maxDispatches?: number;
}

export interface CombatPresentationContractReport {
  readonly version: 1;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly checks: number;
  readonly frame: Readonly<{ tick: number; cues: number; dropped: number; hitstopTicks: number }>;
  readonly delivery: Readonly<{ dispatches: number; pendingAgeP95: number; failuresVisible: boolean }>;
  readonly assets: Readonly<{ combatAudioReady: boolean; combatVfxReady: boolean; disclosedFallbacks: number }>;
  readonly performance: Readonly<{ quality: string; telemetryHealth: string; queuePressure: number }>;
}

const finite=(v:number)=>Number.isFinite(v);
const bounded=(v:number,min:number,max:number)=>finite(v)&&v>=min&&v<=max;

export function validateCombatPresentationContract(input: CombatPresentationContractInput): CombatPresentationContractReport {
  const errors:string[]=[]; const warnings:string[]=[]; let checks=0;
  const maxFrameCues=Math.max(1,Math.floor(input.maxFrameCues??128));
  const maxDispatches=Math.max(1,Math.floor(input.maxDispatches??16));

  checks+=1; if(input.frame.version!==1) errors.push('unsupported frame version');
  checks+=1; if(!Number.isInteger(input.frame.tick)||input.frame.tick<0) errors.push('frame tick is invalid');
  checks+=1; if(input.frame.cues.length>maxFrameCues) errors.push('frame cue count exceeds hard limit');
  checks+=1; if(input.frame.droppedCues>0) warnings.push('presentation cues were shed this frame');
  checks+=1; if(input.frame.hitstopTicks<0||input.frame.hitstopTicks>6) errors.push('hitstop exceeds safety envelope');

  for(const cue of input.frame.cues){
    checks+=1;
    if(!bounded(cue.intensity,0,1)) errors.push(cue.id+': intensity out of range');
    if(!finite(cue.vfx.intensity)||cue.vfx.intensity<0) errors.push(cue.id+': vfx intensity invalid');
    if(!bounded(cue.audio.volume,0,1)) errors.push(cue.id+': audio volume invalid');
    if(cue.spatialAudio && (!finite(cue.spatialAudio.distanceMeters)||!bounded(cue.spatialAudio.attenuation,0,1)||!bounded(cue.spatialAudio.pan,-1,1))) errors.push(cue.id+': spatial audio invalid');
    const reaction=cue.reaction as CombatReactionIntent;
    if(reaction && (!bounded(reaction.upperBodyAdditive,0,1)||!bounded(reaction.lowerBodyStability,0,1)||!bounded(reaction.staggerLikelihood,0,1))) errors.push(cue.id+': reaction intent invalid');
  }

  checks+=1; if(input.dispatches.length>maxDispatches) errors.push('dispatch count exceeds frame budget');
  for(const dispatch of input.dispatches){
    checks+=1;
    if(dispatch.dispatchedTick<dispatch.scheduledTick) errors.push(dispatch.cue.id+': dispatch precedes schedule');
    if(dispatch.ageTicks<0||dispatch.ageTicks>8) errors.push(dispatch.cue.id+': stale dispatch age');
  }

  checks+=1; if(input.assetAudit.total<=0) errors.push('presentation asset audit is empty');
  checks+=1; if(input.assetAudit.missingCombatAudio>0) warnings.push('combat audio assets are incomplete');
  checks+=1; if(input.assetAudit.missingCombatVfx>0) warnings.push('combat VFX assets are incomplete');
  checks+=1; if(input.assetAudit.fallbacks>0) warnings.push('non-combat fallback assets are active');

  checks+=1; if(!['cinematic','balanced','reduced'].includes(input.quality.quality)) errors.push('invalid quality mode');
  checks+=1; if(!['healthy','pressured','degraded'].includes(input.telemetry.health)) errors.push('invalid telemetry health');
  checks+=1; if(input.telemetry.totalDropped>0) warnings.push('telemetry observed dropped cues');
  if(input.telemetry.peakPendingQueue>48) warnings.push('presentation queue pressure is high');

  for(const signal of input.accessibility){
    checks+=1;
    if(signal.cueId.length===0||!bounded(signal.visualEmphasis,0,1)||!finite(signal.motionScale)||signal.motionScale<0||signal.motionScale>1) errors.push('invalid accessibility signal');
  }

  for(const sample of input.timelineSamples??[]){
    checks+=1;
    if(!bounded(sample.normalized,0,1)||!bounded(sample.intensity,0,1)||!bounded(sample.cameraWeight,0,1)||!bounded(sample.recoilWeight,0,1)||!bounded(sample.flashWeight,0,1)||!bounded(sample.hapticWeight,0,1)) errors.push('invalid timeline sample');
  }

  const queuePressure=Math.max(0,input.telemetry.peakPendingQueue);
  const report=Object.freeze({
    version:1 as const, valid:errors.length===0, errors:Object.freeze(errors), warnings:Object.freeze(warnings), checks,
    frame:Object.freeze({tick:input.frame.tick,cues:input.frame.cues.length,dropped:input.frame.droppedCues,hitstopTicks:input.frame.hitstopTicks}),
    delivery:Object.freeze({dispatches:input.dispatches.length,pendingAgeP95:input.telemetry.dispatchAgeP95,failuresVisible:input.telemetry.totalDropped>0}),
    assets:Object.freeze({combatAudioReady:input.assetAudit.missingCombatAudio===0,combatVfxReady:input.assetAudit.missingCombatVfx===0,disclosedFallbacks:input.assetAudit.fallbacks}),
    performance:Object.freeze({quality:input.quality.quality,telemetryHealth:input.telemetry.health,queuePressure}),
  });
  return report;
}

export function summarizeContractBlockers(report: CombatPresentationContractReport): readonly string[] {
  if(report.valid) return Object.freeze([]);
  return Object.freeze(report.errors.slice(0,16));
}

export function assertCombatPresentationContract(input: CombatPresentationContractInput): CombatPresentationContractReport {
  const report=validateCombatPresentationContract(input);
  if(!report.valid) throw new Error('combat presentation contract failed: '+report.errors.join(' | '));
  return report;
}

export function contractReadinessLabel(report: CombatPresentationContractReport): 'ready'|'blocked' { return report.valid?'ready':'blocked'; }