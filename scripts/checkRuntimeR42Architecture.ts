#!/usr/bin/env node
/**
 * R42 architecture gate.
 * Production TypeScript owner.
 */
import { readdir, readFile } from 'node:fs/promises';
import { scanOwnershipR42 } from '../src/3d/strict/r42/ownership.ts';

const projectRoot = new URL('../', import.meta.url);
const sourceRoot = new URL('../src/3d/strict/r42/', import.meta.url);
const testRoot = new URL('../tests/modern/r42/', import.meta.url);

const required = [
  'types.ts','clock.ts','input.ts','world.ts','simulation.ts','render.ts',
  'assets.ts','network.ts','persistence.ts','scheduler.ts','workers.ts',
  'observability.ts','security.ts','events.ts','streaming.ts','ui.ts',
  'browserBridge.ts','migration.ts','replay.ts','compatibility.ts','runtime.ts','index.ts',
];

const forbidden = [
  /@ts-nocheck/,
  /@ts-ignore/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bMath\.random\s*\(/,
  /\bDate\.now\s*\(/,
];

const failures:string[] = [];
let sourceLines = 0;
let testLines = 0;

for (const file of required) {
  const content = await readFile(new URL(file, sourceRoot), 'utf8').catch(() => '');
  if (!content) {
    failures.push(file + ': missing');
    continue;
  }
  sourceLines += content.split(/\r?\n/).length;
  for (const pattern of forbidden) if (pattern.test(content)) failures.push(file + ': forbidden ' + pattern);
  if (!content.includes('Production TypeScript owner') && file !== 'index.ts') failures.push(file + ': ownership marker missing');
}

for (const file of await walk(testRoot)) {
  const content = await readFile(file, 'utf8').catch(() => '');
  testLines += content.split(/\r?\n/).length;
}

const ownership = await scanOwnershipR42(projectRoot);
if (!ownership.ok) failures.push(...ownership.unownedJavaScript.map(path => 'unowned-javascript: ' + path));
if (sourceLines + testLines < 4000) failures.push('R42 source+tests below 4000 lines: ' + (sourceLines + testLines));

const report = {
  ok: failures.length === 0,
  version: 42,
  sourceLines,
  testLines,
  combinedLines: sourceLines + testLines,
  requiredFiles: required.length,
  javascriptScanned: ownership.scannedJavaScript,
  javascriptOwned: ownership.ownedJavaScript,
  compatibilityShims: ownership.compatibilityShims,
};

if (failures.length) {
  console.error(JSON.stringify({ ...report, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));

async function walk(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await walk(next));
    else if (entry.name.endsWith('.test.ts')) files.push(next);
  }
  return files;
}
