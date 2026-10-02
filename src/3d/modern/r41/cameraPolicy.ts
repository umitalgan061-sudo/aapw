export type CameraMode='explore'|'combat'|'cinematic'|'dialogue'|'map';
export interface CameraSample{readonly speed:number;readonly targetDistance:number;readonly obstruction:number;readonly aim:number;readonly shake:number;}
export interface CameraDecision{readonly mode:CameraMode;readonly distance:number;readonly lagMs:number;readonly shakeScale:number;readonly collisionRadius:number;}
export class CameraPolicy{
 choose(mode:CameraMode,sample:CameraSample):CameraDecision{const obstruction=clamp(sample.obstruction,0,1);const aim=clamp(sample.aim,0,1);const distance=Math.max(.5,sample.targetDistance*(1-obstruction*.55));const lag=mode==='combat'?45:mode==='cinematic'?120:mode==='dialogue'?90:60;const shake=clamp(sample.shake,0,1)*(mode==='cinematic'?1:mode==='combat'?.65:.25);return Object.freeze({mode,distance:distance*(1-aim*.12)+Math.min(3,Math.max(0,sample.speed)*.015),lagMs:lag,shakeScale:shake,collisionRadius:mode==='combat'?.28:.2});}
 blend(a:CameraDecision,b:CameraDecision,alpha:number){const t=clamp(alpha,0,1);return Object.freeze({mode:t<.5?a.mode:b.mode,distance:a.distance+(b.distance-a.distance)*t,lagMs:a.lagMs+(b.lagMs-a.lagMs)*t,shakeScale:a.shakeScale+(b.shakeScale-a.shakeScale)*t,collisionRadius:a.collisionRadius+(b.collisionRadius-a.collisionRadius)*t});}
}
function clamp(v:number,min:number,max:number){return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;}
