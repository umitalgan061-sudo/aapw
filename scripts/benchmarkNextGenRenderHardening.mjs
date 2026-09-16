import { performance } from 'node:perf_hooks';
import { createNextGenRenderOrchestrator } from '../src/3d/rendering/nextGenRenderOrchestrator.js';

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822519) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
    return ((state ^ (state >>> 16)) >>> 0) / 0xffffffff;
  };
}

const random = seeded(20260916);
const renderables = Array.from({ length: 1600 }, (_, index) => ({
  id: `renderable-${index}`,
  distance: random() * 1200,
  screenCoverage: random(),
  importance: 0.1 + random() * 1.4,
  visible: index % 29 !== 0,
  frustumVisible: index % 43 !== 0,
  geometryKey: `geo-${index % 24}`,
  materialKey: `mat-${index % 12}`,
}));
const instances = renderables.map((item) => ({ ...item, geometryKey: `instance-${item.geometryKey}` }));
const textures = Array.from({ length: 500 }, (_, index) => ({
  id: `texture-${index}`,
  width: 2048,
  height: 2048,
  format: index % 3 ? 'rgba8' : 'rgba16float',
  distance: random() * 1000,
  screenCoverage: random(),
  importance: 0.2 + random() * 1.2,
  compressed: index % 2 === 0,
  persistent: index < 4,
}));

const orchestrator = createNextGenRenderOrchestrator();
const samples = [];
for (let frame = 0; frame < 40; frame += 1) {
  const start = performance.now();
  const result = orchestrator.renderFrame({
    frameMs: frame < 20 ? 22 : 13,
    cpuMs: 4 + (frame % 5),
    gpuMs: 8 + (frame % 7),
    backend: frame % 4 === 0 ? 'webgl2' : 'webgpu',
    runtimeTier: frame < 10 ? 'high' : 'ultra',
    hardwareScore: 0.85,
    thermalPressure: frame % 9 === 0 ? 0.8 : 0.2,
    width: 1920,
    height: 1080,
    renderables,
    instances,
    textures,
    shaderRequests: [{ features: { skinning: true, fog: true, normalMap: true }, materialFamily: 'standard' }],
    triangles: 2200000,
    timestampMs: frame * 16.67,
  });
  samples.push(performance.now() - start);
  if (result.visibility.visible.length > 2048 || result.instances.batches.some((batch) => batch.instanceCount > 2048)) process.exitCode = 1;
}

samples.sort((a, b) => a - b);
const percentile = (fraction) => samples[Math.floor((samples.length - 1) * fraction)];
const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
console.log(JSON.stringify({
  frames: samples.length,
  orchestrationMs: {
    mean: Number(mean.toFixed(4)),
    p50: Number(percentile(0.5).toFixed(4)),
    p95: Number(percentile(0.95).toFixed(4)),
    p99: Number(percentile(0.99).toFixed(4)),
  },
}));
orchestrator.dispose();
