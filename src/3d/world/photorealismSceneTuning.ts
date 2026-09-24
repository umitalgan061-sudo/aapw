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

/**
 * Applies only the render-owned scene backdrop guardrails. This is deliberately idempotent and
 * does not mutate any terrain, water mesh, collider, material recipe or placement manifest.
 */
export function applyPhotorealismSceneTuning(scene: THREE.Scene): Readonly<{
  backgroundHex: number;
  fogFallbackApplied: boolean;
  backgroundLuminance: number;
}> {
  const background = scene.background instanceof THREE.Color
    ? scene.background
    : new THREE.Color(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
  if (luminance(background) < PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance) {
    background.setHex(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
  }
  scene.background = background;

  let fogFallbackApplied = false;
  if (scene.fog && 'color' in scene.fog) {
    const fogColor = scene.fog.color;
    if (luminance(fogColor) < PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance) {
      fogColor.setHex(PHOTOREALISM_SCENE_TUNING.fogFallbackHex);
      fogFallbackApplied = true;
    }
  }

  return Object.freeze({
    backgroundHex: background.getHex(),
    fogFallbackApplied,
    backgroundLuminance: luminance(background),
  });
}
