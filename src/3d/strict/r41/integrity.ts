
import type { CommandEnvelope, Entity, RuntimeConfig, RuntimeMode, RuntimeSnapshot, Vec3, WorldSnapshot } from './types.ts';
import { R41_VERSION, clamp, finite, stableHash } from './types.ts';

export interface IntegrityIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: 'warning' | 'critical';
  readonly path: string;
}

export interface IntegrityReport {
  readonly ok: boolean;
  readonly issues: readonly IntegrityIssue[];
  readonly checksum: number;
}

export interface RuntimeLimits {
  readonly maxEntityIdLength: number;
  readonly maxTagLength: number;
  readonly maxTagsPerEntity: number;
  readonly maxPayloadDepth: number;
  readonly maxNumericMagnitude: number;
  readonly maxPositionMagnitude: number;
}

export const DEFAULT_R41_LIMITS: RuntimeLimits = Object.freeze({
  maxEntityIdLength: 128,
  maxTagLength: 48,
  maxTagsPerEntity: 32,
  maxPayloadDepth: 6,
  maxNumericMagnitude: 1_000_000_000,
  maxPositionMagnitude: 10_000_000,
});

export class RuntimeIntegrityR41 {
  readonly limits: RuntimeLimits;

  constructor(limits: Partial<RuntimeLimits> = {}) {
    this.limits = Object.freeze({
      ...DEFAULT_R41_LIMITS,
      ...limits,
      maxEntityIdLength: Math.max(8, Math.trunc(finite(limits.maxEntityIdLength, DEFAULT_R41_LIMITS.maxEntityIdLength))),
      maxTagLength: Math.max(4, Math.trunc(finite(limits.maxTagLength, DEFAULT_R41_LIMITS.maxTagLength))),
      maxTagsPerEntity: Math.max(1, Math.trunc(finite(limits.maxTagsPerEntity, DEFAULT_R41_LIMITS.maxTagsPerEntity))),
      maxPayloadDepth: Math.max(1, Math.trunc(finite(limits.maxPayloadDepth, DEFAULT_R41_LIMITS.maxPayloadDepth))),
      maxNumericMagnitude: Math.max(1, finite(limits.maxNumericMagnitude, DEFAULT_R41_LIMITS.maxNumericMagnitude)),
      maxPositionMagnitude: Math.max(1, finite(limits.maxPositionMagnitude, DEFAULT_R41_LIMITS.maxPositionMagnitude)),
    });
  }

  validateConfig(config: RuntimeConfig): IntegrityReport {
    const issues: IntegrityIssue[] = [];
    if (config.seed !== Math.trunc(config.seed)) issues.push(issue('seed-integer', 'Seed must be an integer.', 'critical', 'seed'));
    if (config.fixedStepSeconds < 1 / 240 || config.fixedStepSeconds > 0.25) issues.push(issue('fixed-step-range', 'Fixed simulation step is outside the supported range.', 'critical', 'fixedStepSeconds'));
    if (config.maxEntities < 1) issues.push(issue('entity-capacity', 'Entity capacity must be positive.', 'critical', 'maxEntities'));
    if (config.maxCommandsPerTick < 1) issues.push(issue('command-capacity', 'Command capacity must be positive.', 'critical', 'maxCommandsPerTick'));
    if (!Array.isArray(config.frameBudgets) || config.frameBudgets.length !== 8) issues.push(issue('budget-shape', 'All eight work-class budgets must be present.', 'critical', 'frameBudgets'));
    return finalize(issues);
  }

  validateEntity(entity: Entity): IntegrityReport {
    const issues: IntegrityIssue[] = [];
    if (!entity.id || entity.id.length > this.limits.maxEntityIdLength) issues.push(issue('entity-id', 'Entity id is missing or too long.', 'critical', 'id'));
    if (entity.tags.length > this.limits.maxTagsPerEntity) issues.push(issue('entity-tags', 'Entity has too many tags.', 'warning', 'tags'));
    for (let index = 0; index < entity.tags.length; index += 1) {
      if (entity.tags[index] && entity.tags[index]!.length > this.limits.maxTagLength) {
        issues.push(issue('tag-length', 'Entity tag is too long.', 'warning', 'tags[' + index + ']'));
      }
    }
    this.validateVec3(entity.transform.position, issues, 'transform.position', this.limits.maxPositionMagnitude);
    this.validateVec3(entity.velocity, issues, 'velocity', this.limits.maxNumericMagnitude);
    this.validateFinite(entity.health, issues, 'health');
    this.validateFinite(entity.stamina, issues, 'stamina');
    this.validatePayload(entity.data, issues, 'data', 0);
    return finalize(issues);
  }

  validateCommand(command: CommandEnvelope): IntegrityReport {
    const issues: IntegrityIssue[] = [];
    if (!command.id || command.id.length > 160) issues.push(issue('command-id', 'Command id is invalid.', 'critical', 'id'));
    if (!command.entityId || command.entityId.length > this.limits.maxEntityIdLength) issues.push(issue('command-entity', 'Command entity id is invalid.', 'critical', 'entityId'));
    if (command.tick < 0 || !Number.isSafeInteger(command.tick)) issues.push(issue('command-tick', 'Command tick is invalid.', 'critical', 'tick'));
    if (command.sequence < 0 || !Number.isSafeInteger(command.sequence)) issues.push(issue('command-sequence', 'Command sequence is invalid.', 'critical', 'sequence'));
    this.validatePayload(command.payload, issues, 'payload', 0);
    return finalize(issues);
  }

  validateWorld(snapshot: WorldSnapshot): IntegrityReport {
    const issues: IntegrityIssue[] = [];
    if (snapshot.version !== R41_VERSION) issues.push(issue('world-version', 'World snapshot schema is incompatible.', 'critical', 'version'));
    if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0) issues.push(issue('world-tick', 'World tick is invalid.', 'critical', 'tick'));
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) issues.push(issue('world-revision', 'World revision is invalid.', 'critical', 'revision'));
    if (snapshot.entities.length > 100_000) issues.push(issue('world-entity-count', 'World entity count exceeds hard safety limit.', 'critical', 'entities'));
    for (const entity of snapshot.entities.slice(0, 100_000)) {
      const report = this.validateEntity(entity);
      issues.push(...report.issues.map(value => Object.freeze({
        ...value,
        path: 'entities/' + entity.id + '/' + value.path,
      })));
    }
    const expected = stableHash({
      version: snapshot.version,
      tick: snapshot.tick,
      revision: snapshot.revision,
      seed: snapshot.seed,
      entities: snapshot.entities,
      flags: snapshot.flags,
      values: snapshot.values,
    });
    if (expected !== snapshot.checksum) issues.push(issue('world-checksum', 'World checksum does not match canonical content.', 'critical', 'checksum'));
    return finalize(issues);
  }

  validateRuntimeSnapshot(snapshot: RuntimeSnapshot): IntegrityReport {
    const issues: IntegrityIssue[] = [];
    if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0) issues.push(issue('snapshot-tick', 'Runtime tick is invalid.', 'critical', 'tick'));
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) issues.push(issue('snapshot-revision', 'Runtime revision is invalid.', 'critical', 'revision'));
    if (snapshot.entities < 0 || snapshot.activeEntities < 0 || snapshot.activeEntities > snapshot.entities) issues.push(issue('snapshot-entity-count', 'Runtime entity counts are inconsistent.', 'critical', 'entities'));
    if (snapshot.telemetry.frameMs < 0 || !Number.isFinite(snapshot.telemetry.frameMs)) issues.push(issue('snapshot-frame-time', 'Runtime frame time is invalid.', 'critical', 'telemetry.frameMs'));
    if (snapshot.render.scale < 0.35 || snapshot.render.scale > 1.2) issues.push(issue('snapshot-scale', 'Render scale is outside the governed range.', 'warning', 'render.scale'));
    return finalize(issues);
  }

  sanitizeVector(vector: Vec3): Vec3 {
    return {
      x: clamp(finite(vector.x), -this.limits.maxPositionMagnitude, this.limits.maxPositionMagnitude),
      y: clamp(finite(vector.y), -this.limits.maxPositionMagnitude, this.limits.maxPositionMagnitude),
      z: clamp(finite(vector.z), -this.limits.maxPositionMagnitude, this.limits.maxPositionMagnitude),
    };
  }

  safeModeFor(report: IntegrityReport, current: RuntimeMode): RuntimeMode {
    if (report.issues.some(value => value.severity === 'critical')) return current === 'disposed' ? 'disposed' : 'faulted';
    if (report.issues.some(value => value.severity === 'warning')) return current === 'running' ? 'degraded' : current;
    return current;
  }

  digest(report: IntegrityReport): number {
    return stableHash({
      ok: report.ok,
      checksum: report.checksum,
      issues: report.issues,
    });
  }

  private validateVec3(vector: Vec3, issues: IntegrityIssue[], path: string, magnitude: number): void {
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = vector[axis];
      if (!Number.isFinite(value)) issues.push(issue('vector-finite', 'Vector component is not finite.', 'critical', path + '.' + axis));
      else if (Math.abs(value) > magnitude) issues.push(issue('vector-range', 'Vector component exceeds safety magnitude.', 'warning', path + '.' + axis));
    }
  }

  private validateFinite(value: number, issues: IntegrityIssue[], path: string): void {
    if (!Number.isFinite(value)) issues.push(issue('number-finite', 'Numeric value is not finite.', 'critical', path));
    else if (Math.abs(value) > this.limits.maxNumericMagnitude) issues.push(issue('number-range', 'Numeric value exceeds safety magnitude.', 'warning', path));
  }

  private validatePayload(value: unknown, issues: IntegrityIssue[], path: string, depth: number): void {
    if (depth > this.limits.maxPayloadDepth) {
      issues.push(issue('payload-depth', 'Payload nesting exceeds the safety limit.', 'critical', path || 'payload'));
      return;
    }
    if (value === null) return;
    if (typeof value === 'number') {
      this.validateFinite(value, issues, path);
      return;
    }
    if (typeof value === 'string') {
      if (value.length > 4096) issues.push(issue('payload-string', 'Payload string exceeds size limit.', 'warning', path));
      return;
    }
    if (typeof value === 'boolean') return;
    if (Array.isArray(value)) {
      if (value.length > 2048) issues.push(issue('payload-array', 'Payload array exceeds size limit.', 'warning', path));
      value.slice(0, 2048).forEach((item, index) => this.validatePayload(item, issues, path + '[' + index + ']', depth + 1));
      return;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 512) issues.push(issue('payload-keys', 'Payload object contains too many keys.', 'warning', path));
      for (const [key, item] of entries.slice(0, 512)) {
        if (key.length > 128) issues.push(issue('payload-key', 'Payload key exceeds length limit.', 'warning', path + '.' + key));
        this.validatePayload(item, issues, path + '.' + key, depth + 1);
      }
    }
  }
}

function issue(code: string, message: string, severity: 'warning' | 'critical', path: string): IntegrityIssue {
  return Object.freeze({ code, message, severity, path });
}

function finalize(issues: readonly IntegrityIssue[]): IntegrityReport {
  const normalized = Object.freeze([...issues].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)));
  return Object.freeze({
    ok: !normalized.some(issueValue => issueValue.severity === 'critical'),
    issues: normalized,
    checksum: stableHash(normalized),
  });
}
