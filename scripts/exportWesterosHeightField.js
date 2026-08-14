#!/usr/bin/env node
/**
 * exportWesterosHeightField.js — bridge from the shipped Three.js world to the Godot/Terrain3D
 * authoring workspace (`godot/terrain-authoring/`, DECISIONS.md ADR-0266).
 *
 * Samples the *real, live* `world/terrain.js` height field — the exact `createHeightSampler` output
 * the shipped game renders, including `world/settlements.js`'s settlement flatten pads (ADR-0118) —
 * over a regular grid aligned to Terrain3D's region layout, and writes it as a raw little-endian
 * Float32 heightmap plus a JSON manifest.
 *
 * Why raw Float32 rather than PNG/EXR: Terrain3D height maps are `Image.FORMAT_RF` (32-bit float).
 * A raw buffer round-trips through `Image.create_from_data(..., FORMAT_RF, bytes)` in GDScript with
 * no encoder on either side and no precision loss — a 16-bit PNG would quantize, and hand-rolling an
 * EXR encoder here would add a format implementation nobody asked for. The `.bin` is a build
 * artifact, not committed (see `godot/terrain-authoring/.gitignore`); it is regenerated from this
 * script, which is why the manifest records the seed/geometry/checksum it was produced from.
 *
 * The browser is the sampler host on purpose (same pattern as every other check script here):
 * `world/terrain.js` is an ES module importing `three`, so evaluating it in the real page is what
 * guarantees this export matches what the game actually renders, instead of a Node-side
 * reimplementation of the noise that could silently drift.
 *
 * Usage: node scripts/exportWesterosHeightField.js [--out <path>] [--vertex-spacing 4] [--region-size 512]
 * Exit codes: 0 = wrote heightmap, 1 = failure, 2 = Playwright unavailable.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Rows sampled per `page.evaluate` round trip. Keeps any single base64 transfer to a few MB
 * instead of materializing the whole ~38MB heightmap as one string in the page and again in Node. */
const ROW_BAND = 128;

function parseArgs(argv) {
	const args = { out: null, vertexSpacing: 4, regionSize: 512 };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--out') args.out = argv[++i];
		else if (argv[i] === '--vertex-spacing') args.vertexSpacing = Number(argv[++i]);
		else if (argv[i] === '--region-size') args.regionSize = Number(argv[++i]);
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv);
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[exportWesterosHeightField] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const outBin = path.resolve(args.out || 'godot/terrain-authoring/source_data/westeros_height_r32.bin');
	const outManifest = outBin.replace(/\.bin$/, '.json');
	fs.mkdirSync(path.dirname(outBin), { recursive: true });

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage();
		const pageErrors = [];
		page.on('pageerror', (e) => pageErrors.push(`page:${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console:${m.text()}`); });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

		// Build the sampler once, in the page, and stash it — every row band below reuses it so the
		// noise tables and flatten pads are constructed exactly once (and identically for all rows).
		const geometry = await page.evaluate(async ({ vertexSpacing, regionSize }) => {
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');

			const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const flattenPads = computeSettlementFlattenPads({
				sampleHeightMeters: baseSampleHeightMeters,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);

			// Terrain3D lays regions out on a grid of `regionSize` vertices at `vertexSpacing` meters,
			// so one region spans regionSpanMeters. Cover the whole world with whole regions, centered
			// on the world origin (which is the map center — see settlements.js's mapToWorldXZ).
			const regionSpanMeters = regionSize * vertexSpacing;
			const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS / 2;
			const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS / 2;
			const minRegionX = Math.floor(-halfWidth / regionSpanMeters);
			const maxRegionX = Math.ceil(halfWidth / regionSpanMeters) - 1;
			const minRegionZ = Math.floor(-halfDepth / regionSpanMeters);
			const maxRegionZ = Math.ceil(halfDepth / regionSpanMeters) - 1;
			const regionsX = maxRegionX - minRegionX + 1;
			const regionsZ = maxRegionZ - minRegionZ + 1;

			const originX = minRegionX * regionSpanMeters;
			const originZ = minRegionZ * regionSpanMeters;
			const width = regionsX * regionSize;
			const height = regionsZ * regionSize;

			window.__WESTEROS_HEIGHTFIELD__ = { sampleHeightMeters, originX, originZ, vertexSpacing, width, height };

			const seats = KINGDOM_SEATS.map((seat) => {
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, x, z, heightMeters: sampleHeightMeters(x, z) };
			});

			return {
				originX, originZ, width, height, vertexSpacing, regionSize,
				minRegionX, minRegionZ, regionsX, regionsZ, regionSpanMeters,
				worldSeed: WORLD_DEFAULTS.WORLD_SEED,
				waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
				worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
				seats,
			};
		}, { vertexSpacing: args.vertexSpacing, regionSize: args.regionSize });

		const { width, height } = geometry;
		const buffer = Buffer.allocUnsafe(width * height * 4);
		let minHeight = Infinity;
		let maxHeight = -Infinity;

		for (let rowStart = 0; rowStart < height; rowStart += ROW_BAND) {
			const rows = Math.min(ROW_BAND, height - rowStart);
			const base64 = await page.evaluate(({ rowStart, rows }) => {
				const { sampleHeightMeters, originX, originZ, vertexSpacing, width } = window.__WESTEROS_HEIGHTFIELD__;
				const band = new Float32Array(rows * width);
				for (let j = 0; j < rows; j++) {
					const worldZ = originZ + (rowStart + j) * vertexSpacing;
					const rowOffset = j * width;
					for (let i = 0; i < width; i++) {
						band[rowOffset + i] = sampleHeightMeters(originX + i * vertexSpacing, worldZ);
					}
				}
				const bytes = new Uint8Array(band.buffer);
				let binary = '';
				const CHUNK = 0x8000;
				for (let offset = 0; offset < bytes.length; offset += CHUNK) {
					binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
				}
				return btoa(binary);
			}, { rowStart, rows });

			const bandBuffer = Buffer.from(base64, 'base64');
			if (bandBuffer.length !== rows * width * 4) {
				throw new Error(`band at row ${rowStart}: got ${bandBuffer.length} bytes, expected ${rows * width * 4}`);
			}
			bandBuffer.copy(buffer, rowStart * width * 4);
			for (let k = 0; k < bandBuffer.length; k += 4) {
				const value = bandBuffer.readFloatLE(k);
				if (!Number.isFinite(value)) throw new Error(`non-finite height at row band ${rowStart}, byte ${k}`);
				if (value < minHeight) minHeight = value;
				if (value > maxHeight) maxHeight = value;
			}
			process.stdout.write(`\r[exportWesterosHeightField] sampled ${rowStart + rows}/${height} rows`);
		}
		process.stdout.write('\n');

		if (pageErrors.length) throw new Error(`console/page errors: ${pageErrors.join('\n')}`);

		fs.writeFileSync(outBin, buffer);
		const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
		const manifest = {
			schema: 'westeros-terrain3d-heightfield-v1',
			source: 'src/3d/world/terrain.js createHeightSampler + world/settlements.js flatten pads',
			generatedBy: 'scripts/exportWesterosHeightField.js',
			format: 'float32-le',
			layout: 'row-major, row index = +Z, column index = +X',
			binFile: path.basename(outBin),
			sha256,
			byteLength: buffer.length,
			...geometry,
			minHeightMeters: minHeight,
			maxHeightMeters: maxHeight,
		};
		fs.writeFileSync(outManifest, `${JSON.stringify(manifest, null, '\t')}\n`);

		console.log(
			`[exportWesterosHeightField] PASS: ${width}x${height} vertices ` +
			`(${geometry.regionsX}x${geometry.regionsZ} regions of ${geometry.regionSize} @ ${geometry.vertexSpacing}m), ` +
			`height ${minHeight.toFixed(3)}..${maxHeight.toFixed(3)}m, ` +
			`${(buffer.length / (1024 * 1024)).toFixed(1)}MB -> ${path.relative(process.cwd(), outBin)}`,
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[exportWesterosHeightField] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
