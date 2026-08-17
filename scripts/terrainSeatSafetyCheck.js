import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startStaticServer } from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CENTER_ERROR_METERS = 0.001;
const MAX_NEARBY_SLOPE_METERS = 0.9;
const SLOPE_SAMPLE_OFFSET_METERS = 20;
const GAME_BOOT_TIMEOUT_MS = 30000;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[terrainSeatSafetyCheck] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const roadsModuleExists = fs.existsSync(path.join(ROOT, 'src/3d/world/roads.js'));
	console.log(
		`[terrainSeatSafetyCheck] Road-network check: ${roadsModuleExists ? 'roads.js found — validated by scripts/roadNetworkSafetyCheck.js on the same flattened field' : 'src/3d/world/roads.js does not exist — road safety is not applicable.'}`,
	);

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });

	let seatResults;
	try {
		const page = await browser.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: GAME_BOOT_TIMEOUT_MS });
		seatResults = await page.evaluate(
			async ({ slopeOffset }) => {
				const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
				const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
				const { createHeightSampler } = await import('/src/3d/world/terrain.js');

				// Keep flood detection tied to untouched source terrain, then construct the same flattened
				// field sceneManager.js gives rendered chunks and gameplay physics for walkability.
				const sampleRawHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
				const flattenPads = computeSettlementFlattenPads({
					sampleHeightMeters: sampleRawHeightMeters,
					seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
					minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
					mapBounds: WORLD_SCALE.MAP_BOUNDS,
					metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
				});
				const sampleGameplayHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);

				return KINGDOM_SEATS.map((seat) => {
					const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
					const pad = flattenPads.find((candidate) => candidate.id === seat.id);
					const centerHeight = sampleGameplayHeightMeters(world.x, world.z);
					const rawCenterHeight = sampleRawHeightMeters(world.x, world.z);
					const nearbyHeights = [
						sampleGameplayHeightMeters(world.x + slopeOffset, world.z),
						sampleGameplayHeightMeters(world.x - slopeOffset, world.z),
						sampleGameplayHeightMeters(world.x, world.z + slopeOffset),
						sampleGameplayHeightMeters(world.x, world.z - slopeOffset),
					];
					return {
						id: seat.id,
						name: seat.name,
						centerHeight,
						rawCenterHeight,
						padHeight: pad?.anchorHeightMeters ?? null,
						nearbyHeights,
						world,
					};
				});
			},
			{ slopeOffset: SLOPE_SAMPLE_OFFSET_METERS },
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}

	assert(Array.isArray(seatResults) && seatResults.length > 0, 'No kingdom seats were sampled.');
	for (const seat of seatResults) {
		assert(Number.isFinite(seat.centerHeight), `${seat.id}: flattened center height is invalid.`);
		assert(Number.isFinite(seat.rawCenterHeight), `${seat.id}: raw center height is invalid.`);
		assert(Number.isFinite(seat.padHeight), `${seat.id}: flatten pad is missing.`);
		const centerError = Math.abs(seat.centerHeight - seat.padHeight);
		assert(centerError <= MAX_CENTER_ERROR_METERS, `${seat.id}: center differs from pad by ${centerError.toFixed(4)}m.`);
		const maxSlopeDelta = Math.max(...seat.nearbyHeights.map((height) => Math.abs(height - seat.centerHeight)));
		assert(maxSlopeDelta <= MAX_NEARBY_SLOPE_METERS, `${seat.id}: local pad slope delta ${maxSlopeDelta.toFixed(3)}m is too high.`);
	}

	console.log(`[terrainSeatSafetyCheck] PASS: ${seatResults.length} seats remain finite, centered and walkable on the shared flattened terrain field.`);
}

main().catch((error) => {
	console.error(`[terrainSeatSafetyCheck] FAIL: unexpected error: ${error?.stack || error}`);
	process.exit(1);
});
