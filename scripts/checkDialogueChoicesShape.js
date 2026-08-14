#!/usr/bin/env node
/**
 * checkDialogueChoicesShape.js — static regression guard for `gameplay/dialogueChoices.js`'s
 * `CHOICES_BY_NPC_ID` data shape. Run 69, addresses the last of run 68's three named "smoke coverage
 * gaps" (3D_GAME_PROGRESS.md's "Next step for the next run": `world/roads.js` and `world/rivers.js`
 * already have their own standing guards — `roadNetworkSafetyCheck.js` and `terrainSeatSafetyCheck.js`
 * cover roads/seats; `dialogueChoices.js`'s data shape had none).
 *
 * **Why this exists (GOVERNANCE.md §8.2 Root Cause Analysis precedent).** `CHOICES_BY_NPC_ID` is a
 * hand-written, purely data-shaped file with three invariants nothing in the runtime code enforces at
 * load time: (1) every key must be a real NPC id, so a typo or a since-removed NPC doesn't silently
 * orphan dialogue content; (2) every NPC's choice array must fit inside `interaction.js`'s
 * `DIALOGUE_CHOICE_KEY_CODES` (currently `Digit1..3`, 3 slots) since `game3d.js`'s keydown handler
 * indexes into it — a 4th choice would be genuinely unreachable, not merely unused; (3) every choice
 * needs a real label and a response containing the `{name}` placeholder the file's own header comment
 * documents as the substitution convention `GREETINGS_BY_NPC_ID` already established. None of these
 * would throw at runtime or fail the Playwright smoke suite (a missing/malformed entry just means that
 * NPC falls back to the old greeting-then-close-on-E behavior — see `dialogueChoices.js`'s own header),
 * so a broken entry could ship silently. Same "hand-maintained list, cheap automated cross-check"
 * precedent `checkAssetsManifest.js` / `checkServiceWorkerCache.js` / `checkSmokeCheckRegistry.js`
 * already established for this project — this is that check for dialogue-choice content.
 *
 * `dialogueChoices.js` is a real browser ES module (`export const`), not requirable from this
 * CommonJS script (same reason `checkServiceWorkerCache.js` parses `service-worker.js` as text rather
 * than `require`-ing it) — so this guard parses the source as text with the same regex-extraction
 * approach `checkSmokeCheckRegistry.js` already uses for `smokeTestGame3D.js`. Dev-only tooling, never
 * loaded by a browser, not referenced from `index.html`/`game3d.html`. No dependencies (plain Node
 * `fs`), so it runs anywhere Node does.
 *
 * Checks performed:
 *   1. HARD FAIL — every `CHOICES_BY_NPC_ID` key must match a real `id: '...'` inside
 *      `npcConfig.js`'s `NPC_CONFIG.SPAWNS` list (catches a stale/typo'd NPC id).
 *   2. HARD FAIL — every NPC's choice array length must be <= `interaction.js`'s
 *      `DIALOGUE_CHOICE_KEY_CODES.length` (catches a choice no keypress could ever reach).
 *   3. HARD FAIL — every choice's `label` and `response` must be non-empty after trimming.
 *   4. HARD FAIL — every choice's `response` must contain the literal `{name}` placeholder.
 *   5. SOFT WARNING — reports pilot coverage (covered / total real NPCs) so the "13 of 14" style
 *      progress note in this project's docs can be cross-checked against the data itself, not just
 *      hand-counted.
 *
 * Usage: `node scripts/checkDialogueChoicesShape.js`
 * Exit codes: 0 = OK (warnings may still print). 1 = at least one hard-fail check failed.
 * @module scripts/checkDialogueChoicesShape
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIALOGUE_CHOICES_PATH = path.join(ROOT, 'src/3d/gameplay/dialogueChoices.js');
// run 77 (DECISIONS.md ADR-0100): `NPC_CONFIG` moved out of `gameplayConfig.js` into its own file,
// `npcConfig.js`, once the former hit 597/600 lines — see that file's header for the full split.
// `npcConfig.js` declares only `NPC_CONFIG` (no sibling `ANIMAL_CONFIG`/`DRAGON_CONFIG` block to
// bound against anymore), so every `id: '...'` in the file is now a real NPC id.
const NPC_CONFIG_PATH = path.join(ROOT, 'src/3d/gameplay/npcConfig.js');
const INTERACTION_PATH = path.join(ROOT, 'src/3d/gameplay/interaction.js');

/**
 * Extracts every real NPC id from `npcConfig.js`'s `NPC_CONFIG.SPAWNS` list.
 * @param {string} source Full text of `npcConfig.js`.
 * @returns {string[]} NPC ids, in file order.
 */
function parseNpcIds(source) {
	const start = source.indexOf('export const NPC_CONFIG');
	if (start === -1) {
		throw new Error('could not locate `export const NPC_CONFIG` in npcConfig.js — has the file been restructured?');
	}
	const npcBlock = source.slice(start);
	const ids = [];
	for (const match of npcBlock.matchAll(/id:\s*'([\w-]+)'/g)) ids.push(match[1]);
	return ids;
}

/**
 * Reads `interaction.js`'s `DIALOGUE_CHOICE_KEY_CODES` array literal to get the real number of
 * reachable choice slots, rather than hard-coding `3` here and risking the two silently drifting apart.
 * @param {string} source Full text of `interaction.js`.
 * @returns {number}
 */
function parseChoiceSlotCount(source) {
	const match = source.match(/DIALOGUE_CHOICE_KEY_CODES\s*=\s*\[([^\]]*)\]/);
	if (!match) throw new Error('could not find DIALOGUE_CHOICE_KEY_CODES in interaction.js — has the keybinding constant moved or been renamed?');
	const entries = match[1].split(',').map((s) => s.trim()).filter(Boolean);
	return entries.length;
}

/**
 * Parses `CHOICES_BY_NPC_ID`'s object body into per-NPC choice arrays. Regex-based, matching the
 * file's own consistent `Object.freeze({ ... })` formatting rather than a general JS parser — same
 * trade-off `checkSmokeCheckRegistry.js`'s `parseRunner()` already makes for `smokeTestGame3D.js`.
 * @param {string} source Full text of `dialogueChoices.js`.
 * @returns {{npcId: string, choices: Array<{label: string, response: string}>}[]}
 */
function parseChoicesByNpcId(source) {
	const exportStart = source.indexOf('export const CHOICES_BY_NPC_ID');
	if (exportStart === -1) throw new Error('could not find `export const CHOICES_BY_NPC_ID` in dialogueChoices.js');
	const body = source.slice(exportStart);

	const npcBlockPattern = /'([\w-]+)':\s*Object\.freeze\(\[([\s\S]*?)\n\t\]\),/g;
	const npcEntries = [];
	for (const npcMatch of body.matchAll(npcBlockPattern)) {
		const npcId = npcMatch[1];
		const choicesBody = npcMatch[2];
		const choices = [];
		const choicePattern = /label:\s*'((?:\\'|[^'])*)',\s*\n\s*response:\s*'((?:\\'|[^'])*)',/g;
		for (const choiceMatch of choicesBody.matchAll(choicePattern)) {
			choices.push({ label: choiceMatch[1], response: choiceMatch[2] });
		}
		npcEntries.push({ npcId, choices });
	}
	return npcEntries;
}

function main() {
	for (const p of [DIALOGUE_CHOICES_PATH, NPC_CONFIG_PATH, INTERACTION_PATH]) {
		if (!fs.existsSync(p)) {
			console.error(`[checkDialogueChoicesShape] FAIL: expected file not found at ${path.relative(ROOT, p)}`);
			process.exit(1);
		}
	}

	const dialogueSource = fs.readFileSync(DIALOGUE_CHOICES_PATH, 'utf8');
	const npcConfigSource = fs.readFileSync(NPC_CONFIG_PATH, 'utf8');
	const interactionSource = fs.readFileSync(INTERACTION_PATH, 'utf8');

	let npcIds;
	let choiceSlotCount;
	let npcEntries;
	try {
		npcIds = parseNpcIds(npcConfigSource);
		choiceSlotCount = parseChoiceSlotCount(interactionSource);
		npcEntries = parseChoicesByNpcId(dialogueSource);
	} catch (error) {
		console.error(`[checkDialogueChoicesShape] FAIL: ${error.message}`);
		process.exit(1);
	}

	const realNpcIdSet = new Set(npcIds);
	const failures = [];

	if (npcEntries.length === 0) {
		failures.push('parsed zero NPC entries out of CHOICES_BY_NPC_ID — the regex no longer matches the file\'s shape, or every entry was removed');
	}

	for (const { npcId, choices } of npcEntries) {
		if (!realNpcIdSet.has(npcId)) {
			failures.push(`"${npcId}" is a CHOICES_BY_NPC_ID key but not a real id in NPC_CONFIG.SPAWNS — stale or typo'd NPC id`);
		}
		if (choices.length === 0) {
			failures.push(`"${npcId}" parsed with zero choices — either a genuinely empty array (should be removed, per the file's own "absent/empty means old behavior" convention) or the choice-object regex no longer matches its formatting`);
		}
		if (choices.length > choiceSlotCount) {
			failures.push(`"${npcId}" has ${choices.length} choices but interaction.js's DIALOGUE_CHOICE_KEY_CODES only has ${choiceSlotCount} slot(s) — the extra choice(s) are unreachable by any keypress`);
		}
		choices.forEach((choice, index) => {
			const ordinal = index + 1;
			if (choice.label.trim().length === 0) {
				failures.push(`"${npcId}" choice #${ordinal} has an empty label`);
			}
			if (choice.response.trim().length === 0) {
				failures.push(`"${npcId}" choice #${ordinal} has an empty response`);
			} else if (!choice.response.includes('{name}')) {
				failures.push(`"${npcId}" choice #${ordinal}'s response is missing the "{name}" placeholder (file header documents this as the substitution convention every response follows)`);
			}
		});
	}

	const duplicateIds = npcEntries.map((e) => e.npcId).filter((id, i, arr) => arr.indexOf(id) !== i);
	for (const dup of new Set(duplicateIds)) {
		failures.push(`"${dup}" appears more than once as a CHOICES_BY_NPC_ID key`);
	}

	if (failures.length > 0) {
		for (const failure of failures) console.error(`[checkDialogueChoicesShape] FAIL: ${failure}`);
		console.error(`[checkDialogueChoicesShape] FAIL: ${failures.length} violation(s).`);
		process.exit(1);
	}

	const coveredCount = new Set(npcEntries.map((e) => e.npcId)).size;
	console.log(
		`[checkDialogueChoicesShape] OK: ${npcEntries.length} NPC entries all resolve to real NPC ids, ` +
			`all choices within the ${choiceSlotCount}-slot keybinding limit, all labels/responses non-empty, ` +
			`all responses carry "{name}". Pilot coverage: ${coveredCount}/${npcIds.length} real NPCs.`,
	);
}

main();
