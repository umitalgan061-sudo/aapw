/**
 * Distance fog, tied to the day/night cycle (`lighting.js`) rather than a fixed look: color always
 * matches the current sky horizon color (so fogged-out terrain blends into the sky instead of
 * fading to a mismatched flat color), and density rises toward night (reduced-visibility haze) —
 * see DECISIONS.md ADR-0007 for why this reuses `lighting.js`'s output instead of a second,
 * independently-tuned keyframe table.
 *
 * Applies automatically to any built-in Three.js material (`MeshStandardMaterial`, etc. — e.g.
 * `world/terrain.js`'s ground) via `scene.fog`, three.js's own mechanism. Custom `ShaderMaterial`s
 * (`sky.js`, `world/water.js`) do **not** fog unless they explicitly include the `fog_*` GLSL
 * chunks — `sky.js` deliberately opts out (`fog: false`, it's a backdrop, must never fog into
 * itself); `world/water.js` doesn't opt in yet (see 3D_GAME_PROGRESS.md Known Issues) — flagged
 * there as follow-up work, not silently assumed done here.
 * @module fog
 */

import * as THREE from 'three';

/** Exponential-squared falloff (`THREE.FogExp2`) reads more natural than linear fog at this world's
 * scale. Tuned (via a headless-Chromium screenshot check, not just the formula) so nearby terrain
 * (≤500m) stays essentially clear, mid-range (~1000m) reads as a light haze, and only the far edge
 * of the view (near `WORLD_DEFAULTS.FAR_PLANE`, 2000m) gets meaningfully thick — fog should read as
 * atmosphere, not a wall a few hundred meters from the camera. */
const FOG_DENSITY_DAY = 0.0004;
/** ~1.4x denser at night — a plausible reduced-visibility haze, not physically derived. */
const FOG_DENSITY_NIGHT = 0.00055;

/**
 * Creates the scene fog. Caller assigns it to `scene.fog` and calls `updateFog` every frame
 * afterward — the color/density below are placeholders, immediately overwritten on first update.
 * @returns {THREE.FogExp2}
 */
export function createFog() {
	return new THREE.FogExp2(0x000000, FOG_DENSITY_DAY);
}

/**
 * Syncs fog color/density to the current day/night state. Call once per frame, after
 * `lighting.js`'s `updateDayNightLighting`.
 * @param {THREE.FogExp2} fog
 * @param {{horizonColor: THREE.Color, nightFactor: number}} dayNight - `lighting.js`'s per-frame output.
 */
export function updateFog(fog, dayNight) {
	fog.color.copy(dayNight.horizonColor);
	fog.density = FOG_DENSITY_DAY + (FOG_DENSITY_NIGHT - FOG_DENSITY_DAY) * dayNight.nightFactor;
}
