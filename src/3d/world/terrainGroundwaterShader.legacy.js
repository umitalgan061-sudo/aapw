/**
 * GLSL hook for the terrain groundwater surface layer.
 *
 * The shader mirrors only bounded presentation channels. It does not alter
 * terrain geometry, clipmaps, collision, navigation, water topology, or
 * vegetation placement.
 */
import { TERRAIN_GROUNDWATER_POLICY } from './terrainGroundwaterRegime.js';

const freeze = Object.freeze;

export const TERRAIN_GROUNDWATER_SHADER_POLICY = freeze({
  id: 'terrain-groundwater-shader-2026-09-15-v1',
  materialKey: TERRAIN_GROUNDWATER_POLICY.materialKey,
  renderOnly: true,
  deterministic: true,
  usesWorldXZ: true,
  modifiesVertexPosition: false,
  modifiesDisplacement: false,
});

export const TERRAIN_GROUNDWATER_GLSL = String.raw`
float terrainGwHash(vec2 p){
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.103,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float terrainGwNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  float a=terrainGwHash(i);
  float b=terrainGwHash(i+vec2(1.0,0.0));
  float c=terrainGwHash(i+vec2(0.0,1.0));
  float d=terrainGwHash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float terrainGwFbm(vec2 p){
  float v=0.0;
  float w=0.0;
  float a=0.55;
  for(int i=0;i<5;i++){
    v+=terrainGwNoise(p)*a;
    w+=a;
    p=p*2.03+vec2(9.7,-8.4);
    a*=0.48;
  }
  return v/max(w,0.0001);
}
float terrainGwRidge(vec2 p){
  return 1.0-abs(terrainGwFbm(p)*2.0-1.0);
}
float terrainGwFilm(vec2 p,float slope,float height){
  float basin=1.0-smoothstep(2.0,9.5,slope);
  float low=1.0-smoothstep(20.0,160.0,height);
  float texture=terrainGwFbm(p/52.0+vec2(4.1,-13.7));
  return clamp(basin*(0.34+texture*0.56)+low*0.08,0.0,1.0);
}
float terrainGwSeepage(vec2 p,float slope){
  float ridge=terrainGwRidge(p/9.0+vec2(12.0,-7.0));
  float band=smoothstep(4.0,21.0,slope)*(1.0-smoothstep(21.0,46.0,slope));
  return clamp(ridge*band,0.0,1.0);
}
float terrainGwPuddle(vec2 p,float slope,float height){
  float flat=1.0-smoothstep(1.4,8.5,slope);
  float low=1.0-smoothstep(10.0,120.0,height);
  float texture=terrainGwRidge(p/18.0);
  return clamp(flat*0.50+low*0.18+texture*0.17,0.0,1.0);
}
float terrainGwSaltRing(vec2 p,float slope,float height){
  float crust=smoothstep(12.0,85.0,height);
  float edge=smoothstep(0.18,0.74,terrainGwRidge(p/26.0));
  float flat=1.0-smoothstep(5.0,28.0,slope);
  return clamp(crust*edge*flat,0.0,1.0);
}
void terrainGroundwaterApplyColor(){
  vec2 p=vTerrainLowWorldPosition.xz;
  float slope=degrees(acos(clamp(abs(normalize(vTerrainLowWorldNormal).y),0.0,1.0)));
  float film=terrainGwFilm(p,slope,vTerrainLowWorldPosition.y);
  float seep=terrainGwSeepage(p,slope);
  float puddle=terrainGwPuddle(p,slope,vTerrainLowWorldPosition.y);
  float salt=terrainGwSaltRing(p,slope,vTerrainLowWorldPosition.y);
  diffuseColor.rgb+=vec3(-0.018,-0.012,0.010)*film;
  diffuseColor.rgb+=vec3(0.006,0.005,0.002)*seep;
  diffuseColor.rgb+=vec3(-0.004,-0.003,-0.002)*puddle;
  diffuseColor.rgb+=vec3(0.012,0.008,0.002)*salt;
}
void terrainGroundwaterApplyRoughness(){
  vec2 p=vTerrainLowWorldPosition.xz;
  float slope=degrees(acos(clamp(abs(normalize(vTerrainLowWorldNormal).y),0.0,1.0)));
  float film=terrainGwFilm(p,slope,vTerrainLowWorldPosition.y);
  float puddle=terrainGwPuddle(p,slope,vTerrainLowWorldPosition.y);
  float salt=terrainGwSaltRing(p,slope,vTerrainLowWorldPosition.y);
  roughnessFactor=clamp(roughnessFactor-film*0.105-puddle*0.035+salt*0.018,0.42,1.0);
}
void terrainGroundwaterApplyNormal(){
  vec2 p=vTerrainLowWorldPosition.xz;
  float slope=degrees(acos(clamp(abs(normalize(vTerrainLowWorldNormal).y),0.0,1.0)));
  float seep=terrainGwSeepage(p,slope);
  float film=terrainGwFilm(p,slope,vTerrainLowWorldPosition.y);
  float aa=terrainGwFbm(p/29.0+vec2(2.4,-5.2));
  float bb=terrainGwFbm(p/29.0+vec2(3.1,-4.4));
  vec2 g=vec2(bb-aa,terrainGwRidge(p/118.0+vec2(-8.7,12.1))-.5);
  normal=normalize(normal+mat3(viewMatrix)*vec3(-g.x,0.0,-g.y)*(film*0.055+seep*0.025)*0.62);
}
`;

export function installTerrainGroundwaterShader(material) {
  if (!material) throw new TypeError('groundwater shader requires a material');
  if (material.userData?.terrainGroundwaterShaderInstalled) return material;
  const previous = typeof material.onBeforeCompile === 'function' ? material.onBeforeCompile.bind(material) : () => {};
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_GROUNDWATER_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nterrainGroundwaterApplyColor();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nterrainGroundwaterApplyRoughness();');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nterrainGroundwaterApplyNormal();');
  };
  const previousKey = typeof material.customProgramCacheKey === 'function' ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${TERRAIN_GROUNDWATER_SHADER_POLICY.materialKey}`;
  material.userData = { ...material.userData, terrainGroundwaterShaderInstalled: true, terrainGroundwaterShaderPolicyId: TERRAIN_GROUNDWATER_SHADER_POLICY.id, terrainGroundwaterRenderOnly: true, terrainGroundwaterVertexDisplacementUnchanged: true };
  return material;
}

export function groundwaterShaderReplacements() {
  return Object.freeze({
    common: TERRAIN_GROUNDWATER_GLSL.length > 0,
    color: TERRAIN_GROUNDWATER_GLSL.includes('terrainGroundwaterApplyColor();'),
    roughness: TERRAIN_GROUNDWATER_GLSL.includes('terrainGroundwaterApplyRoughness();'),
    normal: TERRAIN_GROUNDWATER_GLSL.includes('terrainGroundwaterApplyNormal();'),
    vertexDisplacement: !TERRAIN_GROUNDWATER_GLSL.includes('vTerrainLowWorldPosition.y +='),
    geometryMutation: !TERRAIN_GROUNDWATER_GLSL.includes('position +='),
  });
}

export const TERRAIN_GROUNDWATER_SHADER_INVARIANTS = freeze([
  'fragment-only-material-adjustment',
  'no-vertex-position-write',
  'no-height-map-write',
  'no-hydrology-topology-write',
  'no-collider-write',
  'no-vegetation-placement-write',
]);
