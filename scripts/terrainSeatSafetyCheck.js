#!/usr/bin/env node
/**
 * terrainSeatSafetyCheck.js — standalone "Arazi Değişikliği Güvenlik Kontrolü" (GOVERNANCE.md §8.4)
 * for any change to `world/terrain.js`'s height sampler.
 *
 * Samples the real, live height field (via `world/terrain.js`'s `createHeightSampler`, the exact
 * function `createTerrainChunk`/`world/rivers.js` both consume — not a re-derived approximation) at
 * all 14 real kingdom-seat coordinates (`world/settlements.js`'s `KINGDOM_SEATS`, mapped through the
 * same `mapToWorldXZ` the live game uses) and asserts:
 *   1. No seat's raw sampled ground height is at or below `WORLD_DEFAULTS.WATER_LEVEL_METERS`
 *      (not the clamped, already-safe `groundY` `createSettlements` places castles at, and — since
 *      DECISIONS.md ADR-0118 — not the flattened `flattenPads` height either: this check
 *      deliberately builds its own sampler with `createHeightSampler(seed)`, no `flattenPads`, so a
 *      change that would flood a seat can't hide behind either mechanism. `scripts/
 *      game3dSmokeChecksScene.js`'s `checkSettlementGroundFlatten` is the standing regression guard
 *      for the flatten pads themselves — see that check for what it asserts).
 *   2. No seat's local slope (central-difference sampled at a small fixed offset around the seat's
 *      exact `(x, z)`) exceeds `WALKABLE_SLOPE_MAX_DEGREES` — see that constant's own comment for
 *      why this specific threshold and why it's logged to `QUESTIONS_FOR_OWNER.md` as a temporary
 *      default rather than assumed as a final product decision.
 *   3. Road-network connectivity: `world/` has no Roads module yet (checked, not assumed — see
 *      `ls src/3d/world/`), so this item is a documented *not-yet-applicable* future subtask, not a
 *      skipped check — logged explicitly below rather than silently omitted.
 *
 * Run this BEFORE and AFTER any `world/terrain.js` height-sampler edit (per GOVERNANCE.md §8.4) and
 * diff the two runs' printed heights/slopes by eye — this script itself has no git-diffing logic; it
 * only asserts invariants against whatever code is currently on disk when it runs.
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

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

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
		`[terrainSeatSafetyCheck] Road-network check: ${roadsModuleExists ? 'roads.js found — would validate here' : 'src/3d/world/roads.js does not exist yet — "yol ağı" is a future, not-yet-built subtask (GOVERNANCE.md §18 item 2); skipping item 3, not silently omitting it.'}`,
	);

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });

	let seatResults;
	try {
		const page = await browser.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		seatResults = await page.evaluate(
			async ({ slopeOffset }) => {
				const { KINGDOM_SEATS, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
				const { WORLD_SCALE, WORLD_DEFAULTS } = await import('/src/3d/config.js');
				const { createHeightSampler } = await import('/src/3d/world/terrain.js');

				const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);

				return KINGDOM_SEATS.map((seat) => {
					const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
					const height = sampleHeightMeters(x, z);

					const hxPlus = sampleHeightMeters(x + slopeOffset, z);
					const hxMinus = sampleHeightMeters(x - slopeOffset, z);
					const hzPlus = sampleHeightMeters(x, z + slopeOffset);
					const hzMinus = sampleHeightMeters(x, z - slopeOffset);
					const slopeX = (hxPlus - hxMinus) / (2 * slopeOffset);
					const slopeZ = (hzPlus - hzMinus) / (2 * slopeOffset);
					const slopeMagnitude = Math.hypot(slopeX, slopeZ);
					const slopeDegrees = (Math.atan(slopeMagnitude) * 180) / Math.PI;

					return {
						id: seat.id,
						x,
						z,
						height,
						waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
						marginAboveWaterMeters: height - WORLD_DEFAULTS.WATER_LEVEL_METERS,
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
	console.log('[terrainSeatSafetyCheck] seat            height(m)  marginAboveWater(m)  slope(deg)  result');
	for (const seat of seatResults) {
		const underwater = seat.marginAboveWaterMeters <= 0;
		const unwalkable = seat.slopeDegrees > WALKABLE_SLOPE_MAX_DEGREES;
		const ok = !underwater && !unwalkable;
		if (!ok) allOk = false;
		const flags = [underwater ? 'UNDERWATER' : null, unwalkable ? 'UNWALKABLE_SLOPE' : null].filter(Boolean).join(',');
		console.log(
			`[terrainSeatSafetyCheck] ${seat.id.padEnd(15)} ${seat.height.toFixed(3).padStart(9)}  ` +
				`${seat.marginAboveWaterMeters.toFixed(3).padStart(18)}  ${seat.slopeDegrees.toFixed(3).padStart(9)}  ` +
				`${ok ? 'PASS' : `FAIL (${flags})`}`,
		);
	}

	console.log(
		`[terrainSeatSafetyCheck] ${allOk ? 'PASS' : 'FAIL'}: ${seatResults.length}/14 seats checked, ` +
			`walkable-slope threshold ${WALKABLE_SLOPE_MAX_DEGREES}°, water level ${seatResults[0]?.waterLevelMeters}m.`,
	);
	process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
	console.error('[terrainSeatSafetyCheck] FAIL: unexpected error:', error);
	process.exit(1);
});
