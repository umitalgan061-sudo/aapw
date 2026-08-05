#!/usr/bin/env node
/**
 * checkServiceWorkerCache.js — cross-checks `service-worker.js`'s hand-maintained
 * `GAME3D_SHELL_FILES` precache list against the real `src/3d` import graph and the real asset
 * paths referenced from that code, so the offline app shell can't silently drift behind the game
 * again the way it had by run 65 (GOVERNANCE.md §15 "PWA Cache Versiyonlama" — 10 live JS modules
 * and 3 asset groups, including the entire FAZ 7 dragon, were being fetched over the network with
 * no offline entry at all; see `service-worker.js`'s own `GAME3D_SHELL_FILES` header comment and
 * DECISIONS.md ADR-0083). Same "hand-maintained list, cheap automated cross-check" precedent
 * `checkAssetsManifest.js` already established for `assets_manifest.json` — this is that check for
 * `service-worker.js`. No dependencies (plain Node `fs`), so it can run in CI or any dev machine
 * with zero install step.
 *
 * Checks performed:
 *   1. HARD FAIL — every `.js` file under `src/3d/` (the entire game's real import graph — see
 *      `game3d.js`'s own import list, confirmed by hand at ADR-0083 time to all be live, no dead
 *      files) must appear in `GAME3D_SHELL_FILES`.
 *   2. HARD FAIL — every `assets/.../*.fbx` or `assets/.../*.glb` path referenced as a string
 *      literal anywhere under `src/3d/` (i.e. actually passed to `assetLoader.js`'s
 *      `loadFBXModel`/`loadModel`) must appear in `GAME3D_SHELL_FILES`.
 *   3. HARD FAIL — for any `.../` directory path referenced as a string literal under `src/3d/`
 *      (the `resourcePath`/`TEXTURES_RESOURCE_PATH` convention `gameplay/gameplayConfig.js`'s
 *      `DRAGON_CONFIG` uses for an FBX's externally-referenced textures) that resolves to a real
 *      directory under `assets/`, every file inside that directory must appear in
 *      `GAME3D_SHELL_FILES` too — an FBX's own internal texture filenames aren't visible as JS string
 *      literals, so the whole directory is precached rather than guessing which subset the model
 *      actually uses.
 *
 * Usage: `node scripts/checkServiceWorkerCache.js` — exit code 0 = clean, exit code 1 = at least
 * one hard-fail check failed.
 *
 * Run this after adding/removing any file under `src/3d/`, any new model/texture asset a gameplay
 * config references, or any change to `service-worker.js`'s own precache lists.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const SRC_3D_DIR = path.join(ROOT, 'src', '3d');

/** Recursively lists every file under `dir` as a POSIX-style path relative to `ROOT`. */
function listFilesRecursiveRelative(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listFilesRecursiveRelative(full));
		} else {
			out.push(path.relative(ROOT, full).split(path.sep).join('/'));
		}
	}
	return out;
}

/** Extracts the string-literal array contents of `const NAME = [ ... ];` from `source`. */
function extractArrayLiteral(source, constName) {
	const match = source.match(new RegExp(`const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`));
	if (!match) return null;
	const entries = [];
	const stringRe = /'([^']*)'/g;
	let m;
	while ((m = stringRe.exec(match[1])) !== null) entries.push(m[1]);
	return entries;
}

function main() {
	if (!fs.existsSync(SW_PATH)) {
		console.error(`[checkServiceWorkerCache] FAIL: service-worker.js not found at ${SW_PATH}`);
		process.exit(1);
	}
	if (!fs.existsSync(SRC_3D_DIR)) {
		console.error(`[checkServiceWorkerCache] FAIL: src/3d not found at ${SRC_3D_DIR}`);
		process.exit(1);
	}

	const swSource = fs.readFileSync(SW_PATH, 'utf8');
	const rawEntries = extractArrayLiteral(swSource, 'GAME3D_SHELL_FILES');
	if (!rawEntries) {
		console.error('[checkServiceWorkerCache] FAIL: could not find/parse GAME3D_SHELL_FILES in service-worker.js');
		process.exit(1);
	}
	// './src/3d/foo.js' -> 'src/3d/foo.js' (matches listFilesRecursiveRelative's own output shape).
	const precached = new Set(rawEntries.map((e) => (e.startsWith('./') ? e.slice(2) : e)));

	let hardFail = false;

	// Check 1: every src/3d/**/*.js file is precached.
	const jsFiles = listFilesRecursiveRelative(SRC_3D_DIR).filter((f) => f.endsWith('.js'));
	const missingJs = jsFiles.filter((f) => !precached.has(f));
	if (missingJs.length > 0) {
		hardFail = true;
		console.error(`[checkServiceWorkerCache] FAIL: ${missingJs.length} src/3d JS file(s) missing from GAME3D_SHELL_FILES (offline mode can't load these):`);
		for (const f of missingJs) console.error(`  - ${f}`);
	}

	// Check 2: every referenced .fbx/.glb asset path is precached, and Check 3: every referenced
	// resource-path directory's real contents are precached — both scanned from the same string
	// literals across every src/3d source file.
	const modelRe = /['"](assets\/[^'"]+\.(?:fbx|glb))['"]/g;
	// Deliberately narrower than "any assets/.../ string literal" (which would also match
	// config.js's unrelated ASSET_PATHS category prefixes, e.g. 'assets/models/') — only lines
	// naming a `resourcePath`/`RESOURCE_PATH` convention (see `DRAGON_CONFIG.TEXTURES_RESOURCE_PATH`,
	// passed to `assetLoader.js`'s `loadFBXModel`'s `resourcePath` option) name a directory whose
	// *entire* contents need precaching for that model's externally-referenced textures.
	const resourcePathLineRe = /resource_?path/i;
	const dirRe = /['"](assets\/[^'"]+\/)['"]/g;
	const referencedModels = new Set();
	const referencedDirs = new Set();
	for (const relJsFile of jsFiles) {
		const text = fs.readFileSync(path.join(ROOT, relJsFile), 'utf8');
		let m;
		while ((m = modelRe.exec(text)) !== null) referencedModels.add(m[1]);
		for (const line of text.split('\n')) {
			if (!resourcePathLineRe.test(line)) continue;
			while ((m = dirRe.exec(line)) !== null) referencedDirs.add(m[1]);
		}
	}

	const missingModels = [...referencedModels].filter((f) => !precached.has(f));
	if (missingModels.length > 0) {
		hardFail = true;
		console.error(`[checkServiceWorkerCache] FAIL: ${missingModels.length} referenced model asset(s) missing from GAME3D_SHELL_FILES:`);
		for (const f of missingModels) console.error(`  - ${f}`);
	}

	const missingDirFiles = [];
	for (const dir of referencedDirs) {
		const absDir = path.join(ROOT, dir);
		if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
		for (const relFile of listFilesRecursiveRelative(absDir)) {
			if (!precached.has(relFile)) missingDirFiles.push(relFile);
		}
	}
	if (missingDirFiles.length > 0) {
		hardFail = true;
		console.error(`[checkServiceWorkerCache] FAIL: ${missingDirFiles.length} file(s) under a referenced resource-path directory missing from GAME3D_SHELL_FILES:`);
		for (const f of missingDirFiles) console.error(`  - ${f}`);
	}

	if (!hardFail) {
		console.log(`[checkServiceWorkerCache] OK: ${jsFiles.length} JS files, ${referencedModels.size} referenced model assets, and every file under ${referencedDirs.size} referenced resource-path director${referencedDirs.size === 1 ? 'y' : 'ies'} are all present in GAME3D_SHELL_FILES.`);
	}

	process.exit(hardFail ? 1 : 0);
}

main();
