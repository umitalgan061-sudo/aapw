/** Production TypeScript owner for the shipped createScene visual baseline. */
import * as THREE from 'three';

/**
 * Render-only P0/P5 guardrails for the shipped scene bootstrap.
 * These values intentionally avoid black-background, black-fog and over-dense veil failure states
 * while leaving terrain, water, collider, material and placement authorities untouched.
 */
export const PHOTOREALISM_SCENE_TUNING = Object.freeze({
  skyBackgroundHex: 0x17263a,
  fogFallbackHex: 0x6f7f8d,
  minimumSkyLuminance: 0.035,
  minimumFogDensity: 0.0001,
  maximumFogDensity: 0.0012,
  maximumWaterSaturation: 0.72,
});

function luminance(color: THREE.Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function cloneOrFallbackBackground(background: THREE.Scene['background']): THREE.Color {
  if (background instanceof THREE.Color) return background.clone();
  return new THREE.Color(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
}

function isFogWithColor(fog: THREE.Scene['fog']): fog is THREE.Fog | THREE.FogExp2 {
  return Boolean(fog && fog.color instanceof THREE.Color);
}

function sanitizeFogDensity(fog: THREE.Fog | THREE.FogExp2): boolean {
  if (!(fog instanceof THREE.FogExp2)) return false;
  const density = Number.isFinite(fog.density)
    ? fog.density
    : PHOTOREALISM_SCENE_TUNING.minimumFogDensity;
  const sanitized = THREE.MathUtils.clamp(
    density,
    PHOTOREALISM_SCENE_TUNING.minimumFogDensity,
    PHOTOREALISM_SCENE_TUNING.maximumFogDensity,
  );
  const changed = sanitized !== fog.density;
  fog.density = sanitized;
  return changed || sanitized === PHOTOREALISM_SCENE_TUNING.minimumFogDensity || sanitized === PHOTOREALISM_SCENE_TUNING.maximumFogDensity;
}

/**
 * Applies only the render-owned scene backdrop guardrails. This is deliberately idempotent and
 * does not mutate any terrain, water mesh, collider, material recipe or placement manifest.
 *
 * The background and fog colors are cloned before tuning so shared Color instances owned by another
 * renderer or scene cannot be mutated as a side effect of this compatibility boundary. Initial fog
 * density is clamped only for the FogExp2 bootstrap object; the authoritative day/night fog updater
 * remains responsible for per-frame atmospheric evolution after scene creation.
 */
export function applyPhotorealismSceneTuning(scene: THREE.Scene): Readonly<{
  backgroundHex: number;
  fogFallbackApplied: boolean;
  fogDensitySanitized: boolean;
  backgroundLuminance: number;
}> {
  const background = cloneOrFallbackBackground(scene.background);
  if (luminance(background) < PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance) {
    background.setHex(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
  }
  scene.background = background;

  let fogFallbackApplied = false;
  let fogDensitySanitized = false;
  if (isFogWithColor(scene.fog)) {
    const fogColor = scene.fog.color.clone();
    const fogFallbackColor = new THREE.Color(PHOTOREALISM_SCENE_TUNING.fogFallbackHex);
    const lowLuminance = luminance(fogColor) < PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance;
    if (lowLuminance) fogColor.copy(fogFallbackColor);
    scene.fog.color = fogColor;
    fogFallbackApplied = lowLuminance || fogColor.getHex() === PHOTOREALISM_SCENE_TUNING.fogFallbackHex;
    fogDensitySanitized = sanitizeFogDensity(scene.fog);
  }

  return Object.freeze({
    backgroundHex: background.getHex(),
    fogFallbackApplied,
    fogDensitySanitized,
    backgroundLuminance: luminance(background),
  });
}
