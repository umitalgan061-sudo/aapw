import * as THREE from 'three';
import {
  terrainSurfaceReliefContext,
  terrainSurfaceColorMultiplier,
  terrainSurfaceRoughness,
  terrainSurfaceNormalGain,
  TERRAIN_SURFACE_FABRIC_POLICY,
} from './terrainSurfaceFabric.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function ensureAttribute(geometry, name, itemSize, count) {
  const current = geometry?.getAttribute?.(name);
  if (current && current.itemSize === itemSize && current.count === count) return current;
  const array = new Float32Array(count * itemSize);
  const attribute = new THREE.BufferAttribute(array, itemSize);
  geometry.setAttribute(name, attribute);
  return attribute;
}

function writeColor(attribute, index, multiplier, substrateSignal) {
  const response = clamp01((multiplier - 0.72) / 0.56);
  const cool = clamp01(substrateSignal);
  attribute.setXYZ(index,
    clamp01(0.78 + response * 0.18 - cool * 0.06),
    clamp01(0.78 + response * 0.14 - cool * 0.10),
    clamp01(0.74 + response * 0.10 + cool * 0.08),
  );
}

export function applyTerrainSurfaceFabricToGeometry(geometry, sampleAtVertex, options = {}) {
  if (!geometry || typeof geometry.getAttribute !== 'function' || typeof sampleAtVertex !== 'function') {
    return Object.freeze({ ok: false, error: 'geometry-and-sampler-required' });
  }
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || position.count === 0) {
    return Object.freeze({ ok: false, error: 'position-attribute-required' });
  }

  const colors = ensureAttribute(geometry, 'color', 3, position.count);
  const roughness = ensureAttribute(geometry, 'terrainRoughness', 1, position.count);
  const normalGain = ensureAttribute(geometry, 'terrainNormalGain', 1, position.count);
  let minRoughness = 1;
  let maxRoughness = 0;
  let minNormalGain = 1;
  let maxNormalGain = 0;
  const samples = [];

  for (let index = 0; index < position.count; index += 1) {
    const worldX = finite(position.getX(index));
    const worldZ = finite(position.getZ(index));
    const sample = sampleAtVertex(worldX, worldZ, index) || {};
    const context = terrainSurfaceReliefContext({
      ...sample,
      worldX,
      worldZ,
      heightAboveSeaMeters: finite(sample.heightAboveSeaMeters ?? sample.height ?? 0),
      slopeDegrees: finite(sample.slopeDegrees ?? sample.slope ?? 0),
      concavityMeters: finite(sample.concavityMeters ?? sample.concavity ?? 0),
      rockWeight: clamp01(sample.rockWeight),
      snowWeight: clamp01(sample.snowWeight),
      waterWeight: clamp01(sample.waterWeight),
      moisture: sample.moisture == null ? null : clamp01(sample.moisture),
    });
    const multiplier = terrainSurfaceColorMultiplier(context);
    const rough = terrainSurfaceRoughness(context);
    const normal = terrainSurfaceNormalGain(context);
    writeColor(colors, index, multiplier, context.substrate);
    roughness.setX(index, rough);
    normalGain.setX(index, normal);
    minRoughness = Math.min(minRoughness, rough);
    maxRoughness = Math.max(maxRoughness, rough);
    minNormalGain = Math.min(minNormalGain, normal);
    maxNormalGain = Math.max(maxNormalGain, normal);
    samples.push({ index, worldX, worldZ, substrate: context.substrate, roughness: rough, normalGain: normal });
  }

  colors.needsUpdate = true;
  roughness.needsUpdate = true;
  normalGain.needsUpdate = true;
  geometry.userData ||= {};
  geometry.userData.terrainSurfaceFabric = Object.freeze({
    policyId: TERRAIN_SURFACE_FABRIC_POLICY.id,
    renderOnly: true,
    canonicalGeometryUnchanged: true,
    vertexCount: position.count,
    roughnessRange: Object.freeze([minRoughness, maxRoughness]),
    normalGainRange: Object.freeze([minNormalGain, maxNormalGain]),
    worldSpace: true,
    sampleCount: samples.length,
    source: options.source ?? 'terrain-chunk-runtime',
  });

  return Object.freeze({
    ok: true,
    geometry,
    attributes: Object.freeze({ colors, roughness, normalGain }),
    manifest: geometry.userData.terrainSurfaceFabric,
  });
}

export function validateTerrainSurfaceFabricRuntime(result) {
  const errors = [];
  if (!result?.ok) errors.push(result?.error ?? 'runtime-application-failed');
  const manifest = result?.manifest;
  if (!manifest?.renderOnly) errors.push('render-only-contract-missing');
  if (manifest?.canonicalGeometryUnchanged !== true) errors.push('canonical-geometry-mutation-risk');
  if (!(manifest?.vertexCount > 0)) errors.push('empty-geometry');
  if (!Array.isArray(manifest?.roughnessRange) || manifest.roughnessRange[0] < 0.48 || manifest.roughnessRange[1] > 1) errors.push('roughness-range');
  if (!Array.isArray(manifest?.normalGainRange) || manifest.normalGainRange[0] < 0.02 || manifest.normalGainRange[1] > 0.18) errors.push('normal-gain-range');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
