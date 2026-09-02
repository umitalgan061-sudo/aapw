/**
 * Render-only cryosphere shader composition for canonical terrain materials.
 *
 * The deterministic CPU atlas lives in `terrainCryosphereSurfaceAtlas.js`; this module owns only
 * the world-space GPU material response. It never decides where snow or ice exists. Instead it runs
 * after `terrainMicroSurfaceCore.js` and consumes that established terrainPhoto* classification.
 *
 * Canonical terrain height, map.png/Pindex ownership, hydrology, shoreline, snow coverage and
 * colliders remain untouched.
 * @module world/terrainCryosphereSurfaceFabric
 */

import * as THREE from 'three';
import {
  TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY,
  TERRAIN_CRYOSPHERE_WIND_FRAME,
  getSharedTerrainCryosphereSurfaceAtlas,
} from './terrainCryosphereSurfaceAtlas.js';

export {
  TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY,
  getSharedTerrainCryosphereSurfaceAtlas,
} from './terrainCryosphereSurfaceAtlas.js';

const WIND_TRAVEL_X = TERRAIN_CRYOSPHERE_WIND_FRAME.travelX;
const WIND_TRAVEL_Z = TERRAIN_CRYOSPHERE_WIND_FRAME.travelZ;
const WIND_CROSS_X = TERRAIN_CRYOSPHERE_WIND_FRAME.crossX;
const WIND_CROSS_Z = TERRAIN_CRYOSPHERE_WIND_FRAME.crossZ;

function replaceRequired(source, anchor, replacement, label) {
  if (!source.includes(anchor)) {
    throw new Error(`[terrainCryosphereSurfaceFabric] shader anchor missing: ${label}`);
  }
  return source.replace(anchor, replacement);
}

const GLSL_FUNCTION_ANCHOR = `float terrainPhotoRidgeNoise(vec2 p) {
\tfloat n = terrainPhotoFbm(p);
\treturn 1.0 - abs(n * 2.0 - 1.0);
}`;

const GLSL_COLOR_ANCHOR = 'diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.010), vec3(0.845));';
const GLSL_NORMAL_ANCHOR = 'normal = normalize(normal + mat3(viewMatrix) * vec3(terrainPhotoSnowNormalX, 0.0, terrainPhotoSnowNormalZ) * terrainPhotoSnowNormalGain);';

const shaderFunctions = /* glsl */ `
uniform sampler2D uTerrainCryosphereSurfaceAtlas;

mat2 terrainCryoRotation(float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return mat2(c, -s, s, c);
}

vec4 terrainCryoAtlas(vec2 worldXZ, float scaleMeters, float rotationRadians, vec2 offset) {
  vec2 uv = terrainCryoRotation(rotationRadians) * worldXZ / max(scaleMeters, 0.001) + offset;
  return texture2D(uTerrainCryosphereSurfaceAtlas, fract(uv));
}

float terrainCryoRidge(float value) {
  return 1.0 - abs(value * 2.0 - 1.0);
}

float terrainCryoDirectionalRibbon(vec2 worldXZ, float alongMeters, float acrossMeters, float phase) {
  const vec2 windTravel = vec2(${WIND_TRAVEL_X.toFixed(7)}, ${WIND_TRAVEL_Z.toFixed(7)});
  const vec2 windCross = vec2(${WIND_CROSS_X.toFixed(7)}, ${WIND_CROSS_Z.toFixed(7)});
  float along = dot(worldXZ, windTravel) / alongMeters;
  float across = dot(worldXZ, windCross) / acrossMeters;
  float warp = terrainPhotoFbm(worldXZ / 530.0 + vec2(phase * 0.37, -phase * 0.21));
  float band = terrainPhotoNoise(vec2(along + warp * 0.82, across - warp * 0.31) + vec2(phase, -phase * 1.7));
  return terrainCryoRidge(band);
}
`;

const colorChunk = /* glsl */ `
// Dedicated cryosphere material breakup. This consumes only terrainPhoto* masks that the canonical
// terrain shading chain already resolved; no coordinate here creates snow/ice geography.
vec4 terrainCryoFine = terrainCryoAtlas(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoMeso = terrainCryoAtlas(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.mesoScaleMeters.toFixed(1)},
  -0.83,
  vec2(0.731, 0.283)
);
vec4 terrainCryoCoarse = terrainCryoAtlas(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.coarseScaleMeters.toFixed(1)},
  1.41,
  vec2(0.419, 0.887)
);

float terrainCryoFirnAgeField = terrainPhotoFbm(
  (terrainPhotoWarpedXZ + (terrainCryoCoarse.rg - 0.5) * 340.0)
    / ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.firnAgeScaleMeters.toFixed(1)}
    + vec2(-31.7, 14.8)
);
float terrainCryoAblationField = terrainPhotoFbm(
  (terrainPhotoWarpedXZ + (terrainCryoMeso.ra - 0.5) * 170.0)
    / ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.ablationScaleMeters.toFixed(1)}
    + vec2(19.2, -27.6)
);
float terrainCryoBlueIceField = terrainPhotoRidgeNoise(
  (terrainPhotoWarpedXZ + (terrainCryoCoarse.br - 0.5) * 110.0)
    / ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.blueIceScaleMeters.toFixed(1)}
    + vec2(7.8, 23.1)
);
float terrainCryoWindRibbon = terrainCryoDirectionalRibbon(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.windRibbonAlongMeters.toFixed(1)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.windRibbonAcrossMeters.toFixed(1)},
  3.7
);
float terrainCryoSastrugiRibbon = terrainCryoDirectionalRibbon(
  terrainPhotoXZ,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.sastrugiAlongMeters.toFixed(1)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.sastrugiAcrossMeters.toFixed(1)},
  11.3
);

float terrainCryoColdBase = smoothstep(0.008, 0.090, diffuseColor.b - diffuseColor.r);
float terrainCryoOldFirn = terrainPhotoSnow
  * smoothstep(0.42, 0.76, terrainCryoFirnAgeField * 0.62 + terrainCryoCoarse.r * 0.38)
  * clamp(0.36 + terrainPhotoSnowFirn * 0.64 + terrainCryoColdBase * 0.22, 0.0, 1.0)
  * (1.0 - terrainPhotoSnowPowder * 0.34);
float terrainCryoBlueIceLens = terrainPhotoSnow
  * smoothstep(0.56, 0.86, terrainCryoBlueIceField * 0.68 + terrainCryoMeso.b * 0.32)
  * clamp(terrainPhotoSnowBlueIce * 0.90 + terrainPhotoSteep * terrainPhotoSnowFirn * 0.42, 0.0, 1.0)
  * (1.0 - terrainPhotoSnowPowder * 0.52);
float terrainCryoWindCrust = terrainPhotoSnow
  * terrainPhotoShoulder
  * smoothstep(0.55, 0.86, terrainCryoWindRibbon * 0.62 + terrainCryoMeso.g * 0.38)
  * clamp(0.30 + terrainPhotoSnowSastrugi * 0.82 + terrainPhotoSnowScour * 0.48, 0.0, 1.0);
float terrainCryoSastrugi = terrainPhotoSnow
  * smoothstep(0.60, 0.90, terrainCryoSastrugiRibbon * 0.68 + terrainCryoFine.b * 0.32)
  * clamp(terrainPhotoSnowSastrugi * 0.92 + terrainCryoWindCrust * 0.46, 0.0, 1.0);
float terrainCryoMineralAblation = terrainPhotoSnow
  * smoothstep(0.58, 0.86, terrainCryoAblationField * 0.52 + terrainCryoCoarse.a * 0.48)
  * clamp(terrainPhotoSnowRockReveal * 0.72 + terrainPhotoSnowScour * 0.36 + terrainCryoOldFirn * 0.24, 0.0, 1.0)
  * (1.0 - terrainPhotoSnowPowder * 0.72);
float terrainCryoShelteredPowder = terrainPhotoSnowPowder
  * smoothstep(0.46, 0.82, terrainCryoMeso.r * 0.58 + terrainCryoFine.g * 0.42)
  * (1.0 - terrainCryoWindCrust * 0.58);

float terrainCryoGranularValue =
  (terrainCryoCoarse.r - 0.5) * 0.15
  + (terrainCryoMeso.r - 0.5) * 0.095
  + (terrainCryoFine.r - 0.5) * 0.040;
float terrainCryoSnowValue = clamp(
  1.0 + terrainCryoGranularValue * terrainPhotoSnow,
  ${(1 - TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.maxAlbedoDarkening).toFixed(3)},
  ${(1 + TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.maxAlbedoLift).toFixed(3)}
);
diffuseColor.rgb *= terrainCryoSnowValue;

vec3 terrainCryoOldFirnTone = vec3(0.500, 0.567, 0.602);
vec3 terrainCryoBlueIceTone = vec3(0.330, 0.475, 0.548);
vec3 terrainCryoWindCrustTone = vec3(0.590, 0.632, 0.642);
vec3 terrainCryoMineralTone = vec3(0.335, 0.342, 0.329);
vec3 terrainCryoPowderTone = vec3(0.805, 0.817, 0.806);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoOldFirnTone,
  terrainCryoOldFirn * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.oldFirnMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoBlueIceTone,
  terrainCryoBlueIceLens * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.blueIceMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoWindCrustTone,
  terrainCryoWindCrust * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.windCrustMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoMineralTone,
  terrainCryoMineralAblation * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.mineralAblationMixMax.toFixed(3)}
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  terrainCryoPowderTone,
  terrainCryoShelteredPowder * ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.powderMixMax.toFixed(3)}
);

float terrainCryoCompactionDarken = clamp(
  terrainCryoOldFirn * 0.055
    + terrainCryoWindCrust * 0.040
    + terrainCryoBlueIceLens * 0.065
    + terrainCryoMineralAblation * 0.075,
  0.0,
  0.115
);
diffuseColor.rgb *= 1.0 - terrainCryoCompactionDarken;
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.010), vec3(0.825));
`;

const normalChunk = /* glsl */ `
float terrainCryoProbe = ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.normalProbeMeters.toFixed(2)};
vec4 terrainCryoNormalEast = terrainCryoAtlas(
  terrainPhotoXZ + vec2(terrainCryoProbe, 0.0),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoNormalWest = terrainCryoAtlas(
  terrainPhotoXZ - vec2(terrainCryoProbe, 0.0),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoNormalNorth = terrainCryoAtlas(
  terrainPhotoXZ + vec2(0.0, terrainCryoProbe),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
vec4 terrainCryoNormalSouth = terrainCryoAtlas(
  terrainPhotoXZ - vec2(0.0, terrainCryoProbe),
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.fineScaleMeters.toFixed(1)},
  0.37,
  vec2(0.173, 0.619)
);
float terrainCryoNormalX = terrainCryoNormalEast.b - terrainCryoNormalWest.b;
float terrainCryoNormalZ = terrainCryoNormalNorth.b - terrainCryoNormalSouth.b;
const vec2 terrainCryoWindCross = vec2(${WIND_CROSS_X.toFixed(7)}, ${WIND_CROSS_Z.toFixed(7)});
float terrainCryoSastrugiSlope = (terrainCryoSastrugiRibbon - 0.5) * 2.0;
vec2 terrainCryoDirectionalNormal = terrainCryoWindCross * terrainCryoSastrugiSlope;
float terrainCryoNormalGain = mix(
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.normalGainMin.toFixed(3)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.normalGainMax.toFixed(3)},
  clamp(terrainCryoSastrugi * 0.66 + terrainCryoOldFirn * 0.22 + terrainCryoWindCrust * 0.30, 0.0, 1.0)
) * terrainPhotoSnow * (1.0 - terrainCryoShelteredPowder * 0.44);
vec2 terrainCryoCombinedNormal = vec2(terrainCryoNormalX, terrainCryoNormalZ)
  + terrainCryoDirectionalNormal * (0.42 + terrainCryoWindCrust * 0.44);
normal = normalize(
  normal
    + mat3(viewMatrix) * vec3(terrainCryoCombinedNormal.x, 0.0, terrainCryoCombinedNormal.y)
      * terrainCryoNormalGain
);
`;

const roughnessChunk = /* glsl */ `
float terrainCryoAtlasRoughness = clamp(
  terrainCryoCoarse.g * 0.28 + terrainCryoMeso.g * 0.44 + terrainCryoFine.g * 0.28,
  0.0,
  1.0
);
float terrainCryoMaterialRoughness = mix(0.79, 0.96, terrainCryoAtlasRoughness);
terrainCryoMaterialRoughness -= terrainCryoOldFirn * 0.12;
terrainCryoMaterialRoughness -= terrainCryoBlueIceLens * 0.28;
terrainCryoMaterialRoughness -= terrainCryoWindCrust * 0.13;
terrainCryoMaterialRoughness += terrainCryoShelteredPowder * 0.10;
terrainCryoMaterialRoughness += terrainCryoMineralAblation * 0.035;
terrainCryoMaterialRoughness = clamp(
  terrainCryoMaterialRoughness,
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.roughnessMin.toFixed(2)},
  ${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.roughnessMax.toFixed(2)}
);
float terrainCryoRoughnessBlend = clamp(
  terrainPhotoSnow * (0.18 + terrainCryoOldFirn * 0.18 + terrainCryoBlueIceLens * 0.34
    + terrainCryoWindCrust * 0.22 + terrainCryoShelteredPowder * 0.16),
  0.0,
  0.66
);
roughnessFactor = mix(roughnessFactor, terrainCryoMaterialRoughness, terrainCryoRoughnessBlend);
`;

export function installTerrainCryosphereSurfaceFabric(material) {
  if (!material?.isMeshStandardMaterial) {
    throw new TypeError('terrain cryosphere surface fabric requires MeshStandardMaterial');
  }
  const atlas = getSharedTerrainCryosphereSurfaceAtlas();
  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.uniforms.uTerrainCryosphereSurfaceAtlas = { value: atlas };

    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      GLSL_FUNCTION_ANCHOR,
      `${GLSL_FUNCTION_ANCHOR}\n${shaderFunctions}`,
      'photoreal-functions',
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      GLSL_COLOR_ANCHOR,
      `${colorChunk}\n${GLSL_COLOR_ANCHOR}`,
      'photoreal-color-tail',
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      GLSL_NORMAL_ANCHOR,
      `${GLSL_NORMAL_ANCHOR}\n${normalChunk}`,
      'photoreal-normal-tail',
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      '#include <metalnessmap_fragment>',
      `${roughnessChunk}\n#include <metalnessmap_fragment>`,
      'metalness-after-roughness',
    );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}|${TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id}`;
  material.userData ||= {};
  material.userData.terrainCryosphereSurfaceFabric = Object.freeze({
    policyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
    renderOnly: true,
    canonicalTerrainHeightUnchanged: true,
    canonicalSnowCoverageUnchanged: true,
    canonicalCryosphereMaskUnchanged: true,
    canonicalHydrologyUnchanged: true,
    canonicalColliderUnchanged: true,
    worldSpace: true,
    atlasSize: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.atlasSize,
    multiScaleFirnAge: true,
    blueIceLenses: true,
    mineralAblation: true,
    windAlignedSastrugi: true,
    roughnessVariation: true,
    normalVariation: true,
  });
  material.needsUpdate = true;
  return material;
}

export function auditTerrainCryosphereSurfaceFabric(material) {
  const metadata = material?.userData?.terrainCryosphereSurfaceFabric;
  const errors = [];
  if (!material?.isMeshStandardMaterial) errors.push('not-mesh-standard-material');
  if (!metadata) errors.push('missing-metadata');
  if (metadata?.policyId !== TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id) errors.push('policy-id-drift');
  if (metadata?.renderOnly !== true) errors.push('render-only-contract-lost');
  if (metadata?.canonicalTerrainHeightUnchanged !== true) errors.push('height-authority-drift');
  if (metadata?.canonicalSnowCoverageUnchanged !== true) errors.push('snow-authority-drift');
  if (metadata?.canonicalHydrologyUnchanged !== true) errors.push('hydrology-authority-drift');
  if (metadata?.canonicalColliderUnchanged !== true) errors.push('collider-authority-drift');
  const atlas = getSharedTerrainCryosphereSurfaceAtlas();
  if (!atlas?.isDataTexture) errors.push('missing-fabric-atlas');
  if (atlas?.wrapS !== THREE.RepeatWrapping || atlas?.wrapT !== THREE.RepeatWrapping) errors.push('atlas-wrap-drift');
  if (atlas?.colorSpace !== THREE.NoColorSpace) errors.push('atlas-color-space-drift');
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    policyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
    metadata: metadata || null,
  });
}
