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
				fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
			};
			river.material.onBeforeCompile(shader);
			for (const token of [
				'riverFlowEnergy',
				'smoothstep(1.2, 4.5, vFlowSpeed)',
				'mix(0.22, 1.0, riverFlowEnergy)',
				'riverTurbulentBreakup',
				'riverRoughnessTarget',
				'riverWorldPerturb',
			]) {
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
			const segments = waterfall.userData.cascadeColumnSegments;
			const columns = segments + 1;
			const expectedVertices = columns * 4;
			const expectedIndices = segments * 3 * 6;
			fail(segments >= 6, `waterfall segmentation ${segments} is too coarse`);
			fail(fallPositions.count === expectedVertices && fallColors.count === expectedVertices,
				`waterfall segmented cascade vertex count ${fallPositions.count} != ${expectedVertices}`);
			fail(fallIndex?.count === expectedIndices, `waterfall index count ${fallIndex?.count} != ${expectedIndices}`);
			const centerColumn = Math.floor(columns / 2);
			const crestVertex = centerColumn;
			const plungeVertex = columns + centerColumn;
			const impactVertex = columns * 2 + centerColumn;
			const apronVertex = columns * 3 + centerColumn;
			fail(fallSpeeds.getX(crestVertex) === 9, 'waterfall curtain flow speed drifted');
			fail(fallSpeeds.getX(impactVertex) < fallSpeeds.getX(crestVertex), 'plunge apron must slow after impact');
			const lip = new THREE.Color(fallColors.getX(crestVertex), fallColors.getY(crestVertex), fallColors.getZ(crestVertex));
			const plunge = new THREE.Color(fallColors.getX(plungeVertex), fallColors.getY(plungeVertex), fallColors.getZ(plungeVertex));
			const impact = new THREE.Color(fallColors.getX(impactVertex), fallColors.getY(impactVertex), fallColors.getZ(impactVertex));
			fail(lip.r > plunge.r && lip.g > plunge.g && lip.b > plunge.b, 'waterfall lip must remain brighter/foamier than plunge water');
			fail(impact.r > plunge.r && impact.g > plunge.g && impact.b > plunge.b, 'impact apron must re-aerate brighter than plunge water');
			fail(Math.abs(fallDistances.getX(impactVertex) - 8) < 1e-6, 'apron flow must continue from the full curtain drop distance');
			fail(fallDistances.getX(apronVertex) > fallDistances.getX(impactVertex), 'apron flow distance must advance downstream');
			const impactLeft = columns * 2;
			const impactRight = impactLeft + segments;
			const apronLeft = columns * 3;
			const apronRight = apronLeft + segments;
			const impactWidth = Math.hypot(
				fallPositions.getX(impactLeft) - fallPositions.getX(impactRight),
				fallPositions.getZ(impactLeft) - fallPositions.getZ(impactRight),
			);
			const apronWidth = Math.hypot(
				fallPositions.getX(apronLeft) - fallPositions.getX(apronRight),
				fallPositions.getZ(apronLeft) - fallPositions.getZ(apronRight),
			);
			const impactCenterX = (fallPositions.getX(impactLeft) + fallPositions.getX(impactRight)) * 0.5;
			const apronCenterX = (fallPositions.getX(apronLeft) + fallPositions.getX(apronRight)) * 0.5;
			fail(apronWidth > impactWidth * 1.1, `impact apron must spread downstream (${impactWidth} -> ${apronWidth})`);
			fail(apronCenterX > impactCenterX, 'impact apron must extend in the waterfall downstream direction');
			fail(waterfall.material.opacity === 0.74, 'waterfall transparency drifted');
			fail(waterfall.material.userData.opticalProfile?.aerated === true, 'waterfall aeration metadata disappeared');
			fail(waterfall.material.userData.opticalProfile?.splashApron === true, 'waterfall splash-apron metadata disappeared');
			fail(waterfall.material.userData.opticalProfile?.singleDrawCall === true, 'waterfall apron must not add a draw-call mesh');
			fail(waterfall.material.userData.opticalProfile?.segmentedCascade === true, 'waterfall segmented-cascade metadata disappeared');
			fail(waterfall.material.userData.opticalProfile?.turbulentFoamBreakup === true, 'waterfall turbulence breakup metadata disappeared');

			const summary = {
				calmSpeed,
				rapidSpeed,
				colorDistance: calmRapidColorDistance,
				riverOpacity: river.material.opacity,
				waterfallOpacity: waterfall.material.opacity,
				waterfallVertices: fallPositions.count,
				cascadeSegments: segments,
				apronSpread: apronWidth / impactWidth,
			};
			disposeRiverMesh(river);
			disposeWaterfallMesh(waterfall);
			return summary;
		});

		assert(result.rapidSpeed > result.calmSpeed, 'slope-speed relation escaped browser contract');
		console.log(
			`[checkGeographicRiverVisualContract] PASS: calm ${result.calmSpeed.toFixed(2)}m/s → rapid ` +
			`${result.rapidSpeed.toFixed(2)}m/s, colour Δ ${result.colorDistance.toFixed(3)}, ` +
			`${result.waterfallVertices}-vertex/${result.cascadeSegments}-segment single-draw waterfall, ` +
			`apron spread x${result.apronSpread.toFixed(2)}.`,
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
