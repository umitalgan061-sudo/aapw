import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUTPUT = resolve(ROOT, 'artifacts/modern-game-entry-r1/entry-policy.matrix');
const surfaces = ['cold-start', 'warm-start', 'legacy-ready', 'legacy-error', 'gate-open', 'gate-enter', 'gate-repel', 'loop-start', 'loop-stop', 'loop-restart', 'viewport-resize', 'tab-hidden', 'tab-visible', 'worker-capable', 'worker-unavailable', 'webgpu', 'webgl2', 'recovery', 'quality-down', 'quality-up', 'persistence', 'input'];
const backends = ['webgpu', 'webgl2', 'headless'];
const qualities = ['minimal', 'balanced', 'high', 'ultra'];
const devices = ['desktop', 'laptop', 'tablet', 'mobile'];
const inputs = ['keyboard', 'pointer', 'touch', 'gamepad', 'virtual'];
const loopStates = ['stopped', 'starting', 'running', 'stopping'];
const visibility = ['visible', 'hidden'];

const cases = [];
for (let index = 0; index < 4096; index += 1) {
  const surface = surfaces[index % surfaces.length];
  const backend = backends[Math.floor(index / 11) % backends.length];
  const quality = qualities[Math.floor(index / 33) % qualities.length];
  const device = devices[Math.floor(index / 97) % devices.length];
  const input = inputs[Math.floor(index / 211) % inputs.length];
  const loop = loopStates[Math.floor(index / 503) % loopStates.length];
  const page = visibility[Math.floor(index / 1007) % visibility.length];
  const gateMoves = (index * 13 + 5) % 17;
  const frameMs = 4 + ((index * 37) % 34);
  const ready = surface === 'legacy-ready' || surface === 'warm-start' || surface === 'loop-start' || surface === 'loop-restart' || surface === 'gate-enter';
  const expected = expectedState({ surface, backend, quality, device, input, loop, page, gateMoves, frameMs, ready });
  cases.push(JSON.stringify({ id: `entry-${String(index).padStart(4, '0')}`, schema: 2, surface, backend, quality, device, input, loop, page, gateMoves, frameMs, expected }));
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, ['# AAPW modern Game3D entry deterministic conformance corpus', '# schema=2', ...cases, ''].join('\n'), 'utf8');
console.log(`generated ${cases.length} cases at ${OUTPUT}`);

function expectedState(input) {
  const { surface, backend, quality, device, input: source, loop, page, gateMoves, frameMs, ready } = input;
  if (surface === 'legacy-error') return 'error-visible';
  if (page === 'hidden') return loop === 'running' ? 'suspended' : 'idle';
  if (surface === 'gate-open') return 'blocked-by-gate';
  if (surface === 'gate-repel') return gateMoves >= 16 ? 'gate-stable-repel' : 'repel';
  if (surface === 'gate-enter') return 'world-entered';
  if (surface === 'loop-start' || surface === 'loop-restart') return 'running';
  if (surface === 'loop-stop') return 'stopped';
  if (surface === 'recovery') return backend === 'webgl2' || backend === 'headless' ? 'recovered' : 'recoverable';
  if (surface === 'quality-down') return 'adaptive-degrade';
  if (surface === 'quality-up') return 'adaptive-recover';
  if (surface === 'input') return source === 'touch' || source === 'virtual' ? 'mobile-input' : 'desktop-input';
  if (surface === 'worker-capable') return device === 'desktop' || device === 'laptop' ? 'worker-ready' : 'worker-deferred';
  if (surface === 'worker-unavailable') return 'main-thread-fallback';
  if (surface === 'viewport-resize') return 'viewport-synchronized';
  if (surface === 'tab-visible') return loop === 'stopped' ? 'idle' : 'running';
  if (surface === 'tab-hidden') return 'suspended';
  if (surface === 'webgpu') return backend === 'webgpu' ? 'modern-gpu' : 'fallback-gpu';
  if (surface === 'webgl2') return backend === 'webgl2' ? 'compatible-gpu' : 'fallback-gpu';
  if (surface === 'persistence') return 'save-boundary';
  if (surface === 'cold-start') return 'cold-boot';
  if (surface === 'warm-start') return 'warm-boot';
  if (surface === 'legacy-ready' || ready) return frameMs > 28 && quality === 'ultra' ? 'ready-but-budgeted' : 'ready';
  return loop === 'running' ? 'running' : 'idle';
}
