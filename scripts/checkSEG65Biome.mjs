#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildG65BiomeProbe, measureG65Biome } from '../godot/terrain-authoring/geocells/se/g65_biome.mjs';

const EXPECTED = Object.freeze({
  canonicalWater: 0,
  canonicalLand: 96,
  samples: 4225,
  dominantCounts: Object.freeze({ 'yi-ti': 4051, 'jogos-nhai': 174 }),
  maxAdjacentColorDelta: 0.00518619,
  maxGuardBandDelta: 0.03555665,
  colorChecksum: 289038221,
});

const first = measureG65Biome();
const second = measureG65Biome();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G65 biome metrics are not deterministic');
if (first.canonicalWater !== EXPECTED.canonicalWater || first.canonicalLand !== EXPECTED.canonicalLand) throw new Error(`G65 hydrology regression: ${JSON.stringify(first)}`);
if (first.samples !== EXPECTED.samples) throw new Error(`G65 biome sample-count drift: ${first.samples}`);
if (JSON.stringify(first.dominantCounts) !== JSON.stringify(EXPECTED.dominantCounts)) throw new Error(`G65 dominant biome fingerprint drift: ${JSON.stringify(first.dominantCounts)}`);
if (first.maxAdjacentColorDelta !== EXPECTED.maxAdjacentColorDelta) throw new Error(`G65 adjacent color fingerprint drift: ${first.maxAdjacentColorDelta}`);
if (first.maxGuardBandDelta !== EXPECTED.maxGuardBandDelta) throw new Error(`G65 guard-band fingerprint drift: ${first.maxGuardBandDelta}`);
if (first.colorChecksum !== EXPECTED.colorChecksum) throw new Error(`G65 color checksum drift: ${first.colorChecksum}`);
if (first.maxAdjacentColorDelta > 0.03) throw new Error(`G65 adjacent biome color delta out of range: ${first.maxAdjacentColorDelta}`);
if (first.maxGuardBandDelta > 0.12) throw new Error(`G65 guard-band color discontinuity too high: ${first.maxGuardBandDelta}`);

const probe = buildG65BiomeProbe();
if (process.argv.includes('--write-probe')) {
  const out = path.resolve('godot/terrain-authoring/.terrain3d-proof/g65-biome-probe.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(probe)}\n`);
  console.log(`G65_BIOME_PROBE=${out}`);
}
console.log(`SE_G65_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('SE_G65_BIOME_OK');
