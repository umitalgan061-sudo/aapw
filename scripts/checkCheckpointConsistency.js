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
 * Progress entries may also truthfully record a non-checkpoint session (for example a documentation
 * pass that explicitly says no perf-log entry is needed, or a partial run that explicitly lists
 * required validation as not run). Those sections are audit history, not completed checkpoints, and
 * must not advance the continuity watermark.
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

function progressSectionIsExplicitlyNonCheckpoint(sectionBody) {
	const normalized = sectionBody.replace(/[`*_]/g, ' ').replace(/\s+/g, ' ');
	return /\bnot run,\s*explicitly\b/i.test(normalized)
		|| /\bno\b.{0,100}\bperf-log entry needed\b/i.test(normalized);
}

function maxRunFromProgress(text) {
	const headings = [...text.matchAll(/^##\s+(?:This Run\b.*?\brun\s+(\d+)\b|Run\s+(\d+)\b).*$/gim)];
	const runs = [];
	for (let index = 0; index < headings.length; index++) {
		const match = headings[index];
		const run = Number(match[1] || match[2]);
		const sectionStart = match.index + match[0].length;
		const sectionEnd = index + 1 < headings.length ? headings[index + 1].index : text.length;
		const body = text.slice(sectionStart, sectionEnd);
		if (!progressSectionIsExplicitlyNonCheckpoint(body)) runs.push(run);
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

/**
 * Run287 additive-only compatibility extension.
 *
 * Historical stable/perf records use more than one serialization shape. Keep the legacy parser
 * above intact for rollback/audit history, while these later function declarations supersede it
 * at instantiation time and accept both the historical and current canonical forms.
 */
function maxRunFromStableTags(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/)) {
		if (!/stable-/i.test(line)) continue;
		const match = line.match(/\brun\s*(\d+)\b/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs.length ? Math.max(...runs) : null;
}

function maxRunFromPerfCsv(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/).slice(1)) {
		const cells = line.split(',').map((cell) => cell.trim());
		for (const candidate of [cells[0], cells[1]]) {
			const match = candidate?.match(/^run\s*(\d+)$/i);
			if (match) {
				runs.push(Number(match[1]));
				break;
			}
		}
	}
	return runs.length ? Math.max(...runs) : null;
}

/**
 * Run292 additive-only perf-label compatibility extension.
 *
 * Maintenance/perf records may suffix a run identity with a descriptive slug, for example
 * `run291-platform-control`. The checkpoint invariant is the numeric run identity; preserve the
 * full CSV label for human provenance while accepting a bounded `run<digits>-<slug>` form here.
 */
function maxRunFromPerfCsv(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/).slice(1)) {
		const cells = line.split(',').map((cell) => cell.trim());
		for (const candidate of [cells[0], cells[1]]) {
			const match = candidate?.match(/^run\s*(\d+)(?:[-_][a-z0-9][a-z0-9_-]*)?$/i);
			if (match) {
				runs.push(Number(match[1]));
				break;
			}
		}
	}
	return runs.length ? Math.max(...runs) : null;
}

/**
 * Run328 additive-only no-code collision compatibility extension.
 *
 * A concurrency/audit record that explicitly states `no code shipped` has no new runtime artifact
 * and therefore must not manufacture a completed checkpoint when no matching perf row exists.
 * Keep the historical record visible, but leave the completed-run watermark on the last real run.
 */
function progressSectionIsExplicitlyNonCheckpoint(sectionBody) {
	const normalized = sectionBody.replace(/[`*_]/g, ' ').replace(/\s+/g, ' ');
	return /\bnot run,\s*explicitly\b/i.test(normalized)
		|| /\bno\b.{0,100}\bperf-log entry needed\b/i.test(normalized)
		|| /\bno code shipped\b/i.test(normalized);
}

function maxRunFromStableTags(text) {
	const runs = [];
	for (const line of text.split(/\r?\n/)) {
		if (!/stable-/i.test(line)) continue;
		const normalized = line.replace(/[`*_]/g, ' ').replace(/\s+/g, ' ');
		if (/\bno code shipped\b/i.test(normalized)) continue;
		const match = line.match(/\brun\s*(\d+)\b/i);
		if (match) runs.push(Number(match[1]));
	}
	return runs.length ? Math.max(...runs) : null;
}

/**
 * Run328 heading-aware additive compatibility extension.
 *
 * Some collision/audit sections state the non-checkpoint reason only in the Markdown heading.
 * Evaluate the heading together with its body so those truthful audit entries cannot advance the
 * completed-run watermark merely because the explanatory phrase is absent from the bullets.
 */
function maxRunFromProgress(text) {
	const headings = [...text.matchAll(/^##\s+(?:This Run\b.*?\brun\s+(\d+)\b|Run\s+(\d+)\b).*$/gim)];
	const runs = [];
	for (let index = 0; index < headings.length; index++) {
		const match = headings[index];
		const run = Number(match[1] || match[2]);
		const sectionStart = match.index + match[0].length;
		const sectionEnd = index + 1 < headings.length ? headings[index + 1].index : text.length;
		const section = `${match[0]}\n${text.slice(sectionStart, sectionEnd)}`;
		if (!progressSectionIsExplicitlyNonCheckpoint(section)) runs.push(run);
	}
	return runs.length ? Math.max(...runs) : null;
}
