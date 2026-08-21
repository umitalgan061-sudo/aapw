#!/usr/bin/env node
/**
 * checkSkyBodies.js — guards the sun, the moon, and the light the moon casts.
 *
 * The owner asked for three separable things: "Güneş Doğudan doğup Batıdan batsın, Ay geceleri iyi
 * şekilde aydınlatsın" — the sun must rise in the east and set in the west, and the moon must actually
 * light the night. Each can regress on its own, so each is asserted on its own.
 *
 * **East is +X in this world.** `nx` grows with world X and `map.png`'s east edge is `nx` 1, so a sun
 * standing at +X is a sun in the east. That mapping is the thing most likely to be silently inverted by
 * a future change to the orbit, and it is the one the owner would notice immediately.
 *
 * **The direction is `position - target`, not `position`.** `renderQuality.focusSunShadow` translates
 * the sun light onto the player every frame so its shadow frustum follows them; position alone is
 * therefore an arbitrary point near the player, and only the difference is the real direction. This
 * check re-derives the direction the same way `skyBodies.js` does *and* verifies that a focused light
 * still reports the same direction, which is the specific bug that would make the sun swing across the
 * sky as the player walks.
 *
 * **Neither body may be visible through the ground**, and the moon must be dark by day — a moon light
 * left on at noon washes out every shadow in the world.
 *
 * Usage: `node scripts/checkSkyBodies.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkSkyBodies
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Minimum moonlight at midnight. Below this the owner's "aydınlatsın" is not satisfied. */
const MIN_MIDNIGHT_MOONLIGHT = 0.25;
/** Maximum moonlight at noon. Above this the moon is washing out the day. */
const MAX_NOON_MOONLIGHT = 0.001;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[sky-bodies] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const { createDayNightLighting, updateDayNightLighting } = await import('/src/3d/lighting.js');
			const { createSkyBodies, updateSkyBodies } = await import('/src/3d/skyBodies.js');
			const { focusSunShadow } = await import('/src/3d/renderQuality.js');

			const scene = new THREE.Scene();
			const lights = createDayNightLighting(scene);
			const bodies = createSkyBodies(scene, null);
			const camera = new THREE.Vector3(0, 0, 0);
			const day = WORLD_DEFAULTS.DAY_LENGTH_SECONDS;

			const at = (ratio) => {
				const dayNight = updateDayNightLighting(lights, ratio * day, day, 0);
				updateSkyBodies(bodies, camera, lights.sun, dayNight.nightFactor);
				return {
					sunX: lights.sun.position.x,
					sunY: lights.sun.position.y,
					sunVisible: bodies.sun.visible,
					moonVisible: bodies.moon.visible,
					moonLight: +bodies.moonLight.intensity.toFixed(4),
					nightFactor: +dayNight.nightFactor.toFixed(2),
					sunDiscX: +bodies.sun.position.x.toFixed(1),
					moonDiscX: +bodies.moon.position.x.toFixed(1),
				};
			};

			// The two mistakes the first version of this module shipped, each asserted directly.
			const { SKY_BODY_POLICY } = await import('/src/3d/skyBodies.js');
			const frustum = {
				distanceMeters: SKY_BODY_POLICY.distanceMeters,
				farPlaneMeters: WORLD_DEFAULTS.FAR_PLANE,
				sunDepthTest: bodies.sun.material.depthTest,
				moonDepthTest: bodies.moon.material.depthTest,
				sunDepthWrite: bodies.sun.material.depthWrite,
			};

			const sunrise = at(0.27);
			const noon = at(0.5);
			const sunset = at(0.73);
			const midnight = at(0.0);

			// The focused-light invariant: translate the sun onto a player far from the origin, as the
			// real tick does, and confirm the sun disc does not move.
			updateDayNightLighting(lights, 0.27 * day, day, 0);
			updateSkyBodies(bodies, camera, lights.sun, 0.35);
			const beforeFocus = bodies.sun.position.clone();
			focusSunShadow(lights.sun, 4000, 120, -3000);
			updateSkyBodies(bodies, camera, lights.sun, 0.35);
			const focusDrift = bodies.sun.position.distanceTo(beforeFocus);

			return { sunrise, noon, sunset, midnight, frustum, focusDrift: +focusDrift.toFixed(2) };
		});

		const failures = [];
		// East is +X. At sunrise the sun stands east; at sunset, west.
		if (!(result.sunrise.sunX > 0)) failures.push(`at sunrise the sun is at x=${result.sunrise.sunX.toFixed(0)} — it must be east (+X)`);
		if (!(result.sunset.sunX < 0)) failures.push(`at sunset the sun is at x=${result.sunset.sunX.toFixed(0)} — it must be west (-X)`);
		if (!(result.sunrise.sunDiscX > 0)) failures.push('the sun disc is not on the same side as the sun light at sunrise');
		if (!(result.sunset.sunDiscX < 0)) failures.push('the sun disc is not on the same side as the sun light at sunset');
		if (!result.sunrise.sunVisible || !result.noon.sunVisible) failures.push('the sun is not visible by day');
		if (result.midnight.sunVisible) failures.push('the sun is visible at midnight — it is below the horizon');
		if (!result.midnight.moonVisible) failures.push('the moon is not visible at midnight');
		if (result.noon.moonVisible) failures.push('the moon is visible at noon while it is below the horizon');
		if (result.midnight.moonLight < MIN_MIDNIGHT_MOONLIGHT) {
			failures.push(`moonlight at midnight is ${result.midnight.moonLight} (min ${MIN_MIDNIGHT_MOONLIGHT}) — the owner asked that the moon light the night`);
		}
		if (result.noon.moonLight > MAX_NOON_MOONLIGHT) {
			failures.push(`moonlight at noon is ${result.noon.moonLight} (max ${MAX_NOON_MOONLIGHT}) — it is washing out the day`);
		}
		// Inside the frustum: at 9000 m against a 2000 m far plane the bodies were clipped away entirely
		// and the sky was empty again — invisible in gameplay, and only correct in a capture script whose
		// far plane was 40 km.
		if (!(result.frustum.distanceMeters < result.frustum.farPlaneMeters * 0.95)) {
			failures.push(`the bodies sit at ${result.frustum.distanceMeters} m against a ${result.frustum.farPlaneMeters} m far plane — they will be clipped away in gameplay`);
		}
		// Depth-tested: `transparent: true` renders them after all opaque geometry, so without the depth
		// test they paint over the terrain in front of the player.
		if (!result.frustum.sunDepthTest || !result.frustum.moonDepthTest) {
			failures.push('a sky body has depth testing off — in the transparent pass that paints it over the terrain');
		}
		if (result.frustum.sunDepthWrite) {
			failures.push('the sun writes depth — it would occlude the world behind it');
		}
		if (result.focusDrift > 1) {
			failures.push(`the sun disc moved ${result.focusDrift} m when the shadow frustum was focused on the player — the direction must come from position minus target, not position`);
		}

		console.log(`[sky-bodies] sunrise: sun x=${result.sunrise.sunX.toFixed(0)} (east +X), disc x=${result.sunrise.sunDiscX}, sun visible ${result.sunrise.sunVisible}`);
		console.log(`[sky-bodies] sunset:  sun x=${result.sunset.sunX.toFixed(0)} (west -X), disc x=${result.sunset.sunDiscX}`);
		console.log(`[sky-bodies] noon:     moonlight ${result.noon.moonLight}, moon visible ${result.noon.moonVisible}`);
		console.log(`[sky-bodies] midnight: moonlight ${result.midnight.moonLight}, moon visible ${result.midnight.moonVisible}, sun visible ${result.midnight.sunVisible}`);
		console.log(`[sky-bodies] sun disc drift when the shadow light is focused on a distant player: ${result.focusDrift} m`);
		console.log(`[sky-bodies] bodies at ${result.frustum.distanceMeters} m inside a ${result.frustum.farPlaneMeters} m far plane; depth-tested ${result.frustum.sunDepthTest && result.frustum.moonDepthTest}`);

		if (failures.length) {
			for (const failure of failures) console.error(`[sky-bodies] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[sky-bodies] PASS: the sun rises east and sets west, both bodies keep to their own half of the day, and the moon lights the night.');
		process.exit(0);
	} catch (error) {
		console.error('[sky-bodies] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
