/** Typed deterministic procedural night starfield with GPU-driven per-star twinkle. */
import * as THREE from 'three';
const STAR_COUNT=1200, STARFIELD_RADIUS_METERS=1850, MIN_HEIGHT_FACTOR=0.05, STAR_SIZE_PIXELS=2.2, TWINKLE_FREQ_MIN=0.4, TWINKLE_FREQ_MAX=1.3, TWINKLE_BASE=0.65, TWINKLE_AMPLITUDE=0.35;
const STAR_VERTEX_SHADER=/* glsl */`
 attribute float aPhase; attribute float aFreq; uniform float uTime; uniform float uNightFactor; uniform float uSize; varying float vAlpha;
 void main(){float twinkle=${TWINKLE_BASE.toFixed(2)}+${TWINKLE_AMPLITUDE.toFixed(2)}*sin(uTime*aFreq+aPhase);vAlpha=uNightFactor*twinkle;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;gl_PointSize=uSize;}
`;
const STAR_FRAGMENT_SHADER=/* glsl */`
 uniform vec3 uColor; varying float vAlpha; void main(){gl_FragColor=vec4(uColor,vAlpha);}
`;
function mulberry32(seed:number):()=>number{let a=seed>>>0;return function random():number{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
export const STARFIELD_POLICY=Object.freeze({id:'typed-deterministic-starfield-2026-09-21-v1',count:STAR_COUNT,radiusMeters:STARFIELD_RADIUS_METERS,minHeightFactor:MIN_HEIGHT_FACTOR,twinkle:true,gpuDriven:true,deterministic:true,renderOnly:true});
export type StarfieldMaterial=THREE.ShaderMaterial&{readonly uniforms:{readonly uTime:{value:number};readonly uNightFactor:{value:number};readonly uSize:{value:number};readonly uColor:{value:THREE.Color}}};
export type Starfield=THREE.Points<THREE.BufferGeometry,StarfieldMaterial>;
export function createStarfield(seed=1337):Starfield{
 const random=mulberry32(seed^0x53544152),positions=new Float32Array(STAR_COUNT*3),phases=new Float32Array(STAR_COUNT),freqs=new Float32Array(STAR_COUNT);
 for(let i=0;i<STAR_COUNT;i+=1){const theta=random()*Math.PI*2,heightFactor=MIN_HEIGHT_FACTOR+random()*(1-MIN_HEIGHT_FACTOR),radiusXZ=Math.sqrt(Math.max(0,1-heightFactor*heightFactor));positions[i*3]=Math.cos(theta)*radiusXZ*STARFIELD_RADIUS_METERS;positions[i*3+1]=heightFactor*STARFIELD_RADIUS_METERS;positions[i*3+2]=Math.sin(theta)*radiusXZ*STARFIELD_RADIUS_METERS;phases[i]=random()*Math.PI*2;freqs[i]=TWINKLE_FREQ_MIN+random()*(TWINKLE_FREQ_MAX-TWINKLE_FREQ_MIN);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));geometry.setAttribute('aFreq',new THREE.BufferAttribute(freqs,1));
 const material=new THREE.ShaderMaterial({vertexShader:STAR_VERTEX_SHADER,fragmentShader:STAR_FRAGMENT_SHADER,uniforms:{uTime:{value:0},uNightFactor:{value:0},uSize:{value:STAR_SIZE_PIXELS},uColor:{value:new THREE.Color(0xf5f8ff)}},transparent:true,depthWrite:false,fog:false}) as StarfieldMaterial;
 const points=new THREE.Points(geometry,material);points.frustumCulled=false;points.renderOrder=-0.5;return points;
}
export function updateStarfield(starfield:Starfield,cameraPosition:THREE.Vector3,elapsedSeconds:number,nightFactor:number):void{starfield.position.copy(cameraPosition);starfield.material.uniforms.uTime.value=Number.isFinite(elapsedSeconds)?elapsedSeconds:0;starfield.material.uniforms.uNightFactor.value=THREE.MathUtils.clamp(Number(nightFactor)||0,0,1);}
export function disposeStarfield(starfield:Starfield):void{starfield.geometry.dispose();starfield.material.dispose();}
