import { buildG10ReliefProbe } from '../godot/terrain-authoring/geocells/nw/g10_relief.mjs';
import { measureG10Hydrology } from '../godot/terrain-authoring/geocells/nw/g10_hydrology.mjs';
import { measureG10Biome } from '../godot/terrain-authoring/geocells/nw/g10_biome.mjs';

const hydrology = measureG10Hydrology();
if (hydrology.waterCells !== 60 || hydrology.landCells !== 36 || hydrology.boundaryEdges !== 30 || hydrology.centreMismatches !== 0) throw new Error('G10 hydrology regression');
const biome = measureG10Biome();
if (biome.colorChecksum !== 3353551246 || biome.fractionalWaterSamples !== 1251) throw new Error('G10 Macro Biome regression');
const first = buildG10ReliefProbe(), second = buildG10ReliefProbe();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G10 relief must be deterministic');
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner map SHA changed');
if (first.canonicalWaterCells !== 60 || first.canonicalLandCells !== 36 || first.canonicalSignMismatches !== 0) throw new Error('G10 relief moved canonical coast semantics');
if (!(first.minHeight < 0 && first.maxHeight > 3 && first.heightSpan > 5)) throw new Error(`G10 relief lacks physical character: ${first.minHeight}..${first.maxHeight}`);
if (!(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000)) throw new Error('G10 normal scale is not full-reference extent');
if (first.maxAdjacentHeightStep > 12 || first.maxGuardHeightDelta > 8 || first.maxGuardNormalDelta > 0.8) throw new Error('G10 relief seam or source-step regression');
if (first.rows.length !== 65 || first.rows.some((row) => row.length !== 65)) throw new Error('unexpected G10 relief probe dimensions');
const { rows, ...metrics } = first;
console.log(`NW_G10_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G10_RELIEF_VALIDATION_OK');
