import { RuntimeMetrics, SimulationConfig, WorldSnapshot, isFiniteVec3, isValidSimulationConfig, stableChecksum } from './types.ts';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationReport {
  valid: boolean;
  issues: readonly ValidationIssue[];
  checksum: number;
}

export function validateSimulationConfig(config: SimulationConfig): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!isValidSimulationConfig(config)) issues.push(error('config.invalid', '$', 'Simulation configuration is invalid'));
  if (config.tickRate > 240) issues.push(warning('config.high_tick_rate', 'tickRate', 'Tick rate exceeds the recommended 240 Hz ceiling'));
  if (config.maxCatchUpTicks > 32) issues.push(warning('config.large_catchup', 'maxCatchUpTicks', 'Large catch-up windows can amplify frame stalls'));
  return report(issues, config);
}

export function validateWorldSnapshot(snapshot: WorldSnapshot): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) issues.push(error('snapshot.tick', 'tick', 'Snapshot tick must be a non-negative integer'));
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) issues.push(error('snapshot.revision', 'revision', 'Snapshot revision must be a non-negative integer'));
  if (!Array.isArray(snapshot.entities)) issues.push(error('snapshot.entities', 'entities', 'Entities must be an array'));
  const ids = new Set<number>();
  for (const [index, entity] of (snapshot.entities ?? []).entries()) {
    const path = `entities[${index}]`;
    const id = Number(entity.id);
    if (!Number.isInteger(id) || id <= 0) issues.push(error('entity.id', `${path}.id`, 'Entity id must be positive and integral'));
    if (ids.has(id)) issues.push(error('entity.duplicate', `${path}.id`, 'Entity id is duplicated'));
    ids.add(id);
    if (!Number.isInteger(entity.mask) || entity.mask < 0) issues.push(error('entity.mask', `${path}.mask`, 'Entity mask must be a non-negative integer'));
    if (typeof entity.components !== 'object' || entity.components === null || Array.isArray(entity.components)) issues.push(error('entity.components', `${path}.components`, 'Entity components must be an object'));
    for (const [name, component] of Object.entries(entity.components ?? {})) {
      if (name.length > 128) issues.push(error('component.name_length', `${path}.components.${name}`, 'Component key is too long'));
      if (containsNonFinite(component)) issues.push(error('component.non_finite', `${path}.components.${name}`, 'Component contains a non-finite numeric value'));
    }
  }
  const expected = stableChecksum(snapshot.entities);
  if (snapshot.checksum !== expected) issues.push(error('snapshot.checksum', 'checksum', 'Snapshot checksum does not match entity payload'));
  return report(issues, snapshot.entities);
}

export function validateRuntimeMetrics(metrics: RuntimeMetrics): ValidationReport {
  const issues: ValidationIssue[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value) || value < 0) issues.push(error('metrics.invalid', key, `Metric ${key} must be finite and non-negative`));
  }
  if (metrics.entityCount > 1_000_000) issues.push(warning('metrics.entity_pressure', 'entityCount', 'Entity count is above one million'));
  if (metrics.snapshotBytes > 8 * 1024 * 1024) issues.push(warning('metrics.snapshot_size', 'snapshotBytes', 'Snapshot size exceeds the default persistence limit'));
  return report(issues, metrics);
}

export function validatePosition(value: unknown, path = '$'): ValidationIssue[] {
  if (!isFiniteVec3(value as never)) return [error('position.invalid', path, 'Position must contain finite x/y/z coordinates')];
  return [];
}

function containsNonFinite(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(containsNonFinite);
  if (typeof value === 'object' && value !== null) return Object.values(value).some(containsNonFinite);
  return false;
}

function error(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: 'error' };
}

function warning(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: 'warning' };
}

function report(issues: ValidationIssue[], value: unknown): ValidationReport {
  return { valid: !issues.some((issue) => issue.severity === 'error'), issues, checksum: stableChecksum(value) };
}
