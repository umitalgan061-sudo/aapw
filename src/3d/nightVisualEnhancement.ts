/** Typed night readability enhancement kept as a child of the canonical hemisphere light. */
import * as THREE from 'three';
const NIGHT_CINEMATIC_FILL_NAME='Game Night Cinematic Fill', NIGHT_CINEMATIC_DAY_INTENSITY=0.02, NIGHT_CINEMATIC_FULL_INTENSITY=0.72, NIGHT_CINEMATIC_SKY=0x8dbfff, NIGHT_CINEMATIC_GROUND=0x475648;
function smoothNight(value:number):number{const n=THREE.MathUtils.clamp(Number(value)||0,0,1);return n*n*(3-2*n);}
export function installNightVisualEnhancement(hemisphere:THREE.HemisphereLight):THREE.HemisphereLight{
 if(!hemisphere?.isHemisphereLight)throw new Error('Night visual enhancement requires the canonical hemisphere light.');
 const existing=hemisphere.getObjectByName(NIGHT_CINEMATIC_FILL_NAME); if(existing?.isHemisphereLight)return existing;
 const fill=new THREE.HemisphereLight(NIGHT_CINEMATIC_SKY,NIGHT_CINEMATIC_GROUND,NIGHT_CINEMATIC_DAY_INTENSITY);
 fill.name=NIGHT_CINEMATIC_FILL_NAME; fill.userData.gameNightVisualEnhancement=true; hemisphere.add(fill); return fill;
}
export function updateNightVisualEnhancement(hemisphere:THREE.HemisphereLight,nightFactor:number):number{
 const fill=installNightVisualEnhancement(hemisphere), night=smoothNight(nightFactor);
 fill.intensity=THREE.MathUtils.lerp(NIGHT_CINEMATIC_DAY_INTENSITY,NIGHT_CINEMATIC_FULL_INTENSITY,night); return fill.intensity;
}
export interface NightVisualEnhancementSnapshot{readonly name:string;readonly installed:boolean;readonly intensity:number;readonly dayIntensity:number;readonly fullNightIntensity:number;}
export function getNightVisualEnhancementSnapshot(hemisphere:THREE.HemisphereLight|null|undefined):NightVisualEnhancementSnapshot{
 const fill=hemisphere?.getObjectByName?.(NIGHT_CINEMATIC_FILL_NAME);
 return Object.freeze({name:NIGHT_CINEMATIC_FILL_NAME,installed:Boolean(fill?.isHemisphereLight),intensity:Number(fill?.intensity||0),dayIntensity:NIGHT_CINEMATIC_DAY_INTENSITY,fullNightIntensity:NIGHT_CINEMATIC_FULL_INTENSITY});
}
