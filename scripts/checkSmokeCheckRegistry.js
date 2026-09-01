#!/usr/bin/env node
/**
 * checkSmokeCheckRegistry.js — static regression guard for the smoke suite's own wiring and for this
 * project's 600-line file cap (GOVERNANCE.md Altın Kural 7). Run 68, DECISIONS.md ADR-0087.
 *
 * **Why this exists (GOVERNANCE.md §8.2 Root Cause Analysis).** The "a smoke-check module quietly
 * grows past the 600-line cap" failure has now happened three times: `game3dSmokeChecks.js` reached
 * 596/600 (run 40, split), `game3dSmokeChecksMovement.js` reached 614/600 (run 64 — *noticed and
 * documented in that file's own header, but worked around* by putting the new check in a third file
 * instead of fixing it), and it was still 614 lines four runs later when run 68 finally split it.
 * Root cause: the cap is a prose rule in `GOVERNANCE.md` that only a human/agent re-reading the file
 * list can enforce, so it is enforced only when somebody happens to look. Prevention: make it a
 * machine check that fails, like every other invariant this project cares about.
 *
 * The second half guards the risk that the run-68 split itself introduced: the smoke suite is this
 * project's ONLY automated regression guard, and a check silently dropped from `smokeTestGame3D.js`'s
 * registry during a refactor would *also* drop its own line from the output — so the suite would
 * still report a green "all PASS" run while covering less than before. This asserts the runner and
 * the check modules agree in both directions:
 *   1. every `checkXxx` a module exports is invoked exactly once by the runner (nothing orphaned);
 *   2. every function the runner invokes really is exported by the module it names (nothing dangling).
 *
 * Dev-only tooling, same as its sibling `check*.js` scripts — never loaded by a browser, not
 * referenced from `index.html`/`game3d.html`. Needs no Playwright: it is pure static/`require`
 * inspection, so it runs anywhere Node does, including where the full suite cannot.
 *
 * Usage: `node scripts/checkSmokeCheckRegistry.js`
 * Exit codes: 0 = OK. 1 = a violation was found.
 * @module scripts/checkSmokeCheckRegistry
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(__dirname, 'smokeTestGame3D.js');

/** GOVERNANCE.md Altın Kural 7: "Dosya 600 satırı geçmezse iyi, geçerse böl." */
const MAX_LINES = 600;
/** Soft threshold — reported, never fatal. Gives a run advance warning before the cap is breached,
 *  which is exactly the signal runs 64/67 had to produce by hand. */
const WARN_LINES = 540;

/** Directories swept for the line cap, relative to the repo root. */
const SWEEP_DIRS = ['src', 'scripts'];
/** Third-party code this project's own style rules do not govern. */
const SWEEP_EXCLUDE = [path.join('src', '3d', 'vendor')];

/**
 * Recursively collects `.js` files under `dir`, skipping excluded subtrees.
 * @param {string} dir Absolute directory path.
 * @param {string[]} out Accumulator of absolute file paths.
 * @returns {string[]} `out`.
 */
function collectJsFiles(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const absolute = path.join(dir, entry.name);
		const relative = path.relative(ROOT, absolute);
		if (SWEEP_EXCLUDE.some((excluded) => relative === excluded || relative.startsWith(`${excluded}${path.sep}`))) continue;
		if (entry.isDirectory()) collectJsFiles(absolute, out);
		else if (entry.isFile() && entry.name.endsWith('.js')) out.push(absolute);
	}
	return out;
}

/**
 * Counts lines the same way `wc -l` does, so the number reported here matches what a run's own
 * `wc -l` sweep reports and there is never an off-by-one argument about whether a file is at the cap.
 * @param {string} absolutePath
 * @returns {number}
 */
function countLines(absolutePath) {
	const content = fs.readFileSync(absolutePath, 'utf8');
	let lines = 0;
	for (let i = 0; i < content.length; i++) if (content[i] === '\n') lines++;
	return lines;
}

function countGitLines(ref, relative) {
	try {
		const content = execFileSync('git', ['show', `${ref}:${relative}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
		return (content.match(/\n/g) || []).length;
	} catch {
		return null;
	}
}

/**
 * Enforces the 600-line file cap across `src/` and `scripts/`.
 * @returns {{failures: string[], warnings: string[], filesChecked: number}}
 */
function checkFileLineCap(baseRef = null) {
	const failures = [];
	const warnings = [];
	const files = SWEEP_DIRS.flatMap((dir) => collectJsFiles(path.join(ROOT, dir), []));
	for (const absolute of files.sort()) {
		const lines = countLines(absolute);
		const relative = path.relative(ROOT, absolute);
		if (lines > MAX_LINES) {
			const baseLines = baseRef ? countGitLines(baseRef, relative) : null;
			if (baseLines !== null && baseLines > MAX_LINES && lines <= baseLines) warnings.push(`${relative} is inherited line-cap debt at ${lines} lines (base ${baseLines}); this change does not worsen it`);
			else failures.push(`${relative} is ${lines} lines, over the ${MAX_LINES}-line cap (GOVERNANCE.md Altın Kural 7) — split it`);
		} else if (lines >= WARN_LINES) warnings.push(`${relative} is ${lines}/${MAX_LINES} lines — approaching the cap, plan a split before adding to it`);
	}
	return { failures, warnings, filesChecked: files.length };
}

/**
 * Parses `smokeTestGame3D.js` for its `require` aliases and its `results.push(await alias.fn(...))`
 * invocation list. Static parsing (rather than running the suite) is the point: this must be able to
 * detect a dropped check *without* Playwright and without a browser, since a dropped check is exactly
 * the failure a green suite run cannot reveal.
 * @returns {{aliasToModule: Map<string, string>, invocations: Array<{alias: string, fn: string}>}}
 */
function parseRunner() {
	const source = fs.readFileSync(RUNNER, 'utf8');
	const aliasToModule = new Map();
	const requirePattern = /const\s+([A-Za-z0-9_$]+)\s*=\s*require\('\.\/([A-Za-z0-9_$]+\.js)'\)/g;
	for (const match of source.matchAll(requirePattern)) aliasToModule.set(match[1], match[2]);

	const invocations = [];
	const callPattern = /results\.push\(await\s+([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\(/g;
	for (const match of source.matchAll(callPattern)) invocations.push({ alias: match[1], fn: match[2] });

	// Parse-completeness guard. Everything below only reasons about invocations this parser actually
	// understood (`alias.fn(...)`), so a check written in a shape it does not recognise — say, a
	// destructured import called bare as `results.push(await checkFoo(...))` — would be invisible to
	// the cross-checks and silently lower the count without failing anything. Counting the raw
	// `results.push(` sites independently and demanding the two agree means the guard fails loudly
	// when it stops understanding the runner, instead of quietly under-reporting.
	const rawPushCount = (source.match(/results\.push\(/g) || []).length;
	return { aliasToModule, invocations, rawPushCount };
}

/**
 * Cross-checks the runner's invocation list against what the check modules actually export, in both
 * directions.
 * @returns {{failures: string[], checkCount: number, moduleCount: number}}
 */
function checkRegistry() {
	const failures = [];
	const { aliasToModule, invocations, rawPushCount } = parseRunner();

	if (invocations.length === 0) {
		failures.push('smokeTestGame3D.js has no `results.push(await ...)` invocations at all — the registry parse broke, or every check was dropped');
		return { failures, checkCount: 0, moduleCount: 0 };
	}
	if (invocations.length !== rawPushCount) {
		failures.push(
			`smokeTestGame3D.js has ${rawPushCount} \`results.push(\` site(s) but only ${invocations.length} parsed as ` +
				'`alias.checkFn(...)` — this guard no longer understands the runner, so it can no longer prove no check ' +
				'was dropped. Either restore the `alias.checkFn(...)` call shape or teach `parseRunner()` the new one.',
		);
	}

	// Direction 1: every invocation resolves to a real exported function.
	const invokedByModule = new Map();
	for (const { alias, fn } of invocations) {
		const moduleFile = aliasToModule.get(alias);
		if (!moduleFile) {
			failures.push(`smokeTestGame3D.js invokes \`${alias}.${fn}\` but never requires a module bound to \`${alias}\``);
			continue;
		}
		let loaded;
		try {
			loaded = require(path.join(__dirname, moduleFile));
		} catch (error) {
			failures.push(`could not require ./${moduleFile} (invoked as \`${alias}.${fn}\`): ${error.message}`);
			continue;
		}
		if (typeof loaded[fn] !== 'function') {
			failures.push(`smokeTestGame3D.js invokes \`${alias}.${fn}\` but ./${moduleFile} does not export a function named \`${fn}\``);
			continue;
		}
		if (!invokedByModule.has(moduleFile)) invokedByModule.set(moduleFile, new Set());
		const seen = invokedByModule.get(moduleFile);
		if (seen.has(fn)) failures.push(`smokeTestGame3D.js invokes \`${moduleFile}\`'s \`${fn}\` more than once — a check would be double-counted`);
		seen.add(fn);
	}

	// Direction 2: nothing a check module exports is left orphaned (defined but never run). This is
	// the half that catches a refactor silently dropping a check from the registry.
	for (const [alias, moduleFile] of aliasToModule) {
		if (!/^game3dSmokeChecks/.test(moduleFile)) continue; // shared infra (devServerHelper) exports no checks
		let loaded;
		try {
			loaded = require(path.join(__dirname, moduleFile));
		} catch (error) {
			failures.push(`could not require ./${moduleFile} (bound to \`${alias}\`): ${error.message}`);
			continue;
		}
		const invoked = invokedByModule.get(moduleFile) || new Set();
		for (const exportName of Object.keys(loaded)) {
			if (!/^check/.test(exportName) || typeof loaded[exportName] !== 'function') continue;
			if (!invoked.has(exportName)) {
				failures.push(`./${moduleFile} exports check \`${exportName}\` but smokeTestGame3D.js never invokes it — the check exists but never runs`);
			}
		}
	}

	return { failures, checkCount: invocations.length, moduleCount: [...aliasToModule.values()].filter((m) => /^game3dSmokeChecks/.test(m)).length };
}

function main() {
	const cap = checkFileLineCap(process.argv[2] || null);
	const registry = checkRegistry();
	const failures = [...cap.failures, ...registry.failures];

	for (const warning of cap.warnings) console.warn(`[checkSmokeCheckRegistry] WARN: ${warning}`);
	for (const failure of failures) console.error(`[checkSmokeCheckRegistry] FAIL: ${failure}`);

	if (failures.length > 0) {
		console.error(`[checkSmokeCheckRegistry] FAIL: ${failures.length} violation(s).`);
		process.exit(1);
	}
	console.log(
		`[checkSmokeCheckRegistry] OK: ${registry.checkCount} smoke checks wired across ${registry.moduleCount} check ` +
			`modules (every export invoked exactly once, every invocation resolves); ${cap.filesChecked} JS files introduced ` +
			`no new or worsened ${MAX_LINES}-line-cap violations` +
			(cap.warnings.length > 0 ? `, ${cap.warnings.length} approaching/inheriting it (see WARN above)` : ''),
	);
}

main();
