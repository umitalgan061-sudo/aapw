import { AssetCacheV7 } from './assets.ts';
import { BudgetSchedulerV7 } from './scheduler.ts';
import { DeterministicRngV7, checksumV7 } from './deterministic.ts';
import { EntityStoreV7 } from './entityStore.ts';
import { SpatialIndexV7 } from './spatialIndex.ts';
import { tickV7, entityIdV7, vec3V7 } from './types.ts';

export interface BenchmarkResultV7 {
  readonly name: string;
  readonly iterations: number;
  readonly checksum: string;
  readonly operations: number;
  readonly estimatedCost: number;
}

export interface RuntimeBenchmarkSuiteV7 {
  readonly seed: number;
  readonly results: readonly BenchmarkResultV7[];
  readonly aggregateChecksum: string;
}

const measure = (name: string, iterations: number, operation: () => number): BenchmarkResultV7 => {
  let checksum = 2166136261;
  let operations = 0;
  for (let i = 0; i < iterations; i += 1) {
    checksum ^= operation() + i;
    checksum = Math.imul(checksum, 16777619) >>> 0;
    operations += 1;
  }
  return Object.freeze({ name, iterations, checksum: checksum.toString(16).padStart(8, '0'), operations, estimatedCost: operations / Math.max(1, iterations) });
};

export function runProductionBenchmarksV7(seed = 0x7a11ce, iterations = 100): RuntimeBenchmarkSuiteV7 {
  const rng = new DeterministicRngV7(seed);
  const entity = new EntityStoreV7();
  const spatial = new SpatialIndexV7(16);
  const assets = new AssetCacheV7({ maxBytes: 4 * 1024 * 1024, reserveBytes: 64 * 1024, maxEntries: 512 });
  const scheduler = new BudgetSchedulerV7(seed);
  for (let i = 0; i < 128; i += 1) {
    const id = entityIdV7(i + 1);
    const p = vec3V7(i % 16, 0, Math.floor(i / 16));
    entity.upsert({
      id, archetype: 'benchmark',
      createdTick: tickV7(0),
      components: {
        transform: { position: p, yaw: 0, pitch: 0, scale: vec3V7(1, 1, 1) },
        kinematics: { velocity: vec3V7(), acceleration: vec3V7(), grounded: true, maxSpeed: 5 },
        vital: { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, poise: 100, maxPoise: 100, invulnerableUntilTick: tickV7(0) },
        interest: { priority: i % 4, simulationLod: (i % 4) as 0 | 1 | 2 | 3, renderLod: (i % 4) as 0 | 1 | 2 | 3, alwaysRelevant: i < 2 },
        network: { owner: 'benchmark', dirtyRevision: 0 as never, lastAckedSequence: 0 as never, replicated: true },
        tags: ['benchmark'],
      },
    });
    spatial.upsert({ id, layer: 0, active: true, bounds: { min: vec3V7(p.x - 1, 0, p.z - 1), max: vec3V7(p.x + 1, 2, p.z + 1) } });
    assets.put({ id: `benchmark-${i}`, url: `/benchmark/${i}.glb`, kind: 'glb', bytes: 4096, hash: `h${i}` as never, critical: i < 4, tags: ['benchmark'] }, { id: i }, tickV7(0));
    scheduler.enqueue({ id: `bench-${i}`, lane: i < 4 ? 'simulation' : 'background', priority: i % 10, costEstimateMs: 0.01, budgetClass: 'preferred', maxDeferrals: 3, payload: i, run: (value) => ({ outcome: 'executed', costMs: value % 3 * 0.01 }) });
  }
  const results = [
    measure('rng', iterations, () => rng.nextUint()),
    measure('spatial-nearest', iterations, () => spatial.nearest(vec3V7(rng.nextInt(0, 16), 0, rng.nextInt(0, 16)), 24, 8).length),
    measure('scheduler', iterations, () => scheduler.runTick(tickV7(iterations), 1).executed),
    measure('entity-digest', iterations, () => checksumV7(entity.digestInput()).charCodeAt(0)),
    measure('asset-cache', iterations, () => assets.stats().bytes),
  ];
  return Object.freeze({ seed, results: Object.freeze(results), aggregateChecksum: checksumV7(results) });
}
