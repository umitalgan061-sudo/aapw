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
  id: 'natural-geology-render-2026-09-01-v3-ground-parity-geographic-weathering',
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
  hydratedMetalnessCeiling: 0.04,
  proceduralRoughness: 0.96,
  proceduralVertexWeathering: true,
  proceduralBaseColorNeutral: true,
  proceduralBaseOriginNormalized: true,
  hydratedBaseOriginNormalized: true,
  fallbackHydratedGroundParity: true,
  instanceClimateColor: true,
  hydratedSourceMapsPreserved: true,
  hydratedInstanceWeathering: true,
  groupName: 'natural-geology',
  valyriaSurfaceName: 'valyria-volcanic-surface',
});

const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempColor = new THREE.Color();
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

function createRockMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: NATURAL_GEOLOGY_RENDER_POLICY.proceduralRoughness,
    metalness: 0,
    flatShading: true,
  });
  material.userData.naturalGeology = true;
  material.userData.naturalGeologySurface = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    authoredMapsPreserved: false,
    vertexWeathering: true,
    instanceClimateColor: true,
    neutralMaterialBase: true,
    baseOriginNormalized: true,
  });
  return material;
}

function applyProceduralVertexWeathering(geometry, kind) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return geometry;
  const colors = new Float32Array(position.count * 3);
  const kindPhase = {
    'fractured-scarp': 0.31,
    bedrock: 1.17,
    'low-outcrop': 2.21,
    talus: 3.08,
    boulder: 4.13,
    'asset-proxy': 5.07,
  }[kind] ?? 0.73;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const topExposure = clamp01(normal.getY(index) * 0.62 + 0.38);
    const fracture = Math.sin(x * 13.7 + z * 9.1 + kindPhase) * 0.5
      + Math.sin((x - z) * 24.3 - y * 7.8 + kindPhase * 1.9) * 0.5;
    const grain = Math.sin(x * 41.3 + y * 17.7 - z * 29.1 + kindPhase * 3.1);
    const brightness = 0.84 + topExposure * 0.09 + fracture * 0.045 + grain * 0.018;
    const oxidized = clamp01(0.42 - topExposure * 0.25 + Math.max(0, fracture) * 0.16);
    colors[index * 3] = brightness * (1 + oxidized * 0.035);
    colors[index * 3 + 1] = brightness * (1 - oxidized * 0.018);
    colors[index * 3 + 2] = brightness * (1 - oxidized * 0.055);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.userData.naturalGeologySurface = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    vertexWeathering: true,
    localMultiscaleBreakup: true,
    baseOriginNormalized: true,
    geographyAuthorityChanged: false,
  });
  return geometry;
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

function normalizePrototypeBaseOrigin(geometry) {
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min?.y;
  if (Number.isFinite(minY) && Math.abs(minY) > 1e-9) geometry.translate(0, -minY, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.naturalGeologyBaseOrigin = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    bottomAtLocalZero: true,
    source: 'procedural-fallback',
  });
  return geometry;
}

export function createNaturalRockPrototypeGeometry(kind) {
  let geometry;
  if (kind === 'fractured-scarp') geometry = warpGeometry(new THREE.IcosahedronGeometry(0.5, 1), { xScale: 1, yScale: 1.24, zScale: 0.44, fracture: 0.22, terrace: 5 });
  else if (kind === 'bedrock') geometry = warpGeometry(new THREE.DodecahedronGeometry(0.5, 0), { xScale: 1, yScale: 0.62, zScale: 0.74, fracture: 0.18, terrace: 4 });
  else if (kind === 'low-outcrop' || kind === 'asset-proxy') geometry = warpGeometry(new THREE.IcosahedronGeometry(0.5, 1), { xScale: 1, yScale: 0.43, zScale: 0.86, fracture: 0.17, terrace: 3 });
  else if (kind === 'talus') geometry = warpGeometry(new THREE.TetrahedronGeometry(0.5, 1), { xScale: 1, yScale: 0.58, zScale: 0.92, fracture: 0.24 });
  else geometry = warpGeometry(new THREE.DodecahedronGeometry(0.5, 0), { xScale: 1, yScale: 0.82, zScale: 0.92, fracture: 0.21 });
  return applyProceduralVertexWeathering(normalizePrototypeBaseOrigin(geometry), kind);
}

export function naturalGeologyColorForPlacement(placement) {
  if (placement.volcanic) {
    const c = new THREE.Color(0x2c2624);
    const hot = clamp01((placement.valyriaInfluence - 0.45) / 0.55);
    if (placement.kind === 'talus') c.lerp(new THREE.Color(0x4a403b), 0.35);
    if (placement.kind === 'fractured-scarp') c.lerp(new THREE.Color(0x181617), 0.55);
    if (hot > 0.6 && placement.curvatureMeters > 0.35) c.lerp(new THREE.Color(0x6e2412), 0.18);
    return c;
  }
  const north = placement.northness, south = placement.southernDryness;
  const altitude = clamp01(placement.heightAboveSeaMeters / 520);
  const relief = clamp01((placement.localReliefMeters ?? 0) / 180);
  const deterministicGrain = Math.sin(placement.x * 0.0137 + placement.z * 0.0091) * 0.018;
  if (south > 0.69) {
    return new THREE.Color().setRGB(
      0.34 + south * 0.12 + relief * 0.035 + deterministicGrain,
      0.275 + south * 0.065 + relief * 0.018 + deterministicGrain * 0.65,
      0.19 + south * 0.038 + deterministicGrain * 0.35,
    );
  }
  if (north > 0.72 || altitude > 0.72) {
    return new THREE.Color().setRGB(
      0.37 + altitude * 0.075 + deterministicGrain * 0.55,
      0.40 + altitude * 0.08 + deterministicGrain * 0.7,
      0.42 + altitude * 0.085 + deterministicGrain,
    );
  }
  return new THREE.Color().setRGB(
    0.35 + altitude * 0.052 + relief * 0.025 + deterministicGrain,
    0.34 + altitude * 0.048 + relief * 0.018 + deterministicGrain * 0.78,
    0.30 + altitude * 0.043 + deterministicGrain * 0.52,
  );
}

export function naturalGeologyHydratedWeatheringMultiplier(placement) {
  const north = clamp01(placement.northness ?? 0);
  const south = clamp01(placement.southernDryness ?? 0);
  const altitude = clamp01((placement.heightAboveSeaMeters ?? 0) / 520);
  const relief = clamp01((placement.localReliefMeters ?? 0) / 180);
  const phase = Math.sin((placement.x ?? 0) * 0.0113 - (placement.z ?? 0) * 0.0087) * 0.012;
  if (placement.volcanic) {
    const heat = clamp01(((placement.valyriaInfluence ?? 0) - 0.35) / 0.65);
    return new THREE.Color().setRGB(0.82 + heat * 0.08, 0.80 - heat * 0.06, 0.79 - heat * 0.10);
  }
  if (south > 0.62) return new THREE.Color().setRGB(0.98, 0.91 + relief * 0.025, 0.80 + (1 - south) * 0.06);
  if (north > 0.66 || altitude > 0.68) return new THREE.Color().setRGB(0.88 + phase, 0.94 + phase, 1.0);
  return new THREE.Color().setRGB(0.95 + phase, 0.96 + phase, 0.91 + relief * 0.025);
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
  const mesh = new THREE.InstancedMesh(createNaturalRockPrototypeGeometry(kind), createRockMaterial(), placements.length);
  mesh.name = `natural-geology-${kind}`;
  mesh.castShadow = kind !== 'talus';
  mesh.receiveShadow = true;
  for (let i = 0; i < placements.length; i += 1) {
    composePlacementMatrix(placements[i], tempMatrix);
    mesh.setMatrixAt(i, tempMatrix);
    mesh.setColorAt?.(i, naturalGeologyColorForPlacement(placements[i]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  mesh.userData.naturalGeologyKind = kind;
  mesh.userData.placementIds = placements.map((p) => p.id);
  mesh.userData.naturalGeologySurface = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    vertexWeathering: true,
    instanceClimateColor: true,
    doubleTintRemoved: true,
    baseOriginNormalized: true,
  });
  return mesh;
}

function buildProceduralMeshes(placements) {
  const families = new Map();
  for (const p of placements) { if (!families.has(p.kind)) families.set(p.kind, []); families.get(p.kind).push(p); }
  return [...families].map(([kind, family]) => makeInstancedFamily(kind, family)).filter(Boolean);
}

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
    if (color.r > 0.55 && color.g < 0.22) lavaVertices += 1;
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
function prepareHydratedGeologyMaterial(sourceMaterial, family) {
  const material = sourceMaterial.clone();
  material.metalness = Math.min(material.metalness ?? 0, NATURAL_GEOLOGY_RENDER_POLICY.hydratedMetalnessCeiling);
  material.roughness = Math.max(material.roughness ?? 0, NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor);
  material.userData = { ...material.userData, naturalGeology: true, naturalGeologySurface: Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    family,
    authoredMapsPreserved: true,
    instanceClimateWeathering: true,
    baseOriginNormalized: true,
    roughnessFloor: NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor,
    metalnessCeiling: NATURAL_GEOLOGY_RENDER_POLICY.hydratedMetalnessCeiling,
  }) };
  return material;
}
async function hydrateFamily(group, family, url, signal) {
  const placements = proxyPlacementsForFamily(group, family); if (!placements.length) return { family, status: 'unused', placementCount: 0 };
  const preflight = await preflightAsset(url, signal); if (!preflight.load) return { family, status: 'procedural-fallback', reason: preflight.reason, placementCount: placements.length };
  const model = await new AssetLoader().loadModel(url, { fallbackColor: 0x665f56, fallbackSize: 1 }); const validation = validateNaturalGeologyAsset(model);
  if (!validation.valid) { AssetLoader.disposeObject3D(model); return { family, status: 'procedural-fallback', reason: validation.reason, placementCount: placements.length }; }
  const normalization = createAssetNormalization(validation.measurement), hydrated = [];
  for (let meshIndex = 0; meshIndex < validation.meshes.length; meshIndex += 1) {
    const sourceMesh = validation.meshes[meshIndex], material = prepareHydratedGeologyMaterial(sourceMesh.material, family);
    const instances = new THREE.InstancedMesh(sourceMesh.geometry, material, placements.length); instances.name = `natural-geology-hydrated-${family}-${meshIndex}`; instances.castShadow = true; instances.receiveShadow = true;
    for (let i = 0; i < placements.length; i += 1) {
      composePlacementMatrix(placements[i], tempMatrix);
      instances.setMatrixAt(i, tempMatrix.clone().multiply(normalization).multiply(sourceMesh.matrixWorld));
      tempColor.copy(naturalGeologyHydratedWeatheringMultiplier(placements[i]));
      instances.setColorAt?.(i, tempColor);
    }
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    instances.computeBoundingSphere?.();
    instances.userData.naturalGeologySurface = Object.freeze({
      policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
      family,
      hydrated: true,
      authoredMapsPreserved: true,
      instanceClimateWeathering: true,
      baseOriginNormalized: true,
      fallbackHydratedGroundParity: true,
    });
    hydrated.push(instances);
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
