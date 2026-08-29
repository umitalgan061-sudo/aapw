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
const ORBIT_RADIUS_METERS = 900;
const CELESTIAL_VISUAL_SCALE = 18;
const NIGHT_READABILITY_LIGHT_NAME = 'Game Night Readability Fill';
const NIGHT_READABILITY_DAY_INTENSITY = 0.05;
const NIGHT_READABILITY_NIGHT_INTENSITY = 0.36;
const MOON_MAX_INTENSITY = 0.55;
const MOON_ASSET_URL = 'assets/models/Ay/Moon%202K.fbx';

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
	if (largest > 1e-6) object.scale.multiplyScalar(diameter / largest);
}

/** Load the repository moon asset without making world boot wait for it. The procedural sphere stays
 * as a safe fallback if the FBX is unavailable or is only an LFS pointer in the current deployment. */
function installMoonAssetAsync(moonAnchor) {
	const loader = new AssetLoader();
	loader.loadFBXModel(MOON_ASSET_URL, { fallbackColor: 0xdbe8ff, fallbackSize: 2 }).then((model) => {
		if (!moonAnchor.parent || model.userData?.isPlaceholder) return;
		fitObjectToDiameter(model, CELESTIAL_VISUAL_SCALE * 2);
		model.traverse((node) => {
			if (!node.isMesh) return;
			node.castShadow = false;
			node.receiveShadow = false;
		});
		moonAnchor.clear();
		moonAnchor.add(model);
	}).catch(() => {});
}

export function createDayNightLighting(scene) {
	const sun = new THREE.DirectionalLight(0xffffff, 1);
	sun.name = 'Sun Directional Light';
	const moon = new THREE.DirectionalLight(0xc8dcff, 0);
	moon.name = 'Moon Directional Light';
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
	installMoonAssetAsync(moonVisual);
	return { sun, moon, hemisphere, sunVisual, moonVisual };
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
	if (lights.moon) lights.moon.intensity = MOON_MAX_INTENSITY * smoothNightFactor;
	updateNightVisualEnhancement(lights.hemisphere, nightFactor);

	// 06:00 => east (+X) horizon, 12:00 => zenith, 18:00 => west (-X) horizon.
	const angle = (timeRatio - 0.25) * Math.PI * 2;
	const sunX = Math.cos(angle) * ORBIT_RADIUS_METERS;
	const sunY = Math.sin(angle) * ORBIT_RADIUS_METERS;
	const sunZ = Math.sin(angle * 0.35) * ORBIT_RADIUS_METERS * 0.12;
	lights.sun.position.set(sunX, sunY, sunZ);
	if (lights.sunVisual) lights.sunVisual.position.copy(lights.sun.position);

	// Moon is 180 degrees opposite the sun; its light becomes dominant only after sunset.
	if (lights.moon) lights.moon.position.set(-sunX, -sunY, -sunZ);
	if (lights.moonVisual) {
		lights.moonVisual.position.set(-sunX, -sunY, -sunZ);
		lights.moonVisual.visible = smoothNightFactor > 0.08;
	}
	if (lights.sunVisual) lights.sunVisual.visible = sunY > -25;

	const horizonColor = SKY_NIGHT.horizon.clone().lerp(SKY_DAY.horizon, 1 - nightFactor);
	const zenithColor = SKY_NIGHT.zenith.clone().lerp(SKY_DAY.zenith, 1 - nightFactor);
	return { timeRatio, nightFactor, horizonColor, zenithColor };
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
