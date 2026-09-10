import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(ROOT, 'scripts/recordWorldCoverageVisualRunV52.mjs'), 'utf8');
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

const requiredFields = [
  "id: 'world-coverage-visual-run-2026-09-10-v52'",
  "owner: 'Buzul Muhafızı'",
  "scope: 'World / Environment / Photorealism Director'",
  "renderer: 'actual shipped createScene render path'",
  'requestedResolution: [1536, 1024]',
  "postProcessEditing: false",
  "material: 'MaterialAssignmentCore'",
  "placement: 'WorldAssetPlacementPipeline'",
  'editorRuntimeImport: false',
];
for (const field of requiredFields) check(script.includes(field), `run record field: ${field}`);

const sampleIds = [
  'full-world',
  'terrain-near',
  'northwest-near',
  'mountain-near',
  'coast-water',
  'forest-ecotone',
];
for (const sample of sampleIds) check(script.includes(`'${sample}'`), `run record sample: ${sample}`);

const acceptanceFields = [
  'visibleGridSeams',
  'visibleRectangularWater',
  'obviousWaterMoiré',
  'blackSky',
  'floatingVegetation',
  'placeholderGeometry',
  'materialMismatch',
];
for (const field of acceptanceFields) check(script.includes(`${field}: 0`), `run record zero target: ${field}`);

check(script.includes('fs.writeFileSync(recordPath'), 'run record must be persisted');
check(script.includes('JSON.stringify(record, null, 2)'), 'run record must be deterministic JSON');
check(!script.includes('Math.random'), 'run record must not use randomness');
check(!script.includes('Date.now'), 'run record must not inject nondeterministic wall-clock data');

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_RUN_RECORD_OK checks=${checks}`);
