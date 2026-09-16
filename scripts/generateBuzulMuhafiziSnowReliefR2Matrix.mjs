#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY as POLICY,
  resolveTerrainWindSnowSurfaceFabric,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowToneHints,
  terrainWindSnowSurfaceFabricDigest,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const OUTPUT = path.resolve('artifacts/buzul-muhafizi-snow-relief-r2-matrix.jsonl');
const SLOPES = [0, 2.5, 6, 10, 16, 22, 28, 34];
const FOLDS = [0, 0.01, 0.025, 0.05, 0.09, 0.14, 0.20, 0.28];
const ASPECTS = [-1, -0.82, -0.58, -0.30, 0, 0.30, 0.58, 0.82];
const RETENTIONS = [0, 0.14, 0.28, 0.42, 0.56, 0.70, 0.84, 1];
const HEADER = {
  format: 'buzul-muhafizi-snow-relief-r2',
  deterministic: POLICY.deterministic,
  renderOnly: POLICY.renderOnly,
  dimensions: { slopes: SLOPES.length, folds: FOLDS.length, aspects: ASPECTS.length, retentions: RETENTIONS.length },
  cases: SLOPES.length * FOLDS.length * ASPECTS.length * RETENTIONS.length,
};

function round(value) {
  return Number(value.toFixed(8));
}

function buildCase(index, slopeDegrees, foldGradient, aspectDot, leeRetention) {
  const input = { slopeDegrees, foldGradient, aspectDot, leeRetention };
  const fabric = resolveTerrainWindSnowSurfaceFabric(input);
  const continuity = resolveTerrainWindSnowContinuity(input);
  const tone = resolveTerrainWindSnowToneHints(input);
  return {
    caseId: `r2-${String(index).padStart(4, '0')}`,
    index,
    inputs: input,
    expected: {
      digest: terrainWindSnowSurfaceFabricDigest(fabric),
      continuity: round(continuity),
      ridgeCrust: round(fabric.ridgeCrust),
      leePowder: round(fabric.leePowder),
      windwardGain: round(fabric.windwardGain),
      leeGain: round(fabric.leeGain),
      tone: Object.fromEntries(Object.entries(tone).map(([key, value]) => [key, round(value)])),
    },
  };
}

function main() {
  const lines = [JSON.stringify(HEADER)];
  let index = 0;
  for (const leeRetention of RETENTIONS) {
    for (const slopeDegrees of SLOPES) {
      for (const foldGradient of FOLDS) {
        for (const aspectDot of ASPECTS) {
          lines.push(JSON.stringify(buildCase(index, slopeDegrees, foldGradient, aspectDot, leeRetention)));
          index += 1;
        }
      }
    }
  }
  if (index !== HEADER.cases) throw new Error(`expected ${HEADER.cases} cases, generated ${index}`);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Generated ${index} Buzul Muhafızı R2 snow-relief cases at ${OUTPUT}`);
}

main();
