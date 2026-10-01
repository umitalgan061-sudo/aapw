import { hashJson, stableSerialize } from './deterministic';
import type { EntityState, RenderPass, RuntimeCommand, RuntimeConfig } from './types';

export interface ValidationIssue { readonly code: string; readonly severity: 'warning' | 'error'; readonly message: string; readonly path: string; }
export interface ValidationReport { readonly ok: boolean; readonly issues: readonly ValidationIssue[]; readonly digest: string; }

function issue(code: string, severity: ValidationIssue['severity'], message: string, path: string): ValidationIssue {
  return Object.freeze({ code, severity, message, path });
}
export function validateRuntimeConfig(config: RuntimeConfig): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!(config.fixedHz >= 30 && config.fixedHz <= 240)) issues.push(issue('R40_CLOCK_RANGE', 'error', 'fixedHz must remain between 30 and 240', 'fixedHz'));
  if (!(config.maxCatchUpSteps >= 1 && config.maxCatchUpSteps <= 16)) issues.push(issue('R40_CATCHUP_RANGE', 'error', 'maxCatchUpSteps outside supported range', 'maxCatchUpSteps'));
  if (config.frameBudget.frameMs <= 0) issues.push(issue('R40_FRAME_BUDGET', 'error', 'frame budget must be positive', 'frameBudget.frameMs'));
  if (config.maxEntities < 1 || config.maxEntities > 1000000) issues.push(issue('R40_ENTITY_CAP', 'error', 'maxEntities outside safety bound', 'maxEntities'));
  return Object.freeze({ ok: !issues.some((item) => item.severity === 'error'), issues: Object.freeze(issues), digest: hashJson(issues) });
}
export function validateEntity(entity: EntityState): ValidationReport {
  const issues: ValidationIssue[] = [];
  const numeric = [entity.transform.position.x, entity.transform.position.y, entity.transform.position.z, entity.bounds.radius];
  if (!entity.id) issues.push(issue('ENTITY_ID', 'error', 'entity id is required', 'id'));
  if (numeric.some((value) => !Number.isFinite(value))) issues.push(issue('ENTITY_FINITE', 'error', 'entity transform/bounds must be finite', 'transform'));
  if (entity.tags.length > 32) issues.push(issue('ENTITY_TAG_CAP', 'warning', 'entity has been given more than 32 tags', 'tags'));
  return Object.freeze({ ok: !issues.some((item) => item.severity === 'error'), issues: Object.freeze(issues), digest: hashJson(entity) });
}
export function validateCommand(command: RuntimeCommand): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!command.id || command.type.length === 0 || command.type.length > 96) issues.push(issue('COMMAND_ID', 'error', 'command identity is malformed', 'id'));
  if (!Number.isFinite(command.sequence) || command.sequence < 0) issues.push(issue('COMMAND_SEQUENCE', 'error', 'command sequence must be non-negative', 'sequence'));
  const size = stableSerialize(command.payload).length;
  if (size > 65536) issues.push(issue('COMMAND_BYTES', 'error', 'command payload exceeds 64 KiB', 'payload'));
  return Object.freeze({ ok: !issues.some((item) => item.severity === 'error'), issues: Object.freeze(issues), digest: hashJson(command) });
}
export function validateRenderPass(pass: RenderPass): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!pass.id) issues.push(issue('PASS_ID', 'error', 'render pass id is required', 'id'));
  if (pass.estimatedGpuMs < 0) issues.push(issue('PASS_GPU', 'error', 'render pass gpu estimate cannot be negative', 'estimatedGpuMs'));
  if (pass.drawCalls < 0 || pass.triangles < 0) issues.push(issue('PASS_GEOMETRY', 'error', 'draw calls/triangles cannot be negative', 'geometry'));
  if (pass.reads.some((id) => pass.writes.includes(id))) issues.push(issue('PASS_ALIAS', 'warning', 'pass reads and writes the same resource', 'resources'));
  return Object.freeze({ ok: !issues.some((item) => item.severity === 'error'), issues: Object.freeze(issues), digest: hashJson(pass) });
}
export function validateJsonSerializable(value: unknown, maxBytes = 65536): ValidationReport {
  try {
    const serialized = stableSerialize(value);
    const issues = serialized.length > maxBytes ? [issue('JSON_BYTES', 'error', 'value exceeds serialization budget', 'root')] : [];
    return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues), digest: hashJson(value) });
  } catch (error) {
    return Object.freeze({ ok: false, issues: Object.freeze([issue('JSON_CYCLE', 'error', error instanceof Error ? error.message : 'value cannot be serialized', 'root')]), digest: hashJson(String(error)) });
  }
}
