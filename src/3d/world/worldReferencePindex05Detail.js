/** Deterministic micro-detail layer for canonical owner-map Pindex-05 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX05_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex05-detail-2026-08-26-v2-natural-soil-fabric',
  pindex: 5,
  amplitudeBySurface: Object.freeze({ sea: 0.008, lake: 0.008, soil: 0.043, rock: 0.043, snow: 0.02 }),
  naturalSoilFabric: true,
  pindexStartX: 0.4,
  pindexEndX: 0.5,
  edgeFeatherFraction: 0.14,
  macroCyclesX: 7.5,
  macroCyclesY: 5.25,
  mesoCyclesX: 28,
  mesoCyclesY: 23,
  fineCyclesX: 92,
  fineCyclesY: 78,
  moistureStrength: 0.18,
  mineralDryStrength: 0.13,
  luminanceStrength: 0.075,
  wetSoilColor: 0x5f7247,
  dryHeathColor: 0x8a7b50,
});

const WET_SOIL = new THREE.Color(PINDEX05_DETAIL_POLICY.wetSoilColor);
const DRY_HEATH = new THREE.Color(PINDEX05_DETAIL_POLICY.dryHeathColor);
const scratch = new THREE.Color();

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash01(ix, iy) {
  const value = Math.sin(ix * 127.1 + iy * 311.7 + 74.913) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash01(x0, y0);
  const n10 = hash01(x0 + 1, y0);
  const n01 = hash01(x0, y0 + 1);
  const n11 = hash01(x0 + 1, y0 + 1);
  const nx0 = THREE.MathUtils.lerp(n00, n10, sx);
  const nx1 = THREE.MathUtils.lerp(n01, n11, sx);
  return THREE.MathUtils.lerp(nx0, nx1, sy) * 2 - 1;
}

export function resolvePindex05NaturalSoilSignals(normalizedX, normalizedY) {
  const P = PINDEX05_DETAIL_POLICY;
  const localX = clamp01((normalizedX - P.pindexStartX) / (P.pindexEndX - P.pindexStartX));
  const edgeMask = smoothstep(0, P.edgeFeatherFraction, localX)
    * smoothstep(0, P.edgeFeatherFraction, 1 - localX);
  const warpX = valueNoise(normalizedX * 11.3 + 17.2, normalizedY * 9.7 - 8.4) * 0.035;
  const warpY = valueNoise(normalizedX * 8.9 - 3.1, normalizedY * 12.1 + 6.7) * 0.035;
  const x = normalizedX + warpX;
  const y = normalizedY + warpY;
  const macro = valueNoise(x * P.macroCyclesX, y * P.macroCyclesY);
  const meso = valueNoise(x * P.mesoCyclesX + 13.7, y * P.mesoCyclesY - 5.9);
  const fine = valueNoise(x * P.fineCyclesX - 21.4, y * P.fineCyclesY + 18.8);
  const moisture = clamp01(0.5 + macro * 0.39 + meso * 0.17 - fine * 0.04);
  const mineralDry = clamp01(0.5 - macro * 0.30 + meso * 0.24 + fine * 0.10);
  const luminance = THREE.MathUtils.clamp(macro * 0.50 + meso * 0.34 + fine * 0.16, -1, 1);
  return { edgeMask, moisture, mineralDry, luminance };
}

function classificationForWorld(worldX, worldZ) {
  const mapPoint = plannedWorldXZToMapCanvas(worldX, worldZ);
  const normalized = mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
  return {
    surface: classifyReferenceBaseSurface(normalized.x, normalized.y),
    pindex: referencePindexFromNormalizedX(normalized.x),
    normalizedX: normalized.x,
    normalizedY: normalized.y,
  };
}

export function applyPindex05DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  let naturalSoilVertices = 0;
  let naturalSoilEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX05_DETAIL_POLICY.pindex) continue;
    const amplitude = PINDEX05_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0;
    const legacyNoise = valueNoise(c.normalizedX * 1024, c.normalizedY * 1024) * amplitude;
    const shade = THREE.MathUtils.clamp(1 + legacyNoise, 0.85, 1.15);
    scratch.setRGB(
      THREE.MathUtils.clamp(color.getX(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getY(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getZ(index) * shade, 0, 1),
    );
    if (c.surface === 'soil') {
      const signal = resolvePindex05NaturalSoilSignals(c.normalizedX, c.normalizedY);
      const wetWeight = signal.edgeMask * signal.moisture * PINDEX05_DETAIL_POLICY.moistureStrength;
      const dryWeight = signal.edgeMask * signal.mineralDry * PINDEX05_DETAIL_POLICY.mineralDryStrength;
      scratch.lerp(WET_SOIL, wetWeight);
      scratch.lerp(DRY_HEATH, dryWeight);
      const tonal = 1 + signal.edgeMask * signal.luminance * PINDEX05_DETAIL_POLICY.luminanceStrength;
      scratch.multiplyScalar(tonal);
      naturalSoilVertices += signal.edgeMask > 0.01 ? 1 : 0;
      naturalSoilEnergy += signal.edgeMask * (Math.abs(signal.luminance) + wetWeight + dryWeight);
    }
    color.setXYZ(index, clamp01(scratch.r), clamp01(scratch.g), clamp01(scratch.b));
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX05_DETAIL_POLICY.id,
    pindex: 5,
    touchedVertices,
    naturalSoilVertices,
    naturalSoilEnergy,
  });
  mesh.userData.run292Pindex05Detail = summary;
  return summary;
}

export function applyPindex05DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let naturalSoilVertices = 0;
  let naturalSoilEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex05DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    naturalSoilVertices += summary.naturalSoilVertices;
    naturalSoilEnergy += summary.naturalSoilEnergy;
  }
  const summary = Object.freeze({
    policyId: PINDEX05_DETAIL_POLICY.id,
    pindex: 5,
    touchedVertices,
    naturalSoilVertices,
    naturalSoilEnergy,
    meshCount: terrainGroup.children.length,
  });
  terrainGroup.userData.run292Pindex05Detail = summary;
  return summary;
}
