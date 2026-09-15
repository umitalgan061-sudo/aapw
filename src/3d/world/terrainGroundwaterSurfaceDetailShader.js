/**
 * Fragment-only shader presentation for groundwater surface detail.
 *
 * The CPU detail layer remains the source of authored semantics. The shader
 * re-derives bounded local cues from world position so detail remains visible
 * when a material is rendered without a CPU-side per-fragment uniform graph.
 * No vertex displacement, height writes, hydrology writes or placement changes
 * are permitted here.
 */
import { TERRAIN_GROUNDWATER_DETAIL_POLICY } from './terrainGroundwaterSurfaceDetail.js';

const freeze = Object.freeze;

export const TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY = freeze({
  id: 'terrain-groundwater-surface-detail-shader-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_DETAIL_POLICY.id,
  materialKey: TERRAIN_GROUNDWATER_DETAIL_POLICY.materialKey,
  renderOnly: true,
  deterministic: true,
  fragmentOnly: true,
  modifiesVertexPosition: false,
  modifiesDisplacement: false,
  maxNormalStrength: TERRAIN_GROUNDWATER_DETAIL_POLICY.maxNormalStrength,
});

export const TERRAIN_GROUNDWATER_DETAIL_SHADER_INVARIANTS = freeze([
  'fragment-only-material-adjustment',
  'no-vertex-position-write',
  'no-height-map-write',
  'no-hydrology-topology-write',
  'no-collider-write',
  'no-vegetation-placement-write',
  'deterministic-world-space-cues',
]);

export const TERRAIN_GROUNDWATER_DETAIL_GLSL = String.raw`
float terrainGwDetailHash(vec2 p){
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.103,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float terrainGwDetailNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  float a=terrainGwDetailHash(i);
  float b=terrainGwDetailHash(i+vec2(1.0,0.0));
  float c=terrainGwDetailHash(i+vec2(0.0,1.0));
  float d=terrainGwDetailHash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float terrainGwDetailFbm(vec2 p){
  float v=0.0,w=0.0,a=.55;
  for(int i=0;i<5;i++){
    v+=terrainGwDetailNoise(p)*a;
    w+=a;
    p=p*2.03+vec2(7.4,-11.8);
    a*=.48;
  }
  return v/max(w,.0001);
}
float terrainGwDetailRidge(vec2 p){ return 1.0-abs(terrainGwDetailFbm(p)*2.0-1.0); }
float terrainGwDetailWet(vec2 p,float slope,float h){
  float basin=1.0-smoothstep(2.0,9.5,slope);
  float low=1.0-smoothstep(18.0,150.0,h);
  float texture=terrainGwDetailFbm(p/52.0+vec2(3.1,-17.0));
  return clamp(basin*.40+texture*.34+low*.14,0.0,1.0);
}
float terrainGwDetailCapillary(vec2 p,float slope){
  float local=terrainGwDetailFbm(p/18.0+vec2(-4.0,8.0));
  float shallow=1.0-smoothstep(2.0,28.0,slope);
  return clamp(local*.58+shallow*.25,0.0,1.0);
}
float terrainGwDetailSeepage(vec2 p,float slope){
  float ridge=terrainGwDetailRidge(p/9.0+vec2(11.0,-9.0));
  float band=smoothstep(4.0,23.0,slope)*(1.0-smoothstep(23.0,46.0,slope));
  return clamp(ridge*band,0.0,1.0);
}
float terrainGwDetailPuddle(vec2 p,float slope,float h){
  float flat=1.0-smoothstep(1.4,8.5,slope);
  float low=1.0-smoothstep(10.0,130.0,h);
  float texture=terrainGwDetailRidge(p/19.0);
  return clamp(flat*.50+low*.18+texture*.18,0.0,1.0);
}
float terrainGwDetailEvaporation(vec2 p,float slope,float h){
  float dry=terrainGwDetailFbm(p/64.0+vec2(-8.0,2.7));
  float high=smoothstep(35.0,420.0,h);
  float flat=1.0-smoothstep(4.0,34.0,slope);
  return clamp((.24+dry*.46)*high*flat,0.0,1.0);
}
float terrainGwDetailCrust(vec2 p,float slope,float h){
  float edge=smoothstep(.28,.82,terrainGwDetailRidge(p/27.0+vec2(5.5,-3.8)));
  float high=smoothstep(30.0,240.0,h);
  float flat=1.0-smoothstep(6.0,31.0,slope);
  return clamp(edge*high*flat,0.0,1.0);
}
float terrainGwDetailFine(vec2 p,float slope){
  float film=terrainGwDetailWet(p,slope,40.0);
  float fine=terrainGwDetailFbm(p/13.0+vec2(1.8,9.3));
  return clamp(film*.46+fine*.34,0.0,1.0);
}
float terrainGwDetailFreeze(vec2 p,float slope,float h){
  float cold=terrainGwDetailFbm(p/210.0+vec2(8.0,-4.0));
  float elevated=smoothstep(90.0,1800.0,h);
  float band=smoothstep(3.0,36.0,slope);
  return clamp(cold*.42+elevated*.28+band*.10,0.0,1.0);
}
void terrainGwDetailApplyColor(){
  vec2 p=vTerrainLowWorldPosition.xz;
  float h=vTerrainLowWorldPosition.y;
  float slope=degrees(acos(clamp(abs(normalize(vTerrainLowWorldNormal).y),0.0,1.0)));
  float wet=terrainGwDetailWet(p,slope,h);
  float cap=terrainGwDetailCapillary(p,slope);
  float seep=terrainGwDetailSeepage(p,slope);
  float puddle=terrainGwDetailPuddle(p,slope,h);
  float evap=terrainGwDetailEvaporation(p,slope,h);
  float crust=terrainGwDetailCrust(p,slope,h);
  float fine=terrainGwDetailFine(p,slope);
  float freeze=terrainGwDetailFreeze(p,slope,h);
  float marsh=(1.0-smoothstep(20.0,120.0,h))*(.42+wet*.38);
  float rim=clamp((wet*(1.0-wet))*2.7+puddle*.24,0.0,1.0);
  float dark=seep*.42+cap*.16;
  diffuseColor.rgb+=vec3(-.012,-.009,.008)*wet;
  diffuseColor.rgb+=vec3(-.008,-.006,.003)*dark;
  diffuseColor.rgb+=vec3(-.005,-.004,-.002)*puddle;
  diffuseColor.rgb+=vec3(.009,.006,.002)*crust;
  diffuseColor.rgb+=vec3(.004,.003,.002)*evap;
  diffuseColor.rgb+=vec3(.001,.002,.004)*marsh;
  diffuseColor.rgb+=vec3(-.003,-.002,-.001)*fine;
  diffuseColor.rgb+=vec3(-.002,-.002,-.001)*freeze*.25;
  diffuseColor.rgb+=vec3(.002,.001,.001)*rim*.28;
}
void terrainGwDetailApplyRoughness(){
  vec2 p=vTerrainLowWorldPosition.xz;
  float h=vTerrainLowWorldPosition.y;
  float slope=degrees(acos(clamp(abs(normalize(vTerrainLowWorldNormal).y),0.0,1.0)));
  float wet=terrainGwDetailWet(p,slope,h);
  float puddle=terrainGwDetailPuddle(p,slope,h);
  float crust=terrainGwDetailCrust(p,slope,h);
  float freeze=terrainGwDetailFreeze(p,slope,h);
  float evap=terrainGwDetailEvaporation(p,slope,h);
  roughnessFactor=clamp(roughnessFactor-wet*.042-puddle*.034+crust*.030+freeze*.018+evap*.010,.42,1.0);
}
void terrainGwDetailApplyNormal(){
  vec2 p=vTerrainLowWorldPosition.xz;
  float h=vTerrainLowWorldPosition.y;
  float slope=degrees(acos(clamp(abs(normalize(vTerrainLowWorldNormal).y),0.0,1.0)));
  float film=terrainGwDetailWet(p,slope,h);
  float seep=terrainGwDetailSeepage(p,slope);
  float puddle=terrainGwDetailPuddle(p,slope,h);
  float freeze=terrainGwDetailFreeze(p,slope,h);
  float a=terrainGwDetailFbm(p/11.0+vec2(1.9,-3.6));
  float b=terrainGwDetailFbm(p/11.0+vec2(2.7,-2.9));
  float c=terrainGwDetailRidge(p/48.0+vec2(-6.2,11.1));
  vec2 g=vec2(b-a,c-.5);
  float strength=clamp(film*.030+seep*.020+puddle*.014+freeze*.011,0.0,0.055);
  normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.0,-g.y)*strength);
}
`;

function replaceOnce(source, marker, payload){
  return source.replace(marker, `${marker}\n${payload}`);
}

export function groundwaterSurfaceDetailShaderReplacements(){
  return freeze({
    common: TERRAIN_GROUNDWATER_DETAIL_GLSL.length > 0,
    color: TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('terrainGwDetailApplyColor();'),
    roughness: TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('terrainGwDetailApplyRoughness();'),
    normal: TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('terrainGwDetailApplyNormal();'),
    vertexDisplacement: !TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('position +='),
    heightWrite: !TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('vTerrainLowWorldPosition.y +='),
  });
}

export function installTerrainGroundwaterSurfaceDetailShader(material){
  if(!material) throw new TypeError('groundwater surface detail shader requires a material');
  if(material.userData?.terrainGroundwaterSurfaceDetailShaderInstalled) return material;
  const previous=typeof material.onBeforeCompile==='function'?material.onBeforeCompile.bind(material):()=>{};
  material.onBeforeCompile=(shader,renderer)=>{
    previous(shader,renderer);
    shader.fragmentShader=replaceOnce(shader.fragmentShader,'#include <common>',TERRAIN_GROUNDWATER_DETAIL_GLSL);
    shader.fragmentShader=replaceOnce(shader.fragmentShader,'#include <color_fragment>','terrainGwDetailApplyColor();');
    shader.fragmentShader=replaceOnce(shader.fragmentShader,'#include <roughnessmap_fragment>','terrainGwDetailApplyRoughness();');
    shader.fragmentShader=replaceOnce(shader.fragmentShader,'#include <normal_fragment_maps>','terrainGwDetailApplyNormal();');
  };
  const previousKey=typeof material.customProgramCacheKey==='function'?material.customProgramCacheKey.bind(material):null;
  material.customProgramCacheKey=()=>`${previousKey?previousKey():''}|${TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY.materialKey}`;
  material.userData={...material.userData,terrainGroundwaterSurfaceDetailShaderInstalled:true,terrainGroundwaterSurfaceDetailShaderPolicyId:TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY.id,terrainGroundwaterSurfaceDetailRenderOnly:true,terrainGroundwaterSurfaceDetailVertexDisplacementUnchanged:true};
  material.needsUpdate=true;
  return material;
}

export function shaderInvariantReport(){
  const replacements=groundwaterSurfaceDetailShaderReplacements();
  return freeze({
    policyId:TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY.id,
    replacements,
    invariants:TERRAIN_GROUNDWATER_DETAIL_SHADER_INVARIANTS,
    ok:Object.values(replacements).every(Boolean),
  });
}
