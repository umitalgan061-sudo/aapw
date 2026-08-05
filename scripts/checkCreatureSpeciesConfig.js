#!/usr/bin/env node
/**
 * checkCreatureSpeciesConfig.js — static structural guard for
 * `src/3d/gameplay/creatureSpeciesConfig.js`'s `CREATURE_SPECIES` registry (FAZ 11, run 72,
 * DECISIONS.md ADR-0095).
 *
 * That registry is deliberately data-only today (see its own file header) — no runtime code reads
 * it yet — but it is exactly the kind of file this project's own `checkSmokeCheckRegistry.js` was
 * built to argue for (GOVERNANCE.md §8.2 Root Cause Analysis): a hand-maintained list that silently
 * drifts (a copy-pasted entry with a stale `id`, a missing required field, a typo'd `status`) unless
 * something machine-checks it. Registered now, before any species is implemented, so every future
 * one-species-at-a-time sub-task inherits the guard instead of adding it retroactively once the
 * registry has already grown past a dozen entries.
 *
 * Dev-only tooling, same as its `check*.js` siblings — never loaded by a browser, no Playwright
 * needed (loads the config module directly via a real dynamic `import()`, no browser/DOM required).
 *
 * Usage: `node scripts/checkCreatureSpeciesConfig.js`
 * Exit codes: 0 = OK. 1 = a violation was found.
 * @module scripts/checkCreatureSpeciesConfig
 */

const path = require('path');

const REQUIRED_STRING_FIELDS = ['id', 'displayNameTr', 'category', 'locomotion', 'social', 'characteristicMovement'];
const VALID_CATEGORIES = ['insan', 'evcil-hayvan', 'yaban-hayvan', 'kus', 'mitolojik'];
const VALID_LOCOMOTIONS = ['biped', 'quadruped', 'flying'];
const VALID_SOCIALS = ['yalniz', 'suru', 'cift', 'eskortlu'];
const VALID_STATUSES = ['awaiting-model', 'partial-existing'];

/**
 * Validates one `CreatureSpeciesSpec` entry (see `creatureSpeciesConfig.js`'s own JSDoc typedef).
 * @param {string} key The registry key this entry is stored under.
 * @param {object} spec
 * @returns {string[]} Failure messages, empty if the entry is valid.
 */
function validateEntry(key, spec) {
	const failures = [];
	if (spec.id !== key) failures.push(`entry "${key}": id ("${spec.id}") does not match its own registry key`);
	for (const field of REQUIRED_STRING_FIELDS) {
		if (typeof spec[field] !== 'string' || spec[field].trim() === '') {
			failures.push(`entry "${key}": missing or empty required string field "${field}"`);
		}
	}
	if (!VALID_CATEGORIES.includes(spec.category)) {
		failures.push(`entry "${key}": category "${spec.category}" not one of ${JSON.stringify(VALID_CATEGORIES)}`);
	}
	if (!VALID_LOCOMOTIONS.includes(spec.locomotion)) {
		failures.push(`entry "${key}": locomotion "${spec.locomotion}" not one of ${JSON.stringify(VALID_LOCOMOTIONS)}`);
	}
	if (!VALID_SOCIALS.includes(spec.social)) {
		failures.push(`entry "${key}": social "${spec.social}" not one of ${JSON.stringify(VALID_SOCIALS)}`);
	}
	if (!VALID_STATUSES.includes(spec.status)) {
		failures.push(`entry "${key}": status "${spec.status}" not one of ${JSON.stringify(VALID_STATUSES)}`);
	}
	if (spec.status === 'partial-existing' && (typeof spec.existingOverlapNote !== 'string' || spec.existingOverlapNote.trim() === '')) {
		failures.push(`entry "${key}": status is "partial-existing" but existingOverlapNote is missing/empty`);
	}
	if (spec.status === 'awaiting-model' && spec.existingOverlapNote != null) {
		failures.push(`entry "${key}": status is "awaiting-model" but existingOverlapNote is set — should only exist for "partial-existing" entries`);
	}
	const speedProfile = spec.speedProfile;
	if (typeof speedProfile !== 'object' || speedProfile === null) {
		failures.push(`entry "${key}": missing speedProfile object`);
	} else {
		for (const speedField of ['idleOrPatrolMps', 'alertOrFleeMps']) {
			const value = speedProfile[speedField];
			if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
				failures.push(`entry "${key}": speedProfile.${speedField} must be a finite number >= 0, got ${JSON.stringify(value)}`);
			}
		}
	}
	if (!Array.isArray(spec.behaviorTags) || spec.behaviorTags.length === 0) {
		failures.push(`entry "${key}": behaviorTags must be a non-empty array`);
	} else if (spec.behaviorTags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
		failures.push(`entry "${key}": behaviorTags contains a non-string or empty entry`);
	}
	return failures;
}

/**
 * The registry is an ES module (`export const`); this repo has no bundler/transpile step, so it is
 * loaded via Node's own dynamic `import()` (works in a `.js` CommonJS file same as every other
 * `check*.js` script here) rather than `require()`.
 */
async function main() {
	const modulePath = path.join(__dirname, '..', 'src', '3d', 'gameplay', 'creatureSpeciesConfig.js');
	const moduleUrl = 'file://' + modulePath.replace(/\\/g, '/');
	let CREATURE_SPECIES;
	try {
		({ CREATURE_SPECIES } = await import(moduleUrl));
	} catch (error) {
		console.error(`[checkCreatureSpeciesConfig] Failed to load creatureSpeciesConfig.js: ${error.message}`);
		process.exit(1);
		return;
	}

	const entries = Object.entries(CREATURE_SPECIES);
	if (entries.length === 0) {
		console.error('[checkCreatureSpeciesConfig] CREATURE_SPECIES is empty — registry parse likely broke.');
		process.exit(1);
		return;
	}

	const failures = entries.flatMap(([key, spec]) => validateEntry(key, spec));
	if (failures.length > 0) {
		console.error(`[checkCreatureSpeciesConfig] ${failures.length} violation(s):`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
		return;
	}

	const awaitingModel = entries.filter(([, spec]) => spec.status === 'awaiting-model').length;
	const partialExisting = entries.length - awaitingModel;
	console.log(
		`[checkCreatureSpeciesConfig] OK: ${entries.length} species entries all valid ` +
			`(${awaitingModel} awaiting-model, ${partialExisting} partial-existing).`,
	);
}

main();
