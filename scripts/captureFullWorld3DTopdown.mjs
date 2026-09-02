#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function parseArgs(argv) {
	const args = {
		output: 'artifacts/full-world-3d-topdown/full-world-3d-topdown.png',
		width: 1600,
		height: 1100,
		segments: 240,
		port: 4173,
		focus: 'world',
	};
	for (const token of argv) {
		const [key, value] = token.split('=', 2);
		if (key === '--output') args.output = value;
		else if (key === '--width') args.width = Number(value);
		else if (key === '--height') args.height = Number(value);
		else if (key === '--segments') args.segments = Number(value);
		else if (key === '--port') args.port = Number(value);
		else if (key === '--focus') args.focus = value === 'valyria' ? 'valyria' : 'world';
	}
	return args;
}

async function waitForServer(url, attempts = 60) {
	let lastError;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await fetch(url, { cache: 'no-store' });
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw lastError ?? new Error('static server did not start');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	assert(Number.isFinite(args.width) && args.width >= 640);
	assert(Number.isFinite(args.height) && args.height >= 480);
	assert(Number.isFinite(args.segments) && args.segments >= 80);
	assert(Number.isInteger(args.port) && args.port > 0);

	const outputPath = path.resolve(repoRoot, args.output);
	const jsonPath = outputPath.replace(/\.png$/i, '.json');
	await fs.mkdir(path.dirname(outputPath), { recursive: true });

	const server = spawn('python3', ['-m', 'http.server', String(args.port), '--bind', '127.0.0.1'], {
		cwd: repoRoot,
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let serverStderr = '';
	server.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });

	let browser;
	try {
		const baseUrl = `http://127.0.0.1:${args.port}`;
		const harnessUrl = `${baseUrl}/scripts/fullWorld3DTopdownHarness.html`;
		await waitForServer(harnessUrl);
		browser = await chromium.launch({
			headless: true,
			args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
		});
		const page = await browser.newPage({ viewport: { width: args.width, height: args.height } });
		const pageErrors = [];
		let rejectPageFailure;
		const pageFailure = new Promise((_, reject) => { rejectPageFailure = reject; });
		page.on('pageerror', (error) => {
			pageErrors.push(error.message);
			rejectPageFailure(new Error(`page: ${error.message}`));
		});
		page.on('console', (message) => {
			if (message.type() !== 'error') return;
			pageErrors.push(`console: ${message.text()}`);
			rejectPageFailure(new Error(`console: ${message.text()}`));
		});
		const url = `${harnessUrl}?width=${args.width}&height=${args.height}&segments=${args.segments}&focus=${args.focus}`;
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await Promise.race([
			page.waitForFunction(
				() => window.__FULL_WORLD_3D_TOPDOWN__?.status === 'ready',
				null,
				{ timeout: 300000 },
			),
			pageFailure,
		]);
		const summary = await page.evaluate(() => window.__FULL_WORLD_3D_TOPDOWN__);
		if (pageErrors.length) throw new Error(pageErrors.join('\n'));

		await page.screenshot({ path: outputPath, type: 'png', timeout: 120000 });
		await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

		assert.equal(summary.camera.type, 'OrthographicCamera');
		assert.equal(summary.focus, args.focus, 'requested regional focus drifted');
		assert.equal(summary.camera.verticalExaggeration, 1, 'QA must render production vertical scale');
		assert(summary.vertexCount > 20000, 'full-world terrain mesh is unexpectedly coarse');
		assert(summary.maxHeightMeters - summary.minHeightMeters > 400, 'major mountain relief is not visible in sampled height range');
		assert(summary.heightStdDevMeters > 20, 'full-world relief variance is unexpectedly flat');
		assert(summary.surfaceCounts.sea > summary.surfaceCounts.lake, 'sea must remain the dominant water class');
		assert(summary.surfaceCounts.lake > 0, 'canonical inland lakes disappeared from full-world sampling');
		assert(summary.northPermanentIceMax >= 0.8, 'authored permanent-ice core disappeared from the north');
		assert(summary.northPermanentIceActiveSamples > 0, 'no strong permanent-ice samples were represented');

		assert.equal(summary.terrainSurfaceRealism?.policyId, 'terrain-micro-surface-world-uv-pbr-v8-granular-snow',
			'full-world proof must render the production photoreal terrain surface policy');
		assert.equal(summary.terrainSurfaceRealism?.snowGranularAlbedo, true,
			'full-world proof must include deterministic metre-scale snow albedo grain');
		assert.equal(summary.terrainSurfaceRealism?.snowMicroNormal, true,
			'full-world proof must include wind-shaped snow micro normals');
		assert.equal(summary.terrainSurfaceRealism?.snowRoughnessVariation, true,
			'full-world proof must include granular snow roughness variation');
		assert.deepEqual(summary.terrainSurfaceRealism?.snowSurfaceScaleMeters, [2.6, 11, 34],
			'full-world proof must retain the authored fine/meso/sastrugi snow scales');
		assert.equal(summary.terrainSurfaceRealism?.naturalAlbedoRemap, true,
			'full-world proof must include natural vegetation/soil/snow albedo remapping');
		assert.equal(summary.terrainSurfaceRealism?.macroColorBreakup, true,
			'full-world proof must include multi-kilometre terrain colour breakup');
		assert.equal(summary.terrainSurfaceRealism?.regionalMoistureVariation, true,
			'full-world proof must include broad damp/dry terrain variation');
		assert.equal(summary.terrainSurfaceRealism?.elevationWeathering, true,
			'full-world proof must include elevation-driven terrain weathering');
		assert.equal(summary.terrainSurfaceRealism?.coastalIntertidalBreakup, true,
			'full-world proof must include the current bounded intertidal terrain weathering pass');
		assert.equal(summary.terrainSurfaceRealism?.coastalSaltSprayWeathering, true,
			'full-world proof must include sparse coastal salt/mineral weathering');
		assert.equal(summary.terrainSurfaceRealism?.coastalRoughnessResponse, true,
			'full-world proof must include coastal material roughness response');
		assert.equal(summary.terrainSurfaceRealism?.uvChannel, 1,
			'full-world proof must use production metre-space uv1 for terrain PBR detail');
		assert.equal(summary.terrainSurfaceRealism?.valyriaWorldSpacePbr, true,
			'proof must compile the Valyria world-space albedo/normal/roughness layer');
		assert.equal(summary.terrainSurfaceRealism?.valyriaProductionVertexColorParity, true,
			'Valyria regional proof must apply the same biome -> lithology vertex-colour order as production terrain');
		assert.equal(summary.terrainSurfaceRealism?.canonicalHeightUnchanged, true,
			'visual material proof must remain canonical-height neutral');
		assert.equal(summary.terrainSurfaceRealism?.canonicalHydrologyUnchanged, true,
			'visual material proof must remain canonical-hydrology neutral');

		// This is deliberately stronger than the historical screenshot gate: the proof must actually
		// contain natural-geology meshes, not just a terrain material carrying geology-related metadata.
		assert.equal(summary.naturalGeology?.inScene, true, 'natural geology group is missing from rendered proof scene');
		assert(summary.naturalGeology?.placementCount > 100, 'natural geology placement field is unexpectedly sparse');
		assert(summary.naturalGeology?.renderedInstanceCount > 100, 'natural geology meshes were not rendered');
		assert(summary.naturalGeology?.groupChildCount >= 4, 'natural geology family breakup collapsed');
		assert(summary.naturalGeology?.assetProxyCount > 0, 'GLB replacement proxy placements disappeared');
		assert(summary.naturalGeology?.valyriaPlacementCount > 0, 'Valyria-specific geology placements disappeared');
		assert.equal(summary.naturalGeology?.worldSpaceRockWeathering, true,
			'proof must compile world-space albedo/normal/roughness weathering on geology meshes');
		assert.equal(summary.naturalGeology?.deterministicMineralFacetSeparation, true,
			'proof must retain deterministic mineral/facet separation on geology meshes');
		assert.equal(summary.naturalGeology?.volcanicFallbackMaterialIsolation, true,
			'Valyria fallback materials must remain isolated from non-volcanic rock families');
		assert.equal(summary.naturalGeology?.smallFallbackShadowSuppression, true,
			'small fallback families must not collapse into hard black shadow needles');
		assert.equal(summary.naturalGeology?.roundedBoulderNormalResponse, true,
			'fallback boulders must retain a rounded natural-light response');
		assert.equal(summary.naturalGeology?.volcanicFallbackSmoothedLightingNormals, true,
			'Valyria fallback facets must avoid sub-pixel black side-light aliasing');
		assert.equal(summary.naturalGeology?.volcanicFallbackCalibratedBasaltReflectance, true,
			'Valyria basalt fallback must stay inside the calibrated dark-rock reflectance family');
		assert.equal(Object.values(summary.naturalGeology?.kindCounts ?? {}).reduce((sum, count) => sum + count, 0),
			summary.naturalGeology?.placementCount, 'geology kind breakdown must cover every placement');
		assert.equal(Object.values(summary.naturalGeology?.valyriaKindCounts ?? {}).reduce((sum, count) => sum + count, 0),
			summary.naturalGeology?.valyriaPlacementCount, 'Valyria kind breakdown must cover every volcanic placement');
		assert.equal(summary.naturalGeology?.visualProofUsesDeterministicFallback, true,
			'pointer-only CI proof must explicitly render deterministic procedural fallback geometry');
		if (args.focus === 'valyria') {
			assert(summary.camera.activeHalfHeight >= 900 && summary.camera.activeHalfHeight <= 1200,
				'Valyria proof framing must expose volcanic material detail without cropping the regional context');
			assert(summary.camera.activeHalfHeight < summary.camera.fittedHalfHeight,
				'Valyria proof must use the tighter regional camera rather than the full-world framing');
		}

		assert(summary.waterDepthField.meanWetCoverage > 0.35, 'production water coverage is unexpectedly sparse');
		assert(summary.waterDepthField.mixedCoastTexelRatio > 0, 'coastline anti-alias coverage disappeared');
		assert.equal(summary.waterLayerComposition.nearDepthWrite, true, 'near swell must retain depth writes');
		assert.equal(summary.waterLayerComposition.farDepthWrite, false, 'far transparent water underlay must not occlude near swell');
		assert(summary.waterLayerComposition.farRenderOrder < 0, 'far water underlay must render before near swell');
		assert(summary.waterLayerComposition.farLocalY < 0, 'far water underlay must remain slightly below near water');
		assert.equal(summary.waterLayerComposition.deepBackdropDepthWrite, true, 'deep-ocean backdrop must write depth behind transparent water');
		assert.equal(summary.waterLayerComposition.deepBackdropOpaque, true, 'deep-ocean backdrop must remain opaque');
		assert.equal(summary.waterLayerComposition.deepBackdropFog, true, 'deep-ocean backdrop must participate in scene fog');
		assert(summary.waterLayerComposition.deepBackdropRenderOrder < summary.waterLayerComposition.farRenderOrder,
			'deep-ocean backdrop must render before the transparent far-water underlay');
		assert(summary.waterLayerComposition.deepBackdropLocalY < summary.waterLayerComposition.farLocalY,
			'deep-ocean backdrop must remain below the far-water underlay');
		assert(summary.waterLayerComposition.deepBackdropWorldY < summary.minHeightMeters - 1,
			'deep-ocean backdrop must stay safely below the lowest canonical owner terrain');
		const worldDiagonal = Math.hypot(summary.worldWidthMeters, summary.worldDepthMeters);
		assert(summary.waterLayerComposition.deepBackdropExtentMeters > worldDiagonal * 1.5,
			'deep-ocean backdrop must extend comfortably beyond the owner-world diagonal in high-camera views');
		assert(Math.abs(summary.waterLayerComposition.nearWorldXZ[0] - summary.camera.position[0]) < 1e-6,
			'near-water world X must follow the topdown camera exactly');
		assert(Math.abs(summary.waterLayerComposition.nearWorldXZ[1] - summary.camera.position[2]) < 1e-6,
			'near-water world Z must follow the topdown camera exactly');

		console.log('[captureFullWorld3DTopdown] PASS', JSON.stringify({
			output: path.relative(repoRoot, outputPath),
			json: path.relative(repoRoot, jsonPath),
			vertices: summary.vertexCount,
			heightRange: [summary.minHeightMeters, summary.maxHeightMeters],
			lakeSamples: summary.surfaceCounts.lake,
			northPermanentIceMean: summary.northPermanentIceMean,
			northPermanentIceMax: summary.northPermanentIceMax,
			terrainSurfaceRealism: summary.terrainSurfaceRealism,
			naturalGeology: summary.naturalGeology,
			waterLayers: summary.waterLayerComposition,
		}));
	} finally {
		await browser?.close().catch(() => {});
		server.kill('SIGTERM');
		if (serverStderr && server.exitCode && server.exitCode !== 0) process.stderr.write(serverStderr);
	}
}

main().catch((error) => {
	console.error('[captureFullWorld3DTopdown] FAIL', error);
	process.exitCode = 1;
});

