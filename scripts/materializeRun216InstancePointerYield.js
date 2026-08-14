#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'src', '3d', 'editor', 'worldEditor.js');
const ANCHOR = "canvas.addEventListener('pointerdown', (event) => {\n";
const GUARD = "  if (window.__WESTEROS_EDITOR_INSTANCE_POINTER__?.ownsPointer?.(event)) return;\n";

function count(text, needle) {
  return text.split(needle).length - 1;
}

function materializeSource(source) {
  const guardCount = count(source, GUARD);
  if (guardCount > 1) throw new Error(`pointer yield guard appears ${guardCount} times`);
  if (guardCount === 1) return { source, changed: false };
  const anchorCount = count(source, ANCHOR);
  if (anchorCount !== 1) throw new Error(`legacy pointerdown anchor count must be 1, got ${anchorCount}`);
  const next = source.replace(ANCHOR, `${ANCHOR}${GUARD}`);
  if (next.replace(GUARD, '') !== source) throw new Error('materializer changed bytes beyond the additive guard');
  return { source: next, changed: true };
}

function verifySource(source) {
  if (count(source, GUARD) !== 1) throw new Error('pointer yield guard must appear exactly once');
  if (!source.includes(`${ANCHOR}${GUARD}`)) throw new Error('pointer yield guard must immediately follow the legacy pointerdown anchor');
}

function checkSyntax(target) {
  const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'node --check failed');
}

function runSelfTest() {
  const fixture = `const before = true;\n${ANCHOR}  if (event.button !== 0) return;\n});\nconst after = true;\n`;
  const first = materializeSource(fixture);
  if (!first.changed) throw new Error('first materialization must change fixture');
  verifySource(first.source);
  if (first.source.replace(GUARD, '') !== fixture) throw new Error('fixture additive preservation failed');
  const second = materializeSource(first.source);
  if (second.changed || second.source !== first.source) throw new Error('second materialization must be byte-idempotent');
  let duplicateRejected = false;
  try { materializeSource(first.source.replace(GUARD, `${GUARD}${GUARD}`)); } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error('duplicate guard fixture must be rejected');
  console.log('[materializeRun216InstancePointerYield] SELF-TEST PASS');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) return runSelfTest();
  const original = fs.readFileSync(TARGET, 'utf8');
  if (args.has('--verify-only')) {
    verifySource(original);
    checkSyntax(TARGET);
    console.log('[materializeRun216InstancePointerYield] PASS: existing pointer yield guard verified');
    return;
  }
  const result = materializeSource(original);
  if (result.changed) fs.writeFileSync(TARGET, result.source, 'utf8');
  const persisted = fs.readFileSync(TARGET, 'utf8');
  verifySource(persisted);
  checkSyntax(TARGET);
  if (result.changed && persisted.replace(GUARD, '') !== original) throw new Error('persisted file changed bytes beyond the additive guard');
  console.log(`[materializeRun216InstancePointerYield] PASS: ${result.changed ? 'added' : 'already present'}; additions=1 deletions=0 by construction`);
}

try { main(); } catch (error) {
  console.error(`[materializeRun216InstancePointerYield] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
