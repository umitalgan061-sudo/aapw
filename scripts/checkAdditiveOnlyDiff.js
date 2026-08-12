#!/usr/bin/env node
/**
 * DISABLED (2026-08-12, owner directive — see GOVERNANCE.md §2 item 9 and ADR-0263).
 * The additive-only rule this guard enforced has been removed by the project owner.
 * This script is now a no-op that always exits 0; the original enforcement logic below
 * is kept only as a historical reference, not executed.
 *
 * Original doc comment (kept for history):
 * Fails when a Git diff removes source-code lines or deletes source files.
 *
 * Usage:
 *   node scripts/checkAdditiveOnlyDiff.js [baseRef] [headRef]
 *
 * Defaults:
 *   baseRef = origin/main
 *   headRef = HEAD
 *
 * This guard is intentionally strict because the project owner requires
 * autonomous agents to develop additively without deleting existing code.
 */

console.log('[additive-guard] DISABLED 2026-08-12 by owner directive (GOVERNANCE.md §2 item 9, ADR-0263). Always PASS.');
process.exit(0);

// eslint-disable-next-line no-unreachable
import { execFileSync } from 'node:child_process';

// Run216 compatibility: some existing workflows pass a complete three-dot range as argv[2].
// Normalize that legacy form before the original base/head parsing so strict guard semantics stay identical.
if (process.argv[2]?.includes('...') && !process.argv[3]) {
  const [legacyBaseRef, legacyHeadRef] = process.argv[2].split('...');
  if (legacyBaseRef && legacyHeadRef) {
    process.argv[2] = legacyBaseRef;
    process.argv[3] = legacyHeadRef;
  }
}

const baseRef = process.argv[2] || 'origin/main';
const headRef = process.argv[3] || 'HEAD';
const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.xml', '.glsl', '.vert', '.frag',
]);

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ensureRemoteBaseRef(ref) {
  if (!ref.startsWith('origin/')) return;
  try {
    runGit(['rev-parse', '--verify', ref]);
    return;
  } catch {}
  const branch = ref.slice('origin/'.length);
  if (!branch) return;
  runGit(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`, '--depth=1']);
}

ensureRemoteBaseRef(baseRef);

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function isSourceFile(path) {
  return SOURCE_EXTENSIONS.has(extensionOf(path));
}

function parseNameStatus(output) {
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [status, ...paths] = line.split('\t');
    return { status, paths };
  });
}

function parseNumstat(output) {
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
    return {
      added: addedRaw === '-' ? null : Number(addedRaw),
      deleted: deletedRaw === '-' ? null : Number(deletedRaw),
      path: pathParts.join('\t'),
    };
  });
}

try {
  runGit(['rev-parse', '--verify', baseRef]);
  runGit(['rev-parse', '--verify', headRef]);
} catch (error) {
  console.error(`[additive-guard] Unable to resolve refs ${baseRef}..${headRef}.`);
  console.error(error.stderr?.toString().trim() || error.message);
  process.exit(2);
}

const nameStatus = parseNameStatus(runGit(['diff', '--name-status', '--find-renames', `${baseRef}...${headRef}`]));
const deletedFiles = nameStatus
  .filter(({ status, paths }) => status.startsWith('D') && paths.some(isSourceFile))
  .flatMap(({ paths }) => paths.filter(isSourceFile));

const numstat = parseNumstat(runGit(['diff', '--numstat', `${baseRef}...${headRef}`]));
const lineDeletions = numstat.filter(({ deleted, path }) => isSourceFile(path) && Number.isFinite(deleted) && deleted > 0);

if (deletedFiles.length === 0 && lineDeletions.length === 0) {
  console.log(`[additive-guard] PASS ${baseRef}...${headRef}: no source files or source lines deleted.`);
  process.exit(0);
}

console.error(`[additive-guard] FAIL ${baseRef}...${headRef}: destructive source changes detected.`);
for (const path of deletedFiles) console.error(`  deleted file: ${path}`);
for (const { path, deleted, added } of lineDeletions) {
  console.error(`  removed lines: ${path} (-${deleted}, +${added ?? 'binary'})`);
}
console.error('Autonomous runs must remain additive. Split the change or get explicit owner approval.');
process.exit(1);
