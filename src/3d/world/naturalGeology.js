/**
 * Asset-informed natural geology renderer.
 *
 * Deterministic placement is owned by naturalGeologyPlacement.js. This module renders an immediate
 * low-cost fallback and, on hydrated desktop builds, can replace selected outcrops with real GLB
 * geometry. Large landscape GLBs remain morphology references only so the world never becomes a
 * repeated 50 MB terrain tile.
 *
 * Valyria v2 deliberately does NOT paint a second blanket terrain mesh. Canonical terrain.js already
 * owns volcanic height and vertex colour. The renderer adds only sparse morphology-led lava crust and
 * fault scarps, removing the rectangular overlay/cell-edge failure mode while keeping 3D geological
 * detail where the volcanic process actually supports it.
 * @module world/naturalGeology
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY,
  checksumNaturalGeologyPlacements,
  generateNaturalGeologyPlacements,
} from './naturalGeologyPlacement.js';
import { VALYRIA_GEOLOGY_POLICY } from './valyriaGeology.js';
import {
  VALYRIA_VOLCANIC_FEATURE_POLICY,
  generateValyriaVolcanicFeatures,
} from './valyriaVolcanicFeatures.js';

export const NATURAL_GEOLOGY_RENDER_POLICY = Object.freeze({
  id: 'natural-geology-render-2026-08-31-v2-sparse-volcanic-features',
  supersedes: 'natural-geology-render-2026-08-27-v1-asset-hydrated-outcrops',
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
  valyriaFeatureGroupName: 'valyria-volcanic-features',
  legacyBlanketSurfaceRemoved: true,
  canonicalTerrainOwnsContinuousValyriaSurface: true,
  volcanicFeaturePolicyId: VALYRIA_VOLCANIC_FEATURE_POLICY.id,
});

const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempColor = new THREE.Color();
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

function createRockMaterial(color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: NATURAL_GEOLOGY_RENDER_POLICY.proceduralRoughness, metalness: 0, flatShading: true });
  material.userData.naturalGeology = true;
  return material;
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

function createLavaCrustPrototypeGeometry() {
  return warpGeometry(new THREE.IcosahedronGeometry(0.5, 1), {
    xScale: 1.0,
    yScale: 0.11,
    zScale: 0.28,
    fracture: 0.31,
    terrace: 0,
  });
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
  tempObject.quaternion.identity();
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
  const mesh = new THREE.InstancedMesh(createNaturalRockPrototypeGeometry(kind), createRockMaterial(colors[kind] ?? 0x66615a), placements.length);
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

function makeVolcanicFaultMesh(features) {
  if (!features.length) return null;
  const material = new THREE.MeshStandardMaterial({ color: 0x262322, roughness: 0.98, metalness: 0, flatShading: true, vertexColors: true });
  const mesh = new THREE.InstancedMesh(createNaturalRockPrototypeGeometry('fractured-scarp'), material, features.length);
  mesh.name = 'valyria-fault-scarps';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const bright = new THREE.Color(0x3b302d);
  for (let i = 0; i < features.length; i += 1) {
    composePlacementMatrix(features[i], tempMatrix);
    mesh.setMatrixAt(i, tempMatrix);
    tempColor.set(0x221f1e).lerp(bright, clamp01(features[i].score));
    mesh.setColorAt?.(i, tempColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  return mesh;
}

function makeVolcanicLavaMesh(features) {
  if (!features.length) return null;
  const material = new THREE.MeshStandardMaterial({
    color: 0x281510,
    roughness: 0.94,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
    emissive: 0x160300,
    emissiveIntensity: 0.10,
  });
  const mesh = new THREE.InstancedMesh(createLavaCrustPrototypeGeometry(), material, features.length);
  mesh.name = 'valyria-lava-crust-ribbons';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const warm = new THREE.Color(0x6b2717);
  for (let i = 0; i < features.length; i += 1) {
    composePlacementMatrix(features[i], tempMatrix);
    mesh.setMatrixAt(i, tempMatrix);
    const heat = clamp01(features[i].lavaWeight * 0.65 + features[i].drainage * 0.35);
    tempColor.set(0x2a1712).lerp(warm, heat * 0.34);
    mesh.setColorAt?.(i, tempColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  return mesh;
}

export function createValyriaVolcanicFeatures(options) {
  const result = generateValyriaVolcanicFeatures(options);
  const group = new THREE.Group();
  group.name = NATURAL_GEOLOGY_RENDER_POLICY.valyriaFeatureGroupName;
  const faults = result.features.filter((feature) => feature.type === 'fault');
  const lava = result.features.filter((feature) => feature.type === 'lava');
  const faultMesh = makeVolcanicFaultMesh(faults);
  const lavaMesh = makeVolcanicLavaMesh(lava);
  if (faultMesh) group.add(faultMesh);
  if (lavaMesh) group.add(lavaMesh);
  group.userData.valyriaVolcanicFeatures = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    featurePolicyId: VALYRIA_VOLCANIC_FEATURE_POLICY.id,
    valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
    faultCount: result.faultCount,
    lavaCount: result.lavaCount,
    totalFeatureCount: result.features.length,
    checksum: result.checksum,
    blanketSurfaceRemoved: true,
    canonicalTerrainOwnsContinuousSurface: true,
    renderOnly: true,
  });
  return group;
}

/**
 * Compatibility alias for older imports. The full rectangular terrain overlay is gone; this returns
 * only sparse morphology-driven feature geometry.
 */
export function createValyriaVolcanicSurface(options) {
  return createValyriaVolcanicFeatures(options);
}

export function createNaturalGeology({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, worldWidthMeters, worldDepthMeters, isMobileClass = false }) {
  const placementResult = generateNaturalGeologyPlacements({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, worldWidthMeters, worldDepthMeters, isMobileClass });
  const group = new THREE.Group();
  group.name = NATURAL_GEOLOGY_RENDER_POLICY.groupName;
  group.add(...buildProceduralMeshes(placementResult.placements));
  const valyriaFeatures = createValyriaVolcanicFeatures({ sampleHeightMeters, seaLevelMeters, seed, worldWidthMeters, worldDepthMeters, isMobileClass });
  group.add(valyriaFeatures);
  group.userData.naturalGeology = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    placementPolicyId: placementResult.policyId,
    valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
    placementChecksum: checksumNaturalGeologyPlacements(placementResult.placements),
    placementCount: placementResult.placements.length,
    stats: placementResult.stats,
    assetState: 'procedural-fallback',
    directAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies,
    referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
    valyriaFeatures: valyriaFeatures.userData.valyriaVolcanicFeatures,
  });
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
    const sourceMesh = validation.meshes[meshIndex], material = sourceMesh.material.clone(); material.metalness = 0; material.roughness = Math.max(material.roughness ?? 0, NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor);
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
