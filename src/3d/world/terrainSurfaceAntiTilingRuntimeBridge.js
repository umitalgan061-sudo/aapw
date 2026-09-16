/**
 * Runtime-facing bridge for the deterministic terrain anti-tiling contract.
 *
 * The bridge deliberately mutates only caller-owned material uniforms/metadata. It does not
 * author terrain geometry, height, hydrology, coastline, roads, settlements, colliders or assets.
 * A shipped terrain material path can call this bridge once per visible terrain material instance.
 */
import {
  TERRAIN_SURFACE_ANTI_TILING_MANIFEST,
  buildTerrainSurfaceMaterialInputs,
  validateTerrainSurfaceAntiTilingResponse,
} from './terrainSurfaceAntiTiling.js';

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));

export const TERRAIN_SURFACE_RUNTIME_BRIDGE_MANIFEST = Object.freeze({
  id: 'terrain-surface-anti-tiling-runtime-bridge-2026-09-08-v1',
  sourcePolicy: TERRAIN_SURFACE_ANTI_TILING_MANIFEST.policyId,
  mutationScope: Object.freeze(['uniforms', 'userData.terrainSurfaceAudit']),
  forbiddenScope: Object.freeze(['geometry', 'position', 'height', 'hydrology', 'collider', 'assetPath']),
});

function setUniform(uniforms, key, value) {
  if (!uniforms || typeof uniforms !== 'object') return;
  if (!uniforms[key] || typeof uniforms[key] !== 'object') uniforms[key] = { value };
  else uniforms[key].value = value;
}

export function applyTerrainSurfaceAntiTilingRuntimeBridge(material, worldX, worldZ, context = {}) {
  const safeMaterial = material && typeof material === 'object' ? material : {};
  const inputs = buildTerrainSurfaceMaterialInputs(worldX, worldZ, context);
  const response = {
    ...inputs,
    worldX: finite(worldX),
    worldZ: finite(worldZ),
    policyId: TERRAIN_SURFACE_ANTI_TILING_MANIFEST.policyId,
    canonicalContextPreserved: true,
  };
  const validation = validateTerrainSurfaceAntiTilingResponse({
    antiTile: clamp01(inputs.macroSignal * 0.5 + inputs.mesoSignal * 0.35 + inputs.microSignal * 0.15 + 0.5),
    farFade: 1,
    colorGain: inputs.colorGain,
    roughnessGain: inputs.roughnessGain,
    normalGain: inputs.normalGain,
    soilWeight: inputs.soilWeight,
    rockWeight: inputs.rockWeight,
    snowWeight: inputs.snowWeight,
    wetWeight: inputs.wetWeight,
    worldSpace: true,
    canonicalContextPreserved: true,
  });
  if (!validation.ok) return Object.freeze({ applied: false, response, validation });

  safeMaterial.userData = safeMaterial.userData && typeof safeMaterial.userData === 'object' ? safeMaterial.userData : {};
  safeMaterial.userData.terrainSurfaceAudit = Object.freeze({
    bridgeId: TERRAIN_SURFACE_RUNTIME_BRIDGE_MANIFEST.id,
    policyId: response.policyId,
    worldX: response.worldX,
    worldZ: response.worldZ,
    canonicalContextPreserved: true,
  });
  setUniform(safeMaterial.uniforms, 'uTerrainColorGain', response.colorGain);
  setUniform(safeMaterial.uniforms, 'uTerrainRoughnessGain', response.roughnessGain);
  setUniform(safeMaterial.uniforms, 'uTerrainNormalGain', response.normalGain);
  setUniform(safeMaterial.uniforms, 'uTerrainSoilWeight', response.soilWeight);
  setUniform(safeMaterial.uniforms, 'uTerrainRockWeight', response.rockWeight);
  setUniform(safeMaterial.uniforms, 'uTerrainSnowWeight', response.snowWeight);
  setUniform(safeMaterial.uniforms, 'uTerrainWetWeight', response.wetWeight);
  return Object.freeze({ applied: true, response, validation });
}

export function validateTerrainSurfaceAntiTilingRuntimeBridgeResult(result) {
  const errors = [];
  if (result?.applied !== true) errors.push('bridge-not-applied');
  if (result?.response?.canonicalContextPreserved !== true) errors.push('canonical-context-not-preserved');
  if (result?.validation?.ok !== true) errors.push(...(result?.validation?.errors || ['validation-failed']));
  return Object.freeze({ ok: errors.length === 0, errors });
}
