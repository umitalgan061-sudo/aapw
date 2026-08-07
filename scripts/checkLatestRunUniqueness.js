#!/usr/bin/env node
/**
 * Guard the latest completed run identity against duplicate checkpoint records.
 *
 * Multiple autonomous sessions may finish close together. `checkCheckpointConsistency.js` proves
 * that progress/stable/perf agree on the highest run number, but two agents could still append the
 * same run number twice and leave all three maxima equal. This guard closes that concurrency gap:
 * the latest run must appear exactly once in each end-of-run record.
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
		const match = cells[1]?.trim().match(/^run(\d+)$/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs;
}

function count(list, value) {
	return list.reduce((total, candidate) => total + (candidate === value ? 1 : 0), 0);
}

function main() {
	let progress;
	let stable;
	let perf;
	try {
		progress = progressRuns(read('3D_GAME_PROGRESS.md'));
		stable = stableRuns(read('STABLE_TAGS.md'));
		perf = perfRuns(read('perf_log.csv'));
	} catch (error) {
		console.error(`[latest-run-uniqueness] FAIL: ${error.message}`);
		process.exit(1);
	}

	const allRuns = [...progress, ...stable, ...perf];
	if (allRuns.length === 0) {
		console.error('[latest-run-uniqueness] FAIL: no completed run records found.');
		process.exit(1);
	}

	const latest = Math.max(...allRuns);
	const counts = {
		progress: count(progress, latest),
		stable: count(stable, latest),
		perf: count(perf, latest),
	};
	const invalid = Object.entries(counts).filter(([, value]) => value !== 1);
	if (invalid.length > 0) {
		console.error(
			`[latest-run-uniqueness] FAIL: run${latest} must appear exactly once in each checkpoint record; ` +
			Object.entries(counts).map(([name, value]) => `${name}=${value}`).join(', '),
		);
		process.exit(1);
	}

	console.log(
		`[latest-run-uniqueness] PASS: run${latest} is unique across progress, stable tag and perf records.`,
	);
}

main();
