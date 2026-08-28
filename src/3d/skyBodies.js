/**
 * The sun and the moon — visible bodies in the sky, and the light the moon casts.
 *
 * **What the owner asked for.** "Gerçekçi gökyüzü oluştur. Assets'in içerisinde güneş ve ay var.
 * İkisini doğru mantıklarla yerleştir. Güneş Doğudan doğup Batıdan batsın, Ay geceleri iyi şekilde
 * aydınlatsın." Three separate things: the bodies should be *visible*, they should move by a correct
 * rule, and the night should actually be lit by the moon rather than merely dark.
 *
 * **The sun already rose in the east; nothing could see it.** `lighting.js` has always orbited its
 * `DirectionalLight` so that at `timeRatio` 0.25 it stands at +X and at 0.75 at -X, and +X is east in
 * this world (`nx` grows with world X, and `map.png`'s east edge is `nx` 1). So the *direction* was
 * right and the *sky* was empty: a directional light has no body, so there was no disc to see rise or
 * set. This module adds the bodies on exactly that existing direction rather than inventing a second
 * celestial model that could drift out of step with the light — `updateSkyBodies` is handed the sun's
 * own position, so the disc is always where the light comes from, by construction.
 *
 * **The moon is procedural, and that is deliberate.** `assets/models/Ay/Moon 2K.fbx` is a 130-byte Git
 * LFS pointer in a fresh clone (RCA_RUN344), so a moon built from it would be a placeholder box — or
 * nothing — everywhere LFS is not hydrated, which is most places. The sun is different:
 * `assets/models/fbx/sun/2k_sun.jpg` is a real committed 822 KB texture, so the sun disc uses it and
 * falls back to a plain emissive disc if it ever fails to load. The moon's face is generated here as a
 * small deterministic canvas of maria and craters — it costs one 256x256 texture, it is identical on
 * every machine and every run (`mulberry32`, no `Math.random()`, per §8.9), and it cannot regress to a
 * grey cube.
 *
 * **Both bodies ride with the camera, just inside the sky sphere.** They write no depth and cast no
 * shadow, so they need none of the treatment world geometry needs — but they do *test* depth, and they
 * sit inside the camera's far plane. Both of those are corrections of a first version that treated them
 * as astronomical objects and got each wrong in a different way; see `distanceMeters` and the sun
 * material for what each mistake looked like on screen.
 *
 * @module skyBodies
 */

import * as THREE from 'three';
import { mulberry32 } from './world/terrain.js';

export const SKY_BODY_POLICY = Object.freeze({
	id: 'sky-bodies-2026-08-21-v1',
	/**
	 * Distance from the camera the bodies are drawn at, and the sizes that go with it.
	 *
	 * **This must stay inside the camera's far plane, and it is much closer than "the sky" suggests.**
	 * `WORLD_DEFAULTS.FAR_PLANE` is 2000 m and `sky.js`'s own sphere sits at 1900 m for exactly this
	 * reason. The first version of this module placed the bodies at 9000 m, reasoning about them as
	 * astronomical objects: in gameplay they were beyond the far plane and clipped away entirely, so the
	 * sky was empty again — the bug the module exists to fix. It only looked correct in the capture
	 * script, which uses a 40 km far plane no real camera has.
	 *
	 * 1750 m keeps them inside the sky sphere and inside the frustum. The radii are the apparent sizes
	 * that distance implies, not physical ones.
	 */
	distanceMeters: 1750,
	/** Radius of the sun disc at that distance — an apparent size, not a physical one. */
	sunRadiusMeters: 82,
	/** The moon reads slightly smaller than the sun, as it does from Earth. */
	moonRadiusMeters: 64,
	/**
	 * Peak moonlight intensity.
	 *
	 * The owner's complaint is that night is not lit ("Ay geceleri iyi şekilde aydınlatsın"). The night
	 * sun keeps `sunIntensity` 0.05, which is starlight, not moonlight. 0.42 is bright enough to read
	 * the shape of the land and to see a road, and far below the 1.4 of noon, so night stays night.
	 */
	moonLightIntensity: 0.42,
	/** Cool, slightly blue — moonlight is sunlight, but the eye reads dim light as blue (Purkinje). */
	moonLightColor: 0x9fb6d8,
	/** The lit face of the moon, and the light it casts. */
	moonSurfaceColor: 0xe8ecf2,
	/** Deterministic seed for the moon's craters. */
	moonFaceSeed: 0x4d4f4f4e,
});

/**
 * Paints the moon's face once: dark maria and bright-rimmed craters over a pale disc.
 *
 * Deterministic by construction — one `mulberry32` stream, no `Math.random()` — so every machine draws
 * the same moon and the visual-verification renders of one run can be compared with the next.
 *
 * @returns {THREE.CanvasTexture|null} Null when there is no DOM to draw on (headless Node importers).
 */
function createMoonFaceTexture() {
	if (typeof document === 'undefined') return null;
	const size = 256;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	if (!context) return null;
	const random = mulberry32(SKY_BODY_POLICY.moonFaceSeed);

	context.fillStyle = '#e9edf3';
	context.fillRect(0, 0, size, size);

	// Maria: a few large, soft, dark seas. These are what make a moon read as *the* moon at a glance.
	for (let i = 0; i < 7; i += 1) {
		const x = random() * size;
		const y = random() * size;
		const radius = size * (0.09 + random() * 0.13);
		const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
		gradient.addColorStop(0, 'rgba(150,158,172,0.55)');
		gradient.addColorStop(1, 'rgba(150,158,172,0)');
		context.fillStyle = gradient;
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.fill();
	}

	// Craters: a dark floor with a brighter rim, which is what gives the surface its pitted texture.
	for (let i = 0; i < 90; i += 1) {
		const x = random() * size;
		const y = random() * size;
		const radius = size * (0.006 + random() * 0.028);
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.fillStyle = `rgba(168,176,190,${0.25 + random() * 0.35})`;
		context.fill();
		context.lineWidth = Math.max(1, radius * 0.35);
		context.strokeStyle = 'rgba(255,255,255,0.45)';
		context.stroke();
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

/**
 * Builds the sun disc, the moon disc and the moon's light, and adds them to the scene.
 *
 * @param {THREE.Scene} scene
 * @param {import('./assetLoader.js').AssetLoader} [assetLoader] Used only to fetch the sun texture;
 *   omitted or failing, the sun falls back to a plain emissive disc and everything else is unchanged.
 * @returns {{sun: THREE.Mesh, moon: THREE.Mesh, moonLight: THREE.DirectionalLight, group: THREE.Group}}
 */
export function createSkyBodies(scene, assetLoader = null) {
	const P = SKY_BODY_POLICY;
	const group = new THREE.Group();
	group.name = 'sky-bodies';

	const sunMaterial = new THREE.MeshBasicMaterial({
		color: 0xfff3d0,
		fog: false,
		depthWrite: false,
		// **Depth testing on, deliberately.** `transparent: true` puts these in three.js's transparent
		// pass, which runs after *all* opaque geometry, so `depthTest: false` — the obvious choice for a
		// sky body — painted the sun and moon on top of the world: a hillside in front of the player had
		// a disc pasted over it. With the test on and no depth written, terrain nearer than
		// `distanceMeters` occludes them correctly while open sky does not.
		depthTest: true,
		transparent: true,
	});
	const sun = new THREE.Mesh(new THREE.SphereGeometry(P.sunRadiusMeters, 24, 16), sunMaterial);
	sun.name = 'sky-sun';
	sun.frustumCulled = false;
	sun.renderOrder = -0.5;

	const moonMaterial = new THREE.MeshBasicMaterial({
		color: P.moonSurfaceColor,
		map: createMoonFaceTexture(),
		fog: false,
		depthWrite: false,
		depthTest: true, // See the sun's material above.
		transparent: true,
	});
	const moon = new THREE.Mesh(new THREE.SphereGeometry(P.moonRadiusMeters, 24, 16), moonMaterial);
	moon.name = 'sky-moon';
	moon.frustumCulled = false;
	moon.renderOrder = -0.5;

	// The moon's light. A second directional light rather than a brighter night sun, because the two
	// come from opposite directions: at midnight the sun is below the horizon and lighting the world
	// from it would light every slope from underneath.
	const moonLight = new THREE.DirectionalLight(P.moonLightColor, 0);
	moonLight.name = 'moon-light';

	group.add(sun, moon, moonLight);
	scene.add(group);

	// The sun's own texture, when it is readable. Committed as a real file, so this normally succeeds.
	if (assetLoader && typeof assetLoader.loadTexture === 'function') {
		Promise.resolve(assetLoader.loadTexture('assets/models/fbx/sun/2k_sun.jpg'))
			.then((texture) => {
				if (!texture) return;
				texture.colorSpace = THREE.SRGBColorSpace;
				sunMaterial.map = texture;
				sunMaterial.color.set(0xffffff);
				sunMaterial.needsUpdate = true;
			})
			.catch(() => { /* Plain emissive disc is a fine sun; never break the sky over a texture. */ });
	}

	return { sun, moon, moonLight, group };
}

/**
 * Places both bodies for this frame and sets how hard the moon shines.
 *
 * @param {{sun: THREE.Mesh, moon: THREE.Mesh, moonLight: THREE.DirectionalLight}} bodies
 * @param {THREE.Vector3} cameraPosition Bodies ride with the camera so they stay at infinity.
 * @param {THREE.DirectionalLight} sunLight `lights.sun` — the single source of truth for where the sun
 *   is. Reading the light rather than recomputing the orbit is what keeps the disc and the light from
 *   ever disagreeing.
 * @param {number} nightFactor 0 by day, 1 at night, from `updateDayNightLighting`.
 */
export function updateSkyBodies(bodies, cameraPosition, sunLight, nightFactor) {
	const P = SKY_BODY_POLICY;
	const { sun, moon, moonLight } = bodies;

	// **The sun's direction is `position - target`, not `position`.** `renderQuality.focusSunShadow`
	// re-anchors the shadow frustum by translating the light's position *and* its target onto the
	// player together, which leaves the direction untouched but makes the raw position an arbitrary
	// point near the player. Normalising that alone would swing the sun across the sky as the player
	// walked. The difference is the invariant, and it also reads correctly before any focusing has
	// happened, when the target is still the origin.
	const targetPosition = sunLight.target ? sunLight.target.position : null;
	const rawX = sunLight.position.x - (targetPosition ? targetPosition.x : 0);
	const rawY = sunLight.position.y - (targetPosition ? targetPosition.y : 0);
	const rawZ = sunLight.position.z - (targetPosition ? targetPosition.z : 0);
	// Unit direction toward the sun. The moon sits opposite it, so it rises as the sun sets — which is
	// both the familiar full-moon behaviour and the arrangement that keeps the night sky occupied.
	const length = Math.hypot(rawX, rawY, rawZ) || 1;
	const dx = rawX / length;
	const dy = rawY / length;
	const dz = rawZ / length;

	sun.position.set(
		cameraPosition.x + dx * P.distanceMeters,
		cameraPosition.y + dy * P.distanceMeters,
		cameraPosition.z + dz * P.distanceMeters,
	);
	moon.position.set(
		cameraPosition.x - dx * P.distanceMeters,
		cameraPosition.y - dy * P.distanceMeters,
		cameraPosition.z - dz * P.distanceMeters,
	);
	// Keep the painted face turned toward the viewer.
	moon.lookAt(cameraPosition);

	// Each body fades out while it is below the horizon, so neither is ever seen through the ground.
	const horizonFade = (upComponent) => Math.max(0, Math.min(1, (upComponent + 0.06) / 0.12));
	sun.material.opacity = horizonFade(dy);
	sun.visible = sun.material.opacity > 0.01;
	moon.material.opacity = horizonFade(-dy);
	moon.visible = moon.material.opacity > 0.01;

	// Moonlight follows the moon's own direction, and only while it is up and the sky is dark. Both
	// factors matter: without `nightFactor` the moon would wash out dusk, and without the horizon term
	// it would light the world from below the ground at noon.
	moonLight.position.set(
		-dx * P.distanceMeters,
		-dy * P.distanceMeters,
		-dz * P.distanceMeters,
	);
	moonLight.intensity = P.moonLightIntensity * nightFactor * horizonFade(-dy);
}

/**
 * Removes the bodies and frees their geometry and textures.
 * @param {THREE.Scene} scene
 * @param {{sun: THREE.Mesh, moon: THREE.Mesh, group: THREE.Group}} bodies
 */
export function disposeSkyBodies(scene, bodies) {
	scene.remove(bodies.group);
	for (const mesh of [bodies.sun, bodies.moon]) {
		mesh.geometry.dispose();
		if (mesh.material.map) mesh.material.map.dispose();
		mesh.material.dispose();
	}
}
