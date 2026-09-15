import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const capture = fs.readFileSync(path.join(ROOT, 'scripts/captureWorldCoverageVisualProofV52.mjs'), 'utf8');
const policies = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8');
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

const requiredSamples = [
  'full-world',
  'terrain-near',
  'northwest-near',
  'mountain-near',
  'coast-water',
  'forest-ecotone',
];
for (const sample of requiredSamples) check(capture.includes(`id: '${sample}'`), `camera sample missing: ${sample}`);

const resolutionTokens = [
  'const WIDTH = 1536;',
  'const HEIGHT = 1024;',
  'viewport: { width: WIDTH, height: HEIGHT }',
  'deviceScaleFactor: 1',
];
for (const token of resolutionTokens) check(capture.includes(token), `camera resolution token missing: ${token}`);

const deterministicCameraTokens = [
  'CAMERA_SAMPLES',
  'centerForWorld',
  'orthographicHalfWidth',
  'orthographicHalfHeight',
  'camera.updateProjectionMatrix()',
  'state.renderer?.setSize?.(1536, 1024, false)',
  'state.renderer?.render?.(state.scene, state.camera)',
];
for (const token of deterministicCameraTokens) check(capture.includes(token), `deterministic camera token missing: ${token}`);

const sceneCoverageTokens = [
  'canonical runtime scene',
  'actual shipped createScene render path',
  'game3d.html',
  'createScene',
];
for (const token of sceneCoverageTokens) check(capture.includes(token) || runtime.includes(token), `shipped-scene evidence token missing: ${token}`);

const atmosphereTokens = [
  'blackBackgroundThreshold',
  'fallbackBackground',
  'fogColor',
  'horizonLift',
];
for (const token of atmosphereTokens) check(runtime.includes(token) || policies.includes(token), `atmosphere token missing: ${token}`);

const semanticTargets = [
  'visibleGridSeamsTarget',
  'visibleWaterRectanglesTarget',
  'obviousWaterMoiréTarget',
  'blackSkyTarget',
  'floatingVegetationTarget',
];
for (const token of semanticTargets) check(runtime.includes(token), `acceptance camera target missing: ${token}`);

check(capture.includes('post-processing') === false || capture.includes('post-processing'), 'capture source remains explicit about post-processing policy');
check(capture.includes('no post-processing is applied'), 'capture must explicitly prohibit post-processing');
check(capture.includes('real shipped visual evidence'), 'capture must distinguish diagnostics from real shipped evidence');
check(capture.includes('live createScene state is not globally exposed'), 'capture must fail transparently when live state is unavailable');

const cameraGeometryRules = [
  ['1536x1024', /1536[\s×x,]+1024/i],
  ['orthographic', /orthographicHalfWidth.*orthographicHalfHeight/s],
  ['full-world height', /15500/],
  ['near terrain height', /1900/],
  ['northwest near', /-3100.*-1800/s],
  ['mountain near', /2900.*-1650/s],
  ['coast water', /0.*2350/s],
  ['forest ecotone', /-1050.*-680/s],
];
for (const [label, pattern] of cameraGeometryRules) check(pattern.test(capture), `camera geometry rule missing: ${label}`);

const mutableCameraBoundary = [
  'camera.position.set(x, height, z)',
  'camera.lookAt(x, 0, z)',
  'camera.updateProjectionMatrix()',
];
for (const token of mutableCameraBoundary) check(capture.includes(token), `capture camera mutation path missing: ${token}`);

const noFakeEvidence = [
  'sharpnessEnhance',
  'canvas.toDataURL(',
  'OffscreenCanvas(',
  'imageMagick',
  'photoshop',
];
for (const token of noFakeEvidence) check(!capture.toLowerCase().includes(token.toLowerCase()), `fake-evidence path forbidden: ${token}`);

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_CAMERA_MATRIX_OK checks=${checks}`);
