
import { clamp, fail, ok, stableHash, type R35Id, type R35Result, type R35Vec3 } from './contracts';

export type InteractionKind =
  | 'talk'
  | 'inspect'
  | 'loot'
  | 'use'
  | 'open'
  | 'craft'
  | 'mount'
  | 'attack';

export interface InteractionDefinition {
  readonly id: R35Id;
  readonly kind: InteractionKind;
  readonly range: number;
  readonly priority: number;
  readonly cooldown: number;
  readonly tags: readonly string[];
  readonly requiredFlags?: readonly R35Id[];
}

export interface InteractionTarget {
  readonly id: R35Id;
  readonly position: R35Vec3;
  readonly definitions: readonly R35Id[];
  readonly enabled: boolean;
}

export interface InteractionCandidate {
  readonly targetId: R35Id;
  readonly interactionId: R35Id;
  readonly kind: InteractionKind;
  readonly distance: number;
  readonly priority: number;
  readonly score: number;
}

export class InteractionRuntimeR35 {
  #definitions = new Map<R35Id, InteractionDefinition>();
  #targets = new Map<R35Id, InteractionTarget>();
  #cooldowns = new Map<R35Id, number>();
  #flags = new Set<R35Id>();
  #tick = 0;

  register(definition: InteractionDefinition): R35Result<InteractionDefinition> {
    if (this.#definitions.has(definition.id)) {
      return fail('INTERACTION_DUPLICATE', 'Interaction id exists');
    }
    if (!definition.id || definition.range <= 0) {
      return fail('INTERACTION_INVALID', 'Interaction contract is invalid');
    }
    this.#definitions.set(
      definition.id,
      Object.freeze({
        ...definition,
        range: clamp(definition.range, 0.1, 1000),
        priority: clamp(Math.trunc(definition.priority), 0, 1000),
        cooldown: clamp(Math.trunc(definition.cooldown), 0, 3600),
        tags: Object.freeze([...definition.tags]),
        requiredFlags: Object.freeze([...(definition.requiredFlags ?? [])]),
      }),
    );
    return ok(definition);
  }

  registerTarget(target: InteractionTarget): boolean {
    if (this.#targets.has(target.id)) return false;
    if (!target.id) return false;
    this.#targets.set(
      target.id,
      Object.freeze({
        ...target,
        definitions: Object.freeze([...target.definitions]),
      }),
    );
    return true;
  }

  setEnabled(targetId: R35Id, enabled: boolean): boolean {
    const target = this.#targets.get(targetId);
    if (!target) return false;
    this.#targets.set(
      targetId,
      Object.freeze({
        ...target,
        enabled,
      }),
    );
    return true;
  }

  setFlag(flag: R35Id, enabled: boolean): void {
    if (enabled) this.#flags.add(flag);
    else this.#flags.delete(flag);
  }

  advance(ticks = 1): void {
    const count = clamp(Math.trunc(ticks), 1, 120);
    for (let index = 0; index < count; index += 1) {
      this.#tick += 1;
      for (const [key, value] of this.#cooldowns) {
        const next = value - 1;
        if (next <= 0) this.#cooldowns.delete(key);
        else this.#cooldowns.set(key, next);
      }
    }
  }

  candidates(
    origin: R35Vec3,
    radius: number,
    limit = 16,
  ): readonly InteractionCandidate[] {
    const safeRadius = clamp(radius, 0, 1000);
    const out: InteractionCandidate[] = [];
    for (const target of this.#targets.values()) {
      if (!target.enabled) continue;
      const distance = Math.hypot(
        origin.x - target.position.x,
        origin.y - target.position.y,
        origin.z - target.position.z,
      );
      if (distance > safeRadius) continue;
      for (const definitionId of target.definitions) {
        const definition = this.#definitions.get(definitionId);
        if (!definition) continue;
        if (distance > definition.range) continue;
        if ((this.#cooldowns.get(definition.id) ?? 0) > 0) continue;
        if (
          definition.requiredFlags?.some(
            (flag) => !this.#flags.has(flag),
          )
        ) {
          continue;
        }
        const score =
          definition.priority * 100
          + (1 - distance / Math.max(definition.range, 0.1)) * 50;
        out.push(
          Object.freeze({
            targetId: target.id,
            interactionId: definition.id,
            kind: definition.kind,
            distance,
            priority: definition.priority,
            score,
          }),
        );
      }
    }
    return Object.freeze(
      out
        .sort(
          (a, b) =>
            b.score - a.score
            || a.targetId.localeCompare(b.targetId)
            || a.interactionId.localeCompare(b.interactionId),
        )
        .slice(0, clamp(Math.trunc(limit), 1, 64)),
    );
  }

  activate(
    targetId: R35Id,
    interactionId: R35Id,
    origin: R35Vec3,
  ): R35Result<InteractionCandidate> {
    const definition = this.#definitions.get(interactionId);
    const target = this.#targets.get(targetId);
    if (!definition || !target) {
      return fail('INTERACTION_MISSING', 'Interaction or target is missing');
    }
    if (!target.enabled) {
      return fail('INTERACTION_DISABLED', 'Target is disabled');
    }
    const distance = Math.hypot(
      origin.x - target.position.x,
      origin.y - target.position.y,
      origin.z - target.position.z,
    );
    if (distance > definition.range) {
      return fail('INTERACTION_RANGE', 'Target is out of range');
    }
    if ((this.#cooldowns.get(interactionId) ?? 0) > 0) {
      return fail('INTERACTION_COOLDOWN', 'Interaction is cooling down');
    }
    if (
      definition.requiredFlags?.some(
        (flag) => !this.#flags.has(flag),
      )
    ) {
      return fail('INTERACTION_LOCKED', 'Required flag is not set');
    }
    this.#cooldowns.set(interactionId, definition.cooldown);
    const candidate: InteractionCandidate = Object.freeze({
      targetId,
      interactionId,
      kind: definition.kind,
      distance,
      priority: definition.priority,
      score:
        definition.priority * 100
        + (1 - distance / definition.range) * 50,
    });
    return ok(candidate);
  }

  digest(): string {
    return stableHash({
      tick: this.#tick,
      targets: [...this.#targets.values()].sort((a, b) => a.id.localeCompare(b.id)),
      cooldowns: [...this.#cooldowns.entries()].sort(),
      flags: [...this.#flags].sort(),
    });
  }

  reset(): void {
    this.#cooldowns.clear();
    this.#flags.clear();
    this.#tick = 0;
  }
}
