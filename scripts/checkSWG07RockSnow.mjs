import fs from 'node:fs';
import path from 'node:path';
import { buildG07RockSnowProbe, measureG07RockSnow } from '../godot/terrain-authoring/geocells/sw/g07_rock_snow.mjs';

const metrics = measureG07RockSnow();
if (metrics.canonicalLandSamples !== 0) throw new Error(`G07 must remain canonical open sea; land samples=${metrics.canonicalLandSamples}`);
if (metrics.maxSnowBlend !== 0) throw new Error(`G07 open sea must not receive snow; max=${metrics.maxSnowBlend}`);
if (metrics.maxAdjacentRockStep > 0.03) throw new Error(`submerged rock field is too abrupt: ${metrics.maxAdjacentRockStep}`);
if (metrics.maxGuardBandRockDelta > 0.01) throw new Error(`G07 guard-band rock seam too large: ${metrics.maxGuardBandRockDelta}`);
if (!(metrics.maxRockBlend > metrics.minRockBlend)) throw new Error('submerged rock authoring field has no measurable variation');

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const out = emit.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(buildG07RockSnowProbe())}\n`);
}
console.log(`G07_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G07_ROCK_SNOW_VALIDATION_OK');
