/**
 * Asset-informed natural geology renderer.
 *
 * Deterministic placement is owned by naturalGeologyPlacement.js. This module renders an immediate
 * low-cost fallback and, on hydrated desktop builds, replaces selected outcrops with repository GLB
 * geometry. Large landscape GLBs remain morphology references only so the world never becomes a
 * repeated 50 MB terrain tile.
 *
 * Hydration is deliberately transactional per asset family: a real GLB family becomes visible only
 * after every InstancedMesh batch passes the shared material/placement audit. Once that transaction
 * succeeds the corresponding procedural proxy family is physically removed and disposed rather than
 * left behind as zero-scale instances. This keeps the visual fallback fail-safe without retaining
 * invisible draw/culling baggage after a successful upgrade.
 *
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
import {
  NATURAL_GEOLOGY_SURFACE_POLICY,
  applyNaturalGeologySurfaceMaterial,
} from './naturalGeologySurfaceMaterial.js';
import {
  PRE_RESOLVED_INSTANCED_ASSET_POLICY,
  attachPreparedPreResolvedInstancedWorldAsset,
  auditPreResolvedInstancedWorldAsset,
  preparePreResolvedInstancedWorldAsset,
} from './PreResolvedInstancedAssetPlacement.js';

export const NATURAL_GEOLOGY_RENDER_POLICY = Object.freeze({
  id: 'natural-geology-render-2026-09-01-v5-family-proxy-lifecycle',
  renderOnly: true,
  deterministicPlacement: true,
  geographyAuthorityUnchanged: true,
  placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  sharedInstancedPlacementPolicyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
  valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  surfacePolicyId: NATURAL_GEOLOGY_SURFACE_POLICY.id,
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
  hydratedInstanceTintStrength: 0.18,
  proceduralRoughness: 0.96,
  surfaceModeHydrationParity: true,
  sharedPlacementManifestRequired: true,
  transactionalFamilyHydration: true,
  familyScopedProxyBatches: true,
  physicalProxyRemoval: true,
  splitProxySuppression: true,
  disposedGroupHydrationGuard: true,
  pagehideSelfDisposal: true,
  groupName: 'natural-geology',
  valyriaSurfaceName: 'valyria-volcanic-surface',
});

const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempTint = new THREE.Color();
const whiteTint = new THREE.Color(1, 1, 1);
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

function createRockMaterial(color, mode = 'rock') {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: NATURAL_GEOLOGY_RENDER_POLICY.proceduralRoughness,
    metalness: 0,
    flatShading: true,
  });
  material.userData.naturalGeology = true;
  return applyNaturalGeologySurfaceMaterial(material, { mode });
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
    const color = new THREE.Color(0x2c2624);
    const hot = clamp01((placement.valyriaInfluence - 0.45) / 0.55);
    if (placement.kind === 'talus') color.lerp(new THREE.Color(0x4a403b), 0.35);
    if (placement.kind === 'fractured-scarp') color.lerp(new THREE.Color(0x181617), 0.55);
    if (hot > 0.6 && placement.curvatureMeters > 0.35) color.lerp(new THREE.Color(0x6e2412), 0.18);
    return color;
  }
  const north = placement.northness;
  const south = placement.southernDryness;
  const altitude = clamp01(placement.heightAboveSeaMeters / 520);
  if (south > 0.69) return new THREE.Color().setRGB(0.31 + south * 0.12, 0.255 + south * 0.07, 0.18 + south * 0.035);
  if (north > 0.72 || altitude > 0.72) return new THREE.Color().setRGB(0.34 + altitude * 0.08, 0.37 + altitude * 0.08, 0.39 + altitude * 0.08);
  return new THREE.Color().setRGB(0.31 + altitude * 0.055, 0.30 + altitude * 0.05, 0.27 + altitude * 0.045);
}

function hydratedTintForPlacement(placement) {
  return tempTint.copy(whiteTint).lerp(
    colorForPlacement(placement),
    NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength,
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

function surfaceModeForPlacement(placement) {
  if (placement.volcanic) return 'volcanic';
  if (placement.southernDryness > 0.69 || placement.assetFamily === 'desert-rocks') return 'arid';
  return 'rock';
}

function makeInstancedFamily(kind, placements, surfaceMode = 'rock', assetFamily = null) {
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
    createRockMaterial(colors[kind] ?? 0x66615a, surfaceMode),
    placements.length,
  );
  const familySuffix = kind === 'asset-proxy' && assetFamily ? `-${assetFamily}` : '';
  const modeSuffix = surfaceMode === 'rock' ? '' : `-${surfaceMode}`;
  mesh.name = `natural-geology-${kind}${familySuffix}${modeSuffix}`;
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
  mesh.userData.naturalGeologySurfaceMode = surfaceMode;
  mesh.userData.naturalGeologyAssetFamily = assetFamily;
  mesh.userData.placementIds = placements.map((placement) => placement.id);
  return mesh;
}

function buildProceduralMeshes(placements) {
  const batches = new Map();
  for (const placement of placements) {
    const surfaceMode = surfaceModeForPlacement(placement);
    const assetFamily = placement.kind === 'asset-proxy' ? placement.assetFamily : null;
    const key = `${placement.kind}|${surfaceMode}|${assetFamily ?? 'procedural'}`;
    if (!batches.has(key)) {
      batches.set(key, {
        kind: placement.kind,
        surfaceMode,
        assetFamily,
        placements: [],
      });
    }
    batches.get(key).placements.push(placement);
  }
  return [...batches.values()]
    .map(({ kind, surfaceMode, assetFamily, placements: family }) => makeInstancedFamily(kind, family, surfaceMode, assetFamily))
    .filter(Boolean);
}

/** Render-only, terrain-conforming Valyria surface. It never modifies canonical height or water. */
export function createValyriaVolcanicSurface({ sampleHeightMeters, seaLevelMeters, worldWidthMeters, worldDepthMeters, gridMeters = VALYRIA_GEOLOGY_POLICY.volcanicSurfaceGridMeters }) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const minNx = P.coreCenter.nx - P.coreRadius.nx * P.falloff;
  const maxNx = P.coreCenter.nx + P.coreRadius.nx * P.falloff;
  const minNy = Math.min(P.neckCenter.ny - P.neckRadius.ny * P.falloff, P.coreCenter.ny - P.coreRadius.ny * P.falloff);
  const maxNy = P.coreCenter.ny + P.coreRadius.ny * P.falloff;
  const minX = (minNx - 0.5) * worldWidthMeters;
  const maxX = (maxNx - 0.5) * worldWidthMeters;
  const minZ = (minNy - 0.5) * worldDepthMeters;
  const maxZ = (maxNy - 0.5) * worldDepthMeters;
  const cols = Math.max(3, Math.ceil((maxX - minX) / gridMeters));
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
    const p = normalizedOwnerMapAtWorldXZ(x, z);
    const influence = valyriaInfluenceAtWorldXZ(x, z);
    const frame = sampleTerrainFrame(sampleHeightMeters, x, z, 9);
    const color = { r: 0.2, g: 0.2, b: 0.2 };
    applyValyriaSurfaceColor(color, {
      nx: p.nx,
      ny: p.ny,
      heightAboveSeaMeters: y - seaLevelMeters,
      concavityMeters: frame.curvatureMeters,
      slopeDegrees: frame.slopeDegrees,
    });
    if (influence > 0.48 && frame.curvatureMeters > 0.8 && frame.slopeDegrees < 36) lavaVertices += 1;
    const index = vertices.length / 3;
    vertices.push(x, y + P.renderSurfaceOffsetMeters, z);
    colors.push(color.r, color.g, color.b);
    vertexIndex.set(key, index);
    return index;
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = minX + (col / cols) * (maxX - minX);
      const x1 = minX + ((col + 1) / cols) * (maxX - minX);
      const z0 = minZ + (row / rows) * (maxZ - minZ);
      const z1 = minZ + ((row + 1) / rows) * (maxZ - minZ);
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      if (valyriaInfluenceAtWorldXZ(cx, cz) <= 0.035) continue;
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
  const material = applyNaturalGeologySurfaceMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }), { mode: 'volcanic' });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = NATURAL_GEOLOGY_RENDER_POLICY.valyriaSurfaceName;
  mesh.receiveShadow = true;
  mesh.userData.valyriaVolcanicSurface = Object.freeze({
    policyId: P.id,
    surfacePolicyId: NATURAL_GEOLOGY_SURFACE_POLICY.id,
    activeCells,
    triangleCount: indices.length / 3,
    vertexCount: vertices.length / 3,
    lavaVertexRatio: vertices.length ? lavaVertices / (vertices.length / 3) : 0,
    renderOnly: true,
    canonicalHeightUnchanged: true,
  });
  return mesh;
}

function bindPagehideDisposal(group) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  const disposeOnPagehide = () => disposeNaturalGeology(group);
  window.addEventListener('pagehide', disposeOnPagehide, { once: true });
  group.userData.naturalGeologyPagehideDispose = disposeOnPagehide;
}

export function createNaturalGeology({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, worldWidthMeters, worldDepthMeters, isMobileClass = false }) {
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
  const valyriaSurface = createValyriaVolcanicSurface({ sampleHeightMeters, seaLevelMeters, worldWidthMeters, worldDepthMeters });
  group.add(valyriaSurface);
  group.userData.naturalGeology = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    placementPolicyId: placementResult.policyId,
    sharedInstancedPlacementPolicyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
    valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
    surfacePolicyId: NATURAL_GEOLOGY_SURFACE_POLICY.id,
    placementChecksum: checksumNaturalGeologyPlacements(placementResult.placements),
    placementCount: placementResult.placements.length,
    stats: placementResult.stats,
    assetState: 'procedural-fallback',
    directAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies,
    referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
    valyriaSurface: valyriaSurface.userData.valyriaVolcanicSurface,
  });
  group.userData.naturalGeologyPlacements = placementResult.placements;
  group.userData.naturalGeologyDisposed = false;
  bindPagehideDisposal(group);
  return Object.freeze({ group, placements: placementResult.placements, stats: placementResult.stats });
}

const proxyPlacementsForFamily = (group, family) => (group?.userData?.naturalGeologyPlacements ?? [])
  .filter((placement) => placement.kind === 'asset-proxy' && placement.assetFamily === family);

function collectRenderableMeshes(model) {
  const meshes = [];
  model?.updateMatrixWorld?.(true);
  model?.traverse?.((node) => {
    if (node?.isMesh && node.geometry?.getAttribute?.('position') && node.material && !Array.isArray(node.material)) meshes.push(node);
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
  if (meshes.length > NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedPrimitiveCount) return { valid: false, reason: 'too-many-primitives' };
  const measurement = measureNaturalGeologyAsset(model);
  if (!measurement) return { valid: false, reason: 'empty-bounds' };
  if (![measurement.size.x, measurement.size.y, measurement.size.z, measurement.aspectRatio].every(Number.isFinite)) return { valid: false, reason: 'non-finite-bounds' };
  if (measurement.aspectRatio > NATURAL_GEOLOGY_RENDER_POLICY.maximumSourceAspectRatio) return { valid: false, reason: 'implausibly-flat-landscape' };
  return { valid: true, meshes, measurement };
}

async function preflightAsset(url, signal) {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
    if (!response.ok) return { load: false, reason: `http-${response.status}` };
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length < NATURAL_GEOLOGY_RENDER_POLICY.hostedPreflightMinBytes) return { load: false, reason: 'lfs-pointer' };
    if (Number.isFinite(length) && length > NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedSourceBytes) return { load: false, reason: 'source-too-large' };
    return { load: true, contentLength: Number.isFinite(length) ? length : null };
  } catch (error) {
    return { load: false, reason: signal?.aborted ? 'aborted' : 'preflight-error', error };
  }
}

function createAssetNormalization(measurement) {
  const normalizer = 1 / Math.max(measurement.size.x, measurement.size.y, measurement.size.z, 1e-6);
  return new THREE.Matrix4().makeScale(normalizer, normalizer, normalizer)
    .multiply(new THREE.Matrix4().makeTranslation(-measurement.center.x, -measurement.bounds.min.y, -measurement.center.z));
}

function disposeMaterialResources(material, textures = new Set()) {
  if (!material) return;
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value?.isTexture && !textures.has(value)) {
      textures.add(value);
      value.dispose?.();
    }
  }
  material.dispose?.();
}

function removeProxyFamily(group, family) {
  let removedMeshCount = 0;
  let removedInstanceCount = 0;
  const textures = new Set();
  for (const proxy of [...(group?.children ?? [])]) {
    if (!proxy?.isInstancedMesh) continue;
    if (proxy.userData?.naturalGeologyKind !== 'asset-proxy') continue;
    if (proxy.userData?.naturalGeologyAssetFamily !== family) continue;
    removedMeshCount += 1;
    removedInstanceCount += proxy.count;
    group.remove(proxy);
    proxy.geometry?.dispose?.();
    for (const material of Array.isArray(proxy.material) ? proxy.material : proxy.material ? [proxy.material] : []) disposeMaterialResources(material, textures);
  }
  return Object.freeze({ removedMeshCount, removedInstanceCount });
}

function disposeStagedHydratedBatches(staged) {
  const materials = new Set();
  for (const prepared of staged) {
    const material = prepared?.object?.material;
    if (material && !materials.has(material)) {
      materials.add(material);
      material.dispose?.();
    }
  }
}

function removeAttachedBatches(group, attached) {
  for (const prepared of attached) group?.remove?.(prepared.object);
}

function hydrationCancelled(group, signal) {
  return Boolean(signal?.aborted || group?.userData?.naturalGeologyDisposed);
}

function prepareHydratedBatch({ family, url, meshIndex, mode, sourceMesh, modePlacements, normalization, sourcePrimitiveCount }) {
  const material = sourceMesh.material.clone();
  material.metalness = 0;
  material.roughness = Math.max(material.roughness ?? 0, NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor);
  applyNaturalGeologySurfaceMaterial(material, { mode });
  const instances = new THREE.InstancedMesh(sourceMesh.geometry, material, modePlacements.length);
  instances.name = `natural-geology-hydrated-${family}-${mode}-${meshIndex}`;
  instances.castShadow = true;
  instances.receiveShadow = true;
  instances.userData.naturalGeologySurfaceMode = mode;
  instances.userData.naturalGeologyAssetFamily = family;
  instances.userData.naturalGeologyAssetSource = url;
  instances.userData.hydratedInstanceTintStrength = NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength;
  instances.userData.placementIds = modePlacements.map((placement) => placement.id);
  for (let index = 0; index < modePlacements.length; index += 1) {
    composePlacementMatrix(modePlacements[index], tempMatrix);
    instances.setMatrixAt(index, tempMatrix.clone().multiply(normalization).multiply(sourceMesh.matrixWorld));
    instances.setColorAt?.(index, hydratedTintForPlacement(modePlacements[index]));
  }
  instances.instanceMatrix.needsUpdate = true;
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  instances.computeBoundingSphere?.();
  const prepared = preparePreResolvedInstancedWorldAsset(instances, {
    metadata: { id: `natural-geology:${family}:${mode}:${meshIndex}`, name: instances.name, category: 'natural-geology-hydrated', src: url },
    placementIds: instances.userData.placementIds,
    placementChecksum: checksumNaturalGeologyPlacements(modePlacements),
    placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
    batchMetadata: { family, surfaceMode: mode, sourceMeshIndex: meshIndex, sourcePrimitiveCount, surfacePolicyId: NATURAL_GEOLOGY_SURFACE_POLICY.id, hydratedInstanceTintStrength: NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength },
  });
  if (!prepared.ok) material.dispose?.();
  return prepared;
}

async function hydrateFamily(group, family, url, signal) {
  const placements = proxyPlacementsForFamily(group, family);
  if (!placements.length) return { family, status: 'unused', placementCount: 0 };
  if (hydrationCancelled(group, signal)) return { family, status: 'aborted', placementCount: placements.length };
  const preflight = await preflightAsset(url, signal);
  if (!preflight.load) return { family, status: preflight.reason === 'aborted' ? 'aborted' : 'procedural-fallback', reason: preflight.reason, placementCount: placements.length };
  const model = await new AssetLoader().loadModel(url, { fallbackColor: 0x665f56, fallbackSize: 1 });
  if (hydrationCancelled(group, signal)) {
    AssetLoader.disposeObject3D(model);
    return { family, status: 'aborted', placementCount: placements.length };
  }
  const validation = validateNaturalGeologyAsset(model);
  if (!validation.valid) {
    AssetLoader.disposeObject3D(model);
    return { family, status: 'procedural-fallback', reason: validation.reason, placementCount: placements.length };
  }

  const normalization = createAssetNormalization(validation.measurement);
  const staged = [];
  const placementsByMode = new Map();
  for (const placement of placements) {
    const mode = surfaceModeForPlacement(placement);
    if (!placementsByMode.has(mode)) placementsByMode.set(mode, []);
    placementsByMode.get(mode).push(placement);
  }

  for (let meshIndex = 0; meshIndex < validation.meshes.length; meshIndex += 1) {
    const sourceMesh = validation.meshes[meshIndex];
    for (const [mode, modePlacements] of placementsByMode) {
      if (hydrationCancelled(group, signal)) {
        disposeStagedHydratedBatches(staged);
        AssetLoader.disposeObject3D(model);
        return { family, status: 'aborted', placementCount: placements.length };
      }
      const prepared = prepareHydratedBatch({ family, url, meshIndex, mode, sourceMesh, modePlacements, normalization, sourcePrimitiveCount: validation.meshes.length });
      if (!prepared.ok) {
        disposeStagedHydratedBatches(staged);
        AssetLoader.disposeObject3D(model);
        return { family, status: 'procedural-fallback', reason: `shared-placement:${prepared.error || 'prepare-failed'}`, placementCount: placements.length };
      }
      const audit = auditPreResolvedInstancedWorldAsset(prepared.object);
      if (!audit.ok) {
        staged.push(prepared);
        disposeStagedHydratedBatches(staged);
        AssetLoader.disposeObject3D(model);
        return { family, status: 'procedural-fallback', reason: `shared-placement-audit:${audit.errors.join(',')}`, placementCount: placements.length };
      }
      staged.push(prepared);
    }
    sourceMesh.material.dispose?.();
  }

  if (hydrationCancelled(group, signal)) {
    disposeStagedHydratedBatches(staged);
    AssetLoader.disposeObject3D(model);
    return { family, status: 'aborted', placementCount: placements.length };
  }

  const attached = [];
  for (const prepared of staged) {
    if (hydrationCancelled(group, signal)) {
      removeAttachedBatches(group, attached);
      disposeStagedHydratedBatches(staged);
      AssetLoader.disposeObject3D(model);
      return { family, status: 'aborted', placementCount: placements.length };
    }
    const result = attachPreparedPreResolvedInstancedWorldAsset(group, prepared);
    if (!result.ok) {
      removeAttachedBatches(group, attached);
      disposeStagedHydratedBatches(staged);
      AssetLoader.disposeObject3D(model);
      return { family, status: 'procedural-fallback', reason: `shared-attach:${result.error || 'attach-failed'}`, placementCount: placements.length };
    }
    attached.push(prepared);
  }

  if (hydrationCancelled(group, signal)) {
    removeAttachedBatches(group, attached);
    disposeStagedHydratedBatches(staged);
    AssetLoader.disposeObject3D(model);
    return { family, status: 'aborted', placementCount: placements.length };
  }

  const proxyRemoval = removeProxyFamily(group, family);
  return {
    family,
    status: 'active',
    assetUrl: url,
    placementCount: placements.length,
    primitiveCount: staged.length,
    surfaceModes: Object.freeze([...placementsByMode.keys()]),
    hostedContentLength: preflight.contentLength,
    sharedPlacementPolicyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
    preparedBatchCount: staged.length,
    manifestCount: staged.filter((prepared) => prepared.manifest).length,
    removedProxyMeshCount: proxyRemoval.removedMeshCount,
    removedProxyInstanceCount: proxyRemoval.removedInstanceCount,
    hydratedInstanceTintStrength: NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength,
  };
}

const inFlight = new WeakMap();
export function upgradeNaturalGeologyAssets(group, { signal, isMobileClass = false } = {}) {
  if (!group) return Promise.resolve(Object.freeze({ status: 'missing-group' }));
  if (group.userData?.naturalGeologyDisposed) return Promise.resolve(Object.freeze({ status: 'disposed-group' }));
  if (isMobileClass) return Promise.resolve(Object.freeze({ status: 'procedural-fallback', reason: 'mobile-budget' }));
  if (inFlight.has(group)) return inFlight.get(group);
  const task = (async () => {
    const primary = await hydrateFamily(group, 'rocky-terrain', NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset, signal);
    const southern = hydrationCancelled(group, signal)
      ? { family: 'desert-rocks', status: 'aborted', placementCount: proxyPlacementsForFamily(group, 'desert-rocks').length }
      : await hydrateFamily(group, 'desert-rocks', NATURAL_GEOLOGY_RENDER_POLICY.southernRockAsset, signal);
    const families = [primary, southern];
    const active = families.filter((entry) => entry.status === 'active');
    if (!group.userData?.naturalGeologyDisposed) {
      group.userData.naturalGeology = Object.freeze({ ...group.userData.naturalGeology, assetState: active.length ? 'active' : 'procedural-fallback', hydratedFamilies: Object.freeze(families) });
    }
    return Object.freeze({
      status: group.userData?.naturalGeologyDisposed ? 'disposed-group' : active.length ? 'active' : hydrationCancelled(group, signal) ? 'aborted' : 'procedural-fallback',
      activeFamilyCount: active.length,
      hydratedPlacementCount: active.reduce((sum, entry) => sum + entry.placementCount, 0),
      families: Object.freeze(families),
    });
  })().finally(() => inFlight.delete(group));
  inFlight.set(group, task);
  return task;
}

export function disposeNaturalGeology(group) {
  if (!group || group.userData?.naturalGeologyDisposed) return;
  group.userData.naturalGeologyDisposed = true;
  const pagehideDisposer = group.userData?.naturalGeologyPagehideDispose;
  if (pagehideDisposer && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('pagehide', pagehideDisposer);
  }
  delete group.userData.naturalGeologyPagehideDispose;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  group.traverse((node) => {
    if (node.geometry && !geometries.has(node.geometry)) {
      geometries.add(node.geometry);
      node.geometry.dispose?.();
    }
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      if (materials.has(material)) continue;
      materials.add(material);
      disposeMaterialResources(material, textures);
    }
  });
  group.clear();
}
