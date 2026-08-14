#!/usr/bin/env node
/**
 * checkLatestRunUniqueness.js — guards against duplicate latest-run checkpoint records.
 *
 * checkCheckpointConsistency.js proves that the three authoritative ledgers agree on the highest
 * completed run number. This companion guard proves that the same latest run occurs exactly once
 * in each ledger, closing a multi-agent race where duplicate run-N records could otherwise share
 * the same maximum and still appear consistent.
 *
 * Usage: node scripts/checkLatestRunUniqueness.js
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

function occurrenceCount(runs, run) {
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
		progress: occurrenceCount(progress, run),
		stable: occurrenceCount(stable, run),
		perf: occurrenceCount(perf, run),
	};

	if (Object.values(counts).some((value) => value !== 1)) {
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
