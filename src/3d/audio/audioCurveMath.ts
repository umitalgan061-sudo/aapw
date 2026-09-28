/** Strictly typed, pure audio curve primitives. */
export interface PanGains{readonly left:number;readonly right:number;}
export interface CrossfadeGains{readonly out:number;readonly in:number;}
const clamp=(value:number,min=0,max=1):number=>Math.min(max,Math.max(min,value));
const finiteOr=(value:number,fallback:number):number=>Number.isFinite(value)?value:fallback;
export function lerp(a:number,b:number,t:number):number{const x=clamp(finiteOr(t,0));return finiteOr(a,0)+(finiteOr(b,0)-finiteOr(a,0))*x;}
export function inverseLerp(a:number,b:number,value:number):number{const low=finiteOr(a,0);const high=finiteOr(b,1);if(high===low)return 0;return clamp((finiteOr(value,low)-low)/(high-low));}
export function smoothstep(a:number,b:number,value:number):number{const t=inverseLerp(a,b,value);return t*t*(3-2*t);}
export function smootherstep(a:number,b:number,value:number):number{const t=inverseLerp(a,b,value);return t*t*t*(t*(t*6-15)+10);}
export function exponentialApproach(current:number,target:number,deltaSeconds:number,timeConstant=0.2):number{const dt=Math.max(0,finiteOr(deltaSeconds,0));const tau=Math.max(0.001,finiteOr(timeConstant,0.2));return lerp(current,target,1-Math.exp(-dt/tau));}
export function equalPowerPan(position:number):PanGains{const p=clamp(finiteOr(position,0),-1,1);const angle=(p+1)*Math.PI*0.25;return Object.freeze({left:Math.cos(angle),right:Math.sin(angle)});}
export function equalPowerCrossfade(progress:number):CrossfadeGains{const t=clamp(finiteOr(progress,0));const angle=t*Math.PI*0.5;return Object.freeze({out:Math.cos(angle),in:Math.sin(angle)});}
export function distanceCurve(distance:number,near=1,far=100):number{const safeNear=Math.max(0,finiteOr(near,1));const safeFar=Math.max(safeNear+0.001,finiteOr(far,100));const normalized=inverseLerp(safeNear,safeFar,Math.max(0,finiteOr(distance,safeFar)));return Math.pow(1-normalized,1.6);}
export function attackRelease(current:number,target:number,deltaSeconds:number,attackSeconds=0.05,releaseSeconds=0.2):number{const attack=finiteOr(attackSeconds,0.05);const release=finiteOr(releaseSeconds,0.2);return exponentialApproach(current,target,deltaSeconds,target>current?attack:release);}
export function boundedSine(phase:number,amplitude=1,offset=0):number{return finiteOr(offset,0)+Math.sin(finiteOr(phase,0))*clamp(finiteOr(amplitude,1),0,1);}
export function triangleWave(phase:number):number{const x=(finiteOr(phase,0)/(Math.PI*2))%1;const t=x<0?x+1:x;return 1-4*Math.abs(t-0.5);}
export function curveMathConstants():Readonly<{min:0;max:1}>{return Object.freeze({min:0 as const,max:1 as const});}
