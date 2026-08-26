#!/usr/bin/env node
/**
 * No gate may pass its timeout into Playwright's argument slot (run 397).
 *
 * Playwright's `page.waitForFunction` takes **three** parameters: the page function, its argument, and
 * the options. Called with only two — the page function and an options object — that options object is
 * handed to the page function as its argument, silently, and the wait falls back to Playwright's 30 s
 * default. Nothing warns: the call succeeds, the page function ignores the argument it never declared,
 * and the only visible trace is a failure message quoting a timeout nobody wrote.
 *
 * (This file deliberately contains no literal example of the broken form. Exempting the gate from its
 * own scan would leave exactly the blind spot the gate exists to close.)
 *
 * That is exactly how PR #964's mobile blocker read. `checkMobilePerfBudget` asks for 60 s and CI
 * failed it with `page.waitForFunction: Timeout 30000ms exceeded.` — a number that appears nowhere in
 * the file. A sweep found **14 such calls across 13 gate scripts**, including
 * `game3dSmokeChecksScene.js` and `game3dSmokeChecksAudio.js`, which read `GAME3D_READY_TIMEOUT_MS` —
 * the constant run 390 deliberately raised from 30 s to 90 s after finding gates silently unrunnable.
 * That raise never reached these two calls. A gate whose timeout is quietly a third of what its source
 * says is a gate measuring something other than what it claims, which is the failure mode this
 * repository keeps paying for.
 *
 * Cheaper to forbid than to rediscover. Parses each call's real top-level arguments rather than
 * pattern-matching text, so a legitimate three-argument call is not flagged.
 */
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.resolve(__dirname);

/** Offsets of the top-level commas inside a call's parentheses, plus where the call closes. */
function scanCall(source, open) {
	let depth = 1;
	let index = open;
	let quote = null;
	const commas = [];
	while (index < source.length && depth > 0) {
		const character = source[index];
		if (quote) {
			if (character === quote && source[index - 1] !== '\\') quote = null;
		} else if (character === '"' || character === "'" || character === '`') {
			quote = character;
		} else if ('([{'.includes(character)) {
			depth += 1;
		} else if (')]}'.includes(character)) {
			depth -= 1;
		} else if (character === ',' && depth === 1) {
			commas.push(index);
		}
		index += 1;
	}
	return { commas, close: index - 1 };
}

function findOffences(source) {
	const offences = [];
	let index = 0;
	while ((index = source.indexOf('waitForFunction(', index)) !== -1) {
		const open = index + 'waitForFunction('.length;
		const { commas, close } = scanCall(source, open);
		const trailing = commas.length > 1 ? source.slice(commas[commas.length - 1] + 1, close) : null;
		// Two real arguments: one separating comma, or two with nothing after the last (trailing comma).
		const twoArguments = commas.length === 1 || (commas.length === 2 && trailing.trim() === '');
		if (twoArguments) {
			const second = source.slice(commas[0] + 1, commas.length > 1 ? commas[1] : close);
			if (/^\s*\{/.test(second) && /\btimeout\s*:/.test(second)) {
				offences.push({ line: source.slice(0, index).split('\n').length });
			}
		}
		index = close + 1;
	}
	return offences;
}

const failures = [];
let scanned = 0;
let calls = 0;
for (const name of fs.readdirSync(SCRIPTS_DIR).sort()) {
	if (!/\.(js|mjs|cjs)$/.test(name)) continue;
	const source = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
	if (!source.includes('waitForFunction(')) continue;
	scanned += 1;
	calls += source.split('waitForFunction(').length - 1;
	for (const offence of findOffences(source)) {
		failures.push(`scripts/${name}:${offence.line}`);
	}
}

if (failures.length) {
	console.error(
		`[playwright-wait-options] FAIL: ${failures.length} waitForFunction call(s) pass options where Playwright `
			+ `expects the page function's argument, so the timeout is silently the 30s default: ${failures.join(', ')}. `
			+ 'Pass `undefined` as the second argument and the options object as the third.',
	);
	process.exit(1);
}

console.log(
	`[playwright-wait-options] PASS: ${calls} waitForFunction call(s) across ${scanned} script(s); `
		+ 'every timeout is in the slot Playwright actually reads.',
);
