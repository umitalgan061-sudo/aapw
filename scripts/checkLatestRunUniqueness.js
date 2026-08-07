#!/usr/bin/env node
/**
 * checkLatestRunUniqueness.js — verifies the latest completed run appears exactly once in each
 * continuity record. This complements checkCheckpointConsistency.js: consistency proves the three
 * records agree on the same latest run number, while this guard catches duplicate ownership of that
 * run number when overlapping autonomous sessions accidentally publish the same run identity twice.
 *
 * Usage: node scripts/checkLatestRunUniqueness.js
 * Exit 0 = latest run is unique in progress, stable-tag log and performance log.
 * Exit 1 = records disagree, are missing, or duplicate the latest run identity.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
	const fullPath = path.join(ROOT, relativePath);
	if (!fs.existsSync(fullPath)) throw new Error(`required file missing: ${relativePath}`);
	return fs.readFileSync(fullPath, 'utf8');
}

function progressRuns(text) {
	const runs = [];
	for (const match of text.matchAll(/^##\s+(?:This Run\b.*?\brun\s+(\d+)\b|Run\s+(\d+)\b)/gim)) {
		runs.push(Number(match[1] || match[2]));
	}
	return runs;
}

function stableRuns(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/)) {
		if (!/^\s*-\s+stable-/i.test(line)) continue;
		const match = line.match(/\brun\s+(\d+)\b/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs;
}

function perfRuns(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/).slice(1)) {
		const cells = line.split(',');
		if (cells.length < 2) continue;
		const match = cells[1].trim().match(/^run(\d+)$/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs;
}

function count(values, target) {
	return values.reduce((total, value) => total + (value === target ? 1 : 0), 0);
}

function main() {
	let sources;
	try {
		sources = {
			progress: progressRuns(read('3D_GAME_PROGRESS.md')),
			stable: stableRuns(read('STABLE_TAGS.md')),
			perf: perfRuns(read('perf_log.csv')),
		};
	} catch (error) {
		console.error(`[latest-run-uniqueness] FAIL: ${error.message}`);
		process.exit(1);
	}

	for (const [name, values] of Object.entries(sources)) {
		if (values.length === 0) {
			console.error(`[latest-run-uniqueness] FAIL: no run identities found in ${name}.`);
			process.exit(1);
		}
	}

	const latest = Math.max(...Object.values(sources).flat());
	const maxima = Object.fromEntries(
		Object.entries(sources).map(([name, values]) => [name, Math.max(...values)]),
	);
	if (Object.values(maxima).some((value) => value !== latest)) {
		console.error(
			`[latest-run-uniqueness] FAIL: latest records disagree: ` +
				`progress=run${maxima.progress}, stable=run${maxima.stable}, perf=run${maxima.perf}.`,
		);
		process.exit(1);
	}

	const duplicates = Object.entries(sources)
		.map(([name, values]) => [name, count(values, latest)])
		.filter(([, occurrences]) => occurrences !== 1);
	if (duplicates.length) {
		const detail = duplicates.map(([name, occurrences]) => `${name}=${occurrences}`).join(', ');
		console.error(
			`[latest-run-uniqueness] FAIL: run${latest} must appear exactly once in every continuity record; ${detail}.`,
		);
		process.exit(1);
	}

	console.log(
		`[latest-run-uniqueness] PASS: run${latest} appears exactly once in progress, stable-tag and performance records.`,
	);
}

main();
