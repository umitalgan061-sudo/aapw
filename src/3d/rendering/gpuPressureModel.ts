/** Strict TypeScript GPU/CPU render pressure model. */
export type GpuPressureState='nominal'|'warning'|'critical';
export interface GpuPressurePolicy{readonly id:string;readonly targetFrameMs:number;readonly warningRatio:number;readonly criticalRatio:number;readonly memoryWarning:number;readonly memoryCritical:number;readonly thermalWarning:number;readonly thermalCritical:number;}
export interface GpuPressureInput{readonly gpuMs?:number;readonly cpuMs?:number;readonly frameMs?:number;readonly memoryUtilization?:number;readonly thermalPressure?:number;}
export interface GpuPressureOptions{readonly policy?:Partial<GpuPressurePolicy>;}
export interface GpuPressureResult{readonly state:GpuPressureState;readonly overall:number;readonly gpuRatio:number;readonly cpuRatio:number;readonly frameRatio:number;readonly memoryRatio:number;readonly thermal:number;}
const freeze=Object.freeze;
const finite=(value:unknown,fallback=0):number=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value:unknown,min=0,max=1):number=>Math.min(max,Math.max(min,finite(value,min)));
export const GPU_PRESSURE_POLICY:Readonly<GpuPressurePolicy>=freeze({id:'gpu-pressure-model-2026-09-v1',targetFrameMs:16.67,warningRatio:.92,criticalRatio:1.2,memoryWarning:.8,memoryCritical:.95,thermalWarning:.7,thermalCritical:.9});
function ratio(value:unknown,target:unknown):number{return Math.max(0,finite(value)/Math.max(.1,finite(target,1)));}
export function evaluateGpuPressure(input:GpuPressureInput={},options:GpuPressureOptions={}):GpuPressureResult{
 const policy=freeze({...GPU_PRESSURE_POLICY,...(options.policy??{})});
 const gpuRatio=ratio(input.gpuMs,policy.targetFrameMs),cpuRatio=ratio(input.cpuMs,policy.targetFrameMs),frameRatio=ratio(input.frameMs,policy.targetFrameMs),memoryRatio=clamp(input.memoryUtilization),thermal=clamp(input.thermalPressure);
 const gpuScore=clamp(gpuRatio/Math.max(1,policy.criticalRatio)),cpuScore=clamp(cpuRatio/Math.max(1,policy.criticalRatio)),frameScore=clamp(frameRatio/Math.max(1,policy.criticalRatio));
 const overall=clamp(gpuScore*.4+cpuScore*.15+frameScore*.2+memoryRatio*.15+thermal*.1);
 const critical=frameRatio>=policy.criticalRatio||gpuRatio>=policy.criticalRatio||memoryRatio>=policy.memoryCritical||thermal>=policy.thermalCritical;
 const warning=critical||frameRatio>=policy.warningRatio||gpuRatio>=policy.warningRatio||memoryRatio>=policy.memoryWarning||thermal>=policy.thermalWarning;
 return freeze({state:critical?'critical':warning?'warning':'nominal',overall:Number(overall.toFixed(4)),gpuRatio:Number(gpuRatio.toFixed(4)),cpuRatio:Number(cpuRatio.toFixed(4)),frameRatio:Number(frameRatio.toFixed(4)),memoryRatio:Number(memoryRatio.toFixed(4)),thermal:Number(thermal.toFixed(4))});
}
export type PressureRecommendation='retain-default-quality'|'reduce-render-scale'|'disable-expensive-postprocess'|'reduce-instance-budgets'|'defer-low-priority-textures'|'prefer-safe-backend'|'reduce-nonessential-postprocess'|'reduce-low-priority-texture-mips'|'slow-background-streaming';
export function pressureRecommendations(pressure:GpuPressureResult|null|undefined):readonly PressureRecommendation[]{
 if(!pressure)return freeze(['retain-default-quality']);
 if(pressure.state==='critical')return freeze(['reduce-render-scale','disable-expensive-postprocess','reduce-instance-budgets','defer-low-priority-textures','prefer-safe-backend']);
 if(pressure.state==='warning')return freeze(['reduce-nonessential-postprocess','reduce-low-priority-texture-mips','slow-background-streaming']);
 return freeze(['retain-default-quality']);
}
export type PressureClass='nominal'|'watch'|'elevated'|'critical';
export function pressureClass(score=0):PressureClass{const value=clamp(score);return value>=.85?'critical':value>=.55?'elevated':value>=.3?'watch':'nominal';}
