#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildG75BiomeProbe, measureG75Biome } from '../godot/terrain-authoring/geocells/se/g75_biome.mjs';

const first = measureG75Biome();
const second = measureG75Biome();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G75 biome metrics are not deterministic');
if (first.canonicalWater !== 0 || first.canonicalLand !== 96) throw new Error(`G75 hydrology regression: ${JSON.stringify(first)}`);
if (!(first.maxAdjacentColorDelta >= 0) || first.maxAdjacentColorDelta > 0.03) throw new Error(`G75 adjacent biome color delta out of range: ${first.maxAdjacentColorDelta}`);
if (first.maxGuardBandDelta > 0.12) throw new Error(`G75 guard-band color discontinuity too high: ${first.maxGuardBandDelta}`);
if (!Number.isInteger(first.colorChecksum) || first.colorChecksum === 0) throw new Error('G75 color checksum missing');
if (Object.keys(first.dominantCounts).length < 1) throw new Error('G75 biome classification produced no dominant source zone');

const probe = buildG75BiomeProbe();
if (process.argv.includes('--write-probe')) {
  const out = path.resolve('godot/terrain-authoring/.terrain3d-proof/g75-biome-probe.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(probe)}\n`);
  console.log(`G75_BIOME_PROBE=${out}`);
}
console.log(`SE_G75_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('SE_G75_BIOME_OK');
