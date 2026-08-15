#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out='));
const OUT_PATH = OUT_ARG ? path.resolve(OUT_ARG.slice('--out='.length)) : null;
const playwright = loadPlaywright();
if (!playwright) throw new Error('[checkNWG10RuntimeSurfaceTopology] Playwright unavailable');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20_000 });
	const metrics = await page.evaluate(async () => {
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } });
		document.head.append(importMap);
		const pindexes = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
		const visual = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
		const { WORLD_REFERENCE_BASE_SURFACE_MASK, classifyReferenceBaseSurface } = pindexes;
		const { sampleRuntimeSurfaceSemanticTarget } = visual;
		const { width, height } = WORLD_REFERENCE_BASE_SURFACE_MASK;
		let fullWorldMismatches = 0;
		let g10Mismatches = 0;
		const g10Counts = { water: 0, land: 0 };
		let maxCenterWeightError = 0;
		let minCenterDominantWeight = 1;
		let checksum = 2166136261;
		for (let row = 0; row < height; row += 1) {
			const ny = (row + 0.5) / height;
			for (let col = 0; col < width; col += 1) {
				const nx = (col + 0.5) / width;
				const hard = classifyReferenceBaseSurface(nx, ny);
				const sample = sampleRuntimeSurfaceSemanticTarget(nx, ny, 8);
				if (sample.dominantSurface !== hard) fullWorldMismatches += 1;
				const sum = Object.values(sample.surfaceWeights).reduce((total, value) => total + value, 0);
				maxCenterWeightError = Math.max(maxCenterWeightError, Math.abs(1 - sum));
				minCenterDominantWeight = Math.min(minCenterDominantWeight, sample.surfaceWeights[hard] ?? 0);
				if (col >= 12 && col < 24 && row >= 0 && row < 8) {
					if (sample.dominantSurface !== hard) g10Mismatches += 1;
					if (hard === 'sea' || hard === 'lake') g10Counts.water += 1; else g10Counts.land += 1;
				}
				const q = ((sample.dominantSurface.charCodeAt(0) << 24) ^ Math.round((sample.surfaceWeights[hard] ?? 0) * 1e6)) >>> 0;
				for (let shift = 0; shift < 32; shift += 8) { checksum ^= (q >>> shift) & 255; checksum = Math.imul(checksum, 16777619) >>> 0; }
			}
		}
		return {
			mapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
			fullWorldCenters: width * height,
			fullWorldMismatches,
			g10Centers: 96,
			g10Mismatches,
			g10Water: g10Counts.water,
			g10Land: g10Counts.land,
			maxCenterWeightError,
			minCenterDominantWeight,
			checksum,
		};
	});
	if (metrics.mapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('map.png provenance drift');
	if (metrics.fullWorldCenters !== 6144 || metrics.fullWorldMismatches !== 0) throw new Error(`full-world semantic topology moved: ${metrics.fullWorldMismatches}/${metrics.fullWorldCenters}`);
	if (metrics.g10Centers !== 96 || metrics.g10Mismatches !== 0) throw new Error(`G10 semantic topology moved: ${metrics.g10Mismatches}/${metrics.g10Centers}`);
	if (metrics.g10Water !== 60 || metrics.g10Land !== 36) throw new Error(`G10 canonical fingerprint drifted: ${metrics.g10Water} water / ${metrics.g10Land} land`);
	if (metrics.maxCenterWeightError > 2e-6) throw new Error(`center weight partition drift: ${metrics.maxCenterWeightError}`);
	if (metrics.minCenterDominantWeight <= 0.5) throw new Error(`continuous reconstruction no longer anchors source centers: ${metrics.minCenterDominantWeight}`);
	if (OUT_PATH) { fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true }); fs.writeFileSync(OUT_PATH, `${JSON.stringify(metrics, null, 2)}\n`); }
	console.log(`NW_G10_RUNTIME_SURFACE_TOPOLOGY=${JSON.stringify(metrics)}`);
	console.log('NW_G10_RUNTIME_SURFACE_TOPOLOGY_OK');
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
