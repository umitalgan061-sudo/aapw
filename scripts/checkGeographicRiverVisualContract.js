#!/usr/bin/env node
/** Fast browser/WebGL contract and regional proof for production river/waterfall rendering. */
const fs = require('node:fs');
const path = require('node:path');
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
	const artifactDir = path.join(process.cwd(), 'artifacts', 'geographic-river-visual');
	fs.mkdirSync(artifactDir, { recursive: true });
	const screenshotPath = path.join(artifactDir, 'waterfall-regional.png');
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
	try {
		const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
		await page.goto(`http://127.0.0.1:${port}/scripts/geographicRiverHarness.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createRiverMesh, createWaterfallMesh, updateFlowAnimation, disposeRiverMesh, disposeWaterfallMesh } = await import('/src/3d/world/rivers.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const colorDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
			const points = [new THREE.Vector3(0, 10, 0), new THREE.Vector3(20, 9.9, 0), new THREE.Vector3(40, 1.0, 0), new THREE.Vector3(60, 0.8, 0)];
			const river = createRiverMesh(points, 14);
			fail(river?.isMesh === true, 'river mesh was not created');
			const speeds = river.geometry.getAttribute('aFlowSpeed');
			const colors = river.geometry.getAttribute('color');
			const calmSpeed = speeds.getX(0);
			const rapidSpeed = speeds.getX(2);
			fail(rapidSpeed > calmSpeed, `rapid ${rapidSpeed} must be faster than calm reach ${calmSpeed}`);
			const calmColor = new THREE.Color(colors.getX(0), colors.getY(0), colors.getZ(0));
			const rapidColor = new THREE.Color(colors.getX(2), colors.getY(2), colors.getZ(2));
			const calmRapidColorDistance = colorDistance(calmColor, rapidColor);
			fail(calmRapidColorDistance > 0.01, 'calm pool and rapid water collapsed to one colour');
			fail(river.material.opacity === 0.74, 'river bed-readability opacity drifted');
			fail(river.material.userData.opticalProfile?.turbulentFoamBreakup === true, 'river turbulence breakup metadata disappeared');
			const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>' };
			river.material.onBeforeCompile(shader);
			for (const token of ['riverFlowEnergy', 'riverTurbulentBreakup', 'riverRoughnessTarget', 'riverWorldPerturb']) fail(shader.fragmentShader.includes(token), `river shader missing ${token}`);
			updateFlowAnimation(river, 7.5);
			fail(river.material.userData.flowUniforms.uTime.value === 7.5, 'river animation time did not advance');

			const waterfall = createWaterfallMesh({ top: new THREE.Vector3(0, 12, 0), bottom: new THREE.Vector3(4, 4, 0), dropMeters: 8 }, 14);
			const fallPositions = waterfall.geometry.getAttribute('position');
			const fallColors = waterfall.geometry.getAttribute('color');
			const fallDistances = waterfall.geometry.getAttribute('aFlowDistance');
			const fallSpeeds = waterfall.geometry.getAttribute('aFlowSpeed');
			const fallIndex = waterfall.geometry.getIndex();
			const segments = waterfall.userData.cascadeColumnSegments;
			const rows = waterfall.userData.cascadeRowCount;
			const columns = segments + 1;
			fail(segments >= 12, `waterfall segmentation ${segments} is too coarse`);
			fail(rows >= 6, `waterfall cascade rows ${rows} are too sparse`);
			fail(fallPositions.count === columns * rows, 'waterfall segmented cascade vertex count drifted');
			fail(fallIndex?.count === segments * (rows - 1) * 6, 'waterfall index count drifted');
			const centerColumn = Math.floor(columns / 2);
			const crestVertex = centerColumn;
			const plungeVertex = columns * 2 + centerColumn;
			const impactVertex = columns * (rows - 2) + centerColumn;
			const apronVertex = columns * (rows - 1) + centerColumn;
			fail(fallSpeeds.getX(crestVertex) === 9, 'waterfall curtain flow speed drifted');
			fail(fallSpeeds.getX(impactVertex) < fallSpeeds.getX(crestVertex), 'impact must slow after free fall');
			const lip = new THREE.Color(fallColors.getX(crestVertex), fallColors.getY(crestVertex), fallColors.getZ(crestVertex));
			const plunge = new THREE.Color(fallColors.getX(plungeVertex), fallColors.getY(plungeVertex), fallColors.getZ(plungeVertex));
			const impact = new THREE.Color(fallColors.getX(impactVertex), fallColors.getY(impactVertex), fallColors.getZ(impactVertex));
			fail(lip.r > plunge.r && lip.g > plunge.g && lip.b > plunge.b, 'waterfall lip must remain aerated above plunge water');
			fail(impact.r > plunge.r && impact.g > plunge.g && impact.b > plunge.b, 'impact row must re-aerate brighter than plunge water');
			fail(Math.abs(fallDistances.getX(impactVertex) - 8) < 1e-6, 'impact flow must reach full drop distance');
			fail(fallDistances.getX(apronVertex) > fallDistances.getX(impactVertex), 'apron flow must advance downstream');
			const impactLeft = columns * (rows - 2);
			const impactRight = impactLeft + segments;
			const apronLeft = columns * (rows - 1);
			const apronRight = apronLeft + segments;
			const impactWidth = Math.hypot(fallPositions.getX(impactLeft) - fallPositions.getX(impactRight), fallPositions.getZ(impactLeft) - fallPositions.getZ(impactRight));
			const apronWidth = Math.hypot(fallPositions.getX(apronLeft) - fallPositions.getX(apronRight), fallPositions.getZ(apronLeft) - fallPositions.getZ(apronRight));
			fail(apronWidth > impactWidth * 1.1, `impact apron must spread downstream (${impactWidth} -> ${apronWidth})`);
			fail(waterfall.material.opacity === 0.82, 'aerated waterfall opacity drifted');
			fail(waterfall.material.userData.opticalProfile?.hangingCurtain === true, 'hanging-curtain production contract disappeared');
			fail(waterfall.material.userData.opticalProfile?.singleDrawCall === true, 'waterfall must remain one draw-call mesh');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x172126);
			scene.fog = new THREE.FogExp2(0x52636a, 0.012);
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(960, 540);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.05;
			document.body.style.margin = '0';
			document.body.style.background = '#172126';
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(42, 960 / 540, 0.1, 200);
			camera.position.set(23, 15, 26);
			camera.lookAt(5, 7, 0);
			scene.add(new THREE.HemisphereLight(0xb9d1df, 0x232018, 1.25));
			const key = new THREE.DirectionalLight(0xfff1d2, 2.35);
			key.position.set(-12, 24, 18);
			scene.add(key);
			const cliff = new THREE.Mesh(new THREE.BoxGeometry(7.5, 9, 22, 3, 5, 8), new THREE.MeshStandardMaterial({ color: 0x3b3a35, roughness: 0.88 }));
			cliff.position.set(-2.1, 7.5, 0);
			cliff.rotation.z = -0.07;
			scene.add(cliff);
			const basin = new THREE.Mesh(new THREE.PlaneGeometry(70, 55, 14, 10), new THREE.MeshStandardMaterial({ color: 0x343931, roughness: 0.92 }));
			basin.rotation.x = -Math.PI / 2;
			basin.position.set(12, 3.78, 0);
			scene.add(basin);
			scene.add(waterfall);
			updateFlowAnimation(waterfall, 2.35);
			renderer.render(scene, camera);
			const runnablePrograms = renderer.info.programs?.length || 0;
			fail(runnablePrograms > 0, 'waterfall WebGL render produced no runnable shader programs');
			const summary = { calmSpeed, rapidSpeed, colorDistance: calmRapidColorDistance, waterfallVertices: fallPositions.count, cascadeSegments: segments, cascadeRows: rows, apronSpread: apronWidth / impactWidth, runnablePrograms };
			disposeRiverMesh(river);
			disposeWaterfallMesh(waterfall);
			cliff.geometry.dispose(); cliff.material.dispose(); basin.geometry.dispose(); basin.material.dispose();
			return summary;
		});
		await page.screenshot({ path: screenshotPath, fullPage: true });
		assert(fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 5000, 'regional waterfall screenshot was not written');
		console.log(`[checkGeographicRiverVisualContract] PASS: calm ${result.calmSpeed.toFixed(2)}m/s → rapid ${result.rapidSpeed.toFixed(2)}m/s, ${result.waterfallVertices}-vertex/${result.cascadeSegments}x${result.cascadeRows} hanging cascade, apron spread x${result.apronSpread.toFixed(2)}, ${result.runnablePrograms} WebGL programs; proof ${path.relative(process.cwd(), screenshotPath)}.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkGeographicRiverVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
