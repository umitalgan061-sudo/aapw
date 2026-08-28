#!/usr/bin/env node
/**
 * terrainSeatSafetyCheck.js — standalone "Arazi Değişikliği Güvenlik Kontrolü" (GOVERNANCE.md §8.4)
 * for any change to `world/terrain.js`'s height sampler.
 *
 * Samples the real, live height field (via `world/terrain.js`'s `createHeightSampler`, the exact
 * function `createTerrainChunk`/`world/rivers.js` both consume — not a re-derived approximation) at
 * all 14 real kingdom-seat coordinates (`world/settlements.js`'s `KINGDOM_SEATS`, mapped through the
 * same `mapToWorldXZ` the live game uses) and asserts:
 *   1. No seat's RAW, unflattened ground height is at or below `WORLD_DEFAULTS.WATER_LEVEL_METERS`.
 *      Settlement pads must never be allowed to hide a genuinely flooded source location.
 *   2. No seat's local slope on the ACTUAL GAMEPLAY/RENDER field exceeds
 *      `WALKABLE_SLOPE_MAX_DEGREES`. That field includes the same settlement flatten pads that
 *      `sceneManager.js` gives terrain chunks and physics, so a castle deliberately built into a
 *      Vale/Dorne mountainside is judged by the ground the player really walks on rather than the
 *      protected natural slope outside the castle pad.
 *   3. Road-network connectivity is validated separately by `scripts/roadNetworkSafetyCheck.js`,
 *      which uses this same flattened field and the production road modules.
 *
 * Run this BEFORE and AFTER any `world/terrain.js` height-sampler edit (per GOVERNANCE.md §8.4) and
 * diff the printed raw heights/gameplay slopes by eye. The split is intentional: raw terrain owns
 * flood safety; flattened live terrain owns walkability.
 *
 * Uses the exact same in-page dynamic-`import()`-over-a-real-static-server pattern
 * `scripts/game3dSmokeChecks.js` already established, so it exercises the live modules' real module
 * resolution (including the browser import map for the bare `'three'` specifier), not a Node-side
 * reimplementation that could drift from what the game actually runs.
 *
 * Usage: `node scripts/terrainSeatSafetyCheck.js`
 * Exit codes: 0 = all 14 seats pass both checks. 1 = at least one seat failed. 2 = Playwright
 * unavailable in this environment (same convention as `smokeTestGame3D.js`).
 * @module scripts/terrainSeatSafetyCheck
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

/** Max local ground slope, in degrees, a kingdom seat may sit on before this check flags it as
 * "ungodly/impassable" (GOVERNANCE.md §8.4's "gidilemez eğim"). No slope-based movement restriction
 * exists yet anywhere in this codebase (checked `physics.js`/`gameplay/player.js` — ground-height
 * snap always follows the sampled height regardless of steepness), so there is no canonical
 * project-defined "walkable" threshold to reuse. 35° is a deliberately conservative placeholder
 * (stricter than Unity's default `CharacterController.slopeLimit`, 45°, and Unreal's default
 * `WalkableFloorAngle`, ~44.7°) — a real product/design decision, not an API fact, so it is logged
 * to `QUESTIONS_FOR_OWNER.md` per GOVERNANCE.md §14 rather than silently assumed permanent. */
const WALKABLE_SLOPE_MAX_DEGREES = 35;

/** Horizontal offset, in meters, used for the central-difference slope estimate around each seat's
 * exact `(x, z)`. Small enough to reflect the *local* slope right at the seat (not an average over a
 * much larger area), large enough to stay well above floating-point noise. */
const SLOPE_SAMPLE_OFFSET_METERS = 2;

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

/**
 * Starts a plain static file server over the repo root — same minimal pattern
 * `smokeTestGame3D.js` uses, trimmed to only the MIME types this check's page load needs.
 * @returns {Promise<import('http').Server>}
 */
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

/**
 * Resolves Playwright the same way every other check script here does (dev-only tooling, not a
 * repo dependency by design).
 * @returns {object|null}
 */
function loadPlaywright() {
	const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
	for (const id of candidates) {
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
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		seatResults = await page.evaluate(
			async ({ slopeOffset }) => {
				const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
				const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
				const { createHeightSampler } = await import('/src/3d/world/terrain.js');
				const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');

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
				// River valleys (ADR-0307) are part of the natural field a seat sits in, so both flood safety
				// and walkability have to be judged on ground that carries them.
				const valleyField = computeRiverValleys({
					seed: WORLD_DEFAULTS.WORLD_SEED,
					baseSampleHeightMeters: createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads),
					seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				});
				const sampleGameplayHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads, null, valleyField);

				return KINGDOM_SEATS.map((seat) => {
					const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
					const rawHeight = sampleRawHeightMeters(x, z);
					const gameplayHeight = sampleGameplayHeightMeters(x, z);

					const hxPlus = sampleGameplayHeightMeters(x + slopeOffset, z);
					const hxMinus = sampleGameplayHeightMeters(x - slopeOffset, z);
					const hzPlus = sampleGameplayHeightMeters(x, z + slopeOffset);
					const hzMinus = sampleGameplayHeightMeters(x, z - slopeOffset);
					const slopeX = (hxPlus - hxMinus) / (2 * slopeOffset);
					const slopeZ = (hzPlus - hzMinus) / (2 * slopeOffset);
					const slopeMagnitude = Math.hypot(slopeX, slopeZ);
					const slopeDegrees = (Math.atan(slopeMagnitude) * 180) / Math.PI;

					return {
						id: seat.id,
						x,
						z,
						rawHeight,
						gameplayHeight,
						waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
						marginAboveWaterMeters: rawHeight - WORLD_DEFAULTS.WATER_LEVEL_METERS,
						slopeDegrees,
					};
				});
			},
			{ slopeOffset: SLOPE_SAMPLE_OFFSET_METERS },
		);
	} finally {
		await browser.close();
		server.close();
	}

	let allOk = true;
	console.log('[terrainSeatSafetyCheck] seat            rawHeight(m)  gameplayHeight(m)  rawMarginAboveWater(m)  gameplaySlope(deg)  result');
	for (const seat of seatResults) {
		const underwater = seat.marginAboveWaterMeters <= 0;
		const unwalkable = seat.slopeDegrees > WALKABLE_SLOPE_MAX_DEGREES;
		const ok = !underwater && !unwalkable;
		if (!ok) allOk = false;
		const flags = [underwater ? 'UNDERWATER_RAW_TERRAIN' : null, unwalkable ? 'UNWALKABLE_GAMEPLAY_SLOPE' : null].filter(Boolean).join(',');
		console.log(
			`[terrainSeatSafetyCheck] ${seat.id.padEnd(15)} ${seat.rawHeight.toFixed(3).padStart(12)}  ` +
				`${seat.gameplayHeight.toFixed(3).padStart(17)}  ${seat.marginAboveWaterMeters.toFixed(3).padStart(22)}  ` +
				`${seat.slopeDegrees.toFixed(3).padStart(18)}  ${ok ? 'PASS' : `FAIL (${flags})`}`,
		);
	}

	console.log(
		`[terrainSeatSafetyCheck] ${allOk ? 'PASS' : 'FAIL'}: ${seatResults.length}/14 seats checked; ` +
			`raw terrain owns flood safety, flattened gameplay terrain owns ${WALKABLE_SLOPE_MAX_DEGREES}° walkability, ` +
			`water level ${seatResults[0]?.waterLevelMeters}m.`,
	);
	process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
	console.error('[terrainSeatSafetyCheck] FAIL: unexpected error:', error);
	process.exit(1);
});
