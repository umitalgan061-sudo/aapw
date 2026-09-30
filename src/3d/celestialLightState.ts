/** Typed, deterministic shared read-only celestial key-light state for custom shaders. */
export type CelestialLightSource = 'sun' | 'moon';
export interface Vector3Like { readonly x:number; readonly y:number; readonly z:number; }
export interface ColorLike { readonly r:number; readonly g:number; readonly b:number; }
export interface CelestialLightState { readonly source:CelestialLightSource; readonly direction:Vector3Like; readonly color:ColorLike; readonly intensity:number; readonly nightFactor:number; }
export interface CelestialLightInput { readonly x:number; readonly y:number; readonly z:number; }

const DEFAULT_DIRECTION:Vector3Like=Object.freeze({x:0.557086,y:0.742781,z:0.371391});
const DEFAULT_COLOR:ColorLike=Object.freeze({r:1,g:0.887923,b:0.637597});
const PHOTOMETRIC_TIE_RATIO=0.14;

let state:CelestialLightState=Object.freeze({source:'sun',direction:DEFAULT_DIRECTION,color:DEFAULT_COLOR,intensity:1,nightFactor:0});

function normalizedDirection(position?:Partial<CelestialLightInput>|null):Vector3Like{
 const x=Number(position?.x)||0,y=Number(position?.y)||0,z=Number(position?.z)||0;
 const length=Math.hypot(x,y,z)||1;
 return Object.freeze({x:x/length,y:y/length,z:z/length});
}
function frozenColor(color?:Partial<ColorLike>|null):ColorLike{
 return Object.freeze({
  r:Number.isFinite(color?.r)?Math.max(0,Number(color?.r)):1,
  g:Number.isFinite(color?.g)?Math.max(0,Number(color?.g)):1,
  b:Number.isFinite(color?.b)?Math.max(0,Number(color?.b)):1,
 });
}
function photometricKeyScore(intensity:number,color:ColorLike):number{
 const luminance=0.2126*color.r+0.7152*color.g+0.0722*color.b;
 return intensity*Math.max(0.02,luminance);
}
function smoothstep01(value:number):number{
 const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t);
}
function blendedDirection(a:Vector3Like,b:Vector3Like,amount:number):Vector3Like{
 const t=Math.max(0,Math.min(1,amount));
 return normalizedDirection({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
}
function blendedColor(a:ColorLike,b:ColorLike,amount:number):ColorLike{
 const t=Math.max(0,Math.min(1,amount));
 return Object.freeze({r:a.r+(b.r-a.r)*t,g:a.g+(b.g-a.g)*t,b:a.b+(b.b-a.b)*t});
}

export interface PublishCelestialLightStateOptions{
 readonly sunPosition?:Partial<CelestialLightInput>|null; readonly sunColor?:Partial<ColorLike>|null; readonly sunIntensity?:number;
 readonly moonPosition?:Partial<CelestialLightInput>|null; readonly moonColor?:Partial<ColorLike>|null; readonly moonIntensity?:number; readonly nightFactor?:number;
}
export function publishCelestialLightState(options:PublishCelestialLightStateOptions={}):CelestialLightState{
 const {sunPosition,sunColor,sunIntensity=0,moonPosition,moonColor,moonIntensity=0,nightFactor=0}=options;
 const safeSunIntensity=Math.max(0,Number(sunIntensity)||0), safeMoonIntensity=Math.max(0,Number(moonIntensity)||0);
 const safeSunColor=frozenColor(sunColor), safeMoonColor=frozenColor(moonColor);
 const sunDirection=normalizedDirection(sunPosition), moonDirection=normalizedDirection(moonPosition);
 const strongestIntensity=Math.max(safeSunIntensity,safeMoonIntensity), intensityDelta=Math.abs(safeSunIntensity-safeMoonIntensity);
 const nearTie=strongestIntensity>0&&intensityDelta/strongestIntensity<=PHOTOMETRIC_TIE_RATIO;
 const sunScore=photometricKeyScore(safeSunIntensity,safeSunColor), moonScore=photometricKeyScore(safeMoonIntensity,safeMoonColor);
 const rawMoonWins=safeMoonIntensity>safeSunIntensity, photometricMoonWins=moonScore>sunScore, moonWins=nearTie?photometricMoonWins:rawMoonWins;
 const scoreTotal=sunScore+moonScore, moonShare=scoreTotal>0?moonScore/scoreTotal:(moonWins?1:0);
 const tieProximity=nearTie?1-Math.min(1,intensityDelta/Math.max(strongestIntensity*PHOTOMETRIC_TIE_RATIO,1e-9)):0;
 const blendAmount=nearTie?(moonWins?1-(1-moonShare)*smoothstep01(tieProximity):moonShare*smoothstep01(tieProximity)):(moonWins?1:0);
 state=Object.freeze({source:moonWins?'moon':'sun',direction:blendedDirection(sunDirection,moonDirection,blendAmount),color:blendedColor(safeSunColor,safeMoonColor,blendAmount),intensity:strongestIntensity,nightFactor:Math.max(0,Math.min(1,Number(nightFactor)||0))});
 return state;
}
export function getCelestialLightState():CelestialLightState{return state;}
