/**
 * Render-only volcanic weathering for the principal Valyrian/Targaryen fortress.
 *
 * The owner-map seat, imported GLB geometry, footprint, grounding pad and collider all stay untouched.
 * This module only extends the unique per-seat MeshStandardMaterial created by `settlements.js` so the
 * walled fortress belongs to the same basalt/ash landscape as the Doom instead of reading as a clean,
 * warm-grey castle dropped onto volcanic terrain.
 *
 * No new texture or draw call is introduced. The existing seeded stone albedo/normal/roughness maps
 * remain the high-frequency masonry source. World-space low/medium-frequency fields add volcanic
 * staining at a different scale, which avoids obvious UV tiling and keeps reused castle geometry from
 * looking like the same material pasted into every biome.
 *
 * @module world/valyriaCastleWeathering
 */

export const VALYRIA_CASTLE_WEATHERING_POLICY = Object.freeze({
  id: 'valyria-targaryen-fortress-weathering-2026-08-27-v1',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  settlementFootprintUnchanged: true,
  deterministic: true,
  targetSeatId: 'umit',
  surfaceProfile: 'valyria-basalt-fortress',
  baseStoneHex: 0x504844,
  // Shader values are intentionally restrained. The material must remain legible under daylight and
  // moonlight; near-black pure basalt made imported masonry collapse into a silhouette in older runs.
  basaltMixMin: 0.20,
  basaltMixMax: 0.52,
  ashMixMax: 0.31,
  sootMixMax: 0.20,
  fissureEmissiveMax: 0.10,
  macroScalePerMeter: 0.018,
  mesoScalePerMeter: 0.071,
  fineScalePerMeter: 0.24,
});

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

/**
 * Attach volcanic surface weathering to one already-created MeshStandardMaterial.
 *
 * @param {import('three').MeshStandardMaterial} material
 * @param {object} options
 * @param {string} options.seatId
 * @param {number} options.groundY
 * @param {number} options.footprintMeters
 * @param {number} options.seed
 * @returns {import('three').MeshStandardMaterial}
 */
export function applyValyriaCastleWeathering(material, {
  seatId,
  groundY,
  footprintMeters,
  seed,
}) {
  if (!material || seatId !== VALYRIA_CASTLE_WEATHERING_POLICY.targetSeatId) return material;
  if (material.userData?.valyriaCastleWeathering?.active) return material;

  const P = VALYRIA_CASTLE_WEATHERING_POLICY;
  const safeGroundY = finite(groundY, 0);
  const safeFootprint = Math.max(12, finite(footprintMeters, 46));
  const safeSeed = (finite(seed, 1) >>> 0);
  const seedA = ((safeSeed ^ 0x56414c59) & 0xffff) / 65535;
  const seedB = (((safeSeed * 1664525 + 1013904223) >>> 0) & 0xffff) / 65535;

  material.userData = {
    ...material.userData,
    valyriaCastleWeathering: Object.freeze({
      active: true,
      policyId: P.id,
      seatId,
      surfaceProfile: P.surfaceProfile,
      renderOnly: true,
      worldSpace: true,
      multiScale: true,
      basalt: true,
      ash: true,
      soot: true,
      sparseThermalFissures: true,
      groundY: safeGroundY,
      footprintMeters: safeFootprint,
    }),
  };

  const previousOnBeforeCompile = typeof material.onBeforeCompile === 'function'
    ? material.onBeforeCompile.bind(material)
    : null;

  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    shader.uniforms.uValyriaCastleGroundY = { value: safeGroundY };
    shader.uniforms.uValyriaCastleHeightScale = { value: safeFootprint * 1.18 };
    shader.uniforms.uValyriaCastleSeed = { value: [seedA, seedB] };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vValyriaCastleWorldPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 valyriaCastleWorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  valyriaCastleWorldPosition = batchingMatrix * valyriaCastleWorldPosition;
#endif
#ifdef USE_INSTANCING
  valyriaCastleWorldPosition = instanceMatrix * valyriaCastleWorldPosition;
#endif
valyriaCastleWorldPosition = modelMatrix * valyriaCastleWorldPosition;
vValyriaCastleWorldPosition = valyriaCastleWorldPosition.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vValyriaCastleWorldPosition;
uniform float uValyriaCastleGroundY;
uniform float uValyriaCastleHeightScale;
uniform vec2 uValyriaCastleSeed;

float valyriaCastleHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33 + uValyriaCastleSeed.x * 7.0);
  return fract((p3.x + p3.y) * p3.z);
}

float valyriaCastleNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = valyriaCastleHash(i);
  float b = valyriaCastleHash(i + vec2(1.0, 0.0));
  float c = valyriaCastleHash(i + vec2(0.0, 1.0));
  float d = valyriaCastleHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float valyriaCastleFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.56;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    value += valyriaCastleNoise(p) * amplitude;
    p = rotation * p * 2.03 + vec2(7.1, -4.3);
    amplitude *= 0.48;
  }
  return value / 0.9848;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 valyriaCastleXZ = vValyriaCastleWorldPosition.xz;
float valyriaCastleMacro = valyriaCastleFbm(valyriaCastleXZ * ${P.macroScalePerMeter.toFixed(4)} + uValyriaCastleSeed * 17.0);
float valyriaCastleMeso = valyriaCastleFbm(valyriaCastleXZ * ${P.mesoScalePerMeter.toFixed(4)} + uValyriaCastleSeed.yx * 31.0);
float valyriaCastleFine = valyriaCastleNoise(valyriaCastleXZ * ${P.fineScalePerMeter.toFixed(4)} + uValyriaCastleSeed * 53.0);
float valyriaCastleHeight01 = clamp((vValyriaCastleWorldPosition.y - uValyriaCastleGroundY) / max(1.0, uValyriaCastleHeightScale), 0.0, 1.0);

// Cooled basalt stains occupy broad connected areas, not per-brick black noise. Existing stone maps
// remain visible underneath, preserving real masonry scale and normal detail.
float valyriaCastleBasalt = smoothstep(0.25, 0.82, valyriaCastleMacro * 0.68 + valyriaCastleMeso * 0.32);
float valyriaCastleBasaltMix = mix(${P.basaltMixMin.toFixed(3)}, ${P.basaltMixMax.toFixed(3)}, valyriaCastleBasalt);
vec3 valyriaCastleBasaltColor = vec3(0.105, 0.085, 0.078);
diffuseColor.rgb = mix(diffuseColor.rgb, valyriaCastleBasaltColor, valyriaCastleBasaltMix);

// Ash accumulates more strongly on upper masonry and sheltered broad patches. It is grey-brown rather
// than white so the fortress does not look snow-covered under neutral daylight.
float valyriaCastleAshField = smoothstep(0.48, 0.82, valyriaCastleMeso * 0.72 + valyriaCastleFine * 0.28);
float valyriaCastleAsh = valyriaCastleAshField * smoothstep(0.18, 0.88, valyriaCastleHeight01);
vec3 valyriaCastleAshColor = vec3(0.37, 0.34, 0.32);
diffuseColor.rgb = mix(diffuseColor.rgb, valyriaCastleAshColor, valyriaCastleAsh * ${P.ashMixMax.toFixed(3)});

// Soot and smoke wash prefer lower/medium vertical surfaces but break up in world space; this removes
// the freshly-built uniform material read without painting a horizontal stripe around the castle.
float valyriaCastleSootField = smoothstep(0.58, 0.86, 1.0 - valyriaCastleMacro * 0.56 + valyriaCastleFine * 0.44);
float valyriaCastleSoot = valyriaCastleSootField * (1.0 - smoothstep(0.62, 1.0, valyriaCastleHeight01));
vec3 valyriaCastleSootColor = vec3(0.035, 0.028, 0.026);
diffuseColor.rgb = mix(diffuseColor.rgb, valyriaCastleSootColor, valyriaCastleSoot * ${P.sootMixMax.toFixed(3)});

// Very sparse fine fissures: a weak warm seam, not a glowing fantasy grid. Two incommensurate fields
// have to agree, which keeps the effect rare and irregular.
float valyriaCastleRidgeA = 1.0 - abs(valyriaCastleFine * 2.0 - 1.0);
float valyriaCastleRidgeB = 1.0 - abs(valyriaCastleNoise(valyriaCastleXZ * 0.137 + vec2(19.3, -7.4)) * 2.0 - 1.0);
float valyriaCastleFissure = smoothstep(0.965, 0.995, valyriaCastleRidgeA * valyriaCastleRidgeB) * (1.0 - valyriaCastleAsh * 0.75);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + valyriaCastleAsh * 0.12 + valyriaCastleSoot * 0.07 - valyriaCastleFissure * 0.05, 0.52, 1.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.42, 0.055, 0.010) * valyriaCastleFissure * ${P.fissureEmissiveMax.toFixed(3)};`,
      );
  };

  const previousProgramKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material)
    : () => '';
  material.customProgramCacheKey = () => `${previousProgramKey()}:${P.id}:${seatId}:${safeSeed}`;
  material.needsUpdate = true;
  return material;
}
