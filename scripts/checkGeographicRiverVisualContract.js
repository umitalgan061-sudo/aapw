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
	const browser = await playwright.chromium.launch({
		headless: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
	});
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
			fail(river.material.userData.opticalProfile?.turbulentFoamBreakup === true, 'river turbulence breakup metadata disappeared');
			fail(river.material.userData.opticalProfile?.referencePalettePolicyId?.includes('geographic-reference-palette'), 'river shared palette metadata disappeared');

			const shader = {
				uniforms: {},
				vertexShader: '#include <common>\n#include <begin_vertex>',
				fragmentShader: '#include <common>\n#include <color_fragment>',
			};
			river.material.onBeforeCompile(shader);
			for (const token of ['flowEnergy', 'smoothstep(1.2, 4.5, vFlowSpeed)', 'mix(0.24, 1.0, flowEnergy)', 'turbulentBreakup']) {
				fail(shader.fragmentShader.includes(token), `river shader missing ${token}`);
			}
			updateFlowAnimation(river, 7.5);
			fail(river.material.userData.flowUniforms.uTime.value === 7.5, 'river animation time did not advance');

			const waterfall = createWaterfallMesh({
				top: new THREE.Vector3(0, 12, 0),
				bottom: new THREE.Vector3(4, 4, 0),
				dropMeters: 8,
			}, 14);
			const fallPositions = waterfall.geometry.getAttribute('position');
			const fallColors = waterfall.geometry.getAttribute('color');
			const fallDistances = waterfall.geometry.getAttribute('aFlowDistance');
			const fallSpeeds = waterfall.geometry.getAttribute('aFlowSpeed');
			const fallIndex = waterfall.geometry.getIndex();
			fail(fallPositions.count === 8 && fallColors.count === 8, 'waterfall curtain + apron must remain one 8-vertex mesh');
			fail(fallIndex?.count === 12, `waterfall single-mesh index count ${fallIndex?.count} != 12`);
			fail(fallSpeeds.getX(0) === 9, 'waterfall curtain flow speed drifted');
			fail(fallSpeeds.getX(4) < fallSpeeds.getX(0), 'plunge apron must slow after impact');
			const lip = new THREE.Color(fallColors.getX(0), fallColors.getY(0), fallColors.getZ(0));
			const plunge = new THREE.Color(fallColors.getX(2), fallColors.getY(2), fallColors.getZ(2));
			const impact = new THREE.Color(fallColors.getX(4), fallColors.getY(4), fallColors.getZ(4));
			fail(lip.r > plunge.r && lip.g > plunge.g && lip.b > plunge.b, 'waterfall lip must remain brighter/foamier than plunge water');
			fail(impact.r > plunge.r && impact.g > plunge.g && impact.b > plunge.b, 'impact apron must re-aerate brighter than plunge water');
			fail(Math.abs(fallDistances.getX(4) - 8) < 1e-6, 'apron flow must continue from the full curtain drop distance');
			fail(fallDistances.getX(6) > fallDistances.getX(4), 'apron flow distance must advance downstream');
			const nearWidth = Math.hypot(fallPositions.getX(4) - fallPositions.getX(5), fallPositions.getZ(4) - fallPositions.getZ(5));
			const farWidth = Math.hypot(fallPositions.getX(6) - fallPositions.getX(7), fallPositions.getZ(6) - fallPositions.getZ(7));
			const nearCenterX = (fallPositions.getX(4) + fallPositions.getX(5)) * 0.5;
			const farCenterX = (fallPositions.getX(6) + fallPositions.getX(7)) * 0.5;
			fail(farWidth > nearWidth, `plunge apron must spread downstream (${nearWidth} -> ${farWidth})`);
			fail(farCenterX > nearCenterX, 'plunge apron must extend in the waterfall downstream direction');
			fail(waterfall.material.opacity === 0.74, 'waterfall transparency drifted');
			fail(waterfall.material.userData.opticalProfile?.aerated === true, 'waterfall aeration metadata disappeared');
			fail(waterfall.material.userData.opticalProfile?.splashApron === true, 'waterfall splash-apron metadata disappeared');
			fail(waterfall.material.userData.opticalProfile?.singleDrawCall === true, 'waterfall apron must not add a draw-call mesh');
			fail(waterfall.material.userData.opticalProfile?.turbulentFoamBreakup === true, 'waterfall turbulence breakup metadata disappeared');

			const summary = {
				calmSpeed,
				rapidSpeed,
				colorDistance: calmRapidColorDistance,
				riverOpacity: river.material.opacity,
				waterfallOpacity: waterfall.material.opacity,
				waterfallVertices: fallPositions.count,
				apronSpread: farWidth / nearWidth,
			};
			disposeRiverMesh(river);
			disposeWaterfallMesh(waterfall);
			return summary;
		});

		assert(result.rapidSpeed > result.calmSpeed, 'slope-speed relation escaped browser contract');
		console.log(
			`[checkGeographicRiverVisualContract] PASS: calm ${result.calmSpeed.toFixed(2)}m/s → rapid ` +
			`${result.rapidSpeed.toFixed(2)}m/s, colour Δ ${result.colorDistance.toFixed(3)}, ` +
			`${result.waterfallVertices}-vertex single-draw waterfall, apron spread x${result.apronSpread.toFixed(2)}.`,
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
