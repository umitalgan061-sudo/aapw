/** Cross-domain invariants used by tests, development builds and release gates. */

import type { NetworkSnapshot } from './networkProtocolV3';
import type { RuntimeSnapshot } from './runtimeKernel';
import type { StreamingStats } from './assetStreamingV3';
import type { TelemetrySummary } from './runtimeTelemetryV3';

export interface RuntimeContractReport { valid: boolean; errors: string[]; warnings: string[]; checks: number }
export interface RuntimeBudgets { maxEntities: number; maxNetworkEntities: number; maxFrameMs: number; maxSimulationMs: number; maxResidentBytes: number; maxAiBrains: number }

const DEFAULT_BUDGETS: RuntimeBudgets = {
  maxEntities: 4096,
  maxNetworkEntities: 512,
  maxFrameMs: 16.67,
  maxSimulationMs: 8,
  maxResidentBytes: 256 * 1024 * 1024,
  maxAiBrains: 512,
};

function pushFailure(errors: string[], condition: boolean, message: string): void { if (!condition) errors.push(message); }
function pushWarning(warnings: string[], condition: boolean, message: string): void { if (!condition) warnings.push(message); }

export function validateRuntimeSnapshot(snapshot: RuntimeSnapshot, budgets: Partial<RuntimeBudgets> = {}): RuntimeContractReport {
  const limits = { ...DEFAULT_BUDGETS, ...budgets };
  const errors: string[] = []; const warnings: string[] = []; let checks = 0;
  checks += 1; pushFailure(errors, snapshot.schemaVersion === 1, `unsupported runtime snapshot schema ${snapshot.schemaVersion}`);
  checks += 1; pushFailure(errors, Number.isInteger(snapshot.tick) && snapshot.tick >= 0, 'runtime tick must be a non-negative integer');
  checks += 1; pushFailure(errors, Number.isFinite(snapshot.simulationTime) && snapshot.simulationTime >= 0, 'simulation time must be finite and non-negative');
  checks += 1; pushFailure(errors, snapshot.entities.length <= limits.maxEntities, `entity count exceeds ${limits.maxEntities}`);
  const ids = new Set<number>();
  for (const entity of snapshot.entities) {
    checks += 1;
    pushFailure(errors, Number.isInteger(entity.id) && entity.id > 0, 'entity id must be positive');
    pushFailure(errors, !ids.has(entity.id), `duplicate entity id ${entity.id}`); ids.add(entity.id);
    pushFailure(errors, Number.isInteger(entity.generation) && entity.generation > 0, `invalid generation for entity ${entity.id}`);
  }
  const transformIds = new Set(snapshot.transforms.map((entry) => entry.id));
  for (const entry of snapshot.transforms) {
    checks += 1;
    const values = [entry.value.position.x, entry.value.position.y, entry.value.position.z, entry.value.rotation.x, entry.value.rotation.y, entry.value.rotation.z, entry.value.scale.x, entry.value.scale.y, entry.value.scale.z];
    pushFailure(errors, values.every(Number.isFinite), `non-finite transform for entity ${entry.id}`);
    pushFailure(errors, ids.has(entry.id), `transform references unknown entity ${entry.id}`);
  }
  for (const entry of snapshot.velocities) {
    checks += 1;
    const values = [entry.value.linear.x, entry.value.linear.y, entry.value.linear.z, entry.value.angular.x, entry.value.angular.y, entry.value.angular.z];
    pushFailure(errors, values.every(Number.isFinite), `non-finite velocity for entity ${entry.id}`);
    pushFailure(errors, ids.has(entry.id), `velocity references unknown entity ${entry.id}`);
    pushWarning(warnings, transformIds.has(entry.id), `velocity exists without transform for entity ${entry.id}`);
  }
  return { valid: errors.length === 0, errors, warnings, checks };
}

export function validateNetworkSnapshot(snapshot: NetworkSnapshot, budgets: Partial<RuntimeBudgets> = {}): RuntimeContractReport {
  const limits = { ...DEFAULT_BUDGETS, ...budgets };
  const errors: string[] = []; const warnings: string[] = []; let checks = 0;
  checks += 1; pushFailure(errors, snapshot.version === 3, 'network protocol version must be 3');
  checks += 1; pushFailure(errors, snapshot.entities.length <= limits.maxNetworkEntities, `network entity count exceeds ${limits.maxNetworkEntities}`);
  checks += 1; pushFailure(errors, snapshot.serverTick >= snapshot.baselineTick, 'server tick cannot precede baseline tick');
  let previous = -1;
  for (const entity of snapshot.entities) {
    checks += 1;
    pushFailure(errors, entity.id > previous, 'network entity ids must be strictly increasing'); previous = entity.id;
    pushFailure(errors, [entity.id, entity.position.x, entity.position.y, entity.position.z, entity.velocity.x, entity.velocity.y, entity.velocity.z, entity.yaw, entity.health].every(Number.isFinite), `network entity ${entity.id} contains non-finite state`);
    pushWarning(warnings, entity.health >= 0, `network entity ${entity.id} has negative health`);
  }
  return { valid: errors.length === 0, errors, warnings, checks };
}

export function validatePerformance(summary: TelemetrySummary, streaming: StreamingStats, aiBrains: number, budgets: Partial<RuntimeBudgets> = {}): RuntimeContractReport {
  const limits = { ...DEFAULT_BUDGETS, ...budgets };
  const errors: string[] = []; const warnings: string[] = []; let checks = 0;
  checks += 1; pushFailure(errors, summary.frameP95Ms <= limits.maxFrameMs, `frame p95 ${summary.frameP95Ms.toFixed(2)}ms exceeds ${limits.maxFrameMs}ms`);
  checks += 1; pushFailure(errors, summary.simulationP95Ms <= limits.maxSimulationMs, `simulation p95 ${summary.simulationP95Ms.toFixed(2)}ms exceeds ${limits.maxSimulationMs}ms`);
  checks += 1; pushFailure(errors, streaming.residentBytes <= limits.maxResidentBytes, `resident assets ${streaming.residentBytes} exceed ${limits.maxResidentBytes}`);
  checks += 1; pushFailure(errors, aiBrains <= limits.maxAiBrains, `AI brain count ${aiBrains} exceeds ${limits.maxAiBrains}`);
  checks += 1; pushWarning(warnings, summary.droppedSamples === 0, `${summary.droppedSamples} telemetry samples were dropped`);
  checks += 1; pushWarning(warnings, summary.avgDrawCalls < 1000, `average draw calls ${summary.avgDrawCalls.toFixed(0)} are high`);
  return { valid: errors.length === 0, errors, warnings, checks };
}

export function validateCombinedRuntime(snapshot: RuntimeSnapshot, network: NetworkSnapshot, streaming: StreamingStats, telemetry: TelemetrySummary, aiBrains: number, budgets: Partial<RuntimeBudgets> = {}): RuntimeContractReport {
  const reports = [validateRuntimeSnapshot(snapshot, budgets), validateNetworkSnapshot(network, budgets), validatePerformance(telemetry, streaming, aiBrains, budgets)];
  return { valid: reports.every((report) => report.valid), errors: reports.flatMap((report) => report.errors), warnings: reports.flatMap((report) => report.warnings), checks: reports.reduce((sum, report) => sum + report.checks, 0) };
}

export function createDefaultBudgets(): RuntimeBudgets { return { ...DEFAULT_BUDGETS }; }
