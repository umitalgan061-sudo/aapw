#!/usr/bin/env node
/**
 * Live-browser starfield render regression contract.
 *
 * Preserves the canonical same-seed sky positions/twinkle buffers while locking the successor's
 * independently seeded apparent-magnitude, restrained stellar-temperature and circular point-spread
 * treatment. Camera-follow, canonical nightFactor forwarding and teardown remain unchanged.
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
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
			const size = starfield.geometry.getAttribute('aSize');
			const brightness = starfield.geometry.getAttribute('aBrightness');
			const color = starfield.geometry.getAttribute('aColor');
			fail(position?.itemSize === 3 && position.count === 1200, `expected 1200 position vertices, got ${position?.count}`);
			fail(phase?.itemSize === 1 && phase.count === 1200, 'aPhase attribute shape drifted');
			fail(freq?.itemSize === 1 && freq.count === 1200, 'aFreq attribute shape drifted');
			fail(size?.itemSize === 1 && size.count === 1200, 'aSize attribute shape drifted');
			fail(brightness?.itemSize === 1 && brightness.count === 1200, 'aBrightness attribute shape drifted');
			fail(color?.itemSize === 3 && color.count === 1200, 'aColor attribute shape drifted');

			let minHeightFactor = Infinity;
			let maxHeightFactor = -Infinity;
			let minRadius = Infinity;
			let maxRadius = -Infinity;
			let minFreq = Infinity;
			let maxFreq = -Infinity;
			let minSize = Infinity;
			let maxSize = -Infinity;
			let minBrightness = Infinity;
			let maxBrightness = -Infinity;
			let sizeTotal = 0;
			let faintSmallCount = 0;
			let brightLargeCount = 0;
			let warmCount = 0;
			let coolCount = 0;
			let neutralCount = 0;

			for (let i = 0; i < position.count; i++) {
				const x = position.getX(i);
				const y = position.getY(i);
				const z = position.getZ(i);
				const radius = Math.hypot(x, y, z);
				const heightFactor = y / 1850;
				const p = phase.getX(i);
				const f = freq.getX(i);
				const s = size.getX(i);
				const lum = brightness.getX(i);
				const r = color.getX(i);
				const g = color.getY(i);
				const b = color.getZ(i);

				fail(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite star position at ${i}`);
				fail(close(radius, 1850, 0.001), `star ${i} radius ${radius} drifted from 1850m dome`);
				fail(heightFactor >= 0.05 - 1e-6 && heightFactor <= 1 + 1e-6, `star ${i} escaped upper-dome height range`);
				fail(p >= 0 && p <= Math.PI * 2 + 1e-6, `star ${i} phase escaped 0..2π`);
				fail(f >= 0.4 - 1e-6 && f <= 1.3 + 1e-6, `star ${i} frequency escaped 0.4..1.3 rad/s`);
				fail(s >= 1.25 - 1e-6 && s <= 3.25 + 1e-6, `star ${i} size ${s} escaped magnitude range`);
				fail(lum >= 0.42 - 1e-6 && lum <= 1.0 + 1e-6, `star ${i} brightness ${lum} escaped luminance range`);
				fail([r, g, b].every((value) => Number.isFinite(value) && value >= 0.75 && value <= 1.001), `star ${i} color escaped restrained stellar range`);

				if (s < 1.65 && lum < 0.55) faintSmallCount++;
				if (s > 2.45 && lum > 0.75) brightLargeCount++;
				if (r - b > 0.08) warmCount++;
				else if (b - r > 0.08) coolCount++;
				else neutralCount++;

				minHeightFactor = Math.min(minHeightFactor, heightFactor);
				maxHeightFactor = Math.max(maxHeightFactor, heightFactor);
				minRadius = Math.min(minRadius, radius);
				maxRadius = Math.max(maxRadius, radius);
				minFreq = Math.min(minFreq, f);
				maxFreq = Math.max(maxFreq, f);
				minSize = Math.min(minSize, s);
				maxSize = Math.max(maxSize, s);
				minBrightness = Math.min(minBrightness, lum);
				maxBrightness = Math.max(maxBrightness, lum);
				sizeTotal += s;
			}

			fail(maxSize - minSize > 1.6, `star magnitude size spread too narrow: ${minSize}..${maxSize}`);
			fail(maxBrightness - minBrightness > 0.45, `star brightness spread too narrow: ${minBrightness}..${maxBrightness}`);
			fail(faintSmallCount > 650, `faint/small stars no longer dominate: ${faintSmallCount}`);
			fail(brightLargeCount >= 15 && brightLargeCount <= 180, `bright anchor population implausible: ${brightLargeCount}`);
			fail(warmCount >= 60 && warmCount <= 220, `warm-star population drifted: ${warmCount}`);
			fail(coolCount >= 100 && coolCount <= 320, `cool-star population drifted: ${coolCount}`);
			fail(neutralCount > warmCount + coolCount, `near-neutral stars no longer dominate: ${neutralCount}/${warmCount}/${coolCount}`);

			const material = starfield.material;
			fail(material.transparent === true && material.depthWrite === false && material.fog === false, 'star ShaderMaterial transparency/depth/fog contract drifted');
			fail(close(material.uniforms.uTime.value, 0) && close(material.uniforms.uNightFactor.value, 0), 'star initial time/night uniforms drifted');
			fail(!material.uniforms.uSize && !material.uniforms.uColor, 'legacy uniform size/color path still present');
			fail(material.userData.starfieldRealism === 'magnitude-temperature-circular-psf-v1', 'star realism marker missing');
			for (const token of ['attribute float aSize', 'attribute float aBrightness', 'attribute vec3 aColor', 'gl_PointSize = aSize', 'vColor = aColor']) {
				fail(material.vertexShader.includes(token), `stellar vertex token missing: ${token}`);
			}
			for (const token of ['gl_PointCoord', 'if (radius > 0.5) discard', 'smoothstep(0.02, 0.22, radius)', 'smoothstep(0.16, 0.50, radius)', 'vec4(color, alpha)']) {
				fail(material.fragmentShader.includes(token), `circular stellar fragment token missing: ${token}`);
			}

			const attributeArray = (field, geometry = starfield.geometry) => Array.from(geometry.getAttribute(field).array);
			const sameSeedFields = ['position', 'aPhase', 'aFreq', 'aSize', 'aBrightness', 'aColor'];
			for (const field of sameSeedFields) {
				fail(arraysEqual(attributeArray(field), attributeArray(field, twin.geometry)), `same-seed ${field} buffer is not bit-identical`);
			}
			fail(!arraysEqual(attributeArray('position'), attributeArray('position', other.geometry)), 'different seed unexpectedly produced identical positions');
			fail(!arraysEqual(attributeArray('aSize'), attributeArray('aSize', other.geometry)), 'different seed unexpectedly produced identical appearance');

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

			return {
				minHeightFactor, maxHeightFactor, minRadius, maxRadius, minFreq, maxFreq,
				minSize, maxSize, meanSize: sizeTotal / position.count,
				minBrightness, maxBrightness, faintSmallCount, brightLargeCount,
				warmCount, neutralCount, coolCount, geometryDisposals, materialDisposals,
			};
		});
		assert(result.geometryDisposals === 1 && result.materialDisposals === 1, 'starfield teardown escaped browser contract');
		console.log(`[checkStarfieldVisualContract] PASS: 1200 deterministic stars, size ${result.minSize.toFixed(2)}-${result.maxSize.toFixed(2)}px (mean ${result.meanSize.toFixed(2)}), brightness ${result.minBrightness.toFixed(2)}-${result.maxBrightness.toFixed(2)}, faint=${result.faintSmallCount}, bright=${result.brightLargeCount}, warm/neutral/cool=${result.warmCount}/${result.neutralCount}/${result.coolCount}, camera-follow + disposal 1/1.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkStarfieldVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
