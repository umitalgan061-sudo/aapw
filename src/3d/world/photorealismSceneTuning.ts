/** Production TypeScript owner for the shipped createScene visual baseline. */
import * as THREE from 'three';

/**
 * Render-only P0/P5 guardrails for the shipped scene bootstrap.
 * These values intentionally avoid black-background and saturated-cyan failure states while
 * leaving terrain, water, collider, material and placement authorities untouched.
 */
export const PHOTOREALISM_SCENE_TUNING = Object.freeze({
  skyBackgroundHex: 0x17263a,
  fogFallbackHex: 0x6f7f8d,
  minimumSkyLuminance: 0.035,
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

/**
 * Applies only the render-owned scene backdrop guardrails. This is deliberately idempotent and
 * does not mutate any terrain, water mesh, collider, material recipe or placement manifest.
 *
 * The background is cloned before tuning so a shared Color instance owned by another renderer
 * or scene cannot be mutated as a side effect of this compatibility boundary.
 */
export function applyPhotorealismSceneTuning(scene: THREE.Scene): Readonly<{
  backgroundHex: number;
  fogFallbackApplied: boolean;
  backgroundLuminance: number;
}> {
  const background = cloneOrFallbackBackground(scene.background);
  if (luminance(background) < PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance) {
    background.setHex(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
  }
  scene.background = background;

  let fogFallbackApplied = false;
  if (isFogWithColor(scene.fog)) {
    const fogColor = scene.fog.color.clone();
    if (luminance(fogColor) < PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance) {
      fogColor.setHex(PHOTOREALISM_SCENE_TUNING.fogFallbackHex);
      fogFallbackApplied = true;
    }
    scene.fog.color.copy(fogColor);
  }

  return Object.freeze({
    backgroundHex: background.getHex(),
    fogFallbackApplied,
    backgroundLuminance: luminance(background),
  });
}
