#!/usr/bin/env node
/**
 * checkLightingVisualContract.js — live-browser day/night lighting regression contract.
 * Pins the existing DirectionalLight + HemisphereLight creation, keyframe interpolation,
 * sun orbit, sky-gradient synchronization, time wrapping and teardown behavior without
 * changing runtime code.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkLightingVisualContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({
		headless: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/scripts/geographicMaterialHarness.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createDayNightLighting, updateDayNightLighting, disposeDayNightLighting } = await import('/src/3d/lighting.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-10) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const colorClose = (actual, expected, tolerance = 1e-10) => (
				actual?.isColor === true && expected?.isColor === true &&
				close(actual.r, expected.r, tolerance) && close(actual.g, expected.g, tolerance) && close(actual.b, expected.b, tolerance)
			);
			const lerpColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
			const smoothstep = (edge0, edge1, value) => {
				const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
				return x * x * (3 - 2 * x);
			};
			const expectedSky = (nightFactor, sunY) => {
				const smoothNight = nightFactor * nightFactor * (3 - 2 * nightFactor);
				const twilight = 1 - smoothstep(0, 270, Math.abs(sunY));
				return {
					horizon: new THREE.Color(0x263752).lerp(new THREE.Color(0xaed7ee), 1 - smoothNight).lerp(new THREE.Color(0xe59a6d), twilight * 0.68),
					zenith: new THREE.Color(0x071127).lerp(new THREE.Color(0x2f72ad), 1 - smoothNight).lerp(new THREE.Color(0x4d6086), twilight * 0.24),
				};
			};
			const expectedSunPosition = (ratio) => {
				const angle = (ratio - 0.25) * Math.PI * 2;
				return new THREE.Vector3(Math.cos(angle) * 900, Math.sin(angle) * 900, Math.sin(angle * 0.35) * 108);
			};

			const scene = new THREE.Scene();
			const lights = createDayNightLighting(scene);
			fail(lights?.sun?.isDirectionalLight === true, 'sun is not THREE.DirectionalLight');
			fail(lights?.hemisphere?.isHemisphereLight === true, 'hemisphere is not THREE.HemisphereLight');
			fail(scene.children.includes(lights.sun) && scene.children.includes(lights.hemisphere), 'created lights were not added to the scene');
			fail(lights.sun !== lights.hemisphere, 'sun and hemisphere unexpectedly share one object');
			fail(lights.sun.color !== lights.hemisphere.color, 'light colors unexpectedly share mutable state');
			fail(lights.sun.color.getHex() === 0xffffff && close(lights.sun.intensity, 1), 'sun creation defaults drifted');
			fail(lights.hemisphere.color.getHex() === 0xffffff && lights.hemisphere.groundColor.getHex() === 0x000000 && close(lights.hemisphere.intensity, 1), 'hemisphere creation defaults drifted');

			const keyframes = [
				{ ratio: 0.00, sunColor: 0x233a66, sunIntensity: 0.00, hemiSky: 0x101b38, hemiGround: 0x080b13, hemiIntensity: 0.28, nightFactor: 1.00 },
				{ ratio: 0.22, sunColor: 0x344b70, sunIntensity: 0.03, hemiSky: 0x142244, hemiGround: 0x0a0d16, hemiIntensity: 0.30, nightFactor: 1.00 },
				{ ratio: 0.27, sunColor: 0xffb366, sunIntensity: 0.90, hemiSky: 0x8b6b59, hemiGround: 0x302117, hemiIntensity: 0.62, nightFactor: 0.35 },
				{ ratio: 0.50, sunColor: 0xfff2d8, sunIntensity: 1.40, hemiSky: 0xb9d8ed, hemiGround: 0x413a2a, hemiIntensity: 1.10, nightFactor: 0.00 },
				{ ratio: 0.73, sunColor: 0xff8c52, sunIntensity: 0.85, hemiSky: 0x9b6655, hemiGround: 0x301b12, hemiIntensity: 0.58, nightFactor: 0.35 },
				{ ratio: 0.78, sunColor: 0x344b70, sunIntensity: 0.03, hemiSky: 0x142244, hemiGround: 0x0a0d16, hemiIntensity: 0.30, nightFactor: 1.00 },
				{ ratio: 1.00, sunColor: 0x233a66, sunIntensity: 0.00, hemiSky: 0x101b38, hemiGround: 0x080b13, hemiIntensity: 0.28, nightFactor: 1.00 },
			];

			const sample = (ratio) => {
				let a = keyframes[0];
				let b = keyframes[1];
				for (let i = 0; i < keyframes.length - 1; i++) {
					if (ratio >= keyframes[i].ratio && ratio <= keyframes[i + 1].ratio) {
						a = keyframes[i];
						b = keyframes[i + 1];
						break;
					}
				}
				const span = b.ratio - a.ratio;
				const t = span > 0 ? (ratio - a.ratio) / span : 0;
				return {
					sunColor: lerpColor(a.sunColor, b.sunColor, t),
					sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
					hemiSky: lerpColor(a.hemiSky, b.hemiSky, t),
					hemiGround: lerpColor(a.hemiGround, b.hemiGround, t),
					hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
					nightFactor: a.nightFactor + (b.nightFactor - a.nightFactor) * t,
				};
			};

			const ratios = [0, 0.22, 0.245, 0.27, 0.5, 0.73, 0.755, 0.78, 0.9];
			const measured = [];
			for (const ratio of ratios) {
				const state = updateDayNightLighting(lights, ratio * 100, 100, 0);
				const expected = sample(ratio);
				const sunPosition = expectedSunPosition(ratio);
				const sky = expectedSky(expected.nightFactor, sunPosition.y);
				const altitudeWeight = smoothstep(-25, 198, sunPosition.y);
				fail(close(state.timeRatio, ratio), `timeRatio ${state.timeRatio} != ${ratio}`);
				fail(close(state.nightFactor, expected.nightFactor), `nightFactor drifted at ${ratio}`);
				fail(colorClose(lights.sun.color, expected.sunColor), `sun color drifted at ${ratio}`);
				fail(close(lights.sun.intensity, expected.sunIntensity * altitudeWeight), `sun intensity drifted at ${ratio}`);
				fail(colorClose(lights.hemisphere.color, expected.hemiSky), `hemisphere sky color drifted at ${ratio}`);
				fail(colorClose(lights.hemisphere.groundColor, expected.hemiGround), `hemisphere ground color drifted at ${ratio}`);
				fail(close(lights.hemisphere.intensity, expected.hemiIntensity), `hemisphere intensity drifted at ${ratio}`);
				fail(colorClose(state.horizonColor, sky.horizon), `horizon gradient drifted at ${ratio}`);
				fail(colorClose(state.zenithColor, sky.zenith), `zenith gradient drifted at ${ratio}`);
				fail(lights.sun.position.distanceTo(sunPosition) < 1e-8, `sun orbit position drifted at ${ratio}`);
				fail(close(Math.hypot(lights.sun.position.x, lights.sun.position.y), 900), `sun XY orbit radius drifted at ${ratio}`);
				fail(close(lights.sun.position.z, sunPosition.z), `sun Z orbit offset drifted at ${ratio}`);
				measured.push({ ratio, nightFactor: state.nightFactor, sunIntensity: lights.sun.intensity, hemiIntensity: lights.hemisphere.intensity });
			}

			const noon = updateDayNightLighting(lights, 130, 100, 0.2);
			fail(close(noon.timeRatio, 0.5) && close(noon.nightFactor, 0), 'positive time wraparound failed');
			const wrappedNight = updateDayNightLighting(lights, -30, 100, 0.2);
			fail(close(wrappedNight.timeRatio, 0.9) && close(wrappedNight.nightFactor, 1), 'negative time wraparound failed');

			const firstNoon = updateDayNightLighting(lights, 50, 100, 0);
			firstNoon.horizonColor.set(0x000000);
			firstNoon.zenithColor.set(0xffffff);
			const secondNoon = updateDayNightLighting(lights, 50, 100, 0);
			fail(secondNoon.horizonColor.getHex() === 0xaed7ee && secondNoon.zenithColor.getHex() === 0x2f72ad, 'returned sky colors retained caller mutation across updates');
			fail(firstNoon.horizonColor !== secondNoon.horizonColor && firstNoon.zenithColor !== secondNoon.zenithColor, 'update reused mutable output sky colors');

			const twinScene = new THREE.Scene();
			const twin = createDayNightLighting(twinScene);
			updateDayNightLighting(twin, 0, 100, 0);
			updateDayNightLighting(lights, 50, 100, 0);
			fail(twin.sun.color.getHex() === 0x233a66 && close(twin.sun.intensity, 0), 'updating first lighting system mutated twin sun');
			fail(twin.hemisphere.color.getHex() === 0x101b38 && close(twin.hemisphere.intensity, 0.28), 'updating first lighting system mutated twin hemisphere');

			const sun = lights.sun;
			const hemisphere = lights.hemisphere;
			disposeDayNightLighting(scene, lights);
			fail(!scene.children.includes(sun) && !scene.children.includes(hemisphere), 'dispose did not remove both lights from scene');
			fail(sun.parent === null && hemisphere.parent === null, 'disposed lights still have scene parent');
			disposeDayNightLighting(twinScene, twin);
			fail(twinScene.children.length === 0, 'twin scene retained lights after dispose');

			return {
				midnight: measured[0],
				dawnMid: measured[2],
				noon: measured[4],
				duskMid: measured[6],
				wrappedNight: { timeRatio: wrappedNight.timeRatio, nightFactor: wrappedNight.nightFactor },
			};
		});
		assert(result.noon.nightFactor === 0 && result.midnight.nightFactor === 1, 'lighting endpoint factors escaped browser contract');
		console.log(`[checkLightingVisualContract] PASS: Directional+Hemisphere lights, midnight/noon nightFactor ${result.midnight.nightFactor.toFixed(2)}→${result.noon.nightFactor.toFixed(2)}, sun intensity ${result.midnight.sunIntensity.toFixed(2)}→${result.noon.sunIntensity.toFixed(2)}, dawn-mid ${result.dawnMid.nightFactor.toFixed(3)}, dusk-mid ${result.duskMid.nightFactor.toFixed(3)}, ±time wrap + 900m altitude-modulated sun orbit + teardown PASS.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkLightingVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
