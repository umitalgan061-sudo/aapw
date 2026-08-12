#!/usr/bin/env node
import fs from 'node:fs';

const boot = fs.readFileSync('scripts/run201CanonicalDevBoot.mjs', 'utf8');
const candidate = fs.readFileSync('experiments/run290/worldReferencePindex05Detail.js', 'utf8');
const game3d = fs.readFileSync('src/3d/game3d.js', 'utf8');

const requiredBootTokens = [
  "await import('../experiments/run290/worldReferencePindex05Detail.js')",
  "document.body.dataset.run301Pindex05Ready = 'true'",
  'document.body.dataset.run301Pindex05TouchedVertices = String(run301Detail.touchedVertices)',
  "cache.add('./experiments/run290/worldReferencePindex05Detail.js')",
  "document.body.dataset.run301Pindex05CacheReady = 'true'",
];
for (const token of requiredBootTokens) {
  if (!boot.includes(token)) throw new Error(`Run301 canonical activation missing: ${token}`);
}

const p4 = boot.indexOf("await import('../src/3d/world/worldReferencePindex04Detail.js')");
const p5 = boot.indexOf("await import('../experiments/run290/worldReferencePindex05Detail.js')");
if (p4 < 0 || p5 <= p4) throw new Error('Run301 must apply Pindex-05 after the established Pindex-04 layer');

for (const token of [
  'pindex: 5',
  'sea: 0.008',
  'soil: 0.043',
  'rock: 0.043',
  'snow: 0.02',
  'if (c.pindex !== PINDEX05_DETAIL_POLICY.pindex) continue;',
]) {
  if (!candidate.includes(token)) throw new Error(`Run301 proven candidate contract drifted: ${token}`);
}
if (candidate.includes('Math.random(')) throw new Error('Run301 candidate must remain deterministic');
if (game3d.includes('worldReferencePindex05Detail') || game3d.includes('run301Pindex05')) {
  throw new Error('Run301 must remain opt-in canonical-dev only; default game3d runtime changed');
}
if (boot.includes("../src/3d/world/worldReferencePindex05Detail.js")) {
  throw new Error('Run301 must not prematurely promote the experimental candidate into src/3d');
}

console.log('[checkRun301Pindex05CanonicalActivation] PASS: proven Pindex-05 candidate activates after Pindex-04 only on canonical-dev and receives explicit offline warming');
