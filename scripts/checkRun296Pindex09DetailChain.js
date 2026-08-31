#!/usr/bin/env node
import fs from 'node:fs';

const modules = [
  ['01', 'Run277', 'worldReferencePindex01Detail.js', 'run277Pindex01Ready'],
  ['02', 'Run278', 'worldReferencePindex02Detail.js', 'run278Pindex02Ready'],
  ['03', 'Run281', 'worldReferencePindex03Detail.js', 'run281Pindex03Ready'],
  ['04', 'Run282', 'worldReferencePindex04Detail.js', 'run282Pindex04Ready'],
  ['05', 'Run292', 'worldReferencePindex05Detail.js', 'run292Pindex05Ready'],
  ['06', 'Run293', 'worldReferencePindex06Detail.js', 'run293Pindex06Ready'],
  ['07', 'Run294', 'worldReferencePindex07Detail.js', 'run294Pindex07Ready'],
  ['08', 'Run295', 'worldReferencePindex08Detail.js', 'run295Pindex08Ready'],
  ['09', 'Run296', 'worldReferencePindex09Detail.js', 'run296Pindex09Ready'],
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

const p9 = fs.readFileSync('src/3d/world/worldReferencePindex09Detail.js', 'utf8');
for (const required of [
  "owner-map-pindex09-detail-2026-08-27-v2-world-space-weathering",
  'macroMeters: 1680',
  'mesoMeters: 470',
  'fineMeters: 126',
  'microMeters: 44',
  'warpMeters: 760',
  'samplePindex09SurfaceFabric',
  'pindex09BoundaryWeight',
  "surface === 'soil'",
  "surface === 'rock'",
  "surface === 'snow'",
  'geographyAuthorityUnchanged: true',
  'terrainHeightAuthorityUnchanged: true',
  'hydrologyAuthorityUnchanged: true',
  'colliderAuthorityUnchanged: true',
]) {
  if (!p9.includes(required)) throw new Error(`Pindex-09 v2 realism contract missing: ${required}`);
}
if (p9.includes('normalizedX * 1024') || p9.includes('normalizedY * 1024')) {
  throw new Error('Pindex-09 regressed to normalized-map high-frequency hash repetition');
}
if (!p9.includes('worldX / scaleMeters') || !p9.includes('worldZ / scaleMeters')) {
  throw new Error('Pindex-09 v2 must derive multiscale material variation from world-space metres');
}

console.log('[checkRun296Pindex09DetailChain] PASS: runtime/offline Pindex-01→09 chain plus Pindex-09 world-space multiscale weathering contract locked');
