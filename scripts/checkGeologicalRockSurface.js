#!/usr/bin/env node
/**
 * Browser regression for the photogrammetry-inspired geological rock treatment. It verifies that
 * geology is render-only, deterministic, rock-gated and spatially continuous, while final exposed
 * rock stays inside a restrained mineral palette and authored snow still covers the geology later.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkGeologicalRockSurface] SKIP: Playwright is not available.');
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
				TERRAIN_BIOME_SHADING_POLICY,
				resolveRockGeology,
				resolveTerrainBiomeColor,
			} = await import('/src/3d/world/terrainBiomeShading.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const colorDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

			fail(TERRAIN_BIOME_SHADING_POLICY.renderOnly === true, 'terrain geology stopped being render-only');
			fail(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged === true, 'geology changed height authority contract');
			fail(TERRAIN_BIOME_SHADING_POLICY.geologicalRockSurface === true, 'geological rock policy flag missing');

			const flat = resolveRockGeology({
				heightAboveSeaMeters: 40,
				slopeDegrees: 5,
				rockWeight: 0,
				worldX: 140,
				worldZ: 2800,
			});
			fail(flat.rockAmount === 0 && flat.detailEnergy === 0, 'geology leaked onto ordinary flat ground');

			const probe = { heightAboveSeaMeters: 180, slopeDegrees: 56, rockWeight: 1, worldX: 420, worldZ: 2750 };
			const first = resolveRockGeology(probe);
			const twin = resolveRockGeology(probe);
			fail(JSON.stringify(first) === JSON.stringify(twin), 'rock geology is not deterministic');
			fail(first.rockAmount > 0.99, `steep canonical rock authority ${first.rockAmount} is too weak`);

			// Scan a short real-world-sized face instead of pinning one lucky sine phase. The surface must
			// contain all geological modes somewhere on the face without any of them becoming dominant.
			let maxStrata = 0;
			let maxMineral = 0;
			let maxVein = 0;
			let maxErosion = 0;
			let maxEnergy = 0;
			let minEnergy = Infinity;
			let strongest = null;
			let weakest = null;
			for (let i = 0; i < 48; i++) {
				const sample = resolveRockGeology({
					heightAboveSeaMeters: 145 + (i % 8) * 7,
					slopeDegrees: 52 + (i % 3) * 3,
					rockWeight: 1,
					worldX: 260 + i * 11,
					worldZ: 2680 + (i % 6) * 13,
				});
				maxStrata = Math.max(maxStrata, sample.strata);
				maxMineral = Math.max(maxMineral, sample.mineral);
				maxVein = Math.max(maxVein, sample.vein);
				maxErosion = Math.max(maxErosion, sample.erosion);
				if (sample.detailEnergy > maxEnergy) { maxEnergy = sample.detailEnergy; strongest = { i, sample }; }
				if (sample.detailEnergy < minEnergy) { minEnergy = sample.detailEnergy; weakest = { i, sample }; }
			}
			fail(maxStrata > 0.7, `strata never become legible (${maxStrata})`);
			fail(maxMineral > 0.15, `mineral variation never appears (${maxMineral})`);
			fail(maxVein > 0.15, `mineral veins never appear (${maxVein})`);
			fail(maxErosion > 0.15, `erosion streaks never appear (${maxErosion})`);
			fail(maxEnergy > minEnergy + 0.035, `geological face lacks visible variation (${minEnergy}..${maxEnergy})`);
			fail(maxEnergy < 0.35, `geology is overpowering the base rock palette (${maxEnergy})`);

			const smoothA = resolveRockGeology({ ...probe, worldX: 500, worldZ: 2700 });
			const smoothB = resolveRockGeology({ ...probe, worldX: 500.1, worldZ: 2700.1 });
			const smoothDelta = Math.abs(smoothA.detailEnergy - smoothB.detailEnergy);
			fail(smoothDelta < 0.03, `geological field has a hard spatial seam (${smoothDelta})`);

			// Exposed southern rock: no altitude snow at 180m, so colour difference should come through.
			const colorA = new THREE.Color();
			const colorB = new THREE.Color();
			resolveTerrainBiomeColor(colorA, {
				heightAboveSeaMeters: 180,
				slopeDegrees: 58,
				rockWeight: 1,
				snowWeight: 0,
				worldX: 315,
				worldZ: 2900,
			});
			resolveTerrainBiomeColor(colorB, {
				heightAboveSeaMeters: 194,
				slopeDegrees: 58,
				rockWeight: 1,
				snowWeight: 0,
				worldX: 645,
				worldZ: 2910,
			});
			const exposedDelta = colorDistance(colorA, colorB);
			fail(exposedDelta > 0.012, `exposed rock geology is visually inert (${exposedDelta})`);
			for (const color of [colorA, colorB]) {
				const srgb = color.clone().convertLinearToSRGB();
				const max = Math.max(srgb.r, srgb.g, srgb.b);
				const saturation = max <= 0 ? 0 : (max - Math.min(srgb.r, srgb.g, srgb.b)) / max;
				fail(saturation < 0.38, `rock became implausibly saturated (${saturation})`);
			}

			// Authored snow must still be resolved after rock geology, so two geologically different
			// surfaces converge strongly when fully snow supplied on a gentle high surface.
			const snowA = new THREE.Color();
			const snowB = new THREE.Color();
			for (const [target, x] of [[snowA, 315], [snowB, 645]]) {
				resolveTerrainBiomeColor(target, {
					heightAboveSeaMeters: 500,
					slopeDegrees: 8,
					rockWeight: 1,
					snowWeight: 1,
					worldX: x,
					worldZ: 2900,
				});
			}
			const snowDelta = colorDistance(snowA, snowB);
			fail(snowDelta < exposedDelta, `snow no longer covers geological colour (${snowDelta} >= ${exposedDelta})`);

			return {
				maxStrata,
				maxMineral,
				maxVein,
				maxErosion,
				minEnergy,
				maxEnergy,
				smoothDelta,
				exposedDelta,
				snowDelta,
				strongestIndex: strongest?.i,
				weakestIndex: weakest?.i,
			};
		});

		assert(result.maxEnergy > result.minEnergy, 'geological variation escaped browser contract');
		console.log(
			`[checkGeologicalRockSurface] PASS: strata ${result.maxStrata.toFixed(2)}, mineral ${result.maxMineral.toFixed(2)}, ` +
			`vein ${result.maxVein.toFixed(2)}, erosion ${result.maxErosion.toFixed(2)}, energy ` +
			`${result.minEnergy.toFixed(3)}..${result.maxEnergy.toFixed(3)}, 10cm continuity Δ${result.smoothDelta.toFixed(4)}, ` +
			`exposed/snow colour Δ ${result.exposedDelta.toFixed(3)}/${result.snowDelta.toFixed(3)}.`,
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkGeologicalRockSurface] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
