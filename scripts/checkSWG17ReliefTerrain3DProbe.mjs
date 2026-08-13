import fs from 'node:fs';
import path from 'node:path';
import { buildG17ReliefProbe, measureG17Relief, G17_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';
const m = measureG17Relief();
if (m.canonicalWater !== 96 || m.canonicalLand !== 0) throw new Error('G17 hydrology regression');
if (!(m.maxHeight < G17_RELIEF_POLICY.waterCeilingMeters && m.heightSpan > 0.45)) throw new Error('G17 marine relief regression');
if (!(m.maxAdjacentHeightDelta <= 0.12 && m.maxGuardBandHeightDelta <= 0.40 && m.maxGuardBandNormalDelta <= 0.012)) throw new Error('G17 seam regression');
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (!out) throw new Error('--out=path required');
const p = { ...buildG17ReliefProbe(65), worldWidthMeters:G17_RELIEF_POLICY.referenceWorldMeters.x, worldDepthMeters:G17_RELIEF_POLICY.referenceWorldMeters.z,
  canonicalWaterCells:m.canonicalWater, canonicalLandCells:m.canonicalLand, minHeight:m.minHeight, maxHeight:m.maxHeight, heightSpan:m.heightSpan,
  maxAdjacentHeightDelta:m.maxAdjacentHeightDelta, maxGuardBandHeightDelta:m.maxGuardBandHeightDelta, maxGuardBandNormalDelta:m.maxGuardBandNormalDelta, heightChecksum:m.heightChecksum };
fs.mkdirSync(path.dirname(out), { recursive:true }); fs.writeFileSync(out, `${JSON.stringify(p,null,2)}\n`);
console.log('SW_G17_RELIEF_PROBE_METRICS='+JSON.stringify(m)); console.log('SW_G17_RELIEF_PROBE_OK');
