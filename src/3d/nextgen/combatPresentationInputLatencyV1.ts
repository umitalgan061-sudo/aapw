/** Input-latency adapter for combat presentation. The existing input authority remains the source of actions. */

export type CombatCriticalInputAction = 'lightAttack' | 'heavyAttack' | 'block' | 'parry' | 'dodge' | 'lockOn';
export type CombatInputDevice = 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'virtual' | 'replay';
export interface CombatPresentationInputSample {
  readonly action: CombatCriticalInputAction;
  readonly device: CombatInputDevice;
  readonly sourceTick: number;
  readonly simulationTick: number;
  readonly timestampMs: number;
  readonly held: boolean;
  readonly strength?: number;
}
export interface CombatInputLatencyConfig { readonly fixedDeltaMs:number; readonly maxCompensationTicks:number; readonly touchLatencyMs:number; readonly gamepadLatencyMs:number; readonly mouseLatencyMs:number; readonly keyboardLatencyMs:number; readonly replayLatencyMs:number; }
export interface CombatInputLatencyResult { readonly action:CombatCriticalInputAction; readonly device:CombatInputDevice; readonly ageMs:number; readonly ageTicks:number; readonly compensationTicks:number; readonly prewarm: boolean; readonly queuePriority:0|1|2|3; readonly accepted:boolean; readonly late:boolean; readonly strength:number; }

const DEFAULT:CombatInputLatencyConfig=Object.freeze({fixedDeltaMs:16.667,maxCompensationTicks:2,touchLatencyMs:45,gamepadLatencyMs:28,mouseLatencyMs:12,keyboardLatencyMs:10,replayLatencyMs:0});
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,finite(v,min)));
const expectedLatency=(device:CombatInputDevice,cfg:CombatInputLatencyConfig)=>device==='touch'?cfg.touchLatencyMs:device==='gamepad'?cfg.gamepadLatencyMs:device==='mouse'?cfg.mouseLatencyMs:device==='keyboard'?cfg.keyboardLatencyMs:cfg.replayLatencyMs;
const priority=(action:CombatCriticalInputAction):0|1|2|3=>action==='heavyAttack'||action==='parry'?3:action==='dodge'||action==='lightAttack'?2:action==='block'?1:1;

export function resolveCombatPresentationInputLatency(sample:CombatPresentationInputSample,config:Partial<CombatInputLatencyConfig>={}):CombatInputLatencyResult{
  const cfg=Object.freeze({...DEFAULT,...config});
  const deltaTicks=sample.simulationTick-sample.sourceTick;
  const ageTicks=Math.max(0,Number.isFinite(deltaTicks)?deltaTicks:0);
  const ageMs=Math.max(0,ageTicks*cfg.fixedDeltaMs);
  const latency=expectedLatency(sample.device,cfg);
  const expectedAgeTicks=latency/cfg.fixedDeltaMs;
  const compensationTicks=Math.min(cfg.maxCompensationTicks,Math.max(0,Math.round(expectedAgeTicks-ageTicks)));
  const late=ageMs>latency+cfg.fixedDeltaMs*cfg.maxCompensationTicks;
  const strength=clamp(sample.strength??(sample.held?1:0));
  const prewarm=!late&&(sample.action==='lightAttack'||sample.action==='heavyAttack'||sample.action==='dodge'||sample.action==='parry');
  return Object.freeze({action:sample.action,device:sample.device,ageMs:Number(ageMs.toFixed(3)),ageTicks,compensationTicks,prewarm,queuePriority:priority(sample.action),accepted:sample.sourceTick<=sample.simulationTick&&!late,late,strength});
}

export function shouldPrewarmCombatPresentation(result:CombatInputLatencyResult):boolean{return result.accepted&&result.prewarm&&result.compensationTicks>0;}
export function combatInputPresentationBudget(device:CombatInputDevice,config:Partial<CombatInputLatencyConfig>={}):Readonly<{expectedLatencyMs:number;allowedAgeTicks:number;prewarmLeadMs:number}>{const cfg=Object.freeze({...DEFAULT,...config});const expected=expectedLatency(device,cfg);return Object.freeze({expectedLatencyMs:expected,allowedAgeTicks:Math.max(0,Math.round(expected/cfg.fixedDeltaMs)+cfg.maxCompensationTicks),prewarmLeadMs:Math.min(50,expected*0.65)});}
export function validateCombatPresentationInputResult(result:CombatInputLatencyResult):boolean{return result.ageMs>=0&&result.ageTicks>=0&&result.compensationTicks>=0&&result.strength>=0&&result.strength<=1&&result.queuePriority>=0&&result.queuePriority<=3&&!(!result.accepted&&result.prewarm);}
export function resolveCombatInputDeviceParity(samples:readonly CombatPresentationInputSample[]):Readonly<{accepted:number;late:number;prewarm:number;byDevice:Readonly<Record<CombatInputDevice,number>>}>{
  const byDevice={keyboard:0,mouse:0,gamepad:0,touch:0,virtual:0,replay:0}; let accepted=0;let late=0;let prewarm=0;
  for(const sample of samples){const result=resolveCombatPresentationInputLatency(sample);if(result.accepted)accepted+=1;if(result.late)late+=1;if(result.prewarm)prewarm+=1;byDevice[result.device]+=1;}
  return Object.freeze({accepted,late,prewarm,byDevice:Object.freeze(byDevice)});
}