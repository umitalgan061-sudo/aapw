import fs from 'node:fs';
import path from 'node:path';
import { buildG07NearDetailProbe, measureG07NearDetail } from '../godot/terrain-authoring/geocells/sw/g07_near_detail.mjs';

const metrics = measureG07NearDetail();
if (metrics.canonicalLandSamples !== 0) throw new Error(`G07 must remain canonical open sea; land samples=${metrics.canonicalLandSamples}`);
if (metrics.maxFoliageWeight !== 0) throw new Error(`G07 open sea must not receive terrestrial foliage; max=${metrics.maxFoliageWeight}`);
if (!(metrics.maxDetailBlend > metrics.minDetailBlend)) throw new Error('G07 near-detail field has no measurable variation');
if (metrics.maxAdjacentDetailStep > 0.08) throw new Error(`G07 marine near detail is too abrupt: ${metrics.maxAdjacentDetailStep}`);
if (metrics.maxGuardBandDetailDelta > 0.03) throw new Error(`G07 near-detail guard-band seam too large: ${metrics.maxGuardBandDetailDelta}`);

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const out = emit.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(buildG07NearDetailProbe())}\n`);
}
console.log(`G07_NEAR_DETAIL_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G07_NEAR_DETAIL_VALIDATION_OK');
