#!/usr/bin/env node
/**
 * checkLatestRunUniqueness.js — guards against duplicate latest-run checkpoint records.
 *
 * Multi-agent sessions may overlap even when every individual record uses the same highest run
 * number. checkCheckpointConsistency.js verifies that progress/stable/perf agree on that number;
 * this companion guard verifies that the latest run occurs exactly once in each authoritative
 * checkpoint ledger. Duplicate entries therefore fail before a branch can be published.
 *
 * Usage: node scripts/checkLatestRunUniqueness.js
 * Exit 0 = latest run appears exactly once in progress + stable tags + perf log.
 * Exit 1 = missing, disagreeing or duplicate latest-run records.
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

function latest(runs, label) {
	if (!runs.length) throw new Error(`could not resolve any ${label} run records`);
	return Math.max(...runs);
}

function count(runs, run) {
	return runs.filter((candidate) => candidate === run).length;
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

	let progressRun;
	let stableRun;
	let perfRun;
	try {
		progressRun = latest(progress, 'progress');
		stableRun = latest(stable, 'stable');
		perfRun = latest(perf, 'performance');
	} catch (error) {
		console.error(`[latest-run-uniqueness] FAIL: ${error.message}`);
		process.exit(1);
	}

	if (progressRun !== stableRun || progressRun !== perfRun) {
		console.error(
			`[latest-run-uniqueness] FAIL: latest records disagree: ` +
				`progress=run${progressRun}, stable=run${stableRun}, perf=run${perfRun}.`,
		);
		process.exit(1);
	}

	const run = progressRun;
	const counts = {
		progress: count(progress, run),
		stable: count(stable, run),
		perf: count(perf, run),
	};

	const duplicates = Object.entries(counts).filter(([, value]) => value !== 1);
	if (duplicates.length) {
		console.error(
			`[latest-run-uniqueness] FAIL: run${run} must appear exactly once in each ledger; ` +
				`progress=${counts.progress}, stable=${counts.stable}, perf=${counts.perf}.`,
		);
		process.exit(1);
	}

	console.log(
		`[latest-run-uniqueness] PASS: run${run} appears exactly once in progress, stable and performance ledgers.`,
	);
}

main();
