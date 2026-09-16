import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUTPUT = resolve(ROOT, 'artifacts/typescript-cutover-r1/cutover-policy.matrix');
const SCHEMA_VERSION = 1;
const surfaces = ['entry', 'world', 'input', 'assets', 'audio', 'ui', 'simulation', 'rendering', 'persistence', 'editor'];
const risks = ['low', 'medium', 'high', 'critical'];
const statuses = ['legacy', 'shadow', 'ready', 'cut-over', 'retired'];
const backends = ['webgl2', 'webgpu'];
const devices = ['desktop', 'laptop', 'tablet', 'mobile'];
const transport = ['main-thread', 'worker'];

const cases = [];
for (let index = 0; index < 4096; index += 1) {
  const surface = surfaces[index % surfaces.length];
  const risk = risks[Math.floor(index / surfaces.length) % risks.length];
  const status = statuses[Math.floor(index / (surfaces.length * risks.length)) % statuses.length];
  const backend = backends[Math.floor(index / 200) % backends.length];
  const device = devices[Math.floor(index / 400) % devices.length];
  const worker = transport[Math.floor(index / 800) % transport.length];
  const consumers = (index * 17 + 3) % 64;
  const parity = (index * 29 + 7) % 96;
  const bytes = 64 * 1024 + ((index * 7919) % (64 * 1024 * 1024));
  const expected = expectedDecision({ status, risk, consumers, parity, backend, device, worker });
  cases.push(JSON.stringify({ id: `tscutover-${String(index).padStart(4, '0')}`, schema: SCHEMA_VERSION, surface, risk, status, backend, device, transport: worker, consumers, parity, bytes, expected }));
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, ['# AAPW TypeScript cut-over deterministic acceptance corpus', `# schema=${SCHEMA_VERSION}`, ...cases, ''].join('\n'), 'utf8');
console.log(`materialized ${cases.length} deterministic cases at ${OUTPUT}`);

function expectedDecision({ status, risk, consumers, parity, backend, device, worker }) {
  const highRisk = risk === 'high' || risk === 'critical';
  const cannotRetire = consumers > 0;
  const parityReady = parity > 0;
  const modernCapable = backend === 'webgpu' || device === 'desktop' || device === 'laptop';
  const workerPreferred = worker === 'worker' && (device === 'desktop' || device === 'laptop');
  if (status === 'retired') return cannotRetire ? 'audit' : 'stable';
  if (status === 'cut-over') return highRisk && !parityReady ? 'audit' : 'active';
  if (status === 'ready') return parityReady ? 'cutover-candidate' : 'blocked';
  if (status === 'shadow') return workerPreferred || modernCapable ? 'observe' : 'hold';
  return highRisk ? 'priority-migration' : 'legacy-compatible';
}
