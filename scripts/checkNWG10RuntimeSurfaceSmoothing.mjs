#!/usr/bin/env node
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const playwright = loadPlaywright();
if (!playwright) throw new Error('[checkNWG10RuntimeSurfaceSmoothing] Playwright unavailable');

const G10 = Object.freeze({ xMin: 1 / 8, xMax: 2 / 8, yMin: 0, yMax: 1 / 8 });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
	const consoleErrors = [];
	const pageErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20_000 });

	const metrics = await page.evaluate(async (bounds) => {
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);
		const THREE = await import('/src/3d/vendor/three/three.module.js');
		const pindexes = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
		const visual = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
		const { WORLD_REFERENCE_BASE_SURFACE_MASK, classifyReferenceBaseSurface } = pindexes;
		const { WORLD_REFERENCE_SURFACE_VISUAL_POLICY, sampleRuntimeSurfaceSemanticTarget } = visual;
		const palette = Object.fromEntries(Object.entries(WORLD_REFERENCE_SURFACE_VISUAL_POLICY.colors).map(([surface, hex]) => [surface, new THREE.Color(hex)]));
		const epsilon = 1e-5;
		const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
		const paletteDistance = (a, b) => {
			const ca = palette[a]; const cb = palette[b];
			return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
		};
		const boundarySamples = [];
		const width = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
		const height = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
		const pushBoundary = (axis, coordinate, along, hardA, hardB, left, right, middle) => {
			if (hardA === hardB) return;
			boundarySamples.push({
				axis,
				coordinate,
				along,
				hardA,
				hardB,
				legacyJump: paletteDistance(hardA, hardB),
				continuousJump: colorDistance(left.color, right.color),
				midBoundaryBlend: middle.boundaryBlend,
				weightSumError: Math.abs(1 - Object.values(middle.surfaceWeights).reduce((sum, value) => sum + value, 0)),
			});
		};

		for (let row = 0; row < height; row += 1) {
			const ny = (row + 0.5) / height;
			if (ny < bounds.yMin || ny > bounds.yMax) continue;
			for (let col = 0; col < width - 1; col += 1) {
				const nx = (col + 1) / width;
				if (nx <= bounds.xMin || nx >= bounds.xMax) continue;
				const hardA = classifyReferenceBaseSurface((col + 0.5) / width, ny);
				const hardB = classifyReferenceBaseSurface((col + 1.5) / width, ny);
				pushBoundary(
					'x', nx, ny, hardA, hardB,
					sampleRuntimeSurfaceSemanticTarget(nx - epsilon, ny, 8),
					sampleRuntimeSurfaceSemanticTarget(nx + epsilon, ny, 8),
					sampleRuntimeSurfaceSemanticTarget(nx, ny, 8),
				);
			}
		}
		for (let col = 0; col < width; col += 1) {
			const nx = (col + 0.5) / width;
			if (nx < bounds.xMin || nx > bounds.xMax) continue;
			for (let row = 0; row < height - 1; row += 1) {
				const ny = (row + 1) / height;
				if (ny <= bounds.yMin || ny >= bounds.yMax) continue;
				const hardA = classifyReferenceBaseSurface(nx, (row + 0.5) / height);
				const hardB = classifyReferenceBaseSurface(nx, (row + 1.5) / height);
				pushBoundary(
					'y', ny, nx, hardA, hardB,
					sampleRuntimeSurfaceSemanticTarget(nx, ny - epsilon, 8),
					sampleRuntimeSurfaceSemanticTarget(nx, ny + epsilon, 8),
					sampleRuntimeSurfaceSemanticTarget(nx, ny, 8),
				);
			}
		}

		const denseSize = 257;
		let maxWeightSumError = 0;
		let minBlend = Infinity;
		let maxBlend = -Infinity;
		let minRoughness = Infinity;
		let maxRoughness = -Infinity;
		let blendedDenseSamples = 0;
		let checksum = 2166136261;
		const mix = (value) => {
			const q = Math.round(value * 1e7);
			for (let shift = 0; shift < 32; shift += 8) {
				checksum ^= (q >>> shift) & 255;
				checksum = Math.imul(checksum, 16777619) >>> 0;
			}
		};
		for (let y = 0; y < denseSize; y += 1) {
			const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (denseSize - 1);
			for (let x = 0; x < denseSize; x += 1) {
				const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (denseSize - 1);
				const sample = sampleRuntimeSurfaceSemanticTarget(nx, ny, 8);
				const sum = Object.values(sample.surfaceWeights).reduce((total, value) => total + value, 0);
				maxWeightSumError = Math.max(maxWeightSumError, Math.abs(1 - sum));
				minBlend = Math.min(minBlend, sample.blend); maxBlend = Math.max(maxBlend, sample.blend);
				minRoughness = Math.min(minRoughness, sample.roughness); maxRoughness = Math.max(maxRoughness, sample.roughness);
				if (sample.boundaryBlend > 0.02) blendedDenseSamples += 1;
				for (const value of [...sample.color, sample.roughness, sample.blend, sample.boundaryBlend]) mix(value);
			}
		}

		const sum = (key) => boundarySamples.reduce((total, sample) => total + sample[key], 0);
		const max = (key) => Math.max(0, ...boundarySamples.map((sample) => sample[key]));
		return {
			mapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
			maskSize: [width, height],
			boundaryCount: boundarySamples.length,
			legacyMeanJump: sum('legacyJump') / Math.max(1, boundarySamples.length),
			legacyMaxJump: max('legacyJump'),
			continuousMeanJump: sum('continuousJump') / Math.max(1, boundarySamples.length),
			continuousMaxJump: max('continuousJump'),
			meanJumpRatio: sum('continuousJump') / Math.max(1e-12, sum('legacyJump')),
			midBoundaryBlendCount: boundarySamples.filter((sample) => sample.midBoundaryBlend > 0.05).length,
			maxBoundaryWeightSumError: max('weightSumError'),
			denseSamples: denseSize * denseSize,
			blendedDenseSamples,
			maxWeightSumError,
			blendRange: [minBlend, maxBlend],
			roughnessRange: [minRoughness, maxRoughness],
			checksum,
		};
	}, G10);

	const second = await page.evaluate(async (bounds) => {
		const { sampleRuntimeSurfaceSemanticTarget } = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
		let checksum = 2166136261;
		for (let y = 0; y < 257; y += 1) {
			const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / 256;
			for (let x = 0; x < 257; x += 1) {
				const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / 256;
				const sample = sampleRuntimeSurfaceSemanticTarget(nx, ny, 8);
				for (const value of [...sample.color, sample.roughness, sample.blend, sample.boundaryBlend]) {
					const q = Math.round(value * 1e7);
					for (let shift = 0; shift < 32; shift += 8) { checksum ^= (q >>> shift) & 255; checksum = Math.imul(checksum, 16777619) >>> 0; }
				}
			}
		}
		return checksum;
	}, G10);

	if (consoleErrors.length) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
	if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
	if (metrics.mapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('map.png provenance drift');
	if (metrics.maskSize[0] !== 96 || metrics.maskSize[1] !== 64) throw new Error(`unexpected semantic mask ${metrics.maskSize}`);
	if (metrics.boundaryCount < 12) throw new Error(`G10 has too few measured semantic boundaries: ${metrics.boundaryCount}`);
	if (metrics.continuousMeanJump > metrics.legacyMeanJump * 0.025) throw new Error(`mean hard-edge residual too high: ratio=${metrics.meanJumpRatio}`);
	if (metrics.continuousMaxJump > 0.006) throw new Error(`max continuous boundary jump too high: ${metrics.continuousMaxJump}`);
	if (metrics.midBoundaryBlendCount < Math.floor(metrics.boundaryCount * 0.8)) throw new Error(`too few source boundaries reconstruct continuously: ${metrics.midBoundaryBlendCount}/${metrics.boundaryCount}`);
	if (metrics.maxBoundaryWeightSumError > 2e-6 || metrics.maxWeightSumError > 2e-6) throw new Error(`surface weights no longer partition unity: ${metrics.maxWeightSumError}`);
	if (metrics.blendedDenseSamples < 1_000) throw new Error(`dense G10 reconstruction is effectively hard-classified: ${metrics.blendedDenseSamples}`);
	if (metrics.blendRange[0] < 0 || metrics.blendRange[1] > 0.700001) throw new Error(`semantic blend range invalid: ${metrics.blendRange}`);
	if (metrics.roughnessRange[0] < 0.87 || metrics.roughnessRange[1] > 1.001) throw new Error(`roughness range invalid: ${metrics.roughnessRange}`);
	if (metrics.checksum !== second) throw new Error(`runtime semantic reconstruction is non-deterministic: ${metrics.checksum} != ${second}`);
	console.log(`NW_G10_RUNTIME_SURFACE_SMOOTHING=${JSON.stringify(metrics)}`);
	console.log('NW_G10_RUNTIME_SURFACE_SMOOTHING_OK');
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
