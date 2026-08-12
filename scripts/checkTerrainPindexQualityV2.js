#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pindexes = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfacePindexes.js'), 'utf8');
const visual = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.js'), 'utf8');

function requireTokens(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label} missing: ${token}`);
  }
}

requireTokens(pindexes, 'Pindex Quality V2 sampling contract', [
  "id: 'owner-map-pindex-quality-v2-2026-08-12-v1'",
  "pindex: 10, microAmplitude: 0.040",
  'sampleReferencePindexQualityV2(normalizedX, normalizedY)',
  'REFERENCE_BIOME_ZONES',
  'REFERENCE_RELIEF_CHAINS',
  'pindexQualitySurfaceWeights',
  'boundaryBlend',
  'biomeKindWeights',
  'reliefInfluence',
]);
requireTokens(visual, 'Pindex Quality V2 runtime contract', [
  "id: 'terrain-pindex-quality-v2-runtime-2026-08-12-v1'",
  'applyRuntimePindexTerrainQualityV2ToMesh(mesh)',
  'installRuntimePindexTerrainPolishQualityV2()',
  'softenedBoundaryVertices',
  'activeBiomeKinds',
  'pindexVertexCounts',
  'pindexQualityDetail',
  'roughnessFactor = clamp',
  "Symbol.for('westeros.runtime-pindex-terrain-quality-v2.2026-08-12')",
]);

const pindexSection = pindexes.slice(pindexes.indexOf('// Pindex Quality V2'));
const visualSection = visual.slice(visual.indexOf('// Pindex Quality V2'));
for (const [label, source] of [['sampling', pindexSection], ['runtime', visualSection]]) {
  if (source.includes('Math.random(')) throw new Error(`${label} V2 must remain deterministic`);
  if (source.includes('position.setY(')) throw new Error(`${label} V2 must not mutate terrain height`);
}

const pindexLines = pindexes.split(/\r?\n/).length;
const visualLines = visual.split(/\r?\n/).length;
if (pindexLines > 600) throw new Error(`Pindex source exceeded 600-line governance target: ${pindexLines}`);
if (visualLines > 600) throw new Error(`Terrain visual source exceeded 600-line governance target: ${visualLines}`);

if (!pindexes.includes("maskSha256: 'afe62a77fcc9b15887540b49b3b60b199e416f5e033aefb987a192411c25ae44'")) {
  throw new Error('Canonical 96x64 source-derived mask identity drifted');
}
if (!pindexes.includes('sea: 4046') || !pindexes.includes('soil: 1638') || !pindexes.includes('rock: 323') || !pindexes.includes('snow: 131') || !pindexes.includes('lake: 6')) {
  throw new Error('Canonical surface cell-count contract drifted');
}

console.log(`[checkTerrainPindexQualityV2] PASS: continuous P01..P10 sampler + biome/relief/PBR runtime contract; lines pindex=${pindexLines}, visual=${visualLines}`);
