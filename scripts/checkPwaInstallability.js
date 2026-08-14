#!/usr/bin/env node
/**
 * checkPwaInstallability.js — static regression guard for this project's PWA installability chain
 * (GOVERNANCE.md §15 "Periyodik Platform Kontrolü": "~ayda bir (20-30 çalıştırmada bir) ... PWA
 * hâlâ kurulabiliyor mu" — run 70 is the first run to actually act on this rule, so this is also
 * this project's *first* installability check, not a re-run of an existing one).
 *
 * Same "cheap, dependency-free, static `fs`-based cross-check" precedent `checkAssetsManifest.js`/
 * `checkServiceWorkerCache.js`/`checkDialogueChoicesShape.js` already established for this project
 * — no Playwright/browser boot needed here, since every fact this check needs (does the manifest
 * have the fields a browser's install-eligibility heuristic looks for, do the files it references
 * actually exist, does `index.html` actually wire the manifest + service worker) is verifiable from
 * the files on disk alone.
 *
 * **Boundary against the smoke suite:** `smokeTestGame3D.js`'s `check2DShell`/`check3DMode` already
 * prove the pages themselves boot cleanly in a real headless Chromium (proving the service worker's
 * *registration call* doesn't throw); `checkServiceWorkerCache.js` already proves the precache list
 * itself doesn't silently drift behind the real asset/import graph. This check's own, narrower scope
 * is the installability *manifest* itself — the fields/icons a browser's own "Add to Home Screen"
 * eligibility check reads — which neither of those already covers.
 *
 * Checks performed (all HARD FAIL unless noted):
 *   1. `manifest.json` parses as valid JSON.
 *   2. Required installability fields are present and non-empty: `name`, `short_name`, `start_url`,
 *      `display`.
 *   3. `display` is one of the four values the PWA spec defines (`standalone`/`fullscreen`/
 *      `minimal-ui`/`browser`) — WARN (not fail) if it's `browser`, since that's valid per spec but
 *      reads as "not really trying to be installable" to a human, not a real installability blocker.
 *   4. `icons` contains at least one entry whose *declared* `sizes` is >=192 and at least one >=512
 *      in both dimensions (Chrome's own minimum-icon-size install heuristic) — parsed from each
 *      entry's `WxH` string, largest side compared if non-square.
 *   5. Every non-`data:` icon `src` resolves to a real file under the repo root.
 *   6. `start_url` (stripped of any `./`/leading slash) resolves to a real file under the repo root.
 *   7. `service-worker.js` exists on disk (the file `index.html` registers, per check 8 below).
 *   8. `index.html` contains both a `<link rel="manifest" ...>` tag pointing at `manifest.json` and
 *      a `navigator.serviceWorker.register(...)` call referencing `service-worker.js` — the two
 *      wiring points a browser actually needs to consider the page installable in the first place.
 *
 * Usage: `node scripts/checkPwaInstallability.js` — exit code 0 = clean (WARNs allowed), exit code 1
 * = at least one HARD FAIL.
 * @module scripts/checkPwaInstallability
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const VALID_DISPLAY_VALUES = new Set(['standalone', 'fullscreen', 'minimal-ui', 'browser']);
const MIN_INSTALL_ICON_SIZE = 192;
const MIN_MASKABLE_ICON_SIZE = 512;

/** Parses a manifest icon's `sizes` string (e.g. `"192x192"`, `"180x180"`) into its larger side, in
 * pixels — `NaN` if the string doesn't match the expected `WxH` shape. */
function parseIconSize(sizesString) {
	const match = /^(\d+)x(\d+)$/i.exec(String(sizesString || '').trim());
	if (!match) return NaN;
	return Math.max(Number(match[1]), Number(match[2]));
}

function main() {
	const failures = [];
	const warnings = [];

	if (!fs.existsSync(MANIFEST_PATH)) {
		console.error('[checkPwaInstallability] FAIL: manifest.json not found at repo root.');
		process.exit(1);
	}
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
	} catch (error) {
		console.error(`[checkPwaInstallability] FAIL: manifest.json is not valid JSON — ${error.message}`);
		process.exit(1);
	}

	for (const field of ['name', 'short_name', 'start_url', 'display']) {
		if (!manifest[field] || String(manifest[field]).trim() === '') {
			failures.push(`manifest.json is missing a non-empty "${field}" field.`);
		}
	}

	if (manifest.display && !VALID_DISPLAY_VALUES.has(manifest.display)) {
		failures.push(`manifest.json's "display" ("${manifest.display}") is not one of ${[...VALID_DISPLAY_VALUES].join('/')}.`);
	} else if (manifest.display === 'browser') {
		warnings.push('manifest.json\'s "display" is "browser" — valid per spec, but not a real "installed app" feel.');
	}

	const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
	if (icons.length === 0) {
		failures.push('manifest.json has no "icons" array.');
	}
	let hasInstallIcon = false;
	let hasMaskableSizeIcon = false;
	for (const icon of icons) {
		const size = parseIconSize(icon.sizes);
		if (size >= MIN_INSTALL_ICON_SIZE) hasInstallIcon = true;
		if (size >= MIN_MASKABLE_ICON_SIZE) hasMaskableSizeIcon = true;
		const src = String(icon.src || '');
		if (src.startsWith('data:')) continue; // inline — nothing on disk to check
		const iconPath = path.join(ROOT, src.replace(/^\.?\//, ''));
		if (!fs.existsSync(iconPath)) {
			failures.push(`manifest.json icon "${src}" (sizes="${icon.sizes}") does not exist on disk.`);
		}
	}
	if (!hasInstallIcon) {
		failures.push(`manifest.json has no icon with a declared size >= ${MIN_INSTALL_ICON_SIZE}px (Chrome's own install-eligibility minimum).`);
	}
	if (!hasMaskableSizeIcon) {
		failures.push(`manifest.json has no icon with a declared size >= ${MIN_MASKABLE_ICON_SIZE}px.`);
	}

	if (manifest.start_url) {
		const startUrlPath = path.join(ROOT, String(manifest.start_url).replace(/^\.?\//, ''));
		if (!fs.existsSync(startUrlPath)) {
			failures.push(`manifest.json's "start_url" ("${manifest.start_url}") does not resolve to a real file.`);
		}
	}

	const swPath = path.join(ROOT, 'service-worker.js');
	if (!fs.existsSync(swPath)) {
		failures.push('service-worker.js does not exist at the repo root.');
	}

	if (!fs.existsSync(INDEX_HTML_PATH)) {
		failures.push('index.html not found at repo root.');
	} else {
		const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
		if (!/<link[^>]+rel=["']manifest["'][^>]+href=["']manifest\.json["']/i.test(indexHtml)) {
			failures.push('index.html has no <link rel="manifest" href="manifest.json"> tag.');
		}
		if (!/navigator\.serviceWorker\.register\(\s*['"]service-worker\.js['"]/.test(indexHtml)) {
			failures.push('index.html has no navigator.serviceWorker.register(\'service-worker.js\', ...) call.');
		}
	}

	for (const warning of warnings) console.warn(`[checkPwaInstallability] WARN: ${warning}`);

	if (failures.length > 0) {
		console.error(`[checkPwaInstallability] FAIL: ${failures.length} issue(s) found:`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
	}

	console.log(
		`[checkPwaInstallability] OK: manifest.json has all required fields, "${manifest.display}" display, ` +
			`${icons.length} icon(s) (>=${MIN_INSTALL_ICON_SIZE}px and >=${MIN_MASKABLE_ICON_SIZE}px both present, ` +
			'all on-disk srcs resolve), start_url resolves, service-worker.js exists, index.html wires both ' +
			'the manifest link and the service-worker registration.',
	);
	process.exit(0);
}

main();
