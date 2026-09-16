import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'src/3d/modern/v7/primitives.ts', 'src/3d/modern/v7/scheduler.ts', 'src/3d/modern/v7/stateStore.ts',
  'src/3d/modern/v7/eventBus.ts', 'src/3d/modern/v7/taskGraph.ts', 'src/3d/modern/v7/resourceResidency.ts',
  'src/3d/modern/v7/spatialWorld.ts', 'src/3d/modern/v7/aiDirector.ts', 'src/3d/modern/v7/networkSession.ts',
  'src/3d/modern/v7/renderGovernor.ts', 'src/3d/modern/v7/inputReplay.ts', 'src/3d/modern/v7/persistence.ts',
  'src/3d/modern/v7/security.ts', 'src/3d/modern/v7/telemetry.ts', 'src/3d/modern/v7/workerPool.ts',
  'src/3d/modern/v7/ecs.ts', 'src/3d/modern/v7/worldState.ts', 'src/3d/modern/v7/combatRuntime.ts',
  'src/3d/modern/v7/gameplaySimulation.ts', 'src/3d/modern/v7/presentationDirector.ts',
  'src/3d/modern/v7/legacyBridge.ts', 'src/3d/modern/v7/runtimeKernel.ts', 'src/3d/modern/v7/index.ts',
];
const checks = [
  ['Runtime kernel', 'runtimeKernel.ts', 'export class V7RuntimeKernel'],
  ['Determinism primitive', 'primitives.ts', 'export function digest'],
  ['Fixed-step clock', 'scheduler.ts', 'export class FixedStepClock'],
  ['Transactional state', 'stateStore.ts', 'export class RuntimeStateStore'],
  ['Event replay', 'eventBus.ts', 'replay(handler'],
  ['Task graph', 'taskGraph.ts', 'export class RuntimeTaskGraph'],
  ['Resource budget', 'resourceResidency.ts', 'evictTo(targetBytes'],
  ['Spatial LOD', 'spatialWorld.ts', 'interest(center'],
  ['Utility AI', 'aiDirector.ts', 'export class UtilityAiDirector'],
  ['Network reconciliation', 'networkSession.ts', 'reconcile(authoritativeTick'],
  ['Adaptive render', 'renderGovernor.ts', 'evaluate(signals'],
  ['Replay input', 'inputReplay.ts', 'export class InputReplayRuntime'],
  ['Checksummed persistence', 'persistence.ts', '#validEnvelope'],
  ['Security boundary', 'security.ts', 'validatePayload(payload'],
  ['Telemetry health', 'telemetry.ts', 'health(budgets'],
  ['Worker pool', 'workerPool.ts', 'export class BoundedWorkerPool'],
  ['Typed ECS', 'ecs.ts', 'export class TypedEcsWorld'],
  ['World authority', 'worldState.ts', 'export class AuthoritativeWorldState'],
  ['Gameplay simulation', 'gameplaySimulation.ts', 'export class DeterministicGameplaySimulation'],
  ['Combat runtime', 'combatRuntime.ts', 'export class DeterministicCombatRuntime'],
  ['Presentation', 'presentationDirector.ts', 'export class PresentationDirector'],
  ['Migration bridge', 'legacyBridge.ts', 'export class LegacyModernBridge'],
];

let failed = false;
for (const path of required) {
  try {
    const source = await readFile(resolve(root, path), 'utf8');
    if (!source.trim()) throw new Error('empty');
  } catch (error) {
    failed = true;
    console.error(`[v7] missing or unreadable: ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const [label, file, token] of checks) {
  const source = await readFile(resolve(root, `src/3d/modern/v7/${file}`), 'utf8');
  if (!source.includes(token)) { failed = true; console.error(`[v7] contract missing: ${label} -> ${token}`); }
}
const aggregate = [];
for (const path of required) aggregate.push((await readFile(resolve(root, path), 'utf8')).length);
const totalBytes = aggregate.reduce((sum, value) => sum + value, 0);
console.log(JSON.stringify({ runtime: 'v7', files: required.length, sourceBytes: totalBytes, checks: checks.length, status: failed ? 'failed' : 'ok' }, null, 2));
if (failed) process.exit(1);
