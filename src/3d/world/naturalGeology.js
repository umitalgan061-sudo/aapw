/**
 * Asset-informed natural geology renderer.
 *
 * Deterministic placement is owned by naturalGeologyPlacement.js. This module renders an immediate
 * low-cost fallback and, on hydrated desktop builds, can replace selected outcrops with real GLB
 * geometry. Large landscape GLBs remain morphology references only so the world never becomes a
 * repeated 50 MB terrain tile.
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
  id: 'natural-geology-render-2026-08-27-v1-asset-hydrated-outcrops',
  renderOnly: true,
  deterministicPlacement: true,
  geographyAuthorityUnchanged: true,
  placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  primaryRockAsset: 'assets/models/fbx/rocky_terrain_low_poly.glb',
  southernRockAsset: 'assets/models/fbx/desert_rocks.glb',
  referenceLandscapeAsset: 'assets/models/fbx/rugged_mountain_landscape.glb',
  referenceLandscapeRuntimeLoad: false,
  hostedPreflightMinBytes: 512,
  maximumHydratedSourceBytes: 16 * 1024 * 1024,
  maximumHydratedPrimitiveCount: 16,
  minimumSourceExtentMeters: 0.001,
  maximumSourceAspectRatio: 18,
  hydratedRoughnessFloor: 0.86,
  proceduralRoughness: 0.96,
  groupName: 'natural-geology',
  valyriaSurfaceName: 'valyria-volcanic-surface',
});

const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

export const NATURAL_GEOLOGY_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'natural-geology-world-space-surface-fabric-2026-09-02-v1',
  renderOnly: true,
  canonicalHeightUnchanged: true,
  placementUnchanged: true,
  macroMeters: 118,
  mesoMeters: 31,
  fineMeters: 6.4,
  albedoVariation: true,
  microNormalVariation: true,
  roughnessVariation: true,
  triaxialWorldSpaceSampling: true,
});

function applyNaturalGeologySurfaceFabric(material, { surface = 'rock' } = {}) {
  if (!material?.isMeshStandardMaterial) return material;
  const P = NATURAL_GEOLOGY_SURFACE_FABRIC_POLICY;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  material.userData ||= {};
  material.userData.naturalGeologySurfaceFabric = Object.freeze({
    policyId: P.id,
    surface,
    worldSpace: true,
    multiScaleAlbedo: true,
    microNormal: true,
    roughnessVariation: true,
  });

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNaturalGeologyWorldPosition;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 naturalGeologyWorldPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          naturalGeologyWorldPosition = batchingMatrix * naturalGeologyWorldPosition;
        #endif
        #ifdef USE_INSTANCING
          naturalGeologyWorldPosition = instanceMatrix * naturalGeologyWorldPosition;
        #endif
        vNaturalGeologyWorldPosition = (modelMatrix * naturalGeologyWorldPosition).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vNaturalGeologyWorldPosition;
        float naturalGeologyHash(vec2 p) {
          p = fract(p * vec2(0.1031, 0.1030));
          p += dot(p, p.yx + 33.33);
          return fract((p.x + p.y) * p.x);
        }
        float naturalGeologyNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = naturalGeologyHash(i);
          float b = naturalGeologyHash(i + vec2(1.0, 0.0));
          float c = naturalGeologyHash(i + vec2(0.0, 1.0));
          float d = naturalGeologyHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float naturalGeologyTriaxialNoise(vec3 p) {
          float xy = naturalGeologyNoise(p.xy);
          float xz = naturalGeologyNoise(p.xz + vec2(17.3, -6.1));
          float yz = naturalGeologyNoise(p.yz + vec2(-11.7, 8.4));
          return xy * 0.31 + xz * 0.39 + yz * 0.30;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 naturalGeologyP = vNaturalGeologyWorldPosition;
        float naturalGeologyMacro = naturalGeologyTriaxialNoise(naturalGeologyP / ${P.macroMeters.toFixed(1)});
        float naturalGeologyMeso = naturalGeologyTriaxialNoise(naturalGeologyP / ${P.mesoMeters.toFixed(1)} + vec3(13.7, -8.2, 5.9));
        float naturalGeologyFine = naturalGeologyTriaxialNoise(naturalGeologyP / ${P.fineMeters.toFixed(1)} + vec3(-21.4, 9.6, 17.1));
        float naturalGeologyWeather = clamp(naturalGeologyMacro * 0.52 + naturalGeologyMeso * 0.34 + naturalGeologyFine * 0.14, 0.0, 1.0);
        float naturalGeologyDamp = smoothstep(0.56, 0.82, naturalGeologyTriaxialNoise(naturalGeologyP / 46.0 + vec3(4.2, 23.7, -9.1)));
        vec3 naturalGeologyMineral = mix(vec3(0.90, 0.94, 0.96), vec3(1.055, 0.995, 0.91), naturalGeologyMacro);
        diffuseColor.rgb *= mix(vec3(0.87), naturalGeologyMineral, 0.36 + naturalGeologyWeather * 0.24);
        diffuseColor.rgb *= 0.92 + naturalGeologyMeso * 0.17 + naturalGeologyFine * 0.055;
        diffuseColor.rgb *= 1.0 - naturalGeologyDamp * 0.085;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float naturalGeologyEpsilon = 0.19;
        vec3 naturalGeologyMicroP = vNaturalGeologyWorldPosition / 4.8;
        float naturalGeologyNx = naturalGeologyTriaxialNoise(naturalGeologyMicroP + vec3(naturalGeologyEpsilon, 0.0, 0.0)) - naturalGeologyTriaxialNoise(naturalGeologyMicroP - vec3(naturalGeologyEpsilon, 0.0, 0.0));
        float naturalGeologyNy = naturalGeologyTriaxialNoise(naturalGeologyMicroP + vec3(0.0, naturalGeologyEpsilon, 0.0)) - naturalGeologyTriaxialNoise(naturalGeologyMicroP - vec3(0.0, naturalGeologyEpsilon, 0.0));
        float naturalGeologyNz = naturalGeologyTriaxialNoise(naturalGeologyMicroP + vec3(0.0, 0.0, naturalGeologyEpsilon)) - naturalGeologyTriaxialNoise(naturalGeologyMicroP - vec3(0.0, 0.0, naturalGeologyEpsilon));
        normal = normalize(normal + mat3(viewMatrix) * vec3(naturalGeologyNx, naturalGeologyNy, naturalGeologyNz) * 0.095);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float naturalGeologyRoughVariation = (naturalGeologyMeso - 0.5) * 0.19 + (naturalGeologyFine - 0.5) * 0.11;
        roughnessFactor = clamp(0.86 + naturalGeologyRoughVariation - naturalGeologyDamp * 0.12, 0.58, 1.0);`,
      );
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}:${P.id}:${surface}`;
  material.needsUpdate = true;
  return material;
}

function createRockMaterial(color, surface = 'rock') {
  const material = new THREE.MeshStandardMaterial({ color, roughness: NATURAL_GEOLOGY_RENDER_POLICY.proceduralRoughness, metalness: 0, flatShading: true });
  material.userData.naturalGeology = true;
  return applyNaturalGeologySurfaceFabric(material, { surface });
}

function warpGeometry(geometry, { xScale = 1, yScale = 1, zScale = 1, fracture = 0.14, terrace = 0 }) {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    let x = position.getX(index) * xScale;
    let y = position.getY(index) * yScale;
    let z = position.getZ(index) * zScale;
    const phase = Math.sin(x * 4.17 + z * 2.31) * 0.53 + Math.sin(z * 6.2 - x * 1.77) * 0.47;
    const joint = Math.sin((x + z) * 9.1) * Math.sin((x - z) * 5.7);
    x *= 1 + phase * fracture * 0.28;
    z *= 1 - phase * fracture * 0.22;
    y += joint * fracture * 0.13;
    if (terrace > 0) y = y * 0.62 + (Math.round(y * terrace) / terrace) * 0.38;
    position.setXYZ(index, x, y, z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createNaturalRockPrototypeGeometry(kind) {
  if (kind === 'fractured-scarp') return warpGeometry(new THREE.IcosahedronGeometry(0.5, 1), { xScale: 1, yScale: 1.24, zScale: 0.44, fracture: 0.22, terrace: 5 });
  if (kind === 'bedrock') return warpGeometry(new THREE.DodecahedronGeometry(0.5, 0), { xScale: 1, yScale: 0.62, zScale: 0.74, fracture: 0.18, terrace: 4 });
  if (kind === 'low-outcrop' || kind === 'asset-proxy') return warpGeometry(new THREE.IcosahedronGeometry(0.5, 1), { xScale: 1, yScale: 0.43, zScale: 0.86, fracture: 0.17, terrace: 3 });
  if (kind === 'talus') return warpGeometry(new THREE.TetrahedronGeometry(0.5, 1), { xScale: 1, yScale: 0.58, zScale: 0.92, fracture: 0.24 });
  return warpGeometry(new THREE.DodecahedronGeometry(0.5, 0), { xScale: 1, yScale: 0.82, zScale: 0.92, fracture: 0.21 });
}

function colorForPlacement(placement) {
  if (placement.volcanic) {
    const c = new THREE.Color(0x2c2624);
    const hot = clamp01((placement.valyriaInfluence - 0.45) / 0.55);
    if (placement.kind === 'talus') c.lerp(new THREE.Color(0x4a403b), 0.35);
    if (placement.kind === 'fractured-scarp') c.lerp(new THREE.Color(0x181617), 0.55);
    if (hot > 0.6 && placement.curvatureMeters > 0.35) c.lerp(new THREE.Color(0x6e2412), 0.18);
    return c;
  }
  const north = placement.northness, south = placement.southernDryness, altitude = clamp01(placement.heightAboveSeaMeters / 520);
  if (south > 0.69) return new THREE.Color().setRGB(0.31 + south * 0.12, 0.255 + south * 0.07, 0.18 + south * 0.035);
  if (north > 0.72 || altitude > 0.72) return new THREE.Color().setRGB(0.34 + altitude * 0.08, 0.37 + altitude * 0.08, 0.39 + altitude * 0.08);
  return new THREE.Color().setRGB(0.31 + altitude * 0.055, 0.30 + altitude * 0.05, 0.27 + altitude * 0.045);
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
  const colors = { 'fractured-scarp': 0x5c5a54, bedrock: 0x67635a, 'low-outcrop': 0x716b5f, talus: 0x6c665c, boulder: 0x625f58, 'asset-proxy': 0x68635a };
  const mesh = new THREE.InstancedMesh(createNaturalRockPrototypeGeometry(kind), createRockMaterial(colors[kind] ?? 0x66615a, kind), placements.length);
  mesh.name = `natural-geology-${kind}`;
  mesh.castShadow = kind !== 'talus';
  mesh.receiveShadow = true;
  for (let i = 0; i < placements.length; i += 1) {
    composePlacementMatrix(placements[i], tempMatrix);
    mesh.setMatrixAt(i, tempMatrix);
    mesh.setColorAt?.(i, colorForPlacement(placements[i]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  mesh.userData.naturalGeologyKind = kind;
  mesh.userData.placementIds = placements.map((p) => p.id);
  return mesh;
}

function buildProceduralMeshes(placements) {
  const families = new Map();
  for (const p of placements) { if (!families.has(p.kind)) families.set(p.kind, []); families.get(p.kind).push(p); }
  return [...families].map(([kind, family]) => makeInstancedFamily(kind, family)).filter(Boolean);
}

/** Render-only, terrain-conforming Valyria surface. It never modifies canonical height or water. */
export function createValyriaVolcanicSurface({ sampleHeightMeters, seaLevelMeters, worldWidthMeters, worldDepthMeters, gridMeters = VALYRIA_GEOLOGY_POLICY.volcanicSurfaceGridMeters }) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const minNx = P.coreCenter.nx - P.coreRadius.nx * P.falloff;
  const maxNx = P.coreCenter.nx + P.coreRadius.nx * P.falloff;
  const minNy = Math.min(P.neckCenter.ny - P.neckRadius.ny * P.falloff, P.coreCenter.ny - P.coreRadius.ny * P.falloff);
  const maxNy = P.coreCenter.ny + P.coreRadius.ny * P.falloff;
  const minX = (minNx - 0.5) * worldWidthMeters, maxX = (maxNx - 0.5) * worldWidthMeters;
  const minZ = (minNy - 0.5) * worldDepthMeters, maxZ = (maxNy - 0.5) * worldDepthMeters;
  const cols = Math.max(3, Math.ceil((maxX - minX) / gridMeters)), rows = Math.max(3, Math.ceil((maxZ - minZ) / gridMeters));
  const vertices = [], colors = [], indices = [];
  const vertexIndex = new Map(); let activeCells = 0, lavaVertices = 0;
  const addVertex = (x, z) => {
    const key = `${x.toFixed(4)}:${z.toFixed(4)}`;
    if (vertexIndex.has(key)) return vertexIndex.get(key);
    const y = sampleHeightMeters(x, z), p = normalizedOwnerMapAtWorldXZ(x, z), influence = valyriaInfluenceAtWorldXZ(x, z);
    const frame = sampleTerrainFrame(sampleHeightMeters, x, z, 9);
    const color = { r: 0.2, g: 0.2, b: 0.2 };
    applyValyriaSurfaceColor(color, { nx: p.nx, ny: p.ny, heightAboveSeaMeters: y - seaLevelMeters, concavityMeters: frame.curvatureMeters, slopeDegrees: frame.slopeDegrees });
    if (influence > 0.48 && frame.curvatureMeters > 0.8 && frame.slopeDegrees < 36) lavaVertices += 1;
    const idx = vertices.length / 3;
    vertices.push(x, y + P.renderSurfaceOffsetMeters, z); colors.push(color.r, color.g, color.b); vertexIndex.set(key, idx); return idx;
  };
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    const x0 = minX + (col / cols) * (maxX - minX), x1 = minX + ((col + 1) / cols) * (maxX - minX);
    const z0 = minZ + (row / rows) * (maxZ - minZ), z1 = minZ + ((row + 1) / rows) * (maxZ - minZ);
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
    if (valyriaInfluenceAtWorldXZ(cx, cz) <= 0.035) continue;
    const h00 = sampleHeightMeters(x0, z0), h10 = sampleHeightMeters(x1, z0), h01 = sampleHeightMeters(x0, z1), h11 = sampleHeightMeters(x1, z1);
    if (Math.min(h00, h10, h01, h11) <= seaLevelMeters + 0.05) continue;
    const a = addVertex(x0, z0), b = addVertex(x1, z0), c = addVertex(x1, z1), d = addVertex(x0, z1);
    indices.push(a, c, b, a, d, c); activeCells += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  applyNaturalGeologySurfaceFabric(material, { surface: 'valyria-volcanic' });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = NATURAL_GEOLOGY_RENDER_POLICY.valyriaSurfaceName; mesh.receiveShadow = true;
  mesh.userData.valyriaVolcanicSurface = Object.freeze({ policyId: P.id, activeCells, triangleCount: indices.length / 3, vertexCount: vertices.length / 3, lavaVertexRatio: vertices.length ? lavaVertices / (vertices.length / 3) : 0, renderOnly: true, canonicalHeightUnchanged: true });
  return mesh;
}

export function createNaturalGeology({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, worldWidthMeters, worldDepthMeters, isMobileClass = false }) {
  const placementResult = generateNaturalGeologyPlacements({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, worldWidthMeters, worldDepthMeters, isMobileClass });
  const group = new THREE.Group(); group.name = NATURAL_GEOLOGY_RENDER_POLICY.groupName;
  group.add(...buildProceduralMeshes(placementResult.placements));
  const valyriaSurface = createValyriaVolcanicSurface({ sampleHeightMeters, seaLevelMeters, worldWidthMeters, worldDepthMeters });
  group.add(valyriaSurface);
  group.userData.naturalGeology = Object.freeze({ policyId: NATURAL_GEOLOGY_RENDER_POLICY.id, placementPolicyId: placementResult.policyId,
    valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id, placementChecksum: checksumNaturalGeologyPlacements(placementResult.placements), placementCount: placementResult.placements.length,
    stats: placementResult.stats, assetState: 'procedural-fallback', directAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies,
    referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets, valyriaSurface: valyriaSurface.userData.valyriaVolcanicSurface });
  group.userData.naturalGeologyPlacements = placementResult.placements;
  return Object.freeze({ group, placements: placementResult.placements, stats: placementResult.stats });
}

const proxyPlacementsForFamily = (group, family) => (group?.userData?.naturalGeologyPlacements ?? []).filter((p) => p.kind === 'asset-proxy' && p.assetFamily === family);
function collectRenderableMeshes(model) { const meshes = []; model?.updateMatrixWorld?.(true); model?.traverse?.((n) => { if (n?.isMesh && n.geometry?.getAttribute?.('position') && n.material && !Array.isArray(n.material)) meshes.push(n); }); return meshes; }
export function measureNaturalGeologyAsset(model) {
  model?.updateMatrixWorld?.(true); const bounds = new THREE.Box3().setFromObject(model); if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  return { bounds, size, center, horizontal: Math.max(size.x, size.z), aspectRatio: Math.max(size.x, size.z) / Math.max(NATURAL_GEOLOGY_RENDER_POLICY.minimumSourceExtentMeters, size.y) };
}
export function validateNaturalGeologyAsset(model) {
  if (!model || model.userData?.isPlaceholder) return { valid: false, reason: 'placeholder' };
  const meshes = collectRenderableMeshes(model); if (!meshes.length) return { valid: false, reason: 'no-renderable-mesh' };
  if (meshes.length > NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedPrimitiveCount) return { valid: false, reason: 'too-many-primitives' };
  const measurement = measureNaturalGeologyAsset(model); if (!measurement) return { valid: false, reason: 'empty-bounds' };
  if (![measurement.size.x, measurement.size.y, measurement.size.z, measurement.aspectRatio].every(Number.isFinite)) return { valid: false, reason: 'non-finite-bounds' };
  if (measurement.aspectRatio > NATURAL_GEOLOGY_RENDER_POLICY.maximumSourceAspectRatio) return { valid: false, reason: 'implausibly-flat-landscape' };
  return { valid: true, meshes, measurement };
}
async function preflightAsset(url, signal) {
  try { const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal }); if (!response.ok) return { load: false, reason: `http-${response.status}` };
    const length = Number(response.headers.get('content-length')); if (Number.isFinite(length) && length < NATURAL_GEOLOGY_RENDER_POLICY.hostedPreflightMinBytes) return { load: false, reason: 'lfs-pointer' };
    if (Number.isFinite(length) && length > NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedSourceBytes) return { load: false, reason: 'source-too-large' };
    return { load: true, contentLength: Number.isFinite(length) ? length : null }; } catch (error) { return { load: false, reason: signal?.aborted ? 'aborted' : 'preflight-error', error }; }
}
function createAssetNormalization(measurement) {
  const normalizer = 1 / Math.max(measurement.size.x, measurement.size.y, measurement.size.z, 1e-6);
  return new THREE.Matrix4().makeScale(normalizer, normalizer, normalizer).multiply(new THREE.Matrix4().makeTranslation(-measurement.center.x, -measurement.bounds.min.y, -measurement.center.z));
}
function hideProxyInstances(group, ids) {
  const proxy = group?.children?.find((child) => child?.name === 'natural-geology-asset-proxy'); if (!proxy) return;
  const hidden = new Set(ids), current = new THREE.Matrix4();
  for (let i = 0; i < proxy.count; i += 1) if (hidden.has(proxy.userData.placementIds?.[i])) { proxy.getMatrixAt(i, current); current.decompose(tempObject.position, tempQuaternion, tempScale); tempScale.set(0, 0, 0); current.compose(tempObject.position, tempQuaternion, tempScale); proxy.setMatrixAt(i, current); }
  proxy.instanceMatrix.needsUpdate = true;
}
async function hydrateFamily(group, family, url, signal) {
  const placements = proxyPlacementsForFamily(group, family); if (!placements.length) return { family, status: 'unused', placementCount: 0 };
  const preflight = await preflightAsset(url, signal); if (!preflight.load) return { family, status: 'procedural-fallback', reason: preflight.reason, placementCount: placements.length };
  const model = await new AssetLoader().loadModel(url, { fallbackColor: 0x665f56, fallbackSize: 1 }); const validation = validateNaturalGeologyAsset(model);
  if (!validation.valid) { AssetLoader.disposeObject3D(model); return { family, status: 'procedural-fallback', reason: validation.reason, placementCount: placements.length }; }
  const normalization = createAssetNormalization(validation.measurement), hydrated = [];
  for (let meshIndex = 0; meshIndex < validation.meshes.length; meshIndex += 1) {
    const sourceMesh = validation.meshes[meshIndex], material = sourceMesh.material.clone(); material.metalness = 0; material.roughness = Math.max(material.roughness ?? 0, NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor); applyNaturalGeologySurfaceFabric(material, { surface: `hydrated-${family}` });
    const instances = new THREE.InstancedMesh(sourceMesh.geometry, material, placements.length); instances.name = `natural-geology-hydrated-${family}-${meshIndex}`; instances.castShadow = true; instances.receiveShadow = true;
    for (let i = 0; i < placements.length; i += 1) { composePlacementMatrix(placements[i], tempMatrix); instances.setMatrixAt(i, tempMatrix.clone().multiply(normalization).multiply(sourceMesh.matrixWorld)); }
    instances.instanceMatrix.needsUpdate = true; instances.computeBoundingSphere?.(); hydrated.push(instances);
  }
  group.add(...hydrated); hideProxyInstances(group, placements.map((p) => p.id));
  return { family, status: 'active', assetUrl: url, placementCount: placements.length, primitiveCount: hydrated.length, hostedContentLength: preflight.contentLength };
}
const inFlight = new WeakMap();
export function upgradeNaturalGeologyAssets(group, { signal, isMobileClass = false } = {}) {
  if (!group) return Promise.resolve(Object.freeze({ status: 'missing-group' }));
  if (isMobileClass) return Promise.resolve(Object.freeze({ status: 'procedural-fallback', reason: 'mobile-budget' }));
  if (inFlight.has(group)) return inFlight.get(group);
  const task = (async () => { const primary = await hydrateFamily(group, 'rocky-terrain', NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset, signal);
    const southern = signal?.aborted ? { family: 'desert-rocks', status: 'aborted' } : await hydrateFamily(group, 'desert-rocks', NATURAL_GEOLOGY_RENDER_POLICY.southernRockAsset, signal);
    const families = [primary, southern], active = families.filter((e) => e.status === 'active');
    group.userData.naturalGeology = Object.freeze({ ...group.userData.naturalGeology, assetState: active.length ? 'active' : 'procedural-fallback', hydratedFamilies: Object.freeze(families) });
    return Object.freeze({ status: active.length ? 'active' : 'procedural-fallback', activeFamilyCount: active.length, hydratedPlacementCount: active.reduce((s, e) => s + e.placementCount, 0), families: Object.freeze(families) });
  })().finally(() => inFlight.delete(group)); inFlight.set(group, task); return task;
}
export function disposeNaturalGeology(group) {
  if (!group) return; const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse((node) => { if (node.geometry && !geometries.has(node.geometry)) { geometries.add(node.geometry); node.geometry.dispose(); }
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) { if (materials.has(material)) continue; materials.add(material);
      for (const key of Object.keys(material)) { const value = material[key]; if (value?.isTexture && !textures.has(value)) { textures.add(value); value.dispose(); } } material.dispose(); } });
  group.clear();
}
