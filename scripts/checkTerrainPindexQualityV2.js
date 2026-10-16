#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pindexes = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfacePindexes.ts'), 'utf8');
const visual = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.ts'), 'utf8');

function requireTokens(source, label, tokens) {
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${label} missing: ${token}`);
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
requireTokens(visual, 'Pindex Quality V2 shader-first runtime contract', [
  "id: 'terrain-pindex-quality-v2-runtime-2026-10-16-v3-nonperiodic-worldspace'",
  'atlasWidth: 192',
  'atlasHeight: 128',
  'buildRuntimePindexQualityV2Atlas()',
  'new THREE.DataTexture',
  'pindexQualityColorAtlas',
  'pindexQualityDataAtlas',
  'pindexQualityHash(vec2 p)',
  'pindexQualityNoise(vec2 p)',
  'pindexQualityWorldXZ',
  'pindexQualityRotatedXZ',
  'pindexQualityNoiseA',
  'pindexQualityNoiseB',
  'pindexQualityNoiseC',
  'pindexQualityRoughNoise',
  "roughnessDetailRevision: 'v3-nonperiodic-world-space-value-noise'",
  'vPindexQualityWorldPosition',
  'applyRuntimePindexTerrainQualityV2ToMesh(mesh)',
  'cpuVertexPassesAdded: 0',
  'installRuntimePindexTerrainPolishQualityV2()',
  "Symbol.for('westeros.runtime-pindex-terrain-quality-v2.2026-10-16-v3')",
]);

const pindexSection = pindexes.slice(pindexes.indexOf('// Pindex Quality V2'));
const visualSection = visual.slice(visual.indexOf('// Pindex Quality V2'));
for (const [label, source] of [['sampling', pindexSection], ['runtime', visualSection]]) {
  if (source.includes('Math.random(')) throw new Error(`${label} V2 must remain deterministic`);
  if (source.includes('position.setY(')) throw new Error(`${label} V2 must not mutate terrain height`);
}
if (/for\s*\([^)]*position\.count/.test(visualSection)) throw new Error('V2 runtime reintroduced a second per-vertex CPU pass');
if (visualSection.includes('pindexQualityDetailAtlas') || visualSection.includes('buildRuntimePindexQualityV2DetailAtlas')) throw new Error('Fixed-period detail atlas returned; terrain detail must remain non-periodic in world space');
if (!visualSection.includes('pindexQualityNoise(')) throw new Error('Non-periodic world-space value noise is missing');
if (!visualSection.includes('texture2D(pindexQualityColorAtlas')) throw new Error('Canonical GPU color atlas is not sampled in the fragment shader');
if (!visualSection.includes('roughnessFactor=mix')) throw new Error('PBR roughness atlas blend is missing');

const pindexLines = pindexes.split(/\r?\n/).length;
const visualLines = visual.split(/\r?\n/).length;
if (pindexLines > 600) throw new Error(`Pindex source exceeded 600-line governance target: ${pindexLines}`);
if (visualLines > 600) throw new Error(`Terrain visual source exceeded 600-line governance target: ${visualLines}`);
if (!pindexes.includes("maskSha256: 'afe62a77fcc9b15887540b49b3b60b199e416f5e033aefb987a192411c25ae44'")) throw new Error('Canonical mask identity drifted');
for (const token of ['sea: 4046', 'lake: 6', 'soil: 1638', 'rock: 323', 'snow: 131']) if (!pindexes.includes(token)) throw new Error(`Canonical cell-count drift: ${token}`);

console.log(`[checkTerrainPindexQualityV2] PASS: continuous P01..P10 + audited biome/relief + non-periodic world-space detail; lines pindex=${pindexLines}, visual=${visualLines}`);
