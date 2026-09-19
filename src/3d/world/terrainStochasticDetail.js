/**
 * Render-only stochastic microdetail overlay for the canonical terrain material.
 *
 * This layer does not alter height, shoreline, hydrology, roads or colliders. It exists to break the
 * finite 256² normal/roughness tile into a world-space field so long-distance terrain does not reveal
 * a 22m wallpaper cadence. The contribution is intentionally subtle and deterministic.
 */

export const TERRAIN_STOCHASTIC_DETAIL_POLICY = Object.freeze({
  id: 'terrain-stochastic-world-detail-2026-09-v1',
  worldSpace: true,
  deterministic: true,
  renderOnly: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalCoastlineUnchanged: true,
  albedoAmplitude: 0.034,
  roughnessAmplitude: 0.075,
  normalAmplitude: 0.105,
  scalesMeters: Object.freeze([3.2, 11, 37, 119, 410, 1320]),
  domainWarpMeters: 240,
});

function shaderSource() {
  const P = TERRAIN_STOCHASTIC_DETAIL_POLICY;
  return {
    common: `\nfloat aapwStochasticHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));q+=dot(q,q.yzx+31.33);return fract((q.x+q.y)*q.z);}\nfloat aapwStochasticNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=aapwStochasticHash(i),b=aapwStochasticHash(i+vec2(1.0,0.0)),c=aapwStochasticHash(i+vec2(0.0,1.0)),d=aapwStochasticHash(i+vec2(1.0,1.0));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}\nfloat aapwStochasticFbm(vec2 p){float v=0.0,w=0.0,a=0.58;for(int i=0;i<4;i++){v+=aapwStochasticNoise(p)*a;w+=a;p=p*2.07+vec2(13.7,-8.4);a*=0.47;}return v/w;}\nvec2 aapwStochasticWarp(vec2 p){float a=aapwStochasticFbm(p/` + P.domainWarpMeters + `.0+vec2(7.3,-14.1));float b=aapwStochasticFbm(p/` + (P.domainWarpMeters * 0.83).toFixed(1) + `.0+vec2(-19.4,5.8));return p+(vec2(a,b)-0.5)*72.0;}`,
    color: `\nvec2 aapwStochasticP=aapwStochasticWarp(vTerrainStochasticWorldPosition.xz);float aapwStochasticMacro=aapwStochasticFbm(aapwStochasticP/${P.scalesMeters[5]}.0+vec2(3.7,-5.2));float aapwStochasticMeso=aapwStochasticFbm(aapwStochasticP/${P.scalesMeters[3]}.0+vec2(-11.6,17.9));float aapwStochasticPatch=aapwStochasticFbm(aapwStochasticP/${P.scalesMeters[1]}.0+vec2(21.1,4.6));float aapwStochasticGrain=aapwStochasticNoise(aapwStochasticP/${P.scalesMeters[0]}.0+vec2(-7.4,15.8));float aapwStochasticMix=(aapwStochasticMacro-0.5)*0.50+(aapwStochasticMeso-0.5)*0.30+(aapwStochasticPatch-0.5)*0.15+(aapwStochasticGrain-0.5)*0.05;diffuseColor.rgb*=1.0+aapwStochasticMix*${P.albedoAmplitude.toFixed(3)};`,
    roughness: `\nfloat aapwStochasticRough=(aapwStochasticMacro-0.5)*0.45+(aapwStochasticMeso-0.5)*0.35+(aapwStochasticPatch-0.5)*0.20;roughnessFactor=clamp(roughnessFactor+aapwStochasticRough*${P.roughnessAmplitude.toFixed(3)},0.40,1.0);`,
    normal: `\nfloat aapwStochasticStep=0.85;vec2 aapwStochasticPP=aapwStochasticWarp(vTerrainStochasticWorldPosition.xz);float aapwStochasticNX=aapwStochasticFbm((aapwStochasticPP+vec2(aapwStochasticStep,0.0))/37.0)-aapwStochasticFbm((aapwStochasticPP-vec2(aapwStochasticStep,0.0))/37.0);float aapwStochasticNZ=aapwStochasticFbm((aapwStochasticPP+vec2(0.0,aapwStochasticStep))/11.0)-aapwStochasticFbm((aapwStochasticPP-vec2(0.0,aapwStochasticStep))/11.0);normal=normalize(normal+mat3(viewMatrix)*vec3(-aapwStochasticNX,0.0,-aapwStochasticNZ)*${P.normalAmplitude.toFixed(3)});`,
  };
}

export function installTerrainStochasticDetail(material) {
  if (!material?.isMeshStandardMaterial) throw new TypeError('terrain stochastic detail requires MeshStandardMaterial');
  const sourceCompile = material.onBeforeCompile?.bind(material);
  const sourceKey = material.customProgramCacheKey?.bind(material);
  const shader = shaderSource();
  material.onBeforeCompile = (program, renderer) => {
    sourceCompile?.(program, renderer);
    program.vertexShader = program.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainStochasticWorldPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainStochasticWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
    program.fragmentShader = program.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainStochasticWorldPosition;${shader.common}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${shader.color}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>${shader.roughness}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${shader.normal}`);
  };
  material.customProgramCacheKey = () => `${sourceKey?.() ?? ''}|${TERRAIN_STOCHASTIC_DETAIL_POLICY.id}`;
  material.userData = {
    ...material.userData,
    terrainStochasticDetail: TERRAIN_STOCHASTIC_DETAIL_POLICY,
  };
  material.needsUpdate = true;
  return material;
}
