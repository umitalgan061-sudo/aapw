#!/usr/bin/env node
/**
 * Guards the crossing list `world/roadRiverBridges.js` reports for the live world.
 *
 * Run 439 established that the game contains no bridge and that several of its roads run through
 * drawn river geometry. This is the gate that keeps the *first* half of fixing that honest: it builds
 * the real scene, asks the module where the live roads cross the live rivers, and checks the answer
 * is well formed — every crossing clears the water it spans, every deck sits above both its banks,
 * and the list is stable across two builds of the same world.
 *
 * It deliberately does NOT assert a fixed number of crossings. Road routing and river courses both
 * respond to the height field, so pinning a count here would turn any legitimate terrain change into
 * a red gate for a reason that has nothing to do with bridges — the mistake
 * `checkCanonicalRoadBridgeSceneShadow` made with its "expected 7 bridges" and the reason it has been
 * red ever since. What it pins is the shape of the answer, plus the one thing that must never
 * regress: a crossing whose deck is under its own water.
 *
 * Usage: `node scripts/checkRoadRiverBridgeCrossings.js`
 * Exit codes: 0 pass, 2 Playwright unavailable (skip), 1 fail.
 * @module scripts/checkRoadRiverBridgeCrossings
 */

import devServerHelper from './devServerHelper.js';

const IGNORABLE_ERROR = /assets\/|version ht|not valid JSON|Couldn't load texture|placeholder box/;

async function main() {
	const playwright = devServerHelper.loadPlaywright();
	if (!playwright) {
		console.error('[checkRoadRiverBridgeCrossings] SKIP: Playwright is not installed in this environment.');
		process.exit(2);
	}
	const server = await devServerHelper.startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
		page.on('pageerror', (error) => {
			if (!IGNORABLE_ERROR.test(error.message)) console.error(`[checkRoadRiverBridgeCrossings] page: ${error.message}`);
		});
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

		const result = await page.evaluate(async () => {
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { findRoadRiverCrossings, ROAD_RIVER_BRIDGE_POLICY } = await import('/src/3d/world/roadRiverBridges.js');
			const canvas = document.createElement('canvas');
			canvas.width = 64;
			canvas.height = 64;
			document.body.appendChild(canvas);
			const world = await createScene(canvas);
			const sampleHeightMeters = world.groundCollider.getGroundHeight;
			const riverCourses = world.riverCourses ?? [];
			const first = findRoadRiverCrossings({ roadEdges: world.roadEdges, riverCourses, sampleHeightMeters });
			// Same inputs a second time: the module claims to be deterministic, so prove it rather than
			// trusting the claim.
			const second = findRoadRiverCrossings({ roadEdges: world.roadEdges, riverCourses, sampleHeightMeters });
			return {
				policyId: ROAD_RIVER_BRIDGE_POLICY.id,
				riverCourseCount: riverCourses.length,
				roadEdgeCount: world.roadEdges.length,
				crossings: first,
				deterministic: JSON.stringify(first) === JSON.stringify(second),
			};
		});

		const failures = [];
		if (result.policyId !== 'road-river-bridge-v1') failures.push(`unexpected policy id ${result.policyId}`);
		if (!result.riverCourseCount) failures.push('the scene exposed no river courses — nothing could be crossed');
		if (!result.roadEdgeCount) failures.push('the scene exposed no road edges');
		if (!result.deterministic) failures.push('two runs over the same world produced different crossings');

		const ids = new Set();
		for (const crossing of result.crossings) {
			if (ids.has(crossing.id)) failures.push(`duplicate crossing id ${crossing.id}`);
			ids.add(crossing.id);
			if (!(crossing.waterMeters > 0)) failures.push(`${crossing.id}: no water in the crossing`);
			if (!(crossing.spanMeters > crossing.waterMeters)) {
				failures.push(`${crossing.id}: span ${crossing.spanMeters} m does not exceed its water ${crossing.waterMeters} m — the bank margin is missing`);
			}
			// A decked crossing must be one the road actually makes. Run 442's measurement: seven live
			// crossings carry 54-76% of their chord over water, and the one that carried 33% was the road
			// travelling 71.6 m along a 14 m river, where a straight deck spans a field.
			// Both figures are percentages, so the 0.7 fraction applies directly to the expectation.
			if (crossing.decked && !(crossing.chordWetSharePercent >= crossing.expectedWetSharePercent * 0.7)) {
				failures.push(`${crossing.id}: decked, but only ${crossing.chordWetSharePercent}% of its chord is over water against ${crossing.expectedWetSharePercent}% expected`);
			}
			// The defect that made this module necessary: a deck floored on sea level ends up under a
			// river that is 70 m up a valley.
			if (!(crossing.deckAboveWaterMeters > 0)) {
				failures.push(`${crossing.id}: deck sits ${crossing.deckAboveWaterMeters} m relative to its own water surface`);
			}
			if (crossing.deckAboveHigherBankMeters < 0) {
				failures.push(`${crossing.id}: deck sits ${crossing.deckAboveHigherBankMeters} m below its higher bank`);
			}
		}

		const byRiver = new Map();
		for (const crossing of result.crossings) byRiver.set(crossing.river, (byRiver.get(crossing.river) ?? 0) + 1);
		console.log(
			`[checkRoadRiverBridgeCrossings] ${result.crossings.length} crossing(s) over ` +
			`${result.roadEdgeCount} road edges and ${result.riverCourseCount} river courses; ` +
			`rivers crossed: ${[...byRiver.entries()].map(([name, count]) => `${name} x${count}`).join(', ') || 'none'}`,
		);
		for (const crossing of result.crossings) {
			console.log(
				`  ${crossing.decked ? 'BRIDGE' : 'ford  '} ${crossing.id.padEnd(20)} ${crossing.river.padEnd(24)} ` +
				`water ${String(crossing.waterMeters).padStart(6)} m  deck ${String(crossing.deckY).padStart(8)} m  ` +
				`(+${crossing.deckAboveWaterMeters} over water, +${crossing.deckAboveHigherBankMeters} over the higher bank, ` +
				`chord ${crossing.chordWetSharePercent}% wet vs ${crossing.expectedWetSharePercent}% expected)`,
			);
		}
		const forded = result.crossings.filter((crossing) => !crossing.decked);
		if (forded.length) {
			console.log(
				`[checkRoadRiverBridgeCrossings] ${forded.length} run(s) left as fords — the road travels along ` +
				`the channel there, so a straight deck would span dry ground. Those are routes to fix, not bridges.`,
			);
		}
		if (failures.length) {
			for (const failure of failures) console.error(`[checkRoadRiverBridgeCrossings] FAIL: ${failure}`);
			process.exitCode = 1;
			return;
		}
		console.log('[checkRoadRiverBridgeCrossings] OK: every crossing clears its own water and both banks.');
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkRoadRiverBridgeCrossings] FAIL', error?.stack || error);
	process.exit(1);
});
