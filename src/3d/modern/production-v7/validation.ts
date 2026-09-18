import type { ActorComponentSetV7, InputCommandV7, RuntimeCommandV7, WorldSnapshotV7 } from './types.ts';
import { clampV7, isFiniteVec3V7 } from './types.ts';

export interface ValidationLimitsV7 {
  readonly maxStringLength: number;
  readonly maxActions: number;
  readonly maxTags: number;
  readonly maxEntities: number;
  readonly maxDeltas: number;
  readonly maxCoordinate: number;
  readonly maxHealth: number;
}

export const DEFAULT_VALIDATION_LIMITS_V7: ValidationLimitsV7 = Object.freeze({
  maxStringLength: 128, maxActions: 16, maxTags: 64, maxEntities: 20_000,
  maxDeltas: 20_000, maxCoordinate: 10_000_000, maxHealth: 1_000_000,
});

export interface ValidationFailureV7 {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationReportV7 {
  readonly ok: boolean;
  readonly failures: readonly ValidationFailureV7[];
  readonly checked: number;
}

const failure = (path: string, code: string, message: string): ValidationFailureV7 => Object.freeze({ path, code, message });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const validNumber = (value: unknown, min: number, max: number): boolean => finite(value) && value >= min && value <= max;

export class RuntimeValidatorV7 {
  readonly #limits: ValidationLimitsV7;
  constructor(limits: Partial<ValidationLimitsV7> = {}) { this.#limits = Object.freeze({ ...DEFAULT_VALIDATION_LIMITS_V7, ...limits }); }

  validateInput(input: unknown): ValidationReportV7 {
    const failures: ValidationFailureV7[] = [];
    if (!input || typeof input !== 'object') return { ok: false, failures: [failure('$', 'type', 'input must be an object')], checked: 1 };
    const value = input as Partial<InputCommandV7>;
    if (!validNumber(value.sequence, 0, 0x7fffffff) || !Number.isInteger(value.sequence)) failures.push(failure('sequence', 'integer', 'sequence must be a non-negative integer'));
    if (!validNumber(value.tick, 0, 0x7fffffff) || !Number.isInteger(value.tick)) failures.push(failure('tick', 'integer', 'tick must be a non-negative integer'));
    this.#validateVec(failures, 'move', value.move);
    if (!value.look || !validNumber(value.look.yaw, -Math.PI * 2, Math.PI * 2) || !validNumber(value.look.pitch, -Math.PI * 0.51, Math.PI * 0.51)) failures.push(failure('look', 'range', 'look yaw/pitch outside accepted range'));
    if (!Array.isArray(value.actions) || value.actions.length > this.#limits.maxActions) failures.push(failure('actions', 'length', 'too many actions'));
    else value.actions.forEach((action, index) => { if (!text(action, this.#limits.maxStringLength)) failures.push(failure(`actions[${index}]`, 'text', 'invalid action text')); });
    return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures), checked: 1 + failures.length });
  }

  validateCommand(command: unknown): ValidationReportV7 {
    const failures: ValidationFailureV7[] = [];
    if (!command || typeof command !== 'object') return { ok: false, failures: [failure('$', 'type', 'command must be an object')], checked: 1 };
    const value = command as Partial<RuntimeCommandV7>;
    if (!['spawn', 'despawn', 'move', 'damage', 'heal', 'interest', 'tag', 'mode'].includes(String(value.type))) failures.push(failure('type', 'enum', 'unsupported command type'));
    if ('id' in value && (!Number.isInteger(value.id) || !validNumber(value.id, 0, 0x7fffffff))) failures.push(failure('id', 'integer', 'entity id invalid'));
    if (value.type === 'spawn') {
      if (!text(value.archetype, this.#limits.maxStringLength)) failures.push(failure('archetype', 'text', 'invalid archetype'));
      this.#validateComponents(failures, 'components', value.components);
    }
    if (value.type === 'move') {
      this.#validateVec(failures, 'position', value.position);
      this.#validateVec(failures, 'velocity', value.velocity);
    }
    if (value.type === 'damage' || value.type === 'heal') {
      if (!validNumber(value.amount, 0, this.#limits.maxHealth)) failures.push(failure('amount', 'range', 'invalid resource amount'));
    }
    if (value.type === 'interest') {
      if (!validNumber(value.priority, -1000, 1000)) failures.push(failure('priority', 'range', 'invalid interest priority'));
      if (![0, 1, 2, 3].includes(Number(value.simulationLod)) || ![0, 1, 2, 3].includes(Number(value.renderLod))) failures.push(failure('lod', 'enum', 'invalid LOD'));
    }
    if (value.type === 'tag' && !text(value.tag, this.#limits.maxStringLength)) failures.push(failure('tag', 'text', 'invalid tag'));
    return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures), checked: 1 + failures.length });
  }

  validateSnapshot(snapshot: unknown): ValidationReportV7 {
    const failures: ValidationFailureV7[] = [];
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, failures: [failure('$', 'type', 'snapshot must be an object')], checked: 1 };
    const value = snapshot as Partial<WorldSnapshotV7>;
    if (!validNumber(value.tick, 0, 0x7fffffff) || !Number.isInteger(value.tick)) failures.push(failure('tick', 'integer', 'invalid tick'));
    if (!validNumber(value.revision, 0, 0x7fffffff) || !Number.isInteger(value.revision)) failures.push(failure('revision', 'integer', 'invalid revision'));
    if (!Array.isArray(value.entities) || value.entities.length > this.#limits.maxEntities) failures.push(failure('entities', 'length', 'entity limit exceeded'));
    else value.entities.forEach((entity, index) => {
      if (!entity || typeof entity !== 'object') failures.push(failure(`entities[${index}]`, 'type', 'entity must be object'));
      else {
        if (!Number.isInteger(Number(entity.id)) || Number(entity.id) < 0) failures.push(failure(`entities[${index}].id`, 'integer', 'invalid entity id'));
        this.#validateComponents(failures, `entities[${index}].components`, entity.components);
      }
    });
    if (!Array.isArray(value.deltas) || value.deltas.length > this.#limits.maxDeltas) failures.push(failure('deltas', 'length', 'delta limit exceeded'));
    if (typeof value.checksum !== 'string' || value.checksum.length < 4) failures.push(failure('checksum', 'text', 'invalid checksum'));
    return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures), checked: (Array.isArray(value.entities) ? value.entities.length : 0) + (Array.isArray(value.deltas) ? value.deltas.length : 0) });
  }

  #validateVec(failures: ValidationFailureV7[], path: string, value: unknown): void {
    if (!value || typeof value !== 'object' || !isFiniteVec3V7(value as { x: number; y: number; z: number })) {
      failures.push(failure(path, 'vector', 'vector must contain finite x/y/z'));
      return;
    }
    const vec = value as { x: number; y: number; z: number };
    if (Math.max(Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z)) > this.#limits.maxCoordinate) failures.push(failure(path, 'range', 'coordinate exceeds safety limit'));
  }

  #validateComponents(failures: ValidationFailureV7[], path: string, value: unknown): void {
    if (!value || typeof value !== 'object') { failures.push(failure(path, 'type', 'components missing')); return; }
    const components = value as Partial<ActorComponentSetV7>;
    this.#validateVec(failures, `${path}.transform.position`, components.transform?.position);
    this.#validateVec(failures, `${path}.transform.scale`, components.transform?.scale);
    this.#validateVec(failures, `${path}.kinematics.velocity`, components.kinematics?.velocity);
    this.#validateVec(failures, `${path}.kinematics.acceleration`, components.kinematics?.acceleration);
    if (!validNumber(components.vital?.maxHealth, 0, this.#limits.maxHealth) || !validNumber(components.vital?.health, 0, this.#limits.maxHealth)) failures.push(failure(`${path}.vital.health`, 'range', 'invalid health'));
    if (Array.isArray(components.tags) && components.tags.length > this.#limits.maxTags) failures.push(failure(`${path}.tags`, 'length', 'too many tags'));
    if (components.interest && !validNumber(components.interest.priority, -1000, 1000)) failures.push(failure(`${path}.interest.priority`, 'range', 'invalid priority'));
  }
}

export const validateRuntimeCommandV7 = (command: unknown): ValidationReportV7 => new RuntimeValidatorV7().validateCommand(command);
export const sanitizePriorityV7 = (value: number): number => clampV7(Number.isFinite(value) ? value : 0, -1000, 1000);
