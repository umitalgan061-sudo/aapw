#!/usr/bin/env node
/**
 * Run307: locks the canonical-dev Pindex-01..06 micro-surface detail chain.
 *
 * Extends the Run306 Pindex-01..05 contract with the newly activated Pindex-06 layer without
 * modifying it, so each earlier guard keeps proving its own historical range independently.
 */
import fs from 'node:fs';

const RUN216_COMPLETE_MARKER = '// Run216 complete World Editor offline shell extension.';

const modules = [
  ['01', 'Run277', 'worldReferencePindex01Detail.js', 'run277Pindex01Ready'],
  ['02', 'Run278', 'worldReferencePindex02Detail.js', 'run278Pindex02Ready'],
  ['03', 'Run281', 'worldReferencePindex03Detail.js', 'run281Pindex03Ready'],
  ['04', 'Run282', 'worldReferencePindex04Detail.js', 'run282Pindex04Ready'],
  ['05', 'Run306', 'worldReferencePindex05Detail.js', 'run306Pindex05Ready'],
  ['06', 'Run307', 'worldReferencePindex06Detail.js', 'run307Pindex06Ready'],
];

const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const canonicalBoot = fs.readFileSync('scripts/run201CanonicalDevBoot.mjs', 'utf8');

// Run303 kept the Run216 complete-cache marker as the exact first line; later prepends must not displace it.
if (!serviceWorker.startsWith(RUN216_COMPLETE_MARKER)) {
  throw new Error('Run216 complete cache marker prefix regressed');
}

let previousBootIndex = -1;
const serviceWorkerIndexes = [];
for (const [pindex, run, filename, readyMarker] of modules) {
  const swToken = `./src/3d/world/${filename}`;
  const bootImport = `../src/3d/world/${filename}`;
  const swIndex = serviceWorker.indexOf(swToken);
  const bootIndex = canonicalBoot.indexOf(bootImport);
  if (swIndex < 0) throw new Error(`${run}/Pindex-${pindex} missing from offline shell`);
  if (bootIndex < 0) throw new Error(`${run}/Pindex-${pindex} missing from canonical-dev activation`);
  if (!canonicalBoot.includes(readyMarker)) throw new Error(`${run}/Pindex-${pindex} ready marker missing`);
  if (bootIndex <= previousBootIndex) throw new Error(`canonical-dev Pindex detail order regressed at Pindex-${pindex}`);
  previousBootIndex = bootIndex;
  serviceWorkerIndexes.push(swIndex);
}

// Each Pindex run prepends its install listener, so offline registration stays reverse chronological
// (06→05→04→03→02→01) while canonical-dev execution stays chronological.
for (let index = 1; index < serviceWorkerIndexes.length; index += 1) {
  if (serviceWorkerIndexes[index] >= serviceWorkerIndexes[index - 1]) {
    throw new Error(`offline prepend order regressed between Pindex-${String(index).padStart(2, '0')} and Pindex-${String(index + 1).padStart(2, '0')}`);
  }
}

const sources = new Map();
for (const [pindex, run, filename] of modules) {
  const source = fs.readFileSync(`src/3d/world/${filename}`, 'utf8');
  sources.set(pindex, source);
  if (!source.includes(`pindex: ${Number(pindex)}`)) throw new Error(`${run}/Pindex-${pindex} policy index changed`);
  if (source.includes('Math.random(')) throw new Error(`${run}/Pindex-${pindex} became non-deterministic`);
  if (!source.includes(`if (c.pindex !== PINDEX${pindex}_DETAIL_POLICY.pindex) continue;`)) {
    throw new Error(`${run}/Pindex-${pindex} lost its single-pindex isolation guard`);
  }
}

function amplitude(source, surface) {
  const match = source.match(new RegExp(`${surface}: (\\d+(?:\\.\\d+)?)`));
  if (!match) throw new Error(`missing ${surface} amplitude`);
  return Number(match[1]);
}

// Pindexes 04, 05 and 06 are the sea+soil-only strips, with a strictly growing soil share
// (149/576 → 187/640 → 260/640 canonical cells). Per-vertex soil and sea amplitudes must therefore
// be non-increasing across that run, so a wider soil body never reads noisier than a narrower one.
const soilLedStrips = ['04', '05', '06'];
for (const surface of ['sea', 'soil']) {
  for (let index = 1; index < soilLedStrips.length; index += 1) {
    const previous = amplitude(sources.get(soilLedStrips[index - 1]), surface);
    const current = amplitude(sources.get(soilLedStrips[index]), surface);
    if (current > previous) {
      throw new Error(`Pindex-${soilLedStrips[index]} ${surface} amplitude exceeds Pindex-${soilLedStrips[index - 1]} despite its larger soil share`);
    }
  }
}

// Neighbouring strips must not share a noise pattern, or the polish reads as one repeated texture.
const hashLines = new Set();
for (const [pindex] of modules) {
  const match = sources.get(pindex).match(/Math\.sin\(([^)]*)\)/);
  if (!match) throw new Error(`Pindex-${pindex} lost its deterministic hash`);
  if (hashLines.has(match[1])) throw new Error(`Pindex-${pindex} reuses another pindex's noise constants`);
  hashLines.add(match[1]);
}

console.log('[checkRun307Pindex06DetailChain] PASS: chronological runtime + reverse-prepend offline Pindex-01→06 contracts locked');
