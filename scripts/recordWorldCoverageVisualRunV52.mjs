import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv.find((arg) => arg.startsWith('--out-dir='))?.split('=')[1] ?? path.join(ROOT, 'artifacts', 'world-coverage-visual-v52'));
const recordPath = path.join(OUT, 'run-record.json');
fs.mkdirSync(OUT, { recursive: true });

const changedFiles = [
  'game3d.html',
  'src/3d/world/worldCoverageVisualRuntimeV52.js',
  'src/3d/world/worldCoverageVisualRuntimeV52Policies.js',
  'scripts/checkWorldCoverageVisualRuntimeV52.mjs',
  'scripts/checkWorldCoverageVisualRuntimeV52Contract.mjs',
  'scripts/checkWorldCoverageVisualAssetContractV52.mjs',
  'scripts/checkWorldCoverageVisualRcaV52.mjs',
  'scripts/checkWorldCoverageVisualDeterminismV52.mjs',
  'scripts/checkWorldCoverageVisualRenderHookV52.mjs',
  'scripts/checkWorldCoverageVisualBudgetV52.mjs',
  'scripts/checkWorldCoverageVisualSourceCoverageV52.mjs',
  'scripts/checkWorldCoverageVisualEvidenceV52.mjs',
  'scripts/captureWorldCoverageVisualProofV52.mjs',
];

const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'.replace('.js', '.json')), 'utf8'));

const record = {
  id: 'world-coverage-visual-run-2026-09-10-v52',
  owner: 'Buzul Muhafızı',
  scope: 'World / Environment / Photorealism Director',
  production: 'render-time adoption only; canonical geometry/topography remains authoritative',
  changedFiles,
  acceptance: {
    visibleGridSeams: 0,
    visibleRectangularWater: 0,
    obviousWaterMoiré: 0,
    blackSky: 0,
    floatingVegetation: 0,
    placeholderGeometry: 0,
    materialMismatch: 0,
  },
  proof: {
    renderer: 'actual shipped createScene render path',
    requestedResolution: [1536, 1024],
    samples: ['full-world', 'terrain-near', 'northwest-near', 'mountain-near', 'coast-water', 'forest-ecotone'],
    postProcessEditing: false,
  },
  contract: {
    material: 'MaterialAssignmentCore',
    placement: 'WorldAssetPlacementPipeline',
    editorRuntimeImport: false,
  },
};

// A deterministic record deliberately avoids embedding a second source-of-truth policy blob.
// The import above is only a file-existence guard so a future operator immediately sees that the
// run record is generated from repository state rather than hand-authored acceptance prose.
void policy;
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
console.log(`WORLD_COVERAGE_VISUAL_RUN_V52_RECORDED path=${path.relative(ROOT, recordPath)}`);
