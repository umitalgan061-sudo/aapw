#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildG77BiomeProbe, measureG77Biome } from '../godot/terrain-authoring/geocells/se/g77_biome.mjs';

const EXPECTED = Object.freeze({
  samples: 4225, canonicalWater: 44, canonicalLand: 52,
  dominantCounts: Object.freeze({ water: 1993, ulthos: 1615, 'fallback-land': 617 }),
  maxAdjacentColorDelta: 0.12627683, maxAdjacentRoughnessDelta: 0.07224844,
  maxGuardBandColorDelta: 0.2240252, maxBoundaryEpsilonDelta: 0.00009004,
  colorRoughnessChecksum: 978779551,
});

const first = measureG77Biome(), second = measureG77Biome();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G77 biome metrics are not deterministic');
for (const key of ['samples','canonicalWater','canonicalLand','maxAdjacentColorDelta','maxAdjacentRoughnessDelta','maxGuardBandColorDelta','maxBoundaryEpsilonDelta','colorRoughnessChecksum']) {
  if (first[key] !== EXPECTED[key]) throw new Error(`G77 biome ${key} drift: ${first[key]} != ${EXPECTED[key]}`);
}
if (JSON.stringify(first.dominantCounts) !== JSON.stringify(EXPECTED.dominantCounts)) throw new Error(`G77 biome dominance drift: ${JSON.stringify(first.dominantCounts)}`);
if (first.maxAdjacentColorDelta > 0.15 || first.maxAdjacentRoughnessDelta > 0.09) throw new Error('G77 biome local continuity exceeded');
if (first.maxGuardBandColorDelta > 0.25 || first.maxBoundaryEpsilonDelta > 0.001) throw new Error('G77 biome boundary continuity exceeded');

const probe = buildG77BiomeProbe();
if (process.argv.includes('--write-probe')) {
  const out = path.resolve('godot/terrain-authoring/.terrain3d-proof/g77-biome-probe.json');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(probe)}\n`); console.log(`G77_BIOME_PROBE=${out}`);
}
console.log(`SE_G77_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('SE_G77_BIOME_OK');
