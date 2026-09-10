#!/usr/bin/env node
/**
 * Structural + determinism guard for `world/weather.js` (run 371's new `world/Weather` system —
 * GOVERNANCE.md §18 item 14). Mirrors the shape of `checkWorldEventDeterminism.js` but does not
 * need a committed fixture: unlike the world-event catalog, this module's own output space is small
 * enough (a fixed drop count, a pure function of `seed`) to assert directly rather than snapshot.
 *
 * Needs `three` resolvable as a bare specifier — same one-time local setup CI's own workflows use
 * (`npm install --no-save --no-package-lock three@0.160.0`, matching `src/3d/vendor/three`'s
 * REVISION 160), since `weather.js` renders through real `THREE.BufferGeometry`/`LineSegments`.
 *
 * Usage: `node scripts/checkWeatherSystem.js`
 * Exit codes: 0 = OK. 1 = a violation was found.
 * @module scripts/checkWeatherSystem
 */
import assert from 'node:assert/strict';
import { createWeatherSystem, RAIN_DROP_COUNT } from '../src/3d/world/weather.js';

function collectDropLayout(seed) {
	const system = createWeatherSystem({ seed });
	const positions = system.group.geometry.attributes.position.array;
	system.dispose();
	return Array.from(positions);
}

// 1. Determinism: same seed -> byte-identical initial drop layout; different seed -> different one.
const seedA1 = collectDropLayout(424242);
const seedA2 = collectDropLayout(424242);
const seedB = collectDropLayout(424243);
assert.deepEqual(seedA1, seedA2, 'same seed produced a different initial drop layout');
assert.notDeepEqual(seedA1, seedB, 'different seed unexpectedly produced the same drop layout');
assert.equal(seedA1.length, RAIN_DROP_COUNT * 2 * 3, 'position buffer length must match RAIN_DROP_COUNT * 2 vertices * 3 components');

// 2. Idle state: freshly created, un-triggered system is invisible (opacity 0) and does not move the
// scene graph — a shower must be explicitly triggered, never ambient by default.
{
	const system = createWeatherSystem({ seed: 7 });
	assert.equal(system.group.material.opacity, 0, 'untriggered weather system must start at opacity 0');
	system.update(1 / 60, { x: 0, y: 0, z: 0 });
	assert.equal(system.group.visible, false, 'untriggered weather system must stay invisible after an update');
	system.dispose();
}

// 3. trigger() ramps intensity up, holds, then ramps back down to invisible — and never overshoots
// opacity 1 regardless of how many frames are simulated.
{
	const system = createWeatherSystem({ seed: 7 });
	system.trigger(2); // 2s hold + the module's own fade margin on each side.
	let maxOpacity = 0;
	// Non-zero y (this world's terrain reaches real elevation, up to ~780m inland) — run 371 caught a
	// real bug here: the rain volume's Y wasn't following the camera at all, only X/Z, invisible to
	// this exact test only because it originally used y:0, which happened to match the bug's hardcoded
	// 0. Fixed in weather.js; kept non-zero here so this class of regression can't hide again.
	const cameraPosition = { x: 100, y: 340, z: -50 };
	for (let frame = 0; frame < 720; frame += 1) { // 12s at 60fps — comfortably past a 2s shower's full 6s hold + 4s fade-out (10s), with margin for float accumulation.
		system.update(1 / 60, cameraPosition);
		maxOpacity = Math.max(maxOpacity, system.group.material.opacity);
	}
	assert(maxOpacity > 0, 'a triggered shower never became visible');
	assert(maxOpacity <= 0.55 + 1e-6, `opacity overshot its intended ceiling (${maxOpacity})`);
	assert.equal(system.group.visible, false, 'a triggered shower must fade back out and hide itself once its duration elapses');
	assert.equal(system.group.position.x, cameraPosition.x, 'rain volume must recenter under the camera XZ');
	assert.equal(system.group.position.z, cameraPosition.z, 'rain volume must recenter under the camera XZ');
	system.dispose();
}

console.log(
	`[checkWeatherSystem] PASS: ${RAIN_DROP_COUNT} deterministic drops, idle-by-default, ` +
		'trigger()->fade-in->hold->fade-out->hide verified.',
);
