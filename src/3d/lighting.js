/**
 * Day/night cycle: owns the scene's sun (`DirectionalLight`) and sky-fill (`HemisphereLight`),
 * animating their direction/color/intensity from a real-time-driven time-of-day ratio. Also
 * exposes the horizon/zenith sky colors and a night factor that `sky.js` blends in, so the aurora
 * skybox and the sun stay visually consistent instead of two independently-tuned systems drifting
 * apart (see 3D_GAME_PROGRESS.md Known Issues, "always-on aurora", and DECISIONS.md ADR-0006).
 *
 * No GPU resources of its own to dispose (lights are cheap scene-graph nodes, no geometry/texture,
 * no shadow maps yet — see ARCHITECTURE.md) — `disposeDayNightLighting()` just removes the lights
 * from the scene, for symmetry with every other system's create/update/dispose triplet.
 * @module lighting
 */

import * as THREE from 'three';

/**
 * Ordered day/night keyframes, each at a `ratio` in [0, 1) of a full day (0 = midnight, 0.5 =
 * noon). `updateDayNightLighting` finds the two keyframes surrounding the current time and lerps
 * every field between them — adding a new keyframe (e.g. a distinct "storm" preset later) means
 * inserting one entry here, nothing else.
 */
const KEYFRAMES = [
	{ ratio: 0.0, sunColor: 0x233a66, sunIntensity: 0.05, hemiSky: 0x0a1230, hemiGround: 0x05070f, hemiIntensity: 0.25, nightFactor: 1.0 },
	{ ratio: 0.22, sunColor: 0x233a66, sunIntensity: 0.05, hemiSky: 0x0a1230, hemiGround: 0x05070f, hemiIntensity: 0.25, nightFactor: 1.0 },
	{ ratio: 0.27, sunColor: 0xffb366, sunIntensity: 0.9, hemiSky: 0x7d5a4a, hemiGround: 0x2a1c12, hemiIntensity: 0.6, nightFactor: 0.35 },
	{ ratio: 0.5, sunColor: 0xfff2d8, sunIntensity: 1.4, hemiSky: 0xffe8c0, hemiGround: 0x1a140a, hemiIntensity: 1.1, nightFactor: 0.0 },
	{ ratio: 0.73, sunColor: 0xff8c52, sunIntensity: 0.85, hemiSky: 0x8a4a3a, hemiGround: 0x261408, hemiIntensity: 0.55, nightFactor: 0.35 },
	{ ratio: 0.78, sunColor: 0x233a66, sunIntensity: 0.05, hemiSky: 0x0a1230, hemiGround: 0x05070f, hemiIntensity: 0.25, nightFactor: 1.0 },
	{ ratio: 1.0, sunColor: 0x233a66, sunIntensity: 0.05, hemiSky: 0x0a1230, hemiGround: 0x05070f, hemiIntensity: 0.25, nightFactor: 1.0 },
];

/** Sky-sphere horizon/zenith gradient endpoints, keyed by the same night factor the keyframes carry. */
const SKY_DAY = { horizon: new THREE.Color(0x9fd0ee), zenith: new THREE.Color(0x1c4f8f) };
const SKY_NIGHT = { horizon: new THREE.Color(0xd98a52), zenith: new THREE.Color(0x0b1633) };

/** Radius, in meters, of the sun's circular path around the origin — only its direction matters (it's a DirectionalLight), the radius just keeps it a sane finite position for debugging/gizmos. */
const SUN_ORBIT_RADIUS_METERS = 500;

// Owner readability requirement (2026-08-10): gameplay may still become night, but never a near-black
// silhouette scene. This cool fill is intentionally a child of the existing hemisphere light so the
// public `{ sun, hemisphere }` contract and existing dispose path remain unchanged/additive-only.
const NIGHT_READABILITY_LIGHT_NAME = 'Game Night Readability Fill';
const NIGHT_READABILITY_DAY_INTENSITY = 0.08;
const NIGHT_READABILITY_NIGHT_INTENSITY = 1.05;

/**
 * Finds the two keyframes surrounding `ratio` and the local 0-1 blend between them.
 * @param {number} ratio
 * @returns {{a: KEYFRAMES[number], b: KEYFRAMES[number], t: number}}
 */
function findKeyframeSegment(ratio) {
	for (let i = 0; i < KEYFRAMES.length - 1; i++) {
		const a = KEYFRAMES[i];
		const b = KEYFRAMES[i + 1];
		if (ratio >= a.ratio && ratio <= b.ratio) {
			const span = b.ratio - a.ratio;
			const t = span > 0 ? (ratio - a.ratio) / span : 0;
			return { a, b, t };
		}
	}
	// Unreachable given KEYFRAMES spans [0, 1] inclusive, but keeps the function total.
	return { a: KEYFRAMES[0], b: KEYFRAMES[0], t: 0 };
}

const scratchColorA = new THREE.Color();
const scratchColorB = new THREE.Color();

/**
 * Creates the sun/hemisphere lights and adds them to `scene`. Call `updateDayNightLighting` once
 * per frame afterward to actually animate them — they start at whatever `t=0` keyframe blend
 * `elapsedSeconds=0` (plus `WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO`) produces on the first update.
 * @param {THREE.Scene} scene
 * @returns {{sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}}
 */
export function createDayNightLighting(scene) {
	const sun = new THREE.DirectionalLight(0xffffff, 1);
	const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
	scene.add(sun);
	scene.add(hemisphere);
	const readability = new THREE.HemisphereLight(0xaed9ff, 0x4e5848, NIGHT_READABILITY_DAY_INTENSITY);
	readability.name = NIGHT_READABILITY_LIGHT_NAME;
	readability.userData.gameNightReadability = true;
	hemisphere.add(readability);
	return { sun, hemisphere };
}

/**
 * Advances the day/night cycle and applies it to the lights created by `createDayNightLighting`.
 * @param {{sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}} lights
 * @param {number} elapsedSeconds - from the same `THREE.Clock` every other per-frame system uses.
 * @param {number} dayLengthSeconds - real seconds for one full day/night cycle (`WORLD_DEFAULTS.DAY_LENGTH_SECONDS`).
 * @param {number} startRatio - initial offset in [0, 1) so a session doesn't always boot at midnight (`WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO`).
 * @returns {{timeRatio: number, nightFactor: number, horizonColor: THREE.Color, zenithColor: THREE.Color}}
 *   Consumed by `sky.js`'s `updateAuroraSky` so the skybox and sun stay in sync.
 */
export function updateDayNightLighting(lights, elapsedSeconds, dayLengthSeconds, startRatio) {
	const timeRatio = ((elapsedSeconds / dayLengthSeconds + startRatio) % 1 + 1) % 1;
	const { a, b, t } = findKeyframeSegment(timeRatio);

	scratchColorA.set(a.sunColor);
	scratchColorB.set(b.sunColor);
	lights.sun.color.copy(scratchColorA).lerp(scratchColorB, t);
	lights.sun.intensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;

	scratchColorA.set(a.hemiSky);
	scratchColorB.set(b.hemiSky);
	lights.hemisphere.color.copy(scratchColorA).lerp(scratchColorB, t);
	scratchColorA.set(a.hemiGround);
	scratchColorB.set(b.hemiGround);
	lights.hemisphere.groundColor.copy(scratchColorA).lerp(scratchColorB, t);
	lights.hemisphere.intensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;

	const nightFactor = a.nightFactor + (b.nightFactor - a.nightFactor) * t;
	const readability = lights.hemisphere.getObjectByName(NIGHT_READABILITY_LIGHT_NAME);
	if (readability?.isHemisphereLight) {
		const smoothNightFactor = nightFactor * nightFactor * (3 - 2 * nightFactor);
		readability.intensity = NIGHT_READABILITY_DAY_INTENSITY +
			(NIGHT_READABILITY_NIGHT_INTENSITY - NIGHT_READABILITY_DAY_INTENSITY) * smoothNightFactor;
	}

	// Sun arcs through a fixed vertical plane: elevation via sine, tracking the same [0,1) ratio
	// (0.25 = sunrise at the horizon, 0.5 = noon overhead, 0.75 = sunset at the horizon).
	const angle = (timeRatio - 0.25) * Math.PI * 2;
	lights.sun.position.set(
		Math.cos(angle) * SUN_ORBIT_RADIUS_METERS,
		Math.sin(angle) * SUN_ORBIT_RADIUS_METERS,
		SUN_ORBIT_RADIUS_METERS * 0.4,
	);

	const horizonColor = SKY_NIGHT.horizon.clone().lerp(SKY_DAY.horizon, 1 - nightFactor);
	const zenithColor = SKY_NIGHT.zenith.clone().lerp(SKY_DAY.zenith, 1 - nightFactor);

	return { timeRatio, nightFactor, horizonColor, zenithColor };
}

/**
 * Removes the day/night lights from the scene. No geometry/texture/shadow-map to free yet (see
 * module doc) — kept as its own function so `game3d.js`'s teardown chain reads uniformly with
 * every other system's `dispose*()` call.
 * @param {THREE.Scene} scene
 * @param {{sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}} lights
 */
export function disposeDayNightLighting(scene, lights) {
	scene.remove(lights.sun);
	scene.remove(lights.hemisphere);
}
