/** Render-only deterministic PBR breakup for natural geology meshes. */
export const NATURAL_GEOLOGY_SURFACE_POLICY = Object.freeze({
  id: 'natural-geology-surface-pbr-2026-08-31-v2-triplanar-weathering',
  renderOnly: true,
  deterministic: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  geometryUnchanged: true,
  worldSpaceMultiScaleAlbedo: true,
  worldSpaceNormalVariation: true,
  worldSpaceRoughnessVariation: true,
  triplanarVerticalFaceCoverage: true,
  domainWarpedWeathering: true,
});

const MODES = Object.freeze({
  rock: Object.freeze({ lichen: 0.16, oxide: 0.07, mineral: 0.03, normal: 0.22, base: 0.90, min: 0.62, lift: 1.02 }),
  arid: Object.freeze({ lichen: 0.02, oxide: 0.16, mineral: 0.06, normal: 0.21, base: 0.93, min: 0.68, lift: 1.04 }),
  volcanic: Object.freeze({ lichen: 0, oxide: 0.20, mineral: 0.18, normal: 0.27, base: 0.86, min: 0.48, lift: 1.10 }),
});
const f = (value) => Number(value).toFixed(5);

export function applyNaturalGeologySurfaceMaterial(material, { mode = 'rock' } = {}) {
  if (!material?.isMeshStandardMaterial && !material?.isMeshPhysicalMaterial) return material;
  const p = MODES[mode] ?? MODES.rock;
  const before = material.onBeforeCompile?.bind(material);
  const cache = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGeoWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvec4 geoP=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\ngeoP=instanceMatrix*geoP;\n#endif\nvGeoWorld=(modelMatrix*geoP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGeoWorld;\nfloat geoN(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat geoV(vec2 p){vec2 i=floor(p),q=fract(p);q=q*q*(3.0-2.0*q);return mix(mix(geoN(i),geoN(i+vec2(1,0)),q.x),mix(geoN(i+vec2(0,1)),geoN(i+vec2(1,1)),q.x),q.y);}\nfloat geoF(vec2 p){return geoV(p)*0.56+geoV(p*2.07+11.3)*0.28+geoV(p*4.31-7.9)*0.16;}\nvec3 geoTriWeights(vec3 n){vec3 w=pow(abs(n)+vec3(.0001),vec3(3.0));return w/max(w.x+w.y+w.z,.0001);}\nfloat geoTriF(vec3 p,vec3 w){return geoF(p.yz)*w.x+geoF(p.xz)*w.y+geoF(p.xy)*w.z;}\nfloat geoTriField(vec3 p,vec3 w){float warp=geoTriF(p/410.0,w)-.5;vec3 q=p+vec3(warp*46.0,-warp*31.0,warp*23.0);return (geoTriF(q/31.0,w)-.5)*.72+(geoTriF((q+vec3(17.0,-9.0,11.0))/8.5,w)-.5)*.28;}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nvec3 geoGN=normalize(cross(dFdx(vGeoWorld),dFdy(vGeoWorld)));vec3 geoTW=geoTriWeights(geoGN);float geoWarp=geoTriF(vGeoWorld/520.0,geoTW)-.5;vec3 geoPW=vGeoWorld+vec3(geoWarp*82.0,-geoWarp*47.0,geoWarp*63.0);float geoMacro=geoTriF(geoPW/760.0,geoTW),geoMeso=geoTriF(geoPW/145.0,geoTW),geoFine=geoTriF(geoPW/27.0,geoTW);float geoSteep=1.0-clamp(abs(geoGN.y),0.0,1.0);float geoAspect=dot(normalize(geoGN.xz+vec2(.0001)),normalize(vec2(.84,.54)))*.5+.5;float geoMoist=smoothstep(.47,.78,(1.0-geoMacro)*.58+(1.0-geoMeso)*.27+(1.0-geoAspect)*.15);float geoFracture=smoothstep(.55,.82,geoFine*.58+geoSteep*.42);float geoLichen=geoMoist*(1.0-geoSteep*.62)*${f(p.lichen)};float geoOx=smoothstep(.54,.82,geoMeso*.68+geoAspect*.32)*${f(p.oxide)};float geoMineral=smoothstep(.50,.79,geoMacro*.42+geoFine*.58)*(0.34+geoSteep*.66)*${f(p.mineral)};diffuseColor.rgb*=${f(p.lift)}*(1.0+(geoMacro-.5)*.150+(geoMeso-.5)*.105+(geoFine-.5)*.048);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.165,.205,.115),geoLichen);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.355,.185,.090),geoOx);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.235,.225,.205),geoMineral);diffuseColor.rgb*=1.0-geoFracture*.062;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nfloat geoR=${f(p.base)}+(geoMacro-.5)*.14+(geoMeso-.5)*.115+(geoFine-.5)*.075+geoLichen*.20+geoMineral*.10-geoFracture*.18;roughnessFactor=mix(roughnessFactor,clamp(geoR,${f(p.min)},.995),.80);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nfloat geoC=geoTriField(vGeoWorld,geoTW),geoX=geoTriField(vGeoWorld+vec3(.72,0,0),geoTW)-geoC,geoY=geoTriField(vGeoWorld+vec3(0,.72,0),geoTW)-geoC,geoZ=geoTriField(vGeoWorld+vec3(0,0,.72),geoTW)-geoC;vec3 geoGrad=vec3(geoX,geoY,geoZ);geoGrad-=geoGN*dot(geoGrad,geoGN);normal=normalize(normal+mat3(viewMatrix)*geoGrad*${f(p.normal)}*(.76+geoFracture*.46));`);
  };
  material.customProgramCacheKey = () => `${cache ? cache() : ''}|${NATURAL_GEOLOGY_SURFACE_POLICY.id}|${mode}`;
  material.userData.naturalGeologySurface = Object.freeze({ policyId: NATURAL_GEOLOGY_SURFACE_POLICY.id, mode });
  material.needsUpdate = true;
  return material;
}
