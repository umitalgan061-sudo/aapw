#!/usr/bin/env node
/**
 * Guards the head trim that makes rivers emerge at a spring line instead of on a summit.
 *
 * Run 444 measured the defect: `rivers.js` seeds each course at "the highest sampled point within
 * `searchRadiusMeters`", so at station 0.05 the ground 200 m either side of the water sat a median
 * 46.0 m *below* it (worst 193.0 m, The White Knife). Run 446 fixed it inside `buildRiverSurface` by
 * dropping the perched head, and photographed the result in `artifacts/river-source/`.
 *
 * This gate pins the trim's *contract* against a synthetic height field rather than the live world.
 * That is deliberate. The live perch numbers move whenever the terrain does, so asserting them here
 * would turn every legitimate height change into a red gate about rivers — the mistake
 * `checkCanonicalRoadBridgeSceneShadow` made with its frozen bridge count. What must never regress is
 * the behaviour itself: the trim stops at the first seated point, it never exceeds its own cap, it
 * never shortens a course past the retained-point floor, it never makes a head *worse*, and it is
 * deterministic and idempotent (GOVERNANCE §8.9).
 *
 * Usage: `node scripts/checkRiverHeadwaterSpring.js`
 * Exit codes: 0 pass, 1 fail.
 * @module scripts/checkRiverHeadwaterSpring
 */

import { RIVER_HEADWATER_SPRING_POLICY, trimHeadwaterPerch } from '../src/3d/world/riverHeadwaterSpring.js';

const POLICY = RIVER_HEADWATER_SPRING_POLICY;
const SPACING_METERS = 8; // `rivers.js`'s RIVER_SURFACE_SPACING_METERS — the surface arrives densified.

const failures = [];
const check = (label, condition, detail) => {
	if (!condition) failures.push(`${label}: ${detail}`);
};

/**
 * A world in two halves, joined at `transitionX`. Before it the land is a ridge that falls away from
 * the course on both sides, so any water there is perched; after it the land is a valley that rises
 * on both sides, so water is seated. The trim's whole job is to find that join.
 * @param {number} transitionX
 * @returns {(x: number, z: number) => number}
 */
function ridgeThenValley(transitionX) {
	return (x, z) => (x < transitionX ? 200 - Math.abs(z) : Math.abs(z));
}

/** A course running along +x at z = 0, descending gently, at the density `buildRiverSurface` emits. */
function course(lengthMeters) {
	const points = [];
	for (let x = 0; x <= lengthMeters; x += SPACING_METERS) points.push({ x, y: 100 - x * 0.01, z: 0 });
	return points;
}

/** Perch at a point, by the same definition the module uses: water height above the lower bank. */
function perchAt(points, index, sampleHeightMeters) {
	const point = points[index];
	const previous = points[Math.max(0, index - 1)];
	const next = points[Math.min(points.length - 1, index + 1)];
	const tangentX = next.x - previous.x;
	const tangentZ = next.z - previous.z;
	const length = Math.hypot(tangentX, tangentZ) || 1;
	const acrossX = (-tangentZ / length) * POLICY.perchProbeMeters;
	const acrossZ = (tangentX / length) * POLICY.perchProbeMeters;
	return point.y - Math.min(
		sampleHeightMeters(point.x + acrossX, point.z + acrossZ),
		sampleHeightMeters(point.x - acrossX, point.z - acrossZ),
	);
}

const trimmedMeters = (before, after) => before[0].x !== undefined ? after[0].x - before[0].x : 0;

// 1. A head perched over a ridge is trimmed to the first seated point, and no further.
{
	const transitionX = 240; // inside the 400 m budget.
	const ground = ridgeThenValley(transitionX);
	const before = course(1600);
	const after = trimHeadwaterPerch(before, ground);
	check('seated-head', perchAt(after, 0, ground) <= POLICY.acceptablePerchMeters,
		`head perch ${perchAt(after, 0, ground).toFixed(1)} m exceeds ${POLICY.acceptablePerchMeters} m`);
	check('minimal-trim', after[0].x === transitionX,
		`trimmed to x=${after[0].x}, expected the first seated point x=${transitionX}`);
	check('improves-head', perchAt(after, 0, ground) < perchAt(before, 0, ground),
		'trim did not improve the head perch');
	check('idempotent', trimHeadwaterPerch(after, ground)[0].x === after[0].x,
		'a second trim moved the head again');
	check('deterministic', trimHeadwaterPerch(course(1600), ground)[0].x === after[0].x,
		'two trims of the same course disagreed');
}

// 2. A course that never seats inside the budget is trimmed by at most the cap — never gutted.
{
	const ground = ridgeThenValley(5000); // never seats anywhere the trim can reach.
	const before = course(1600);
	const after = trimHeadwaterPerch(before, ground);
	const cap = Math.min(POLICY.maximumTrimMeters, 1600 * POLICY.maximumTrimShareOfCourse);
	check('respects-cap', trimmedMeters(before, after) <= cap,
		`trimmed ${trimmedMeters(before, after)} m against a ${cap} m cap`);
	check('never-worse', perchAt(after, 0, ground) <= perchAt(before, 0, ground) + 1e-6,
		'the fallback trim left the head more perched than it started');
}

// 3. The share cap binds on a short course even though the absolute cap would not.
{
	const ground = ridgeThenValley(5000);
	const before = course(400);
	const after = trimHeadwaterPerch(before, ground);
	check('share-cap', trimmedMeters(before, after) <= 400 * POLICY.maximumTrimShareOfCourse + SPACING_METERS,
		`trimmed ${trimmedMeters(before, after)} m of a 400 m course`);
	check('retains-points', after.length >= Math.min(before.length, POLICY.minimumRetainedPoints),
		`left ${after.length} points, below the ${POLICY.minimumRetainedPoints} floor`);
}

// 4. A course too short to trim safely is returned untouched, not emptied.
{
	const ground = ridgeThenValley(5000);
	const before = course(SPACING_METERS * 4);
	check('short-course-untouched', trimHeadwaterPerch(before, ground) === before,
		'a course below the retained-point floor was trimmed anyway');
}

// 5. Missing a height field is a no-op, not a crash — `buildRiverSurface` is called without one in tests.
check('no-sampler', trimHeadwaterPerch(course(800), null).length === course(800).length,
	'a missing height sampler changed the course');

if (failures.length > 0) {
	console.error('[checkRiverHeadwaterSpring] FAIL');
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log(`[checkRiverHeadwaterSpring] PASS: head trim seats the source, caps at ${POLICY.maximumTrimMeters} m / ${POLICY.maximumTrimShareOfCourse * 100}% of course, and is deterministic.`);
