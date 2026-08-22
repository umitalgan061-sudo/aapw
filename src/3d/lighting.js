/**
 * Physically readable day/night lighting.
 * World cardinal convention: +X = east, -X = west, +Y = up. Sunrise therefore starts on +X,
 * noon is overhead and sunset ends on -X. The moon runs on the opposite half of the same orbit and
 * provides a real cool directional night key instead of relying on ambient fill alone.
 * @module lighting
 */

import * as THREE from 'three';
import { installNightVisualEnhancement, updateNightVisualEnhancement } from './nightVisualEnhancement.js';
import { AssetLoader } from './assetLoader.js';

const KEYFRAMES = [
	{ ratio: 0.0, sunColor: 0x233a66, sunIntensity: 0.0, hemiSky: 0x101b38, hemiGround: 0x080b13, hemiIntensity: 0.28, nightFactor: 1.0 },
	{ ratio: 0.22, sunColor: 0x344b70, sunIntensity: 0.03, hemiSky: 0x142244, hemiGround: 0x0a0d16, hemiIntensity: 0.30, nightFactor: 1.0 },
	{ ratio: 0.27, sunColor: 0xffb366, sunIntensity: 0.9, hemiSky: 0x8b6b59, hemiGround: 0x302117, hemiIntensity: 0.62, nightFactor: 0.35 },
	{ ratio: 0.5, sunColor: 0xfff2d8, sunIntensity: 1.4, hemiSky: 0xb9d8ed, hemiGround: 0x413a2a, hemiIntensity: 1.1, nightFactor: 0.0 },
	{ ratio: 0.73, sunColor: 0xff8c52, sunIntensity: 0.85, hemiSky: 0x9b6655, hemiGround: 0x301b12, hemiIntensity: 0.58, nightFactor: 0.35 },
	{ ratio: 0.78, sunColor: 0x344b70, sunIntensity: 0.03, hemiSky: 0x142244, hemiGround: 0x0a0d16, hemiIntensity: 0.30, nightFactor: 1.0 },
	{ ratio: 1.0, sunColor: 0x233a66, sunIntensity: 0.0, hemiSky: 0x101b38, hemiGround: 0x080b13, hemiIntensity: 0.28, nightFactor: 1.0 },
];

const SKY_DAY = { horizon: new THREE.Color(0xaed7ee), zenith: new THREE.Color(0x2f72ad) };
const SKY_NIGHT = { horizon: new THREE.Color(0x263752), zenith: new THREE.Color(0x071127) };
const SKY_TWILIGHT = { horizon: new THREE.Color(0xe59a6d), zenith: new THREE.Color(0x4d6086) };
const ORBIT_RADIUS_METERS = 900;
const CELESTIAL_VISUAL_SCALE = 18;
const NIGHT_READABILITY_LIGHT_NAME = 'Game Night Readability Fill';
const NIGHT_READABILITY_DAY_INTENSITY = 0.05;
const NIGHT_READABILITY_NIGHT_INTENSITY = 0.36;
const MOON_MAX_INTENSITY = 0.55;
const CELESTIAL_HORIZON_FADE_METERS = 25;
const CELESTIAL_FULL_ALTITUDE_METERS = ORBIT_RADIUS_METERS * 0.22;
const TWILIGHT_FULL_ALTITUDE_METERS = ORBIT_RADIUS_METERS * 0.30;

export const CELESTIAL_ASSET_POLICY = Object.freeze({
	id: 'celestial-asset-policy-2026-08-22-v2',
	moonRepositoryPath: 'assets/models/Ay/Moon 2K.fbx',
	moonAssetUrl: 'assets/models/Ay/Moon%202K.fbx',
	moonTargetDiameterMeters: CELESTIAL_VISUAL_SCALE * 2,
	moonLightingAltitudeModulated: true,
	twilightSkyAltitudeModulated: true,
});

function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * Keeps a directional celestial key from lighting the world at full strength while its visual body
 * is still at or below the horizon. The small negative start avoids a one-frame pop at rise/set.
 */
export function celestialAltitudeWeightFromY(worldY) {
	return smoothstep(-CELESTIAL_HORIZON_FADE_METERS, CELESTIAL_FULL_ALTITUDE_METERS, worldY);
}

function twilightWeightFromSunY(sunY) {
	return 1 - smoothstep(0, TWILIGHT_FULL_ALTITUDE_METERS, Math.abs(sunY));
}

function findKeyframeSegment(ratio) {
	for (let i = 0; i < KEYFRAMES.length - 1; i++) {
		const a = KEYFRAMES[i];
		const b = KEYFRAMES[i + 1];
		if (ratio >= a.ratio && ratio <= b.ratio) {
			const span = b.ratio - a.ratio;
			return { a, b, t: span > 0 ? (ratio - a.ratio) / span : 0 };
		}
	}
	return { a: KEYFRAMES[0], b: KEYFRAMES[0], t: 0 };
}

const scratchColorA = new THREE.Color();
const scratchColorB = new THREE.Color();

function makeCelestialSphere(name, color, scale = CELESTIAL_VISUAL_SCALE) {
	const mesh = new THREE.Mesh(
		new THREE.SphereGeometry(1, 24, 16),
		new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false }),
	);
	mesh.name = name;
	mesh.scale.setScalar(scale);
	mesh.frustumCulled = false;
	mesh.renderOrder = -10;
	return mesh;
}

function fitObjectToDiameter(object, diameter) {
	const box = new THREE.Box3().setFromObject(object);
	const size = new THREE.Vector3();
	box.getSize(size);
	const largest = Math.max(size.x, size.y, size.z);
	if (!(largest > 1e-6)) return false;
	object.scale.multiplyScalar(diameter / largest);
	object.updateMatrixWorld(true);
	box.setFromObject(object);
	const center = box.getCenter(new THREE.Vector3());
	object.position.sub(center);
	object.updateMatrixWorld(true);
	return true;
}

function setMoonAssetStatus(moonAnchor, status, detail = {}) {
	const value = Object.freeze({
		policy: CELESTIAL_ASSET_POLICY.id,
		assetUrl: CELESTIAL_ASSET_POLICY.moonAssetUrl,
		status,
		...detail,
	});
	moonAnchor.userData.celestialAsset = value;
	return value;
}

/** Load the repository moon asset without making world boot wait for it. The procedural sphere stays
 * as a safe fallback if the FBX is unavailable or is only an LFS pointer in the current deployment. */
function installMoonAssetAsync(moonAnchor) {
	const loader = new AssetLoader();
	setMoonAssetStatus(moonAnchor, 'loading');
	return loader.loadFBXModel(CELESTIAL_ASSET_POLICY.moonAssetUrl, { fallbackColor: 0xdbe8ff, fallbackSize: 2 }).then((model) => {
		if (!moonAnchor.parent) return setMoonAssetStatus(moonAnchor, 'detached');
		if (model.userData?.isPlaceholder) return setMoonAssetStatus(moonAnchor, 'fallback-placeholder');
		if (!fitObjectToDiameter(model, CELESTIAL_ASSET_POLICY.moonTargetDiameterMeters)) {
			return setMoonAssetStatus(moonAnchor, 'fallback-empty-model');
		}
		let meshCount = 0;
		model.traverse((node) => {
			if (!node.isMesh) return;
			meshCount += 1;
			node.castShadow = false;
			node.receiveShadow = false;
		});
		if (meshCount === 0) return setMoonAssetStatus(moonAnchor, 'fallback-empty-model');
		moonAnchor.clear();
		moonAnchor.add(model);
		return setMoonAssetStatus(moonAnchor, 'active', { meshCount });
	}).catch((error) => setMoonAssetStatus(moonAnchor, 'fallback-error', {
		error: error instanceof Error ? error.message : String(error),
	}));
}

export function createDayNightLighting(scene) {
	const sun = new THREE.DirectionalLight(0xffffff, 1);
	sun.name = 'Sun Directional Light';
	const moon = new THREE.DirectionalLight(0xc8dcff, 0);
	moon.name = 'Moon Directional Light';
	moon.userData.altitudeModulated = true;
	const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1);

	const sunVisual = new THREE.Group();
	sunVisual.name = 'Sun Visual';
	sunVisual.add(makeCelestialSphere('Sun Disc', 0xffe2a1));
	const moonVisual = new THREE.Group();
	moonVisual.name = 'Moon Visual';
	moonVisual.add(makeCelestialSphere('Moon Fallback Disc', 0xdbe8ff, CELESTIAL_VISUAL_SCALE * 0.72));

	scene.add(sun, moon, hemisphere, sunVisual, moonVisual);
	const readability = new THREE.HemisphereLight(0xaed9ff, 0x465366, NIGHT_READABILITY_DAY_INTENSITY);
	readability.name = NIGHT_READABILITY_LIGHT_NAME;
	readability.userData.gameNightReadability = true;
	hemisphere.add(readability);
	installNightVisualEnhancement(hemisphere);
	const moonAssetReady = installMoonAssetAsync(moonVisual);
	return { sun, moon, hemisphere, sunVisual, moonVisual, moonAssetReady };
}

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
	const smoothNightFactor = nightFactor * nightFactor * (3 - 2 * nightFactor);
	const readability = lights.hemisphere.getObjectByName(NIGHT_READABILITY_LIGHT_NAME);
	if (readability?.isHemisphereLight) {
		readability.intensity = NIGHT_READABILITY_DAY_INTENSITY +
			(NIGHT_READABILITY_NIGHT_INTENSITY - NIGHT_READABILITY_DAY_INTENSITY) * smoothNightFactor;
	}
	updateNightVisualEnhancement(lights.hemisphere, nightFactor);

	// 06:00 => east (+X) horizon, 12:00 => zenith, 18:00 => west (-X) horizon.
	const angle = (timeRatio - 0.25) * Math.PI * 2;
	const sunX = Math.cos(angle) * ORBIT_RADIUS_METERS;
	const sunY = Math.sin(angle) * ORBIT_RADIUS_METERS;
	const sunZ = Math.sin(angle * 0.35) * ORBIT_RADIUS_METERS * 0.12;
	lights.sun.position.set(sunX, sunY, sunZ);
	if (lights.sunVisual) lights.sunVisual.position.copy(lights.sun.position);

	// Moon is 180 degrees opposite the sun. Its illumination now follows its actual altitude as well as
	// darkness, so a moon below the horizon cannot cast a physically impossible full-strength key.
	const moonY = -sunY;
	const moonAltitudeFactor = celestialAltitudeWeightFromY(moonY);
	if (lights.moon) {
		lights.moon.position.set(-sunX, moonY, -sunZ);
		lights.moon.intensity = MOON_MAX_INTENSITY * smoothNightFactor * moonAltitudeFactor;
		lights.moon.userData.altitudeFactor = moonAltitudeFactor;
	}
	if (lights.moonVisual) {
		lights.moonVisual.position.set(-sunX, moonY, -sunZ);
		lights.moonVisual.visible = moonY > -CELESTIAL_HORIZON_FADE_METERS && smoothNightFactor > 0.08;
	}
	if (lights.sunVisual) lights.sunVisual.visible = sunY > -CELESTIAL_HORIZON_FADE_METERS;

	// Twilight is tied to solar altitude rather than clock keyframes alone. This keeps noon blue and
	// midnight dark while giving both sunrise and sunset a narrow warm horizon band.
	const twilightFactor = twilightWeightFromSunY(sunY);
	const daylightFactor = 1 - smoothNightFactor;
	const horizonColor = SKY_NIGHT.horizon.clone().lerp(SKY_DAY.horizon, daylightFactor)
		.lerp(SKY_TWILIGHT.horizon, twilightFactor * 0.68);
	const zenithColor = SKY_NIGHT.zenith.clone().lerp(SKY_DAY.zenith, daylightFactor)
		.lerp(SKY_TWILIGHT.zenith, twilightFactor * 0.24);
	return { timeRatio, nightFactor, twilightFactor, moonAltitudeFactor, horizonColor, zenithColor };
}

export function disposeDayNightLighting(scene, lights) {
	for (const node of [lights.sun, lights.moon, lights.hemisphere, lights.sunVisual, lights.moonVisual]) {
		if (!node) continue;
		scene.remove(node);
		node.traverse?.((child) => {
			child.geometry?.dispose?.();
			if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
			else child.material?.dispose?.();
		});
	}
}