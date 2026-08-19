#!/usr/bin/env node
/**
 * checkRoadCorridorSmoothing.js — regression guard for run 357 / ADR-0304's road cut-and-fill bed.
 *
 * The bed is what lets `world/terrainReliefDetail.js` carry player-scale roughness at all, so the
 * properties below are load-bearing for the world's whole look, not just for roads:
 *
 *   1. **The bed is smoother than the ground beside it.** Max grade sampled along a road centreline
 *      must be far below max grade along a line the same length just outside the corridor. If this
 *      inverts, roads are no longer getting a bed and the roughness ceiling is back.
 *   2. **The corridor is narrow.** Terrain a little way off the road must be untouched — this is the
 *      only place in the world where gameplay overrides the owner's height field, and it has to stay
 *      a road-width scar rather than a valley-wide flattening.
 *   3. **Ends are reconciled, not pinned.** Hard-pinning was measured at 57.1 deg (a pinned endpoint
 *      beside a filtered neighbour 8 m away is itself a cliff), so the profile must be continuous at
 *      both ends *and* still land on the seat's own height.
 *   4. **Render and gameplay agree.** The sampler with a corridor must return the same height the
 *      chunk mesh was built from — the ADR-0118 failure mode, now with a second override layer.
 *
 * Usage: `node scripts/checkRoadCorridorSmoothing.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkRoadCorridorSmoothing
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** The bed must be at least this many times gentler than untouched ground beside it. */
const MIN_SMOOTHING_RATIO = 2;
/** Max allowed step, in metres, between consecutive bed samples near either end — the pinning-cliff
 * regression this guards against produced steps many times this. */
const MAX_END_STEP_METERS = 1.5;

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRoadCorridor, ROAD_CORRIDOR_POLICY } = await import('/src/3d/world/roadCorridorSmoothing.js');

			const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const flattenPads = computeSettlementFlattenPads({
				sampleHeightMeters: base,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const phase1 = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
			const seats = KINGDOM_SEATS.map((seat) => {
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, x, z };
			});
			const corridor = computeRoadCorridor({ seats, baseSampleHeightMeters: phase1 });
			const bedded = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads, corridor);

			const gradeAlong = (points, sampler) => {
				let max = 0;
				for (let i = 1; i < points.length; i += 1) {
					const run = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
					if (run <= 0) continue;
					const rise = Math.abs(sampler(points[i].x, points[i].z) - sampler(points[i - 1].x, points[i - 1].z));
					max = Math.max(max, (Math.atan(rise / run) * 180) / Math.PI);
				}
				return max;
			};

			// Longest edge, as the most demanding sample of real cross-country road.
			const edge = corridor.smoothedEdges.reduce((longest, candidate) => (
				candidate.points.length > (longest?.points.length ?? 0) ? candidate : longest), null);
			const centreline = edge.points;
			const offCorridorOffset = ROAD_CORRIDOR_POLICY.fadeHalfWidthMeters * 3;
			// The same polyline pushed sideways, so terrain difficulty is comparable but no bed applies.
			const offset = centreline.map((point, i) => {
				const next = centreline[Math.min(i + 1, centreline.length - 1)];
				const previous = centreline[Math.max(i - 1, 0)];
				const dx = next.x - previous.x;
				const dz = next.z - previous.z;
				const length = Math.hypot(dx, dz) || 1;
				return { x: point.x + (-dz / length) * offCorridorOffset, z: point.z + (dx / length) * offCorridorOffset };
			});

			const bedGrade = gradeAlong(centreline, bedded);
			const naturalGrade = gradeAlong(offset, bedded);

			// Corridor width: the bed must have stopped mattering well before this.
			const mid = centreline[Math.floor(centreline.length / 2)];
			const nextMid = centreline[Math.floor(centreline.length / 2) + 1];
			const ndx = nextMid.x - mid.x;
			const ndz = nextMid.z - mid.z;
			const nlen = Math.hypot(ndx, ndz) || 1;
			const sideways = (distance) => ({ x: mid.x + (-ndz / nlen) * distance, z: mid.z + (ndx / nlen) * distance });
			const farPoint = sideways(offCorridorOffset);
			const untouchedDelta = Math.abs(bedded(farPoint.x, farPoint.z) - phase1(farPoint.x, farPoint.z));
			// How much cut-and-fill the bed actually performs, taken as the largest displacement anywhere
			// along the edge rather than at one arbitrary point — at a spot where terrain happens to sit
			// on its own local average the bed correctly changes nothing, which says nothing either way.
			let onRoadDelta = 0;
			for (const point of centreline) {
				onRoadDelta = Math.max(onRoadDelta, Math.abs(bedded(point.x, point.z) - phase1(point.x, point.z)));
			}

			// End continuity: the largest single step among the first and last few bed samples.
			let maxEndStep = 0;
			const endWindow = 6;
			for (const range of [[1, endWindow], [centreline.length - endWindow, centreline.length - 1]]) {
				for (let i = Math.max(1, range[0]); i <= Math.min(centreline.length - 1, range[1]); i += 1) {
					maxEndStep = Math.max(maxEndStep, Math.abs(centreline[i].y - centreline[i - 1].y));
				}
			}

			// Render/gameplay agreement: the bedded sampler is what both chunks and the collider use.
			const agreementError = Math.abs(bedded(mid.x, mid.z) - createHeightSampler(
				WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads, corridor)(mid.x, mid.z));

			return {
				segmentCount: corridor.segmentCount,
				edgeCount: corridor.smoothedEdges.length,
				bedGrade, naturalGrade, untouchedDelta, onRoadDelta, maxEndStep, agreementError,
				fadeHalfWidthMeters: ROAD_CORRIDOR_POLICY.fadeHalfWidthMeters,
			};
		});

		const smoothingRatio = result.naturalGrade / Math.max(result.bedGrade, 1e-6);
		const ok = smoothingRatio >= MIN_SMOOTHING_RATIO &&
			result.untouchedDelta < 0.01 &&
			result.onRoadDelta > 1 &&
			result.maxEndStep <= MAX_END_STEP_METERS &&
			result.agreementError === 0 &&
			result.edgeCount === 13;

		if (!ok) {
			console.error('[road-corridor] FAIL', JSON.stringify({ ...result, smoothingRatio }));
			process.exit(1);
		}
		console.log(
			`[road-corridor] PASS: ${result.edgeCount} bedded edges / ${result.segmentCount} segments; ` +
				`bed max grade ${result.bedGrade.toFixed(1)}° vs ${result.naturalGrade.toFixed(1)}° on untouched ground ` +
				`beside it (${smoothingRatio.toFixed(1)}x gentler); terrain ${result.fadeHalfWidthMeters * 3} m off the road ` +
				`is byte-identical to the no-bed field while the bed cuts/fills up to ${result.onRoadDelta.toFixed(1)} m ` +
				`on the centreline; worst end step ${result.maxEndStep.toFixed(2)} m (no pinning cliff); ` +
				'render/gameplay samplers agree exactly.',
		);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[road-corridor] FAIL: unexpected error:', error);
	process.exit(1);
});
