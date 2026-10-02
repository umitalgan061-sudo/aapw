export interface FrameBudgetInput{readonly frameMs:number;readonly gpuMs:number;readonly cpuMs:number;readonly drawCalls:number;readonly triangles:number;readonly passes:number;}
export interface FrameBudgetLimits{readonly frameMs:number;readonly gpuMs:number;readonly cpuMs:number;readonly drawCalls:number;readonly triangles:number;readonly passes:number;}
export class RenderFrameBudget{
 readonly limits:FrameBudgetLimits;
 constructor(limits:Partial<FrameBudgetLimits>={}){this.limits=Object.freeze({frameMs:limits.frameMs??16.6,gpuMs:limits.gpuMs??10,cpuMs:limits.cpuMs??8,drawCalls:limits.drawCalls??2500,triangles:limits.triangles??3000000,passes:limits.passes??32});}
 evaluate(input:FrameBudgetInput){const keys:[keyof FrameBudgetLimits,string][]=[['frameMs','frame'],['gpuMs','gpu'],['cpuMs','cpu'],['drawCalls','draw-calls'],['triangles','triangles'],['passes','passes']];const violations=keys.filter(([k])=>input[k]>this.limits[k]).map(([,name])=>name);const pressure=Math.max(...keys.map(([k])=>input[k]/Math.max(.001,this.limits[k])));return Object.freeze({pressure,violations:Object.freeze(violations),safe:violations.length===0});}
}
