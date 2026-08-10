#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE_REF = process.argv[2] || 'origin/main';
const HEAD_REF = process.argv[3] || 'HEAD';
const TRACKING_FILES = Object.freeze([
  '3D_GAME_PROGRESS.md',
  'QUESTIONS_FOR_OWNER.md'
]);
const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.xml', '.glsl', '.vert', '.frag'
]);
const FORBIDDEN_TEMP_MARKERS = /\b(?:TEMP|HACK|FIXME|WORKAROUND)\b/i;
const DEBT_MARKERS = /\b(?:TODO|XXX|TECH[-_ ]?DEBT)\b/i;

function fail(message) {
  throw new Error(message);
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function ensureRemoteRef(ref) {
  if (!ref.startsWith('origin/')) return;
  try {
    runGit(['rev-parse', '--verify', ref]);
    return;
  } catch {}
  const branch = ref.slice('origin/'.length);
  if (!branch) fail(`Invalid remote ref: ${ref}`);
  runGit(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`, '--depth=1']);
}

function isSourcePath(file) {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function parseAddedSourceLines(diffText) {
  const findings = [];
  let currentFile = null;
  let newLine = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      newLine = match ? Number(match[1]) : 0;
      continue;
    }
    if (!currentFile || !isSourcePath(currentFile)) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      findings.push({ file: currentFile, line: newLine, text: line.slice(1) });
      newLine += 1;
      continue;
    }
    if (!line.startsWith('-')) newLine += 1;
  }
  return findings;
}

function main() {
  for (const relative of TRACKING_FILES) {
    const target = path.join(ROOT, relative);
    if (!fs.existsSync(target)) fail(`Required debt/owner tracking surface is missing: ${relative}`);
  }

  const governance = fs.readFileSync(path.join(ROOT, 'GOVERNANCE.md'), 'utf8');
  if (!governance.includes('### 8.8 Geçici Çözüm Yok')) fail('Governance temporary-solution rule is missing');
  if (!governance.includes('**Hafif Teknik Borç Sayacı:**')) fail('Governance lightweight technical-debt counter rule is missing');

  ensureRemoteRef(BASE_REF);
  runGit(['rev-parse', '--verify', BASE_REF]);
  runGit(['rev-parse', '--verify', HEAD_REF]);

  const diffText = runGit(['diff', '--unified=0', `${BASE_REF}...${HEAD_REF}`, '--']);
  const addedSource = parseAddedSourceLines(diffText);
  const forbidden = addedSource.filter((entry) => FORBIDDEN_TEMP_MARKERS.test(entry.text));
  const debt = addedSource.filter((entry) => DEBT_MARKERS.test(entry.text));

  if (forbidden.length > 0) {
    console.error(`[checkTechnicalDebt] FAIL: ${forbidden.length} newly-added forbidden temporary-solution marker(s) violate GOVERNANCE §8.8:`);
    for (const entry of forbidden) console.error(`  - ${entry.file}:${entry.line}: ${entry.text.trim()}`);
    process.exit(1);
  }

  const progress = fs.readFileSync(path.join(ROOT, '3D_GAME_PROGRESS.md'), 'utf8');
  const ownerQuestions = fs.readFileSync(path.join(ROOT, 'QUESTIONS_FOR_OWNER.md'), 'utf8');
  const progressDebtRecords = (progress.match(/Technical debt introduced:/gi) || []).length;
  const openOwnerQuestionCount = (ownerQuestions.match(/^[-*]\s+/gm) || []).length;

  console.log(`[checkTechnicalDebt] PASS: forbidden temporary-solution additions=0; newly-added debt markers=${debt.length}; recorded progress debt entries=${progressDebtRecords}; owner-tracking list entries=${openOwnerQuestionCount}.`);
  if (debt.length > 0) {
    console.log('[checkTechnicalDebt] Newly-added debt markers (tracked, not forbidden):');
    for (const entry of debt) console.log(`  - ${entry.file}:${entry.line}: ${entry.text.trim()}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[checkTechnicalDebt] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
