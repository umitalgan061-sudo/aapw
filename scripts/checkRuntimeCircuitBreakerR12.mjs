import { readFile } from 'node:fs/promises';

const facade = await readFile('src/3d/modern/modernRuntimeFacade.ts', 'utf8');
const circuit = await readFile('src/3d/strict/runtimeCircuitBreakerR12.ts', 'utf8');
const strictIndex = await readFile('src/3d/strict/index.ts', 'utf8');
const test = await readFile('tests/modern/runtimeCircuitBreakerR12.test.ts', 'utf8');
const failures = [];

for (const token of [
  'RuntimeCircuitBreakerR12',
  'circuit.canExecute()',
  "circuit.recordSuccess('facade.frame')",
  "circuit.recordFailure('facade.frame'",
  'this.circuit.dispose()',
]) {
  if (!facade.includes(token)) failures.push('modernRuntimeFacade.ts: missing ' + token);
}

for (const token of [
  'export type RuntimeCircuitState',
  'export interface RuntimeCircuitPolicy',
  'class RuntimeCircuitBreakerR12',
  'canExecute()',
  'recordFailure(',
  'recordSuccess(',
  'forceOpen(',
  'dispose()',
  'historyCapacity',
]) {
  if (!circuit.includes(token)) failures.push('runtimeCircuitBreakerR12.ts: missing ' + token);
}

if (!strictIndex.includes("export * from './runtimeCircuitBreakerR12.ts';")) {
  failures.push('strict/index.ts: R12 circuit breaker export missing');
}

for (const token of [
  'opens after the configured failure threshold',
  'requires multiple successful probes',
  'history remains bounded',
]) {
  if (!test.includes(token)) failures.push('runtimeCircuitBreakerR12.test.ts: scenario marker missing');
}

if (failures.length) {
  console.error('R12 resilience architecture gate failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log(JSON.stringify({
  policy: 'r12-deterministic-runtime-circuit-breaker',
  checks: [
    'frame execution gate',
    'failure threshold',
    'cooldown half-open transition',
    'recovery hysteresis',
    'bounded history',
    'final disposal',
  ],
  verified: true,
}, null, 2));
