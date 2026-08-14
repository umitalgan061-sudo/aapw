#!/usr/bin/env node
import fs from 'node:fs';

const modules = [
  ['01', 'Run277', 'worldReferencePindex01Detail.js', 'run277Pindex01Ready'],
  ['02', 'Run278', 'worldReferencePindex02Detail.js', 'run278Pindex02Ready'],
  ['03', 'Run281', 'worldReferencePindex03Detail.js', 'run281Pindex03Ready'],
  ['04', 'Run282', 'worldReferencePindex04Detail.js', 'run282Pindex04Ready'],
  ['05', 'Run292', 'worldReferencePindex05Detail.js', 'run292Pindex05Ready'],
  ['06', 'Run293', 'worldReferencePindex06Detail.js', 'run293Pindex06Ready'],
];

const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const canonicalBoot = fs.readFileSync('scripts/run201CanonicalDevBoot.mjs', 'utf8');

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

// Continues the Run277-292 reverse-prepend offline / chronological-boot convention (see
// `checkRun284PindexDetailChain.js` / `checkRun292Pindex05DetailChain.js`): each new Pindex block is
// prepended above all earlier ones offline while running last, chronologically, at boot time.
for (let index = 1; index < serviceWorkerIndexes.length; index += 1) {
  if (serviceWorkerIndexes[index] >= serviceWorkerIndexes[index - 1]) {
    throw new Error(`offline prepend order regressed between Pindex-${modules[index - 1][0]} and Pindex-${modules[index][0]}`);
  }
}

for (const [pindex, run, filename] of modules) {
  const source = fs.readFileSync(`src/3d/world/${filename}`, 'utf8');
  if (!source.includes(`pindex: ${Number(pindex)}`)) throw new Error(`${run}/Pindex-${pindex} policy index changed`);
  if (source.includes('Math.random(')) throw new Error(`${run}/Pindex-${pindex} became non-deterministic`);
}

console.log('[checkRun293Pindex06DetailChain] PASS: chronological runtime + reverse-prepend offline Pindex-01→06 contracts locked');
