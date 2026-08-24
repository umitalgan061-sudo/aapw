#!/usr/bin/env node
/**
 * Fast browser contract for the geographic river/waterfall appearance. Unlike the historical
 * Run325 evidence script, this loads only `world/rivers.js` through a tiny import-map harness, so a
 * slow full-game/LFS boot cannot masquerade as a river regression.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkGeographicRiverVisualContract] SKIP: Playwright is not available.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
		await page.goto(`http://127.0.0.1:${port}/scripts/geographicRiverHarness.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 15000,
		});
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const {
				createRiverMesh,
				createWaterfallMesh,
				updateFlowAnimation,
				disposeRiverMesh,
				disposeWaterfallMesh,
			} = await import('/src/3d/world/rivers.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const colorDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

			// A deliberately calm first reach followed by a steep rapid. Production code must derive
			// both speed and visual colour from that same bed-gradient signal.
			const points = [
				new THREE.Vector3(0, 10, 0),
				new THREE.Vector3(20, 9.9, 0),
				new THREE.Vector3(40, 1.0, 0),
				new THREE.Vector3(60, 0.8, 0),
			];
			const river = createRiverMesh(points, 14);
			fail(river?.isMesh === true, 'river mesh was not created');
			const speeds = river.geometry.getAttribute('aFlowSpeed');
			const colors = river.geometry.getAttribute('color');
			fail(Boolean(speeds && colors), 'river flow/color attributes are missing');
			const calmSpeed = speeds.getX(0);
			const rapidSpeed = speeds.getX(2);
			fail(rapidSpeed > calmSpeed, `rapid ${rapidSpeed} must be faster than calm reach ${calmSpeed}`);
			const calmColor = new THREE.Color(colors.getX(0), colors.getY(0), colors.getZ(0));
			const rapidColor = new THREE.Color(colors.getX(2), colors.getY(2), colors.getZ(2));
			const calmRapidColorDistance = colorDistance(calmColor, rapidColor);
			fail(calmRapidColorDistance > 0.01, 'calm pool and rapid water collapsed to one colour');
			fail(river.material.opacity === 0.74, `river opacity ${river.material.opacity} no longer exposes the bed`);
			fail(river.material.userData.opticalProfile?.calmBedReadable === true, 'calm river bed-readability metadata disappeared');
			fail(river.material.userData.opticalProfile?.slopeDrivenFoam === true, 'slope-driven foam metadata disappeared');

			const shader = {
				uniforms: {},
				vertexShader: '#include <common>\n#include <begin_vertex>',
				fragmentShader: '#include <common>\n#include <color_fragment>',
			};
			river.material.onBeforeCompile(shader);
			for (const token of ['flowEnergy', 'smoothstep(1.2, 4.5, vFlowSpeed)', 'mix(0.24, 1.0, flowEnergy)']) {
				fail(shader.fragmentShader.includes(token), `river shader missing ${token}`);
			}
			updateFlowAnimation(river, 7.5);
			fail(river.material.userData.flowUniforms.uTime.value === 7.5, 'river animation time did not advance');

			const waterfall = createWaterfallMesh({
				top: new THREE.Vector3(0, 12, 0),
				bottom: new THREE.Vector3(4, 4, 0),
				dropMeters: 8,
			}, 14);
			const fallColors = waterfall.geometry.getAttribute('color');
			const fallSpeeds = waterfall.geometry.getAttribute('aFlowSpeed');
			fail(fallColors.count === 4, 'waterfall curtain topology unexpectedly changed');
			fail(fallSpeeds.getX(0) === 9, 'waterfall flow speed drifted');
			const lip = new THREE.Color(fallColors.getX(0), fallColors.getY(0), fallColors.getZ(0));
			const plunge = new THREE.Color(fallColors.getX(2), fallColors.getY(2), fallColors.getZ(2));
			fail(lip.r > plunge.r && lip.g > plunge.g && lip.b > plunge.b, 'waterfall lip must remain brighter/foamier than plunge water');
			fail(waterfall.material.opacity === 0.74, 'waterfall transparency drifted');
			fail(waterfall.material.userData.opticalProfile?.aerated === true, 'waterfall aeration metadata disappeared');

			const summary = {
				calmSpeed,
				rapidSpeed,
				colorDistance: calmRapidColorDistance,
				riverOpacity: river.material.opacity,
				waterfallOpacity: waterfall.material.opacity,
			};
			disposeRiverMesh(river);
			disposeWaterfallMesh(waterfall);
			return summary;
		});

		assert(result.rapidSpeed > result.calmSpeed, 'slope-speed relation escaped browser contract');
		console.log(
			`[checkGeographicRiverVisualContract] PASS: calm ${result.calmSpeed.toFixed(2)}m/s → rapid ` +
			`${result.rapidSpeed.toFixed(2)}m/s, colour Δ ${result.colorDistance.toFixed(3)}, ` +
			`river/fall alpha ${result.riverOpacity}/${result.waterfallOpacity}.`,
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkGeographicRiverVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
