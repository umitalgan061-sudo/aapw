#!/usr/bin/env node
/**
 * checkStarfieldVisualContract.js — live-browser starfield render regression contract.
 * Pins the existing deterministic Points dome, ShaderMaterial, camera-follow update and teardown
 * behavior without changing runtime code or recalibrating owner-visible twinkle tuning values.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkStarfieldVisualContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createStarfield, updateStarfield, disposeStarfield } = await import('/src/3d/stars.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const arraysEqual = (a, b) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

			const starfield = createStarfield(1337);
			const twin = createStarfield(1337);
			const other = createStarfield(1338);
			fail(starfield?.isPoints === true, 'starfield is not THREE.Points');
			fail(starfield.geometry?.isBufferGeometry === true, 'starfield geometry is not BufferGeometry');
			fail(starfield.material?.isShaderMaterial === true, 'starfield material is not ShaderMaterial');
			fail(starfield.frustumCulled === false, 'starfield frustumCulled contract drifted');
			fail(close(starfield.renderOrder, -0.5), 'starfield renderOrder contract drifted');

			const position = starfield.geometry.getAttribute('position');
			const phase = starfield.geometry.getAttribute('aPhase');
			const freq = starfield.geometry.getAttribute('aFreq');
			fail(position?.itemSize === 3 && position.count === 1200, `expected 1200 position vertices, got ${position?.count}`);
			fail(phase?.itemSize === 1 && phase.count === 1200, 'aPhase attribute shape drifted');
			fail(freq?.itemSize === 1 && freq.count === 1200, 'aFreq attribute shape drifted');

			let minHeightFactor = Infinity;
			let maxHeightFactor = -Infinity;
			let minRadius = Infinity;
			let maxRadius = -Infinity;
			let minFreq = Infinity;
			let maxFreq = -Infinity;
			let minPhase = Infinity;
			let maxPhase = -Infinity;
			for (let i = 0; i < position.count; i++) {
				const x = position.getX(i);
				const y = position.getY(i);
				const z = position.getZ(i);
				const radius = Math.hypot(x, y, z);
				const heightFactor = y / 1850;
				const p = phase.getX(i);
				const f = freq.getX(i);
				fail(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite star position at ${i}`);
				fail(close(radius, 1850, 0.001), `star ${i} radius ${radius} drifted from 1850m dome`);
				fail(heightFactor >= 0.05 - 1e-6 && heightFactor <= 1 + 1e-6, `star ${i} escaped upper-dome height range`);
				fail(p >= 0 && p <= Math.PI * 2 + 1e-6, `star ${i} phase escaped 0..2π`);
				fail(f >= 0.4 - 1e-6 && f <= 1.3 + 1e-6, `star ${i} frequency escaped 0.4..1.3 rad/s`);
				minHeightFactor = Math.min(minHeightFactor, heightFactor);
				maxHeightFactor = Math.max(maxHeightFactor, heightFactor);
				minRadius = Math.min(minRadius, radius);
				maxRadius = Math.max(maxRadius, radius);
				minFreq = Math.min(minFreq, f);
				maxFreq = Math.max(maxFreq, f);
				minPhase = Math.min(minPhase, p);
				maxPhase = Math.max(maxPhase, p);
			}

			const material = starfield.material;
			fail(material.transparent === true && material.depthWrite === false && material.fog === false, 'star ShaderMaterial transparency/depth/fog contract drifted');
			fail(close(material.uniforms.uTime.value, 0) && close(material.uniforms.uNightFactor.value, 0), 'star initial time/night uniforms drifted');
			fail(close(material.uniforms.uSize.value, 2.2), 'star fixed pixel size drifted');
			fail(material.uniforms.uColor.value?.isColor === true && material.uniforms.uColor.value.getHex() === 0xf5f8ff, 'star color drifted');
			fail(material.vertexShader.includes('gl_PointSize = uSize'), 'vertex shader no longer uses fixed uSize pixels');
			fail(material.vertexShader.includes('vAlpha = uNightFactor * twinkle'), 'vertex shader night/twinkle alpha contract drifted');
			fail(material.fragmentShader.includes('vec4(uColor, vAlpha)'), 'fragment shader color/alpha output contract drifted');

			const p1 = Array.from(position.array);
			const p2 = Array.from(twin.geometry.getAttribute('position').array);
			const ph1 = Array.from(phase.array);
			const ph2 = Array.from(twin.geometry.getAttribute('aPhase').array);
			const f1 = Array.from(freq.array);
			const f2 = Array.from(twin.geometry.getAttribute('aFreq').array);
			const otherPositions = Array.from(other.geometry.getAttribute('position').array);
			fail(arraysEqual(p1, p2) && arraysEqual(ph1, ph2) && arraysEqual(f1, f2), 'same-seed star geometry/twinkle buffers are not bit-identical');
			fail(!arraysEqual(p1, otherPositions), 'different seed unexpectedly produced identical positions');

			const cameraPosition = new THREE.Vector3(123.25, 45.5, -678.75);
			updateStarfield(starfield, cameraPosition, 12.5, 0.73);
			fail(starfield.position.equals(cameraPosition), 'starfield did not recenter exactly on camera');
			fail(close(material.uniforms.uTime.value, 12.5) && close(material.uniforms.uNightFactor.value, 0.73), 'starfield update did not forward time/night uniforms');
			cameraPosition.set(-50, 8, 75);
			updateStarfield(starfield, cameraPosition, 99.25, 0);
			fail(starfield.position.equals(cameraPosition), 'second camera-follow update drifted');
			fail(close(material.uniforms.uTime.value, 99.25) && close(material.uniforms.uNightFactor.value, 0), 'day fade/update contract drifted');

			let geometryDisposals = 0;
			let materialDisposals = 0;
			starfield.geometry.addEventListener('dispose', () => geometryDisposals++);
			starfield.material.addEventListener('dispose', () => materialDisposals++);
			disposeStarfield(starfield);
			fail(geometryDisposals === 1 && materialDisposals === 1, `dispose events ${geometryDisposals}/${materialDisposals}, expected 1/1`);
			disposeStarfield(twin);
			disposeStarfield(other);

			return { minHeightFactor, maxHeightFactor, minRadius, maxRadius, minFreq, maxFreq, minPhase, maxPhase, geometryDisposals, materialDisposals };
		});
		assert(result.geometryDisposals === 1 && result.materialDisposals === 1, 'starfield teardown escaped browser contract');
		console.log(`[checkStarfieldVisualContract] PASS: 1200 deterministic stars on ${result.minRadius.toFixed(3)}-${result.maxRadius.toFixed(3)}m dome, heightFactor ${result.minHeightFactor.toFixed(3)}-${result.maxHeightFactor.toFixed(3)}, twinkle freq ${result.minFreq.toFixed(3)}-${result.maxFreq.toFixed(3)} rad/s, fixed 2.2px ShaderMaterial + camera-follow + disposal 1/1.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkStarfieldVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
