/**
 * Asset-informed natural geology renderer.
 *
 * Deterministic placement is owned by naturalGeologyPlacement.js. This module renders an immediate
 * low-cost fallback and, on hydrated desktop builds, can replace selected outcrops with real GLB or
 * FBX geometry. Large landscape assets remain morphology references only so the world never becomes a
 * repeated terrain tile. The fallback itself deliberately uses stratified/faceted rock hulls instead
 * of Platonic primitives: even when LFS assets are unavailable the scene should read as geology, not
 * as stretched icosahedrons.
 * @module world/naturalGeology
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY,
  checksumNaturalGeologyPlacements,
  generateNaturalGeologyPlacements,
  sampleTerrainFrame,
} from './naturalGeologyPlacement.js';
import {
  VALYRIA_GEOLOGY_POLICY,
  applyValyriaSurfaceColor,
  normalizedOwnerMapAtWorldXZ,
  valyriaInfluenceAtWorldXZ,
} from './valyriaGeology.js';

export const NATURAL_GEOLOGY_RENDER_POLICY = Object.freeze({
  id: 'natural-geology-render-2026-09-01-v8-hydrated-texture-fidelity',
  renderOnly: true,
  deterministicPlacement: true,
  geographyAuthorityUnchanged: true,
  placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  primaryRockAsset: 'assets/models/fbx/rocky_terrain_low_poly.glb',
  southernRockAsset: 'assets/models/fbx/desert_rocks.glb',
  smallRockAsset: 'assets/models/fbx/Free_rock_Rock_1.fbx',
  snowRockAsset: 'assets/models/fbx/snow_terrain_low_poly.glb',
  directAssetUrls: Object.freeze([
    'assets/models/fbx/rocky_terrain_low_poly.glb',
    'assets/models/fbx/desert_rocks.glb',
    'assets/models/fbx/Free_rock_Rock_1.fbx',
    'assets/models/fbx/snow_terrain_low_poly.glb',
  ]),
  knownDirectAssetBytes: Object.freeze({
    'assets/models/fbx/rocky_terrain_low_poly.glb': 5708516,
    'assets/models/fbx/desert_rocks.glb': 12773288,
    'assets/models/fbx/Free_rock_Rock_1.fbx': 74044,
    'assets/models/fbx/snow_terrain_low_poly.glb': 5180716,
  }),
  referenceLandscapeAsset: 'assets/models/fbx/rugged_mountain_landscape.glb',
  referenceLandscapeRuntimeLoad: false,
  geographicAssetRouting: true,
  fbxHydrationSupported: true,
  snowAssetRestrictedToColdHighland: true,
  valyriaNeverUsesSnowAsset: true,
  fallbackGeometryFamily: 'stratified-faceted-geologic-ledges',
  platonicFallbackGeometry: false,
  hostedPreflightMinBytes: 512,
  maximumHydratedSourceBytes: 16 * 1024 * 1024,
  maximumHydratedPrimitiveCount: 16,
  minimumSourceExtentMeters: 0.001,
  maximumSourceAspectRatio: 18,
  hydratedRoughnessFloor: 0.64,
  hydratedRegionalTintStrength: 0.36,
  hydratedRegionalTint: true,
  multiMaterialHydrationSupported: true,
  hydratedTextureColorSpaceContract: true,
  hydratedMipFiltering: true,
  hydratedMaximumAnisotropy: 8,
  sourceUvAndTextureTransformPreserved: true,
  proceduralRoughness: 0.90,
  worldSpaceRockWeathering: true,
  worldSpaceRockAlbedoVariation: true,
  worldSpaceRockNormalVariation: true,
  worldSpaceRockRoughnessVariation: true,
  instanceScaleCompensatedWorldNormal: true,
  cameraStableRockWeathering: true,
  rockWeatheringScalesMeters: Object.freeze([3.4, 11, 38, 125]),
  rockRoughnessRange: Object.freeze([0.64, 0.98]),
  groupName: 'natural-geology',
  valyriaSurfaceName: 'valyria-volcanic-surface',
  canonicalTerrainOwnsValyriaSurface: true,
  legacyValyriaSurfaceOverlayEnabled: false,
});

const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const hydratedTintWhite = new THREE.Color(1, 1, 1);
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const ROCK_WEATHERING_SHADER_KEY = 'natural-geology-world-space-weathering-v2-correct-normal-space';
const HYDRATED_COLOR_TEXTURE_KEYS = Object.freeze(['map', 'emissiveMap']);
const HYDRATED_DATA_TEXTURE_KEYS = Object.freeze([
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
]);

function configureHydratedRockTexture(texture, { colorTexture, maxAnisotropy }) {
  if (!texture?.isTexture) return null;
  const targetColorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const anisotropy = Math.max(
    1,
    Math.min(
      NATURAL_GEOLOGY_RENDER_POLICY.hydratedMaximumAnisotropy,
      Number.isFinite(maxAnisotropy) ? Math.floor(maxAnisotropy) : 1,
    ),
  );
  const hasMipChain = texture.generateMipmaps !== false || (texture.mipmaps?.length ?? 0) > 1;
  let changed = false;
  if (texture.colorSpace !== targetColorSpace) {
    texture.colorSpace = targetColorSpace;
    changed = true;
  }
  if (texture.anisotropy !== anisotropy) {
    texture.anisotropy = anisotropy;
    changed = true;
  }
  const targetMinFilter = hasMipChain ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (texture.minFilter !== targetMinFilter) {
    texture.minFilter = targetMinFilter;
    changed = true;
  }
  if (texture.magFilter !== THREE.LinearFilter) {
    texture.magFilter = THREE.LinearFilter;
    changed = true;
  }
  if (changed) texture.needsUpdate = true;
  texture.userData = {
    ...texture.userData,
    naturalGeologyTextureRole: colorTexture ? 'srgb-color' : 'linear-data',
    naturalGeologyAnisotropy: anisotropy,
    naturalGeologyMipFiltering: hasMipChain ? 'trilinear' : 'linear-no-mip-chain',
  };
  return texture;
}

/**
 * Clones one source material while retaining its UVs, maps and authored texture transforms. Only the
 * sampling/color-management contract and physically implausible rock scalars are normalized.
 */
export function prepareNaturalGeologyHydratedMaterial(sourceMaterial, { maxAnisotropy = 1 } = {}) {
  if (!sourceMaterial?.clone) return sourceMaterial;
  const material = sourceMaterial.clone();
  for (const key of HYDRATED_COLOR_TEXTURE_KEYS) {
    configureHydratedRockTexture(material[key], { colorTexture: true, maxAnisotropy });
  }
  for (const key of HYDRATED_DATA_TEXTURE_KEYS) {
    configureHydratedRockTexture(material[key], { colorTexture: false, maxAnisotropy });
  }
  if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
    material.metalness = 0;
    material.roughness = Math.max(
      material.roughness ?? 0,
      NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor,
    );
    installRockMaterialWeathering(material);
  }
  material.userData = {
    ...material.userData,
    naturalGeologyHydratedMaterial: true,
    naturalGeologySourceMapsPreserved: true,
    naturalGeologyTextureColorSpaceContract: true,
  };
  material.needsUpdate = true;
  return material;
}

export function prepareNaturalGeologyHydratedMaterials(source, options) {
  return Array.isArray(source)
    ? source.map((material) => prepareNaturalGeologyHydratedMaterial(material, options))
    : prepareNaturalGeologyHydratedMaterial(source, options);
}

function installRockMaterialWeathering(material) {
  if (!material || (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial)) return material;
  if (material.userData?.naturalGeologyWorldWeathering === ROCK_WEATHERING_SHADER_KEY) return material;

  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vNaturalRockWorldPosition;\nvarying vec3 vNaturalRockWorldNormal;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
// Capture a true world-space normal before Three.js converts transformedNormal into view space.
// The same inverse-scale compensation used by Three's instancing normal path is required here because
// geology placements intentionally use non-uniform XYZ scales. Without it, weathering rotates and
// stretches with the instance transform and can read as camera-dependent/plastic.
vec3 naturalRockWeatheringObjectNormal = objectNormal;
#ifdef USE_INSTANCING
  mat3 naturalRockInstanceNormalMatrix = mat3(instanceMatrix);
  naturalRockWeatheringObjectNormal /= vec3(
    dot(naturalRockInstanceNormalMatrix[0], naturalRockInstanceNormalMatrix[0]),
    dot(naturalRockInstanceNormalMatrix[1], naturalRockInstanceNormalMatrix[1]),
    dot(naturalRockInstanceNormalMatrix[2], naturalRockInstanceNormalMatrix[2])
  );
  naturalRockWeatheringObjectNormal = naturalRockInstanceNormalMatrix * naturalRockWeatheringObjectNormal;
#endif
vNaturalRockWorldNormal = normalize(mat3(modelMatrix) * naturalRockWeatheringObjectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 naturalRockInstancePosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  naturalRockInstancePosition = instanceMatrix * naturalRockInstancePosition;
#endif
vNaturalRockWorldPosition = (modelMatrix * naturalRockInstancePosition).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vNaturalRockWorldPosition;
varying vec3 vNaturalRockWorldNormal;
float naturalRockHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float naturalRockNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = naturalRockHash(i);
  float b = naturalRockHash(i + vec2(1.0, 0.0));
  float c = naturalRockHash(i + vec2(0.0, 1.0));
  float d = naturalRockHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float naturalRockFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.54;
  for (int octave = 0; octave < 4; octave++) {
    value += naturalRockNoise(p) * amplitude;
    p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(13.17, -9.41);
    amplitude *= 0.47;
  }
  return value / 1.0112;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 naturalRockXZ = vNaturalRockWorldPosition.xz;
vec3 naturalRockWorldNormal = normalize(vNaturalRockWorldNormal);
float naturalRockBroad = naturalRockFbm(naturalRockXZ / 125.0 + vec2(7.1, -4.2));
float naturalRockMacro = naturalRockFbm(naturalRockXZ / 38.0 + vec2(-11.3, 9.7));
float naturalRockMeso = naturalRockFbm(naturalRockXZ / 11.0 + vec2(19.4, 3.8));
float naturalRockGrain = naturalRockNoise(naturalRockXZ / 3.4 + vec2(-5.7, 17.9));
float naturalRockSlope = 1.0 - clamp(abs(naturalRockWorldNormal.y), 0.0, 1.0);
float naturalRockNorthFace = smoothstep(0.10, 0.72, -naturalRockWorldNormal.z) * smoothstep(0.08, 0.55, naturalRockSlope);
float naturalRockExposure = smoothstep(0.48, 0.82, naturalRockBroad * 0.46 + naturalRockMacro * 0.34 + naturalRockMeso * 0.20);
float naturalRockRecess = smoothstep(0.55, 0.83, 1.0 - naturalRockMeso) * (0.35 + naturalRockSlope * 0.65);
float naturalRockValue = 0.86 + (naturalRockBroad - 0.5) * 0.18 + (naturalRockMacro - 0.5) * 0.15 + (naturalRockMeso - 0.5) * 0.085 + (naturalRockGrain - 0.5) * 0.035;
diffuseColor.rgb *= naturalRockValue;
vec3 naturalRockWeathered = mix(vec3(0.235, 0.224, 0.202), vec3(0.105, 0.112, 0.103), naturalRockNorthFace);
vec3 naturalRockFreshBreak = vec3(0.315, 0.305, 0.282);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalRockWeathered, naturalRockRecess * 0.16);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalRockFreshBreak, naturalRockExposure * naturalRockSlope * 0.11);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.032), vec3(0.78));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float naturalRockRoughMacro = naturalRockFbm(vNaturalRockWorldPosition.xz / 29.0 + vec2(2.4, -13.8));
float naturalRockRoughFine = naturalRockNoise(vNaturalRockWorldPosition.xz / 4.8 + vec2(-8.9, 6.3));
float naturalRockWetPocket = smoothstep(0.58, 0.84, 1.0 - naturalRockRoughMacro) * smoothstep(0.52, 0.82, 1.0 - naturalRockRoughFine);
float naturalRockRoughTarget = 0.79 + naturalRockRoughMacro * 0.15 + naturalRockRoughFine * 0.07 - naturalRockWetPocket * 0.18;
roughnessFactor = clamp(mix(roughnessFactor, naturalRockRoughTarget, 0.78), 0.64, 0.98);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float naturalRockNormalCenter = naturalRockFbm(vNaturalRockWorldPosition.xz / 5.2 + vec2(4.6, -7.2));
float naturalRockNormalX = naturalRockFbm((vNaturalRockWorldPosition.xz + vec2(0.65, 0.0)) / 5.2 + vec2(4.6, -7.2)) - naturalRockNormalCenter;
float naturalRockNormalZ = naturalRockFbm((vNaturalRockWorldPosition.xz + vec2(0.0, 0.65)) / 5.2 + vec2(4.6, -7.2)) - naturalRockNormalCenter;
vec3 naturalRockPerturbedWorldNormal = normalize(vNaturalRockWorldNormal + vec3(-naturalRockNormalX * 0.34, 0.0, -naturalRockNormalZ * 0.34));
normal = normalize(mix(normal, normalize(mat3(viewMatrix) * naturalRockPerturbedWorldNormal), 0.16));`,
      );
  };

  material.customProgramCacheKey = () => `${previousCacheKey()}|${ROCK_WEATHERING_SHADER_KEY}`;
  material.userData = {
    ...material.userData,
    naturalGeology: true,
    naturalGeologyWorldWeathering: ROCK_WEATHERING_SHADER_KEY,
    naturalGeologyWorldNormalSpace: 'instance-scale-compensated-world',
  };
  return material;
}

function createRockMaterial(color) {
  return installRockMaterialWeathering(new THREE.MeshStandardMaterial({
    color,
    roughness: NATURAL_GEOLOGY_RENDER_POLICY.proceduralRoughness,
    metalness: 0,
    flatShading: true,
  }));
}

/**
 * Builds one low-poly rock from stacked irregular rings. The silhouette is authored as strata and
 * faulted ledges from the start instead of deforming a sphere/Platonic solid afterwards. Ring radii,
 * offsets and twists are deterministic constants per family; runtime variation still comes from each
 * placement's scale/yaw/tilt and world-space material weathering, so instancing remains cheap.
 */
function createStratifiedRockGeometry({ segments, phase = 0, rings }) {
  const vertices = [];
  const indices = [];
  const count = Math.max(5, Math.floor(segments));
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];
    for (let segment = 0; segment < count; segment += 1) {
      const angle = phase + ring.twist + (segment / count) * Math.PI * 2;
      const angularNoise = 1
        + Math.sin(angle * 3 + ringIndex * 1.37) * 0.085
        + Math.sin(angle * 5 - ringIndex * 0.81) * 0.045;
      const fractureBias = 1 + Math.max(0, Math.sin(angle * 2.0 + phase * 1.7)) * (ring.fracture ?? 0.06);
      vertices.push(
        ring.offsetX + Math.cos(angle) * ring.radiusX * angularNoise * fractureBias,
        ring.y + Math.sin(angle * 2 + ringIndex) * (ring.verticalNoise ?? 0.018),
        ring.offsetZ + Math.sin(angle) * ring.radiusZ * angularNoise,
      );
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const lower = ringIndex * count;
    const upper = (ringIndex + 1) * count;
    for (let segment = 0; segment < count; segment += 1) {
      const next = (segment + 1) % count;
      indices.push(lower + segment, upper + next, upper + segment);
      indices.push(lower + segment, lower + next, upper + next);
    }
  }

  const bottomCenter = vertices.length / 3;
  const bottom = rings[0];
  vertices.push(bottom.offsetX, bottom.y - 0.012, bottom.offsetZ);
  const topCenter = vertices.length / 3;
  const top = rings[rings.length - 1];
  vertices.push(top.offsetX, top.y + 0.012, top.offsetZ);
  const topBase = (rings.length - 1) * count;
  for (let segment = 0; segment < count; segment += 1) {
    const next = (segment + 1) % count;
    indices.push(bottomCenter, next, segment);
    indices.push(topCenter, topBase + segment, topBase + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.naturalRockPrototype = 'stratified-faceted-geologic-ledges';
  return geometry;
}

export function createNaturalRockPrototypeGeometry(kind) {
  if (kind === 'fractured-scarp') {
    return createStratifiedRockGeometry({
      segments: 9,
      phase: 0.17,
      rings: [
        { y: -0.50, radiusX: 0.58, radiusZ: 0.34, offsetX: -0.04, offsetZ: 0.02, twist: 0.00, fracture: 0.11 },
        { y: -0.16, radiusX: 0.55, radiusZ: 0.30, offsetX: 0.02, offsetZ: -0.01, twist: 0.035, fracture: 0.14 },
        { y: 0.18, radiusX: 0.48, radiusZ: 0.27, offsetX: 0.09, offsetZ: -0.025, twist: -0.018, fracture: 0.13 },
        { y: 0.50, radiusX: 0.39, radiusZ: 0.22, offsetX: 0.16, offsetZ: -0.04, twist: 0.045, fracture: 0.10 },
      ],
    });
  }
  if (kind === 'bedrock') {
    return createStratifiedRockGeometry({
      segments: 10,
      phase: 0.09,
      rings: [
        { y: -0.34, radiusX: 0.58, radiusZ: 0.44, offsetX: -0.03, offsetZ: 0.01, twist: 0.00, fracture: 0.08 },
        { y: -0.10, radiusX: 0.61, radiusZ: 0.43, offsetX: 0.015, offsetZ: -0.015, twist: 0.028, fracture: 0.09 },
        { y: 0.14, radiusX: 0.51, radiusZ: 0.37, offsetX: 0.055, offsetZ: -0.02, twist: -0.016, fracture: 0.07 },
        { y: 0.34, radiusX: 0.42, radiusZ: 0.31, offsetX: 0.08, offsetZ: -0.015, twist: 0.032, fracture: 0.06 },
      ],
    });
  }
  if (kind === 'low-outcrop' || kind === 'asset-proxy') {
    return createStratifiedRockGeometry({
      segments: 10,
      phase: 0.23,
      rings: [
        { y: -0.22, radiusX: 0.62, radiusZ: 0.50, offsetX: -0.03, offsetZ: 0.01, twist: 0.00, fracture: 0.06 },
        { y: -0.03, radiusX: 0.64, radiusZ: 0.47, offsetX: 0.02, offsetZ: -0.01, twist: 0.025, fracture: 0.07 },
        { y: 0.20, radiusX: 0.48, radiusZ: 0.39, offsetX: 0.09, offsetZ: -0.02, twist: -0.02, fracture: 0.08 },
      ],
    });
  }
  if (kind === 'talus') {
    return createStratifiedRockGeometry({
      segments: 6,
      phase: 0.31,
      rings: [
        { y: -0.43, radiusX: 0.56, radiusZ: 0.49, offsetX: -0.05, offsetZ: 0.03, twist: 0.00, fracture: 0.13 },
        { y: 0.02, radiusX: 0.43, radiusZ: 0.39, offsetX: 0.06, offsetZ: -0.02, twist: 0.08, fracture: 0.15 },
        { y: 0.48, radiusX: 0.16, radiusZ: 0.19, offsetX: 0.18, offsetZ: -0.07, twist: -0.06, fracture: 0.11 },
        { y: 0.72, radiusX: 0.07, radiusZ: 0.09, offsetX: 0.22, offsetZ: -0.08, twist: 0.03, fracture: 0.08 },
      ],
    });
  }
  return createStratifiedRockGeometry({
    segments: 8,
    phase: 0.13,
    rings: [
      { y: -0.46, radiusX: 0.50, radiusZ: 0.46, offsetX: -0.02, offsetZ: 0.00, twist: 0.00, fracture: 0.10 },
      { y: -0.05, radiusX: 0.54, radiusZ: 0.48, offsetX: 0.02, offsetZ: -0.015, twist: 0.06, fracture: 0.12 },
      { y: 0.34, radiusX: 0.39, radiusZ: 0.37, offsetX: 0.08, offsetZ: -0.04, twist: -0.035, fracture: 0.10 },
      { y: 0.50, radiusX: 0.22, radiusZ: 0.24, offsetX: 0.13, offsetZ: -0.055, twist: 0.04, fracture: 0.08 },
    ],
  });
}

function colorForPlacement(placement) {
  if (placement.volcanic) {
    const c = new THREE.Color(0x47413e);
    const hot = clamp01((placement.valyriaInfluence - 0.45) / 0.55);
    if (placement.kind === 'talus') c.lerp(new THREE.Color(0x57504b), 0.26);
    if (placement.kind === 'fractured-scarp') c.lerp(new THREE.Color(0x3b3939), 0.30);
    if (hot > 0.6 && placement.curvatureMeters > 0.35) c.lerp(new THREE.Color(0x5a3025), 0.08);
    return c;
  }
  const north = placement.northness;
  const south = placement.southernDryness;
  const altitude = clamp01(placement.heightAboveSeaMeters / 520);
  if (south > 0.69) return new THREE.Color().setRGB(0.31 + south * 0.12, 0.255 + south * 0.07, 0.18 + south * 0.035);
  if (north > 0.72 || altitude > 0.72) return new THREE.Color().setRGB(0.34 + altitude * 0.08, 0.37 + altitude * 0.08, 0.39 + altitude * 0.08);
  return new THREE.Color().setRGB(0.31 + altitude * 0.055, 0.30 + altitude * 0.05, 0.27 + altitude * 0.045);
}

function hydratedTintForPlacement(placement) {
  return colorForPlacement(placement).lerp(
    hydratedTintWhite,
    1 - NATURAL_GEOLOGY_RENDER_POLICY.hydratedRegionalTintStrength,
  );
}

function composePlacementMatrix(placement, output = new THREE.Matrix4()) {
  tempObject.position.set(placement.x, placement.y, placement.z);
  tempObject.rotation.order = 'YXZ';
  tempObject.rotation.set(0, placement.yawRadians, 0);
  if (placement.tiltRadians > 1e-6) {
    const axis = new THREE.Vector3(Math.cos(placement.tiltAxisRadians), 0, Math.sin(placement.tiltAxisRadians));
    tempObject.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, placement.tiltRadians));
  }
  tempObject.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
  tempObject.updateMatrix();
  return output.copy(tempObject.matrix);
}

function makeInstancedFamily(kind, placements) {
  if (!placements.length) return null;
  const colors = {
    'fractured-scarp': 0x5c5a54,
    bedrock: 0x67635a,
    'low-outcrop': 0x716b5f,
    talus: 0x6c665c,
    boulder: 0x625f58,
    'asset-proxy': 0x68635a,
  };
  const mesh = new THREE.InstancedMesh(
    createNaturalRockPrototypeGeometry(kind),
    createRockMaterial(colors[kind] ?? 0x66615a),
    placements.length,
  );
  mesh.name = `natural-geology-${kind}`;
  mesh.castShadow = kind !== 'talus';
  mesh.receiveShadow = true;
  for (let index = 0; index < placements.length; index += 1) {
    composePlacementMatrix(placements[index], tempMatrix);
    mesh.setMatrixAt(index, tempMatrix);
    mesh.setColorAt?.(index, colorForPlacement(placements[index]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  mesh.userData.naturalGeologyKind = kind;
  mesh.userData.placementIds = placements.map((placement) => placement.id);
  return mesh;
}

function buildProceduralMeshes(placements) {
  const families = new Map();
  for (const placement of placements) {
    if (!families.has(placement.kind)) families.set(placement.kind, []);
    families.get(placement.kind).push(placement);
  }
  return [...families]
    .map(([kind, family]) => makeInstancedFamily(kind, family))
    .filter(Boolean);
}

/**
 * Legacy/debug-only terrain-conforming Valyria overlay. Production no longer adds this mesh to the
 * natural-geology group because canonical terrain already owns Valyria height, vertex colour and the
 * morphology-aligned PBR pass. Keeping the helper export lets QA compare historical overlays without
 * reintroducing a second 46m-grid surface into the shipped scene.
 */
export function createValyriaVolcanicSurface({
  sampleHeightMeters,
  seaLevelMeters,
  worldWidthMeters,
  worldDepthMeters,
  gridMeters = VALYRIA_GEOLOGY_POLICY.volcanicSurfaceGridMeters,
}) {
  const policy = VALYRIA_GEOLOGY_POLICY;
  const minNx = policy.coreCenter.nx - policy.coreRadius.nx * policy.falloff;
  const maxNx = policy.coreCenter.nx + policy.coreRadius.nx * policy.falloff;
  const minNy = Math.min(
    policy.neckCenter.ny - policy.neckRadius.ny * policy.falloff,
    policy.coreCenter.ny - policy.coreRadius.ny * policy.falloff,
  );
  const maxNy = policy.coreCenter.ny + policy.coreRadius.ny * policy.falloff;
  const minX = (minNx - 0.5) * worldWidthMeters;
  const maxX = (maxNx - 0.5) * worldWidthMeters;
  const minZ = (minNy - 0.5) * worldDepthMeters;
  const maxZ = (maxNy - 0.5) * worldDepthMeters;
  const columns = Math.max(3, Math.ceil((maxX - minX) / gridMeters));
  const rows = Math.max(3, Math.ceil((maxZ - minZ) / gridMeters));
  const vertices = [];
  const colors = [];
  const indices = [];
  const vertexIndex = new Map();
  let activeCells = 0;
  let lavaVertices = 0;

  const addVertex = (x, z) => {
    const key = `${x.toFixed(4)}:${z.toFixed(4)}`;
    if (vertexIndex.has(key)) return vertexIndex.get(key);
    const y = sampleHeightMeters(x, z);
    const ownerPoint = normalizedOwnerMapAtWorldXZ(x, z);
    const influence = valyriaInfluenceAtWorldXZ(x, z);
    const frame = sampleTerrainFrame(sampleHeightMeters, x, z, 9);
    const color = { r: 0.2, g: 0.2, b: 0.2 };
    applyValyriaSurfaceColor(color, {
      nx: ownerPoint.nx,
      ny: ownerPoint.ny,
      heightAboveSeaMeters: y - seaLevelMeters,
      concavityMeters: frame.curvatureMeters,
      slopeDegrees: frame.slopeDegrees,
    });
    if (influence > 0.48 && frame.curvatureMeters > 0.8 && frame.slopeDegrees < 36) lavaVertices += 1;
    const index = vertices.length / 3;
    vertices.push(x, y + policy.renderSurfaceOffsetMeters, z);
    colors.push(color.r, color.g, color.b);
    vertexIndex.set(key, index);
    return index;
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = minX + (column / columns) * (maxX - minX);
      const x1 = minX + ((column + 1) / columns) * (maxX - minX);
      const z0 = minZ + (row / rows) * (maxZ - minZ);
      const z1 = minZ + ((row + 1) / rows) * (maxZ - minZ);
      const centerX = (x0 + x1) * 0.5;
      const centerZ = (z0 + z1) * 0.5;
      if (valyriaInfluenceAtWorldXZ(centerX, centerZ) <= 0.035) continue;
      const h00 = sampleHeightMeters(x0, z0);
      const h10 = sampleHeightMeters(x1, z0);
      const h01 = sampleHeightMeters(x0, z1);
      const h11 = sampleHeightMeters(x1, z1);
      if (Math.min(h00, h10, h01, h11) <= seaLevelMeters + 0.05) continue;
      const a = addVertex(x0, z0);
      const b = addVertex(x1, z0);
      const c = addVertex(x1, z1);
      const d = addVertex(x0, z1);
      indices.push(a, c, b, a, d, c);
      activeCells += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = NATURAL_GEOLOGY_RENDER_POLICY.valyriaSurfaceName;
  mesh.receiveShadow = true;
  mesh.userData.valyriaVolcanicSurface = Object.freeze({
    policyId: policy.id,
    activeCells,
    triangleCount: indices.length / 3,
    vertexCount: vertices.length / 3,
    lavaVertexRatio: vertices.length ? lavaVertices / (vertices.length / 3) : 0,
    renderOnly: true,
    canonicalHeightUnchanged: true,
    legacyDebugOnly: true,
  });
  return mesh;
}

export function createNaturalGeology({
  sampleHeightMeters,
  seaLevelMeters,
  seed,
  seats,
  roadEdges,
  worldWidthMeters,
  worldDepthMeters,
  isMobileClass = false,
}) {
  const placementResult = generateNaturalGeologyPlacements({
    sampleHeightMeters,
    seaLevelMeters,
    seed,
    seats,
    roadEdges,
    worldWidthMeters,
    worldDepthMeters,
    isMobileClass,
  });
  const group = new THREE.Group();
  group.name = NATURAL_GEOLOGY_RENDER_POLICY.groupName;
  group.add(...buildProceduralMeshes(placementResult.placements));
  group.userData.naturalGeology = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    placementPolicyId: placementResult.policyId,
    valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
    placementChecksum: checksumNaturalGeologyPlacements(placementResult.placements),
    placementCount: placementResult.placements.length,
    stats: placementResult.stats,
    assetState: 'procedural-fallback',
    directAssets: NATURAL_GEOLOGY_RENDER_POLICY.directAssetUrls,
    referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
    valyriaSurfaceAuthority: 'canonical-terrain',
    legacyValyriaSurfaceOverlayEnabled: false,
    worldSpaceRockWeathering: true,
    worldNormalSpace: 'instance-scale-compensated-world',
    hydratedRegionalTint: true,
    fallbackGeometryFamily: NATURAL_GEOLOGY_RENDER_POLICY.fallbackGeometryFamily,
    geographicAssetRouting: true,
  });
  group.userData.naturalGeologyPlacements = placementResult.placements;
  return Object.freeze({ group, placements: placementResult.placements, stats: placementResult.stats });
}

/**
 * Chooses a hydrated model family from geography rather than from arbitrary placement order.
 * Valyria stays dark/faulted; cold/high outcrops use the snow reference; southern arid provinces use
 * desert rocks; small mid-latitude/boulder-field proxies use the tiny free-rock FBX to add a third
 * silhouette without paying another multi-megabyte landscape download.
 */
export function resolveNaturalGeologyAssetFamily(placement) {
  if (!placement || placement.kind !== 'asset-proxy') return null;
  if (placement.volcanic) return 'rocky-terrain';
  const northness = clamp01(placement.northness ?? 0);
  const southernDryness = clamp01(placement.southernDryness ?? 0);
  const altitude01 = clamp01((placement.heightAboveSeaMeters ?? 0) / 520);
  if (northness > 0.76 || altitude01 > 0.78) return 'snow-terrain';
  if (southernDryness > 0.69) return 'desert-rocks';
  if (placement.sourceClusterKind === 'boulder-field' || (placement.slopeDegrees ?? 90) < 14) return 'free-rock';
  return placement.assetFamily === 'desert-rocks' ? 'desert-rocks' : 'rocky-terrain';
}

const proxyPlacementsForFamily = (group, family) => (
  group?.userData?.naturalGeologyPlacements ?? []
).filter((placement) => placement.kind === 'asset-proxy' && resolveNaturalGeologyAssetFamily(placement) === family);

function collectRenderableMeshes(model) {
  const meshes = [];
  model?.updateMatrixWorld?.(true);
  model?.traverse?.((node) => {
    const materials = Array.isArray(node?.material) ? node.material.filter(Boolean) : node?.material ? [node.material] : [];
    if (node?.isMesh && node.geometry?.getAttribute?.('position') && materials.length) {
      meshes.push(node);
    }
  });
  return meshes;
}

export function measureNaturalGeologyAsset(model) {
  model?.updateMatrixWorld?.(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  return {
    bounds,
    size,
    center,
    horizontal: Math.max(size.x, size.z),
    aspectRatio: Math.max(size.x, size.z) / Math.max(NATURAL_GEOLOGY_RENDER_POLICY.minimumSourceExtentMeters, size.y),
  };
}

export function validateNaturalGeologyAsset(model) {
  if (!model || model.userData?.isPlaceholder) return { valid: false, reason: 'placeholder' };
  const meshes = collectRenderableMeshes(model);
  if (!meshes.length) return { valid: false, reason: 'no-renderable-mesh' };
  if (meshes.length > NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedPrimitiveCount) {
    return { valid: false, reason: 'too-many-primitives' };
  }
  const measurement = measureNaturalGeologyAsset(model);
  if (!measurement) return { valid: false, reason: 'empty-bounds' };
  if (![measurement.size.x, measurement.size.y, measurement.size.z, measurement.aspectRatio].every(Number.isFinite)) {
    return { valid: false, reason: 'non-finite-bounds' };
  }
  if (measurement.aspectRatio > NATURAL_GEOLOGY_RENDER_POLICY.maximumSourceAspectRatio) {
    return { valid: false, reason: 'implausibly-flat-landscape' };
  }
  return { valid: true, meshes, measurement };
}

async function preflightAsset(url, signal) {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
    if (!response.ok) return { load: false, reason: `http-${response.status}` };
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length < NATURAL_GEOLOGY_RENDER_POLICY.hostedPreflightMinBytes) {
      return { load: false, reason: 'lfs-pointer' };
    }
    if (Number.isFinite(length) && length > NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedSourceBytes) {
      return { load: false, reason: 'source-too-large' };
    }
    return { load: true, contentLength: Number.isFinite(length) ? length : null };
  } catch (error) {
    return { load: false, reason: signal?.aborted ? 'aborted' : 'preflight-error', error };
  }
}

function createAssetNormalization(measurement) {
  const normalizer = 1 / Math.max(measurement.size.x, measurement.size.y, measurement.size.z, 1e-6);
  return new THREE.Matrix4()
    .makeScale(normalizer, normalizer, normalizer)
    .multiply(new THREE.Matrix4().makeTranslation(
      -measurement.center.x,
      -measurement.bounds.min.y,
      -measurement.center.z,
    ));
}

function hideProxyInstances(group, ids) {
  const proxy = group?.children?.find((child) => child?.name === 'natural-geology-asset-proxy');
  if (!proxy) return;
  const hidden = new Set(ids);
  const current = new THREE.Matrix4();
  for (let index = 0; index < proxy.count; index += 1) {
    if (!hidden.has(proxy.userData.placementIds?.[index])) continue;
    proxy.getMatrixAt(index, current);
    current.decompose(tempObject.position, tempQuaternion, tempScale);
    tempScale.set(0, 0, 0);
    current.compose(tempObject.position, tempQuaternion, tempScale);
    proxy.setMatrixAt(index, current);
  }
  proxy.instanceMatrix.needsUpdate = true;
}

async function loadNaturalGeologySource(url) {
  const loader = new AssetLoader();
  const isFbx = /\.fbx(?:$|[?#])/i.test(url);
  const model = isFbx
    ? await loader.loadFBXModel(url, { fallbackColor: 0x665f56, fallbackSize: 1 })
    : await loader.loadModel(url, { fallbackColor: 0x665f56, fallbackSize: 1 });
  return { model, sourceFormat: isFbx ? 'fbx' : 'gltf' };
}

async function hydrateFamily(group, family, url, signal, maxAnisotropy) {
  const placements = proxyPlacementsForFamily(group, family);
  if (!placements.length) return { family, status: 'unused', placementCount: 0 };
  const preflight = await preflightAsset(url, signal);
  if (!preflight.load) {
    return { family, status: 'procedural-fallback', reason: preflight.reason, placementCount: placements.length };
  }

  const { model, sourceFormat } = await loadNaturalGeologySource(url);
  const validation = validateNaturalGeologyAsset(model);
  if (!validation.valid) {
    AssetLoader.disposeObject3D(model);
    return { family, status: 'procedural-fallback', reason: validation.reason, placementCount: placements.length, sourceFormat };
  }

  const normalization = createAssetNormalization(validation.measurement);
  const hydrated = [];
  for (let meshIndex = 0; meshIndex < validation.meshes.length; meshIndex += 1) {
    const sourceMesh = validation.meshes[meshIndex];
    const material = prepareNaturalGeologyHydratedMaterials(sourceMesh.material, { maxAnisotropy });
    const instances = new THREE.InstancedMesh(sourceMesh.geometry, material, placements.length);
    instances.name = `natural-geology-hydrated-${family}-${meshIndex}`;
    instances.castShadow = true;
    instances.receiveShadow = true;
    for (let index = 0; index < placements.length; index += 1) {
      composePlacementMatrix(placements[index], tempMatrix);
      instances.setMatrixAt(index, tempMatrix.clone().multiply(normalization).multiply(sourceMesh.matrixWorld));
      // Preserve the source material/texture, but lightly tint each hydrated instance toward the same
      // regional lithology already used by the deterministic fallback. This breaks obvious clone colour
      // repetition without recolouring the source asset into a flat procedural swatch.
      instances.setColorAt(index, hydratedTintForPlacement(placements[index]));
    }
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    instances.computeBoundingSphere?.();
    instances.userData.naturalGeologyHydrated = Object.freeze({
      family,
      sourceFormat,
      regionalTintStrength: NATURAL_GEOLOGY_RENDER_POLICY.hydratedRegionalTintStrength,
      sourceMaterialPreserved: true,
      multiMaterial: Array.isArray(material),
      materialCount: Array.isArray(material) ? material.length : 1,
      textureAnisotropy: maxAnisotropy,
      textureColorSpaceContract: true,
      sourceUvAndTextureTransformPreserved: true,
    });
    hydrated.push(instances);
  }
  group.add(...hydrated);
  hideProxyInstances(group, placements.map((placement) => placement.id));
  return {
    family,
    status: 'active',
    assetUrl: url,
    sourceFormat,
    placementCount: placements.length,
    primitiveCount: hydrated.length,
    hostedContentLength: preflight.contentLength,
  };
}

const inFlight = new WeakMap();

export function upgradeNaturalGeologyAssets(group, {
  signal,
  isMobileClass = false,
  maxAnisotropy = 1,
} = {}) {
  if (!group) return Promise.resolve(Object.freeze({ status: 'missing-group' }));
  if (isMobileClass) return Promise.resolve(Object.freeze({ status: 'procedural-fallback', reason: 'mobile-budget' }));
  if (inFlight.has(group)) return inFlight.get(group);

  const task = (async () => {
    const definitions = [
      ['rocky-terrain', NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset],
      ['free-rock', NATURAL_GEOLOGY_RENDER_POLICY.smallRockAsset],
      ['snow-terrain', NATURAL_GEOLOGY_RENDER_POLICY.snowRockAsset],
      ['desert-rocks', NATURAL_GEOLOGY_RENDER_POLICY.southernRockAsset],
    ];
    const families = [];
    for (const [family, url] of definitions) {
      if (signal?.aborted) {
        families.push({ family, status: 'aborted', placementCount: 0 });
        continue;
      }
      families.push(await hydrateFamily(
        group,
        family,
        url,
        signal,
        Math.max(1, Math.min(
          NATURAL_GEOLOGY_RENDER_POLICY.hydratedMaximumAnisotropy,
          Number.isFinite(maxAnisotropy) ? Math.floor(maxAnisotropy) : 1,
        )),
      ));
    }
    const active = families.filter((entry) => entry.status === 'active');
    group.userData.naturalGeology = Object.freeze({
      ...group.userData.naturalGeology,
      assetState: active.length ? 'active' : 'procedural-fallback',
      hydratedFamilies: Object.freeze(families),
    });
    return Object.freeze({
      status: active.length ? 'active' : 'procedural-fallback',
      activeFamilyCount: active.length,
      hydratedPlacementCount: active.reduce((sum, entry) => sum + entry.placementCount, 0),
      families: Object.freeze(families),
    });
  })().finally(() => inFlight.delete(group));
  inFlight.set(group, task);
  return task;
}

export function disposeNaturalGeology(group) {
  if (!group) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  group.traverse((node) => {
    if (node.geometry && !geometries.has(node.geometry)) {
      geometries.add(node.geometry);
      node.geometry.dispose();
    }
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value?.isTexture && !textures.has(value)) {
          textures.add(value);
          value.dispose();
        }
      }
      material.dispose();
    }
  });
  group.clear();
}
