#!/usr/bin/env node
/**
 * checkCheckpointConsistency.js — validates that the project's three end-of-run continuity
 * records agree on the latest completed run. This is intentionally a dev-only repository guard:
 * no runtime/PWA/gameplay module imports it.
 *
 * Why this exists: autonomous sessions can overlap. A run may append 3D_GAME_PROGRESS.md but fail
 * before perf_log.csv or STABLE_TAGS.md is updated, leaving the next agent with a misleading
 * snapshot. GOVERNANCE.md requires all three records at a successful checkpoint; this guard makes
 * that invariant executable.
 *
 * Usage: node scripts/checkCheckpointConsistency.js
 * Exit 0 = latest completed run is represented by progress + performance + stable tag.
 * Exit 1 = records are missing or disagree.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
	const fullPath = path.join(ROOT, relativePath);
	if (!fs.existsSync(fullPath)) {
		throw new Error(`required file missing: ${relativePath}`);
	}
	return fs.readFileSync(fullPath, 'utf8');
}

function maxRunFromProgress(text) {
	const runs = [];
	for (const match of text.matchAll(/^##\s+(?:This Run\b.*?\brun\s+(\d+)\b|Run\s+(\d+)\b)/gim)) {
		runs.push(Number(match[1] || match[2]));
	}
	return runs.length ? Math.max(...runs) : null;
}

function maxRunFromStableTags(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/)) {
		if (!/^\s*-\s+stable-/i.test(line)) continue;
		const match = line.match(/\brun\s+(\d+)\b/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs.length ? Math.max(...runs) : null;
}

function maxRunFromPerfCsv(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/).slice(1)) {
		const cells = line.split(',');
		if (cells.length < 2) continue;
		const match = cells[1].trim().match(/^run(\d+)$/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs.length ? Math.max(...runs) : null;
}

function main() {
	let progressRun;
	let stableRun;
	let perfRun;
	try {
		progressRun = maxRunFromProgress(read('3D_GAME_PROGRESS.md'));
		stableRun = maxRunFromStableTags(read('STABLE_TAGS.md'));
		perfRun = maxRunFromPerfCsv(read('perf_log.csv'));
	} catch (error) {
		console.error(`[checkpoint-consistency] FAIL: ${error.message}`);
		process.exit(1);
	}

	const values = { progressRun, stableRun, perfRun };
	for (const [name, value] of Object.entries(values)) {
		if (!Number.isInteger(value)) {
			console.error(`[checkpoint-consistency] FAIL: could not resolve latest ${name}.`);
			process.exit(1);
		}
	}

	if (stableRun !== progressRun || perfRun !== progressRun) {
		console.error(
			`[checkpoint-consistency] FAIL: latest completed-run records disagree: ` +
				`progress=run${progressRun}, stable=run${stableRun}, perf=run${perfRun}.`,
		);
		process.exit(1);
	}

	console.log(
		`[checkpoint-consistency] PASS: progress, performance log and stable checkpoint all resolve to run${progressRun}.`,
	);
}

main();
