#!/usr/bin/env node
/**
 * checkAssetCoverage.js — every model in `assets/` is accounted for, or this fails.
 *
 * **The question this makes answerable.** The owner has asked three times for the whole model library to
 * be placed across the whole map. Until run 377 there was no way to check whether it had been: the
 * catalogue listed what it placed, the exclusions were bare counts with no filenames, and nothing
 * compared either against what is actually on disk. Measuring it found the gap was not small — of the
 * **360 distinct models** in `assets/`, **203 were referenced by no system at all**. Not placed, not
 * deliberately withheld. Invisible, and invisible in a way no existing gate could see, because every
 * gate scored the catalogue against itself.
 *
 * So this walks `assets/` and demands that every model file be exactly one of:
 *
 *   1. **placed** — in `world/worldPropCatalogue.js`;
 *   2. **owned** — referenced by a named system that has its own reason to hold it (the seat castles,
 *      the animals, the NPCs, the player, the dragons, the editor's asset library);
 *   3. **withheld** — listed in `world/worldPropExclusions.js` against a named reason.
 *
 * Anything else is unaccounted for and fails. Adding a model to `assets/` and forgetting to place it is
 * now a red build rather than a silent omission that survives for hundreds of runs.
 *
 * **Distinct models, not paths.** `assets/models/fbx/` is the raw download folder and the organised
 * directories hold copies of the same files under tidier names. Counting paths therefore double-counts,
 * and — worse — the catalogue had drifted into listing 58 models twice, placing each at double weight
 * and loading two GPU copies under two cache keys. Files are grouped by their Git LFS content hash,
 * which is the one identifier that survives a rename, and a model counted once however many names it
 * has. The check also fails if the catalogue lists two paths that are the same model.
 *
 * Usage: `node scripts/checkAssetCoverage.js`
 * Exit codes: 0 = PASS. 1 = FAIL.
 * @module scripts/checkAssetCoverage
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const ASSET_ROOT = path.join(REPO, 'assets');
const MODEL_ROOT = path.join(ASSET_ROOT, 'models');
const MODEL_EXTENSIONS = new Set(['.glb', '.fbx', '.gltf']);

/** Systems that legitimately reference a model without the scatter placing it. */
const OWNING_SYSTEMS = Object.freeze({
	'src/3d/world/settlements.js': 'seat-castles',
	'src/3d/gameplay/animalConfig.js': 'animals',
	'src/3d/gameplay/npcConfig.js': 'npcs',
	'src/3d/gameplay/playerConfig.js': 'player',
	'src/3d/gameplay/dragonConfig.js': 'dragons',
	'src/3d/editor/editorAssetLibrary.js': 'editor',
});

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
	}
	return out;
}

/**
 * A model's identity: its Git LFS content hash where the file is a pointer, else its own bytes' size and
 * name. In a fresh clone every model is a 129-byte pointer (RCA_RUN344), and the pointer carries the
 * sha256 of the real object — which is exactly the identity we want, and costs nothing to read.
 */
function modelIdentity(file) {
	const head = fs.readFileSync(file).subarray(0, 300).toString('utf8');
	const oid = /oid sha256:([0-9a-f]{64})/.exec(head);
	return oid ? oid[1] : `bytes:${fs.statSync(file).size}:${path.basename(file)}`;
}

/** How a model path is written in the catalogue and the exclusion list. */
function catalogueForm(file) {
	const rel = path.relative(MODEL_ROOT, file);
	if (!rel.startsWith('..')) return rel.split(path.sep).join('/');
	return `../${path.relative(ASSET_ROOT, file).split(path.sep).join('/')}`;
}

(async () => {
	const catalogue = await import(`file://${path.join(REPO, 'src/3d/world/worldPropCatalogue.js')}`);
	const exclusions = await import(`file://${path.join(REPO, 'src/3d/world/worldPropExclusions.js')}`);
	const placed = new Set(catalogue.PROP_CATALOGUE.map((entry) => entry.file));
	const withheld = new Set(exclusions.PROP_EXCLUDED_FILES);

	// Every model path referenced by a system that owns models for its own reasons.
	const owned = new Map();
	for (const [source, system] of Object.entries(OWNING_SYSTEMS)) {
		const text = fs.readFileSync(path.join(REPO, source), 'utf8');
		for (const match of text.matchAll(/['"]([^'"]*\.(?:glb|fbx|gltf|FBX))['"]/g)) {
			const value = match[1];
			for (const key of [value, path.basename(value), value.replace(/^assets\/models\//, '')]) {
				owned.set(key, system);
			}
		}
	}

	const files = walk(ASSET_ROOT);
	/** @type {Map<string, {forms: string[], files: string[]}>} */
	const models = new Map();
	for (const file of files) {
		const id = modelIdentity(file);
		if (!models.has(id)) models.set(id, { forms: [], files: [] });
		models.get(id).forms.push(catalogueForm(file));
		models.get(id).files.push(path.relative(REPO, file));
	}

	const status = { placed: [], owned: [], withheld: [], unaccounted: [] };
	for (const [id, model] of models) {
		const isPlaced = model.forms.some((form) => placed.has(form));
		const isWithheld = model.forms.some((form) => withheld.has(form));
		const isOwned = model.forms.some((form) => owned.has(form) || owned.has(path.basename(form)));
		if (isPlaced) status.placed.push(model);
		else if (isOwned) status.owned.push(model);
		else if (isWithheld) status.withheld.push(model);
		else status.unaccounted.push({ id, ...model });
	}

	// A model placed twice under two names is placed at double weight and loaded twice.
	const placedTwice = [];
	for (const model of models.values()) {
		const hits = model.forms.filter((form) => placed.has(form));
		if (hits.length > 1) placedTwice.push(hits);
	}
	// A path in either list that no longer exists on disk is a stale entry the scatter will fail to load.
	const everyForm = new Set([...models.values()].flatMap((model) => model.forms));
	const ghostPlaced = [...placed].filter((form) => !everyForm.has(form));
	const ghostWithheld = [...withheld].filter((form) => !everyForm.has(form));
	const bothPlacedAndWithheld = [...placed].filter((form) => withheld.has(form));

	const failures = [];
	if (status.unaccounted.length) {
		failures.push(`${status.unaccounted.length} model(s) are neither placed, owned by a system, nor withheld with a reason`);
	}
	if (placedTwice.length) failures.push(`${placedTwice.length} model(s) appear in the catalogue under two paths — double weight, two GPU copies`);
	if (ghostPlaced.length) failures.push(`${ghostPlaced.length} catalogue entr(ies) name a file that is not in assets/`);
	if (ghostWithheld.length) failures.push(`${ghostWithheld.length} exclusion entr(ies) name a file that is not in assets/`);
	if (bothPlacedAndWithheld.length) failures.push(`${bothPlacedAndWithheld.length} file(s) are both placed and withheld`);

	console.log(`[asset-coverage] ${files.length} model files in assets/ -> ${models.size} distinct models`);
	console.log(`[asset-coverage]   placed by the scatter : ${status.placed.length}`);
	console.log(`[asset-coverage]   owned by a system     : ${status.owned.length}`);
	console.log(`[asset-coverage]   withheld with a reason: ${status.withheld.length}`);
	console.log(`[asset-coverage]   unaccounted for       : ${status.unaccounted.length}`);
	const reasons = Object.entries(exclusions.PROP_EXCLUSIONS_BY_REASON)
		.map(([reason, list]) => `${reason} ${list.length}`).join(', ');
	console.log(`[asset-coverage] withheld by reason: ${reasons}`);
	for (const model of status.unaccounted.slice(0, 25)) console.error(`[asset-coverage]   unaccounted: ${model.files[0]}`);
	for (const hits of placedTwice.slice(0, 10)) console.error(`[asset-coverage]   placed twice: ${hits.join('  ||  ')}`);
	for (const form of [...ghostPlaced, ...ghostWithheld].slice(0, 10)) console.error(`[asset-coverage]   names a missing file: ${form}`);

	if (failures.length) {
		for (const failure of failures) console.error(`[asset-coverage] FAIL: ${failure}`);
		process.exit(1);
	}
	console.log('[asset-coverage] PASS: every model in assets/ is placed, owned by a named system, or withheld with a stated reason — and none is placed twice.');
	process.exit(0);
})().catch((error) => {
	console.error('[asset-coverage] FAIL:', error);
	process.exit(1);
});
