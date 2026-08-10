#!/usr/bin/env node
/**
 * checkAssetsManifest.js — cross-checks `assets_manifest.json` against the real contents of
 * `assets/` so the manifest (hand-maintained since Phase 0) can't silently drift from disk.
 *
 * Flagged as tech debt in 3D_GAME_PROGRESS.md's "Known Issues" ("assets_manifest.json is
 * hand-maintained, no automated check that it matches assets/") — this script is that check.
 * No dependencies (plain Node `fs`), so it can run in CI or any dev machine with zero install step.
 *
 * Checks performed:
 *   1. HARD FAIL — every manifest entry's `file` must exist on disk (catches a typo'd path or a
 *      registered-but-never-actually-added asset).
 *   2. HARD FAIL — every "primary" model file on disk (`.fbx` / `.glb` — the two formats this
 *      project's code actually loads, see `assetLoader.js`'s `loadFBXModel`/`loadModel`) must be
 *      referenced by at least one manifest entry (catches a newly dropped-in asset that was never
 *      registered, so its license/source would go untracked).
 *   3. SOFT WARNING — any other file under `assets/` not referenced by the manifest (textures,
 *      `.gltf`/`.bin` sidecars, etc.) is reported but does not fail the run. Rigged-model exports
 *      routinely ship texture/buffer sidecar files that live alongside a registered primary file
 *      without needing their own manifest entry (e.g. the wolf model's `.png`/`.jpeg` textures, or
 *      its unused `.gltf`+`.bin` alternate encoding of the same registered `.glb`).
 *
 * Usage: `node scripts/checkAssetsManifest.js` — exit code 0 = clean (hard-fail checks passed,
 * warnings may still be printed), exit code 1 = at least one hard-fail check failed.
 *
 * Run this after adding/removing any file under `assets/` or any entry in `assets_manifest.json`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'assets_manifest.json');
const ASSETS_DIR = path.join(ROOT, 'assets');
const QUARANTINE_PATH = path.join(ROOT, 'assets_manifest.quarantine.json');

/** Extensions this project's code actually loads as a 3D model (see assetLoader.js). */
const PRIMARY_MODEL_EXTENSIONS = new Set(['.fbx', '.glb']);

/**
 * Recursively lists every file under `dir`, skipping `.gitkeep` placeholders.
 * @param {string} dir Absolute directory path.
 * @returns {string[]} Absolute file paths.
 */
function listFilesRecursive(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listFilesRecursive(full));
		} else if (entry.name !== '.gitkeep') {
			out.push(full);
		}
	}
	return out;
}

function main() {
	if (!fs.existsSync(MANIFEST_PATH)) {
		console.error(`[checkAssetsManifest] FAIL: manifest not found at ${MANIFEST_PATH}`);
		process.exit(1);
	}
	if (!fs.existsSync(ASSETS_DIR)) {
		console.error(`[checkAssetsManifest] FAIL: assets/ directory not found at ${ASSETS_DIR}`);
		process.exit(1);
	}

	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
	} catch (error) {
		console.error(`[checkAssetsManifest] FAIL: assets_manifest.json is not valid JSON — ${error.message}`);
		process.exit(1);
	}

	const entries = Array.isArray(manifest.assets) ? manifest.assets : [];
	const registeredAbsPaths = new Set();
	const missingRegisteredFiles = [];
	const quarantineErrors = [];
	let quarantineEntries = [];

	if (fs.existsSync(QUARANTINE_PATH)) {
		try {
			const quarantine = JSON.parse(fs.readFileSync(QUARANTINE_PATH, 'utf8'));
			quarantineEntries = Array.isArray(quarantine.assets) ? quarantine.assets : [];
		} catch (error) {
			quarantineErrors.push(`assets_manifest.quarantine.json is not valid JSON — ${error.message}`);
		}
	}

	for (const entry of entries) {
		if (!entry.file) continue;
		const abs = path.join(ROOT, entry.file);
		registeredAbsPaths.add(abs);
		if (!fs.existsSync(abs)) {
			missingRegisteredFiles.push({ id: entry.id, file: entry.file });
		}
	}

	for (const entry of quarantineEntries) {
		if (!entry?.file || entry.provenanceStatus !== 'pending-owner-confirmation' || entry.license !== 'UNKNOWN' || entry.runtimeUseAllowed !== false || entry.redistributionApproved !== false) {
			quarantineErrors.push(`${entry?.id || '<missing-id>'}: quarantine record must remain provenance-pending, UNKNOWN-license, runtime-disabled and redistribution-unapproved`);
			continue;
		}
		const abs = path.join(ROOT, entry.file);
		if (!fs.existsSync(abs)) {
			quarantineErrors.push(`${entry.id}: quarantined file does not exist: ${entry.file}`);
			continue;
		}
		if (!PRIMARY_MODEL_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
			quarantineErrors.push(`${entry.id}: quarantine exception is only valid for primary .fbx/.glb models: ${entry.file}`);
			continue;
		}
		registeredAbsPaths.add(abs);
	}

	const diskFiles = listFilesRecursive(ASSETS_DIR);
	const unregisteredPrimaryModels = [];
	const unregisteredOther = [];

	for (const abs of diskFiles) {
		if (registeredAbsPaths.has(abs)) continue;
		const ext = path.extname(abs).toLowerCase();
		const rel = path.relative(ROOT, abs);
		if (PRIMARY_MODEL_EXTENSIONS.has(ext)) {
			unregisteredPrimaryModels.push(rel);
		} else {
			unregisteredOther.push(rel);
		}
	}

	let hardFail = false;

	if (quarantineErrors.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${quarantineErrors.length} invalid quarantine record(s):`);
		for (const error of quarantineErrors) console.error(`  - ${error}`);
	}

	if (quarantineEntries.length > 0 && quarantineErrors.length === 0) {
		console.warn(`[checkAssetsManifest] QUARANTINE: ${quarantineEntries.length} owner-upload primary model(s) are accounted for but remain runtime-disabled and redistribution-unapproved until provenance/license is confirmed.`);
	}

	if (missingRegisteredFiles.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${missingRegisteredFiles.length} manifest entr${missingRegisteredFiles.length === 1 ? 'y refers' : 'ies refer'} to a file that does not exist on disk:`);
		for (const m of missingRegisteredFiles) console.error(`  - "${m.id}" -> ${m.file}`);
	}

	if (unregisteredPrimaryModels.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${unregisteredPrimaryModels.length} primary model file(s) on disk are not registered in assets_manifest.json (add an entry with source/license before this ships):`);
		for (const f of unregisteredPrimaryModels) console.error(`  - ${f}`);
	}

	if (unregisteredOther.length > 0) {
		console.warn(`[checkAssetsManifest] WARN: ${unregisteredOther.length} non-model file(s) under assets/ are not individually referenced by the manifest (expected for texture/sidecar files that ship alongside a registered model):`);
		for (const f of unregisteredOther) console.warn(`  - ${f}`);
	}

	if (!hardFail) {
		console.log(`[checkAssetsManifest] OK: ${entries.length} manifest entries all resolve to real files; all .fbx/.glb model files on disk are registered.`);
	}

	process.exit(hardFail ? 1 : 0);
}

main();
