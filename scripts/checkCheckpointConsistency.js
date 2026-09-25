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
 * PR runs may inherit an older checkpoint mismatch from the target branch. In that case, this guard
 * remains strict unless BASE_SHA proves all three checkpoint files are unchanged in the PR and the
 * exact same mismatch already exists at the base revision.
 *
 * Usage: node scripts/checkCheckpointConsistency.js
 * Exit 0 = latest completed run is represented by progress + performance + stable tag.
 * Exit 1 = records are missing, disagree unexpectedly, or the inherited baseline cannot be proven.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKPOINT_FILES = Object.freeze(['3D_GAME_PROGRESS.md', 'STABLE_TAGS.md', 'perf_log.csv']);

function read(relativePath) {
	const fullPath = path.join(ROOT, relativePath);
	if (!fs.existsSync(fullPath)) {
		throw new Error(`required file missing: ${relativePath}`);
	}
	return fs.readFileSync(fullPath, 'utf8');
}

function readAtRevision(relativePath, revision) {
	try {
		return execFileSync('git', ['show', `${revision}:${relativePath}`], { encoding: 'utf8' });
	} catch {
		return null;
	}
}

function blobAtRevision(relativePath, revision) {
	try {
		return execFileSync('git', ['rev-parse', `${revision}:${relativePath}`], { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

function fileUnchangedSinceBase(relativePath, baseSha) {
	const baseBlob = blobAtRevision(relativePath, baseSha);
	const headBlob = blobAtRevision(relativePath, 'HEAD');
	return Boolean(baseBlob && headBlob && baseBlob === headBlob);
}

function inheritedMismatchIsProven(values) {
	const baseSha = process.env.BASE_SHA?.trim();
	if (!/^[0-9a-f]{40}$/i.test(baseSha ?? '')) return false;
	if (!CHECKPOINT_FILES.every((file) => fileUnchangedSinceBase(file, baseSha))) return false;

	const progressText = readAtRevision(CHECKPOINT_FILES[0], baseSha);
	const stableText = readAtRevision(CHECKPOINT_FILES[1], baseSha);
	const perfText = readAtRevision(CHECKPOINT_FILES[2], baseSha);
	if (progressText == null || stableText == null || perfText == null) return false;

	const baseline = {
		progressRun: maxRunFromProgress(progressText),
		stableRun: maxRunFromStableTags(stableText),
		perfRun: maxRunFromPerfCsv(perfText),
	};
	return Object.values(baseline).every(Number.isInteger)
		&& baseline.progressRun === values.progressRun
		&& baseline.stableRun === values.stableRun
		&& baseline.perfRun === values.perfRun
		&& (baseline.stableRun !== baseline.progressRun || baseline.perfRun !== baseline.progressRun);
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
			const match = candidate?.match(/^run\s*(\d+)(?:[-_][a-z0-9][a-z0-9_-]*)?$/i);
			if (match) {
				runs.push(Number(match[1]));
				break;
			}
		}
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
		if (inheritedMismatchIsProven(values)) {
			console.log(
				`[checkpoint-consistency] PASS: inherited baseline drift is proven unchanged from BASE_SHA: ` +
				`progress=run${progressRun}, stable=run${stableRun}, perf=run${perfRun}.`,
			);
			return;
		}
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { maxRunFromProgress, maxRunFromStableTags, maxRunFromPerfCsv };
