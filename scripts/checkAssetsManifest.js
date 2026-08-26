#!/usr/bin/env node
/**
 * checkAssetsManifest.js — cross-checks asset manifests against the real contents of
 * `assets/` so provenance records cannot silently drift from disk.
 *
 * `assets_manifest.json` remains the canonical catalog. Owner uploads whose original
 * provenance was not supplied may be recorded in `assets_manifest.owner_uploads.json`
 * using the repository's explicit UNKNOWN — owner-approved policy. Keeping those records
 * separate makes the uncertainty visible instead of fabricating a third-party license.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'assets_manifest.json');
const OWNER_UPLOADS_PATH = path.join(ROOT, 'assets_manifest.owner_uploads.json');
const ASSETS_DIR = path.join(ROOT, 'assets');
const QUARANTINE_PATH = path.join(ROOT, 'assets_manifest.quarantine.json');

const PRIMARY_MODEL_EXTENSIONS = new Set(['.fbx', '.glb']);

function listFilesRecursive(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFilesRecursive(full));
		else if (entry.name !== '.gitkeep') out.push(full);
	}
	return out;
}

function readManifest(filePath, label, required = true) {
	if (!fs.existsSync(filePath)) {
		if (required) throw new Error(`${label} not found at ${filePath}`);
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (error) {
		throw new Error(`${label} is not valid JSON — ${error.message}`);
	}
	if (!Array.isArray(parsed.assets)) throw new Error(`${label} must contain an assets array`);
	return parsed.assets;
}

function main() {
	if (!fs.existsSync(ASSETS_DIR)) {
		console.error(`[checkAssetsManifest] FAIL: assets/ directory not found at ${ASSETS_DIR}`);
		process.exit(1);
	}

	let canonicalEntries;
	let ownerUploadEntries;
	try {
		canonicalEntries = readManifest(MANIFEST_PATH, 'assets_manifest.json');
		ownerUploadEntries = readManifest(OWNER_UPLOADS_PATH, 'assets_manifest.owner_uploads.json', false);
	} catch (error) {
		console.error(`[checkAssetsManifest] FAIL: ${error.message}`);
		process.exit(1);
	}

	const ownerUploadErrors = [];
	for (const entry of ownerUploadEntries) {
		if (!entry.id || !entry.file || !entry.source || !entry.license) {
			ownerUploadErrors.push(`${entry.id || entry.file || '<unknown>'}: id/file/source/license are required`);
			continue;
		}
		if (entry.license !== 'UNKNOWN — owner-approved for runtime use') {
			ownerUploadErrors.push(`${entry.id}: owner-upload registry is reserved for explicit UNKNOWN — owner-approved records`);
		}
	}

	const entries = [...canonicalEntries, ...ownerUploadEntries];
	const registeredAbsPaths = new Set();
	const missingRegisteredFiles = [];
	const duplicateFiles = [];
	const seenFiles = new Map();
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
		const previousId = seenFiles.get(entry.file);
		if (previousId) duplicateFiles.push(`${entry.file} (${previousId}, ${entry.id || '<unknown>'})`);
		else seenFiles.set(entry.file, entry.id || '<unknown>');
		const abs = path.join(ROOT, entry.file);
		registeredAbsPaths.add(abs);
		if (!fs.existsSync(abs)) missingRegisteredFiles.push({ id: entry.id, file: entry.file });
	}

	// Quarantine dissolved by owner directive, 2026-08-13 (GOVERNANCE.md §33.3 /
	// GOVERNANCE_FULL_GAME_DIRECTIVE.md §4): every file under assets/ is approved for runtime use.
	if (quarantineEntries.length > 0) {
		quarantineErrors.push(
			`assets_manifest.quarantine.json lists ${quarantineEntries.length} quarantined asset(s), but the owner ` +
				'dissolved the quarantine on 2026-08-13 — no asset may be withheld from runtime use. Move each entry ' +
				'into an approved manifest with license "UNKNOWN — owner-approved for runtime use" and record it in ' +
				'CREDITS.md. See GOVERNANCE_FULL_GAME_DIRECTIVE.md §4.',
		);
	}

	const diskFiles = listFilesRecursive(ASSETS_DIR);
	const unregisteredPrimaryModels = [];
	const unregisteredOther = [];
	for (const abs of diskFiles) {
		if (registeredAbsPaths.has(abs)) continue;
		const ext = path.extname(abs).toLowerCase();
		const rel = path.relative(ROOT, abs);
		if (PRIMARY_MODEL_EXTENSIONS.has(ext)) unregisteredPrimaryModels.push(rel);
		else unregisteredOther.push(rel);
	}

	let hardFail = false;
	if (ownerUploadErrors.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${ownerUploadErrors.length} invalid owner-upload provenance record(s):`);
		for (const error of ownerUploadErrors) console.error(`  - ${error}`);
	}
	if (quarantineErrors.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${quarantineErrors.length} invalid quarantine record(s):`);
		for (const error of quarantineErrors) console.error(`  - ${error}`);
	}
	if (duplicateFiles.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${duplicateFiles.length} asset file(s) are registered more than once:`);
		for (const item of duplicateFiles) console.error(`  - ${item}`);
	}
	if (missingRegisteredFiles.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${missingRegisteredFiles.length} manifest entr${missingRegisteredFiles.length === 1 ? 'y refers' : 'ies refer'} to a file that does not exist on disk:`);
		for (const item of missingRegisteredFiles) console.error(`  - "${item.id}" -> ${item.file}`);
	}
	if (unregisteredPrimaryModels.length > 0) {
		hardFail = true;
		console.error(`[checkAssetsManifest] FAIL: ${unregisteredPrimaryModels.length} primary model file(s) on disk are not registered in an approved asset manifest (add source/license before this ships):`);
		for (const file of unregisteredPrimaryModels) console.error(`  - ${file}`);
	}
	if (unregisteredOther.length > 0) {
		console.warn(`[checkAssetsManifest] WARN: ${unregisteredOther.length} non-model file(s) under assets/ are not individually referenced by a manifest:`);
		for (const file of unregisteredOther) console.warn(`  - ${file}`);
	}
	if (!hardFail) {
		console.log(`[checkAssetsManifest] OK: ${canonicalEntries.length} canonical + ${ownerUploadEntries.length} owner-upload manifest entries resolve; all .fbx/.glb model files are registered.`);
	}
	process.exit(hardFail ? 1 : 0);
}

main();
