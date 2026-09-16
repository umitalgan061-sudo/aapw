import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRenderQualityGovernor, normalizeRenderTelemetry, normalizeRenderGovernorContext, validateRenderQualityResult, renderQualityDigest } from '../src/3d/renderQualityGovernorR2.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.join(root, 'artifacts/render-quality-governor-r2');
const files = fs.readdirSync(dir).filter((name) => /^part-\d+\.matrix$/.test(name)).sort();
assert.ok(files.length >= 5, 'expected matrix partitions');

const cases = [];
const ids = new Set();
for (const file of files) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [tag, id, backendToken, levelToken, frameToken] = line.split('|');
    assert.equal(tag, 'RQ');
    assert.ok(id && !ids.has(id), `duplicate matrix id ${id}`);
    ids.add(id);
    const backend = { wg: 'webgpu', w2: 'webgl2', w1: 'webgl', n: 'none', webgpu: 'webgpu', webgl2: 'webgl2', webgl: 'webgl', none: 'none' }[backendToken] ?? 'webgl2';
    const level = { u: 'ultra', h: 'high', b: 'balanced', p: 'performance', c: 'compatibility', ultra: 'ultra', high: 'high', balanced: 'balanced', performance: 'performance', compatibility: 'compatibility' }[levelToken] ?? 'balanced';
    const frameMs = Number(frameToken);
    cases.push({ id, backend, level, frameMs });
  }
}

assert.ok(cases.length >= 4000, `matrix too small: ${cases.length}`);
for (const item of cases) {
  const governor = createRenderQualityGovernor({ level: item.level });
  const telemetry = normalizeRenderTelemetry({ frameMs: item.frameMs, gpuMs: Math.min(32, item.frameMs * .55), cpuMs: Math.min(30, item.frameMs * .4), memoryPressure: item.id.endsWith('0') ? .9 : .28, thermalPressure: item.id.endsWith('5') ? .94 : .21, batteryLevel: item.id.endsWith('9') ? .07 : .88, inputActive: item.id.endsWith('7'), hidden: item.id.endsWith('3') });
  const context = normalizeRenderGovernorContext({ backend: item.backend, level: item.level, frameIndex: Number(item.id) || 0, seed: `matrix-${item.id}` });
  const first = governor.evaluate(telemetry, context);
  const replay = createRenderQualityGovernor({ level: item.level }).evaluate(telemetry, context);
  assert.equal(validateRenderQualityResult(first).valid, true, item.id);
  assert.equal(renderQualityDigest(first), renderQualityDigest(replay), `nondeterministic ${item.id}`);
}

const batch = cases.slice(0, 64).map((item) => ({ telemetry: { frameMs: item.frameMs, gpuMs: item.frameMs * .5, cpuMs: item.frameMs * .4, batteryLevel: .9 }, context: { backend: item.backend, level: item.level, seed: 'batch' } }));
const replayA = createRenderQualityGovernor({ level: 'balanced' });
const replayB = createRenderQualityGovernor({ level: 'balanced' });
const digestA = batch.map((item) => renderQualityDigest(replayA.evaluate(item.telemetry, item.context)));
const digestB = batch.map((item) => renderQualityDigest(replayB.evaluate(item.telemetry, item.context)));
assert.deepEqual(digestA, digestB);

console.log(JSON.stringify({ pass: true, partitions: files.length, cases: cases.length, uniqueIds: ids.size, replayCases: batch.length }));
