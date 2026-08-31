/** Render-only deterministic PBR breakup for natural geology meshes. */
export const NATURAL_GEOLOGY_SURFACE_POLICY = Object.freeze({
  id: 'natural-geology-surface-pbr-2026-08-31-v1',
  renderOnly: true,
  deterministic: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  geometryUnchanged: true,
  worldSpaceMultiScaleAlbedo: true,
  worldSpaceNormalVariation: true,
  worldSpaceRoughnessVariation: true,
  domainWarpedWeathering: true,
});

const MODES = Object.freeze({
  rock: Object.freeze({ lichen: 0.16, oxide: 0.07, normal: 0.22, base: 0.90, min: 0.62 }),
  arid: Object.freeze({ lichen: 0.02, oxide: 0.16, normal: 0.20, base: 0.93, min: 0.68 }),
  volcanic: Object.freeze({ lichen: 0, oxide: 0.20, normal: 0.25, base: 0.86, min: 0.48 }),
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
      .replace('#include <common>', `#include <common>\nvarying vec3 vGeoWorld;\nfloat geoN(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat geoV(vec2 p){vec2 i=floor(p),q=fract(p);q=q*q*(3.0-2.0*q);return mix(mix(geoN(i),geoN(i+vec2(1,0)),q.x),mix(geoN(i+vec2(0,1)),geoN(i+vec2(1,1)),q.x),q.y);}\nfloat geoF(vec2 p){return geoV(p)*0.56+geoV(p*2.07+11.3)*0.28+geoV(p*4.31-7.9)*0.16;}\nfloat geoField(vec2 p){float w=geoF(p/410.0)-0.5;return (geoF((p+w*46.0)/31.0)-0.5)*0.72+(geoF((p-w*23.0)/8.5)-0.5)*0.28;}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nvec2 geoXZ=vGeoWorld.xz;float geoW=geoF(geoXZ/520.0)-0.5;vec2 geoP2=geoXZ+vec2(geoW,geoF(geoXZ/520.0+17.0)-0.5)*82.0;float geoMacro=geoF(geoP2/760.0),geoMeso=geoF(geoP2/145.0),geoFine=geoF(geoP2/27.0);vec3 geoGN=normalize(cross(dFdx(vGeoWorld),dFdy(vGeoWorld)));float geoSteep=1.0-clamp(abs(geoGN.y),0.0,1.0);float geoAspect=dot(normalize(geoGN.xz+vec2(.0001)),normalize(vec2(.84,.54)))*.5+.5;float geoMoist=smoothstep(.47,.78,(1.0-geoMacro)*.58+(1.0-geoMeso)*.27+(1.0-geoAspect)*.15);float geoFracture=smoothstep(.57,.82,geoFine*.62+geoSteep*.38);float geoLichen=geoMoist*(1.0-geoSteep*.62)*${f(p.lichen)};float geoOx=smoothstep(.54,.82,geoMeso*.68+geoAspect*.32)*${f(p.oxide)};diffuseColor.rgb*=1.0+(geoMacro-.5)*.115+(geoMeso-.5)*.072+(geoFine-.5)*.032;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.165,.205,.115),geoLichen);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.355,.185,.090),geoOx);diffuseColor.rgb*=1.0-geoFracture*.055;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nfloat geoR=${f(p.base)}+(geoMacro-.5)*.12+(geoMeso-.5)*.10+(geoFine-.5)*.065+geoLichen*.20-geoFracture*.16;roughnessFactor=mix(roughnessFactor,clamp(geoR,${f(p.min)},.995),.78);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nfloat geoC=geoField(vGeoWorld.xz),geoX=geoField(vGeoWorld.xz+vec2(.85,0))-geoC,geoZ=geoField(vGeoWorld.xz+vec2(0,.85))-geoC;normal=normalize(normal+mat3(viewMatrix)*vec3(-geoX,0,-geoZ)*${f(p.normal)}*(.72+geoFracture*.42));`);
  };
  material.customProgramCacheKey = () => `${cache ? cache() : ''}|${NATURAL_GEOLOGY_SURFACE_POLICY.id}|${mode}`;
  material.userData.naturalGeologySurface = Object.freeze({ policyId: NATURAL_GEOLOGY_SURFACE_POLICY.id, mode });
  material.needsUpdate = true;
  return material;
}
