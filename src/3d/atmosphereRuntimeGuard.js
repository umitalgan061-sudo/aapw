/**
 * Runtime-facing atmosphere guard for the shipped camera-relative sky/fog path.
 *
 * This module does not own the sky mesh, lighting loop or weather state. It converts
 * caller-provided day/night and exposure inputs into bounded render guidance and rejects
 * black-background regressions before scene attachment. No geography or terrain authority is
 * touched.
 * @module atmosphereRuntimeGuard
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export const ATMOSPHERE_RUNTIME_POLICY = Object.freeze({
  id: 'camera-relative-atmosphere-runtime-guard-2026-09-08-v1',
  cameraRelative: true,
  renderOnly: true,
  blackBackgroundFallback: false,
  canonicalGeographyMutation: false,
  output: 'bounded-sky-fog-exposure-guidance',
});

export function resolveAtmosphereRuntimeGuidance(input = {}) {
  const nightFactor = clamp01(Number(input.nightFactor));
  const exposure = clamp(Number(input.exposure), -2.0, 2.0, 0.0);
  const fogDensity = clamp(Number(input.fogDensity), 0.00001, 0.02, 0.0012);
  const fogNear = clamp(Number(input.fogNear), 1, 20000, 120);
  const fogFar = clamp(Number(input.fogFar), fogNear + 1, 50000, Math.max(fogNear + 1, 8000));
  const horizonLuma = clamp(Number(input.horizonLuma), 0.04, 1.0, nightFactor > 0.86 ? 0.12 : 0.34);
  const zenithLuma = clamp(Number(input.zenithLuma), 0.025, 1.0, nightFactor > 0.86 ? 0.09 : 0.28);
  const fallbackActive = horizonLuma <= 0.045 || zenithLuma <= 0.03;
  const atmosphericContrast = clamp01(Math.abs(zenithLuma - horizonLuma) * 1.6);
  const distantPerspective = clamp01((fogFar - fogNear) / Math.max(1, fogFar));

  return Object.freeze({
    accepted: !fallbackActive,
    fallbackActive,
    nightFactor,
    exposure,
    fogDensity,
    fogNear,
    fogFar,
    horizonLuma,
    zenithLuma,
    atmosphericContrast,
    distantPerspective,
    policyId: ATMOSPHERE_RUNTIME_POLICY.id,
    provenance: Object.freeze({
      source: 'camera-relative-lighting-inputs',
      ownsTerrainHeight: false,
      ownsHydrology: false,
      ownsWeatherState: false,
    }),
  });
}

export function applyAtmosphereRuntimeGuidance(target = {}, guidance = {}) {
  if (!target || typeof target !== 'object') return Object.freeze({ applied: false, reason: 'invalid-target' });
  if (!guidance || typeof guidance !== 'object' || guidance.accepted !== true) {
    return Object.freeze({ applied: false, reason: 'rejected-guidance' });
  }
  target.userData = target.userData && typeof target.userData === 'object' ? target.userData : {};
  target.userData.atmosphereRuntimeGuard = {
    policyId: guidance.policyId,
    horizonLuma: guidance.horizonLuma,
    zenithLuma: guidance.zenithLuma,
    fogNear: guidance.fogNear,
    fogFar: guidance.fogFar,
    fogDensity: guidance.fogDensity,
    exposure: guidance.exposure,
    cameraRelative: ATMOSPHERE_RUNTIME_POLICY.cameraRelative,
  };
  return Object.freeze({ applied: true, policyId: guidance.policyId });
}
