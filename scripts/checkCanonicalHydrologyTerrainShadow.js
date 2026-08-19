#!/usr/bin/env node
/** Run 186 canonical-hydrology target-terrain shadow proof. */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const EPSILON = 1e-7;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, ''));
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalHydrologyTerrainShadow] SKIP: Playwright unavailable.');
		process.exit(2);
	}

	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	let result;
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		result = await page.evaluate(async () => {
			const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { WORLD_REFERENCE_WATER_MASK } = await import('/src/3d/world/worldReferenceWaterMask.js');
			const { mapCanvasToNormalizedReference, normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { referenceProtectionRadiiFromMeters } = await import('/src/3d/world/worldReferenceHydrology.js');
			const { FULL_REFERENCE_MAP_BOUNDS, FULL_REFERENCE_WORLD_MIGRATION_PLAN, mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
			const { CANONICAL_TERRAIN_SHADOW_POLICY, createCanonicalHydrologyTerrainSampler, sampleCanonicalHydrologyTerrainTarget } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');

			const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: natural,
				seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: FULL_REFERENCE_MAP_BOUNDS,
				metersPerMapUnit: plan.metersPerMapUnit,
			});
			const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, plan.metersPerMapUnit);
			const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
			const sampler = createCanonicalHydrologyTerrainSampler({ baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });

			let waterCells = 0;
			let landCells = 0;
			let protectedCells = 0;
			let changedWaterCells = 0;
			let changedLandCells = 0;
			let minWaterDepth = Infinity;
			let minLandClearance = Infinity;
			let maxRepeatError = 0;
			let minHeight = Infinity;
			let maxHeight = -Infinity;

			for (let row = 0; row < WORLD_REFERENCE_WATER_MASK.height; row += 1) {
				for (let col = 0; col < WORLD_REFERENCE_WATER_MASK.width; col += 1) {
					const nx = (col + 0.5) / WORLD_REFERENCE_WATER_MASK.width;
					const ny = (row + 0.5) / WORLD_REFERENCE_WATER_MASK.height;
					const map = normalizedReferenceToMapCanvas(nx, ny);
					const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
					const sample = sampleCanonicalHydrologyTerrainTarget({ worldX: world.x, worldZ: world.z, baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
					const repeated = sampler(world.x, world.z);
					maxRepeatError = Math.max(maxRepeatError, Math.abs(sample.targetHeightMeters - repeated));
					minHeight = Math.min(minHeight, sample.targetHeightMeters);
					maxHeight = Math.max(maxHeight, sample.targetHeightMeters);
					if (sample.hydrology.protectedLand) protectedCells += 1;
					if (sample.hydrology.water) {
						waterCells += 1;
						const depth = sea - sample.targetHeightMeters;
						minWaterDepth = Math.min(minWaterDepth, depth);
						if (sample.targetHeightMeters < sample.baseHeightMeters - 1e-9) changedWaterCells += 1;
					} else {
						landCells += 1;
						const clearance = sample.targetHeightMeters - sea;
						minLandClearance = Math.min(minLandClearance, clearance);
						if (sample.targetHeightMeters > sample.baseHeightMeters + 1e-9) changedLandCells += 1;
					}
				}
			}

			const seats = KINGDOM_SEATS.map((seat, index) => {
				const world = mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit);
				const center = sampleCanonicalHydrologyTerrainTarget({ worldX: world.x, worldZ: world.z, baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
				const offsets = [[20,0],[-20,0],[0,20],[0,-20]];
				const probeHeights = offsets.map(([dx, dz]) => sampler(world.x + dx, world.z + dz));
				const maxFlatDelta = Math.max(...probeHeights.map((height) => Math.abs(height - center.targetHeightMeters)));
				return {
					id: seat.id,
					rule: center.rule,
					protectedLand: center.hydrology.protectedLand,
					protectedWeight: center.hydrology.protectedLandWeight,
					height: center.targetHeightMeters,
					baseHeight: center.baseHeightMeters,
					maxFlatDelta,
					padAnchor: pads[index].anchorHeightMeters,
				};
			});

			const openSeaMap = normalizedReferenceToMapCanvas(0.535, 0.835);
			const openSeaWorld = mapCanvasToPlannedWorldXZ(openSeaMap.x, openSeaMap.y);
			const openSea = sampleCanonicalHydrologyTerrainTarget({ worldX: openSeaWorld.x, worldZ: openSeaWorld.z, baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });

			return {
				policy: CANONICAL_TERRAIN_SHADOW_POLICY,
				sea,
				waterCells,
				landCells,
				protectedCells,
				changedWaterCells,
				changedLandCells,
				minWaterDepth,
				minLandClearance,
				maxRepeatError,
				minHeight,
				maxHeight,
				seats,
				openSea: { rule: openSea.rule, water: openSea.hydrology.water, targetHeight: openSea.targetHeightMeters, baseHeight: openSea.baseHeightMeters, coastBlend: openSea.hydrology.coastBlend },
			};
		});
	} finally {
		await browser.close();
		server.close();
	}

	assert(result.waterCells > 0 && result.landCells > 0, `grid classification degenerate: water=${result.waterCells} land=${result.landCells}`);
	assert(result.waterCells + result.landCells === 96 * 64, `expected 6144 cells, got ${result.waterCells + result.landCells}`);
	assert(result.changedWaterCells > 0, 'shadow adapter never lowers any canonical water cell');
	assert(result.changedLandCells > 0, 'shadow adapter never raises any canonical land cell');
	assert(result.minWaterDepth + EPSILON >= result.policy.minimumWaterDepthMeters, `minimum water depth ${result.minWaterDepth} below policy ${result.policy.minimumWaterDepthMeters}`);
	assert(result.minLandClearance + EPSILON >= result.policy.minimumProtectedLandClearanceMeters, `minimum land clearance ${result.minLandClearance} below protected edge policy ${result.policy.minimumProtectedLandClearanceMeters}`);
	assert(result.maxRepeatError < EPSILON, `determinism repeat error ${result.maxRepeatError}`);

	assert(result.seats.length === 14, `expected 14 seats, got ${result.seats.length}`);
	for (const seat of result.seats) {
		assert(seat.rule === 'protected-land', `${seat.id}: expected protected-land rule, got ${seat.rule}`);
		assert(seat.protectedLand && Math.abs(seat.protectedWeight - 1) < EPSILON, `${seat.id}: center protection weight != 1`);
		assert(seat.height + EPSILON >= result.sea + 1.5, `${seat.id}: target terrain below settlement water-clearance floor`);
		assert(Math.abs(seat.height - seat.padAnchor) < 1e-6, `${seat.id}: shadow target drifted from settlement pad anchor`);
		assert(seat.maxFlatDelta < 1e-6, `${seat.id}: shadow sampler broke inner settlement flatten pad (${seat.maxFlatDelta})`);
	}
	assert(result.openSea.water && result.openSea.rule === 'canonical-water', 'open Summer Sea must use canonical-water rule');
	assert(result.openSea.targetHeight <= result.sea - result.policy.minimumWaterDepthMeters + EPSILON, 'open Summer Sea floor is not below water plane');

	const runtimeConsumers = [
		'src/3d/game3d.js', 'src/3d/config.js', 'src/3d/sceneManager.js', 'src/3d/world/terrain.js',
		'src/3d/world/chunkManager.js', 'src/3d/world/water.js', 'src/3d/world/roads.js', 'src/3d/world/settlements.js',
	];
	for (const file of runtimeConsumers) {
		assert(!fs.readFileSync(path.join(ROOT, file), 'utf8').includes('worldReferenceTerrainAdapter'), `${file}: Run186 adapter must remain shadow-only`);
	}

	console.log(`[checkCanonicalHydrologyTerrainShadow] PASS: 96x64 grid ${result.waterCells} water / ${result.landCells} land (${result.protectedCells} protected samples); changed water=${result.changedWaterCells}, land=${result.changedLandCells}; min water depth ${result.minWaterDepth.toFixed(2)}m, min land clearance ${result.minLandClearance.toFixed(2)}m; 14/14 seat pads remain flat+dry; open Summer Sea ${result.openSea.targetHeight.toFixed(2)}m; deterministic error ${result.maxRepeatError}; target range ${result.minHeight.toFixed(2)}..${result.maxHeight.toFixed(2)}m; runtime remains unwired.`);
}

main().catch((error) => {
	console.error('[checkCanonicalHydrologyTerrainShadow] FAIL:', error);
	process.exit(1);
});
