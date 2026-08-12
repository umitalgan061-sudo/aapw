#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANDIDATE = 'experiments/run290/worldReferencePindex05Detail.js';
const FORBIDDEN_FILES = [
  'service-worker.js',
  'game3d.html',
  'rts.html',
  'editor.html',
  'canonical-dev.html',
  'canonical-dev-launcher.html',
  'scripts/run201CanonicalDevBoot.mjs',
];

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const candidatePath = path.join(ROOT, CANDIDATE);
if (!fs.existsSync(candidatePath)) throw new Error(`Run290 candidate missing: ${CANDIDATE}`);

const candidateSource = fs.readFileSync(candidatePath, 'utf8');
for (const token of ['pindex: 5', 'PINDEX05_DETAIL_POLICY', 'applyPindex05DetailToTerrainMesh']) {
  if (!candidateSource.includes(token)) throw new Error(`Run290 candidate contract missing: ${token}`);
}

const forbidden = [
  ...walk(path.join(ROOT, 'src', '3d')).filter((file) => /\.(?:js|mjs|cjs)$/.test(file)),
  ...FORBIDDEN_FILES.map((file) => path.join(ROOT, file)).filter((file) => fs.existsSync(file)),
];

const violations = [];
for (const file of forbidden) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(CANDIDATE) || source.includes('worldReferencePindex05Detail.js')) {
    violations.push(path.relative(ROOT, file));
  }
}

if (violations.length) {
  throw new Error(`Dormant Pindex-05 candidate leaked into runtime/PWA surfaces: ${violations.join(', ')}`);
}

console.log(`[checkRun291Pindex05DormantIsolation] PASS: ${CANDIDATE} exists and remains outside runtime/PWA import surfaces`);
