#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildG07BiomeProbe, measureG07Biome } from '../godot/terrain-authoring/geocells/sw/g07_biome.mjs';

const first = measureG07Biome();
const second = measureG07Biome();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G07 biome metrics are not deterministic');
if (first.canonicalWater !== 96 || first.canonicalLand !== 0) throw new Error(`G07 hydrology regression: ${JSON.stringify(first)}`);
if (!(first.maxAdjacentColorDelta > 0) || first.maxAdjacentColorDelta > 0.01) throw new Error(`G07 adjacent marine color delta out of range: ${first.maxAdjacentColorDelta}`);
if (first.maxGuardBandDelta > 0.08) throw new Error(`G07 guard-band color discontinuity too high: ${first.maxGuardBandDelta}`);
if (!Number.isInteger(first.colorChecksum) || first.colorChecksum === 0) throw new Error('G07 color checksum missing');

const probe = buildG07BiomeProbe();
if (process.argv.includes('--write-probe')) {
  const out = path.resolve('godot/terrain-authoring/.terrain3d-proof/g07-biome-probe.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(probe)}\n`);
  console.log(`G07_BIOME_PROBE=${out}`);
}
console.log(`SW_G07_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('SW_G07_BIOME_OK');
