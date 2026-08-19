#!/usr/bin/env node
/**
 * measureTerrainChunkSkirtDepth.js — measures how deep `world/terrainChunkSkirt.js`'s ribbon actually
 * has to hang, instead of picking a number that "looks safe".
 *
 * **What a crack is, exactly.** Where two chunks of different LOD share an edge, the finer chunk
 * follows the height field every `size / fine` metres while the coarser one draws a straight chord
 * between vertices `size / coarse` metres apart. At any point along that edge the two surfaces sit
 * `|H(t) - chord(t)|` apart, and that difference *is* the gap the player sees through. A skirt closes
 * it if and only if it is at least that deep — so the right constant is the worst such difference the
 * world can produce, not a guess.
 *
 * **What this measures.** Every shared edge of the full 27x21 chunk grid, for every LOD pair the game
 * can actually put next to each other: run 134 / ADR-0158's mobile bands (64 / 32 / 16) and the
 * desktop bands that build on them. Heights come from `world/terrain.js`'s real
 * `createHeightSampler` with the same settlement flatten pads `sceneManager.js` gives rendered
 * chunks, so this is the field the game draws, not an approximation of it.
 *
 * Usage: `node scripts/measureTerrainChunkSkirtDepth.js`
 * Exit codes: 0 = measured and reported (and, if `world/terrainChunkSkirt.js` is present, its
 * configured depth covers the measured worst case). 1 = the configured depth is too shallow.
 * 2 = Playwright unavailable (same convention as `smokeTestGame3D.js`).
 * @module scripts/measureTerrainChunkSkirtDepth
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

/** LOD pairs that can share an edge. `[fine, coarse]` subdivisions per 500 m chunk. */
const LOD_PAIRS = [[64, 32], [64, 16], [32, 16], [128, 64], [128, 32]];

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404);
				res.end('Not found');
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500);
			res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try {
			return require(id);
		} catch (error) {
			// Try the next candidate.
		}
	}
	return null;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[measureTerrainChunkSkirtDepth] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });

	let measurement;
	try {
		const page = await browser.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		measurement = await page.evaluate(async ({ lodPairs }) => {
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG, CHUNK_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');

			const baseSampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const flattenPads = computeSettlementFlattenPads({
				sampleHeightMeters: baseSampler,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const sample = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);

			const size = CHUNK_CONFIG.CHUNK_SIZE_METERS;
			const halfColumns = Math.floor(CHUNK_CONFIG.GRID_COLUMNS / 2);
			const halfRows = Math.floor(CHUNK_CONFIG.GRID_ROWS / 2);

			/**
			 * Worst |H - chord| along one straight edge. `at(t)` maps edge parameter [0,1] to a world
			 * height; the coarse chord is rebuilt from the same `at` so both sides come from one field.
			 */
			function worstOnEdge(at, fine, coarse) {
				let worst = 0;
				let worstT = 0;
				const coarseHeights = new Float64Array(coarse + 1);
				for (let c = 0; c <= coarse; c += 1) coarseHeights[c] = at(c / coarse);
				for (let f = 0; f <= fine; f += 1) {
					const t = f / fine;
					const scaled = t * coarse;
					const c0 = Math.min(coarse - 1, Math.floor(scaled));
					const frac = scaled - c0;
					const chord = coarseHeights[c0] * (1 - frac) + coarseHeights[c0 + 1] * frac;
					const gap = Math.abs(at(t) - chord);
					if (gap > worst) {
						worst = gap;
						worstT = t;
					}
				}
				return { worst, worstT };
			}

			/**
			 * End-to-end check of the shipped path: build a real chunk, let `createTerrainChunkSkirt`
			 * choose its own depth, and confirm that depth covers the gap independently measured against
			 * the coarsest neighbour the game can put beside it.
			 */
			const { createTerrainChunk } = await import('/src/3d/world/terrain.js');
			const { createTerrainChunkSkirt, TERRAIN_CHUNK_SKIRT_POLICY } = await import('/src/3d/world/terrainChunkSkirt.js');
			const coverage = [];
			const sampled = [
				// The three worst edges the gap sweep below finds, plus a spread of ordinary ground so the
				// reported depth distribution is not just the tail.
				[6, 0], [12, 8], [6, -1], [0, 0], [-4, 3], [8, -6], [-10, -8], [3, 9], [-7, 5], [11, 2],
			];
			for (const [chunkX, chunkZ] of sampled) {
				const segments = CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP;
				const chunk = createTerrainChunk({ chunkX, chunkZ, size, segments, seed: WORLD_DEFAULTS.WORLD_SEED, flattenPads });
				const skirt = createTerrainChunkSkirt(chunk.geometry, { segments, size });
				const minX = chunkX * size - size / 2;
				const minZ = chunkZ * size - size / 2;
				const coarsest = TERRAIN_CHUNK_SKIRT_POLICY.coarsestNeighbourSegments;
				const worstHere = Math.max(
					worstOnEdge((t) => sample(minX, minZ + t * size), segments, coarsest).worst,
					worstOnEdge((t) => sample(minX + t * size, minZ), segments, coarsest).worst,
					worstOnEdge((t) => sample(minX + size, minZ + t * size), segments, coarsest).worst,
					worstOnEdge((t) => sample(minX + t * size, minZ + size), segments, coarsest).worst,
				);
				coverage.push({
					chunkX,
					chunkZ,
					depthMeters: skirt?.userData?.terrainChunkSkirt?.depthMeters ?? null,
					ringVertices: skirt?.userData?.terrainChunkSkirt?.ringVertices ?? null,
					chunkVertices: chunk.geometry.getAttribute('position').count,
					chunkIndices: chunk.geometry.getIndex()?.count ?? null,
					measuredGapMeters: worstHere,
				});
				chunk.geometry.dispose();
				chunk.material.dispose();
				skirt?.geometry?.dispose?.();
				skirt?.material?.dispose?.();
			}

			const results = [];
			for (const [fine, coarse] of lodPairs) {
				let worst = 0;
				let where = null;
				let total = 0;
				let edges = 0;
				for (let chunkZ = -halfRows; chunkZ <= halfRows; chunkZ += 1) {
					for (let chunkX = -halfColumns; chunkX <= halfColumns; chunkX += 1) {
						const minX = chunkX * size - size / 2;
						const minZ = chunkZ * size - size / 2;
						// The chunk's own west edge (X constant) and north edge (Z constant). Taking one of
						// each per chunk covers every shared edge in the grid exactly once.
						const west = worstOnEdge((t) => sample(minX, minZ + t * size), fine, coarse);
						const north = worstOnEdge((t) => sample(minX + t * size, minZ), fine, coarse);
						for (const [edge, label] of [[west, 'west'], [north, 'north']]) {
							total += edge.worst;
							edges += 1;
							if (edge.worst > worst) {
								worst = edge.worst;
								where = { chunkX, chunkZ, edge: label, t: edge.worstT };
							}
						}
					}
				}
				results.push({ fine, coarse, worstMeters: worst, meanMeters: total / edges, edges, where });
			}
			return { results, coverage, gridColumns: CHUNK_CONFIG.GRID_COLUMNS, gridRows: CHUNK_CONFIG.GRID_ROWS };
		}, { lodPairs: LOD_PAIRS });
	} finally {
		await browser.close();
		server.close();
	}

	console.log(
		`[measureTerrainChunkSkirtDepth] Measured over the full ${measurement.gridColumns}x${measurement.gridRows} chunk grid, ` +
			'on the flattened field the game renders.',
	);
	console.log('[measureTerrainChunkSkirtDepth] fine  coarse   worstGap(m)   meanGap(m)   edges   worst location');
	let overallWorst = 0;
	for (const row of measurement.results) {
		overallWorst = Math.max(overallWorst, row.worstMeters);
		const at = row.where ? `chunk(${row.where.chunkX},${row.where.chunkZ}) ${row.where.edge} t=${row.where.t.toFixed(3)}` : '-';
		console.log(
			`[measureTerrainChunkSkirtDepth] ${String(row.fine).padStart(4)}  ${String(row.coarse).padStart(6)}   ` +
				`${row.worstMeters.toFixed(3).padStart(10)}   ${row.meanMeters.toFixed(3).padStart(10)}   ` +
				`${String(row.edges).padStart(5)}   ${at}`,
		);
	}
	console.log(`[measureTerrainChunkSkirtDepth] Worst gap across every measured LOD pair: ${overallWorst.toFixed(3)} m.`);

	console.log(
		'[measureTerrainChunkSkirtDepth] Per-chunk adaptive depth, from the shipped createTerrainChunkSkirt path:',
	);
	console.log('[measureTerrainChunkSkirtDepth]    chunk   chosenDepth(m)   measuredGap(m)   margin(m)   chunk verts/indices   result');
	let allCovered = true;
	let deepest = 0;
	for (const row of measurement.coverage) {
		const covered = Number.isFinite(row.depthMeters) && row.depthMeters >= row.measuredGapMeters;
		if (!covered) allCovered = false;
		deepest = Math.max(deepest, row.depthMeters ?? 0);
		// The skirt is a child mesh precisely so these two numbers never move — every existing terrain
		// topology contract asserts them exactly.
		const topologyIntact = row.chunkVertices === 4225 && row.chunkIndices === 24576;
		if (!topologyIntact) allCovered = false;
		console.log(
			`[measureTerrainChunkSkirtDepth] ${`(${row.chunkX},${row.chunkZ})`.padStart(9)}   ` +
				`${(row.depthMeters ?? NaN).toFixed(3).padStart(14)}   ${row.measuredGapMeters.toFixed(3).padStart(14)}   ` +
				`${((row.depthMeters ?? NaN) - row.measuredGapMeters).toFixed(3).padStart(9)}   ` +
				`${`${row.chunkVertices}/${row.chunkIndices}`.padStart(19)}   ` +
				`${covered && topologyIntact ? 'PASS' : `FAIL${topologyIntact ? '' : ' (chunk topology moved)'}`}`,
		);
	}
	console.log(
		`[measureTerrainChunkSkirtDepth] ${allCovered ? 'PASS' : 'FAIL'}: every sampled chunk's own skirt covers its own ` +
			`worst coarsest-neighbour gap; deepest chosen ${deepest.toFixed(3)} m against a world worst gap of ` +
			`${overallWorst.toFixed(3)} m, and chunk geometry stayed 4225/24576.`,
	);
	process.exit(allCovered ? 0 : 1);
}

main().catch((error) => {
	console.error('[measureTerrainChunkSkirtDepth] FAIL: unexpected error:', error);
	process.exit(1);
});
