/**
 * R35 interaction registry.
 *
 * Interactions are resolved by deterministic priority, distance and identifier
 * ordering. A renderer can consume the prompt state while gameplay keeps the
 * authoritative validation and cooldown rules here.
 */
import type { EntityId, Vec3 } from '../types.ts';

export type InteractionKindR35 =
  | 'pickup'
  | 'talk'
  | 'open'
  | 'use'
  | 'craft'
  | 'inspect'
  | 'enter'
  | 'rest'
  | 'quest'
  | 'custom';

export interface InteractionActorR35 {
  readonly entityId: EntityId;
  readonly position: Vec3;
  readonly tags: ReadonlySet<string>;
}

export interface InteractionDefinitionR35 {
  readonly id: string;
  readonly kind: InteractionKindR35;
  readonly label: string;
  readonly range: number;
  readonly priority?: number;
  readonly cooldown?: number;
  readonly requiredTags?: readonly string[];
  readonly blockedTags?: readonly string[];
  readonly enabled?: boolean;
  readonly repeatable?: boolean;
}

export interface InteractionTargetR35 {
  readonly id: string;
  readonly entityId: EntityId;
  readonly position: Vec3;
  readonly definitionId: string;
  readonly state: Readonly<Record<string, string | number | boolean>>;
}

export interface InteractionCandidateR35 {
  readonly targetId: string;
  readonly definitionId: string;
  readonly kind: InteractionKindR35;
  readonly label: string;
  readonly distance: number;
  readonly priority: number;
}

export interface InteractionExecutionR35 {
  readonly ok: boolean;
  readonly targetId: string;
  readonly definitionId: string;
  readonly reason?: string;
  readonly candidate?: InteractionCandidateR35;
}

export interface InteractionSnapshotR35 {
  readonly version: 1;
  readonly sequence: number;
  readonly cooldowns: readonly {
    readonly definitionId: string;
    readonly targetId: string;
    readonly remaining: number;
  }[];
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function finiteRange(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function sortedStrings(values: readonly string[] | undefined): readonly string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

export class InteractionAuthorityR35 {
  #definitions = new Map<string, InteractionDefinitionR35>();
  #targets = new Map<string, InteractionTargetR35>();
  #cooldowns = new Map<string, number>();
  #sequence = 0;

  registerDefinition(definition: InteractionDefinitionR35): void {
    if (!definition.id.trim()) throw new Error('interaction id required');
    if (!definition.label.trim()) throw new Error('interaction label required');

    this.#definitions.set(definition.id, {
      ...definition,
      range: finiteRange(definition.range),
      priority: Math.floor(definition.priority ?? 0),
      cooldown:
        definition.cooldown === undefined
          ? undefined
          : Math.max(0, Number(definition.cooldown) || 0),
      requiredTags: sortedStrings(definition.requiredTags),
      blockedTags: sortedStrings(definition.blockedTags),
      enabled: definition.enabled !== false,
      repeatable: definition.repeatable !== false,
    });
  }

  registerTarget(target: InteractionTargetR35): void {
    if (!target.id.trim()) throw new Error('interaction target id required');
    if (!target.entityId) throw new Error('interaction target entity required');
    if (!this.#definitions.has(target.definitionId)) {
      throw new Error('unknown interaction definition: ' + target.definitionId);
    }
    this.#targets.set(target.id, {
      ...target,
      state: { ...target.state },
    });
  }

  unregisterTarget(targetId: string): boolean {
    return this.#targets.delete(targetId);
  }

  updateTarget(
    targetId: string,
    update: Partial<Omit<InteractionTargetR35, 'id'>>,
  ): boolean {
    const target = this.#targets.get(targetId);
    if (!target) return false;
    this.#targets.set(targetId, {
      ...target,
      ...update,
      state: update.state ? { ...update.state } : target.state,
    });
    return true;
  }

  clearTargets(): void {
    this.#targets.clear();
  }

  get definitions(): readonly InteractionDefinitionR35[] {
    return [...this.#definitions.values()].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
  }

  get targets(): readonly InteractionTargetR35[] {
    return [...this.#targets.values()].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
  }

  private tagsAllowed(
    definition: InteractionDefinitionR35,
    actor: InteractionActorR35,
  ): boolean {
    const tags = actor.tags;
    for (const required of definition.requiredTags ?? []) {
      if (!tags.has(required)) return false;
    }
    for (const blocked of definition.blockedTags ?? []) {
      if (tags.has(blocked)) return false;
    }
    return true;
  }

  private cooldownKey(targetId: string, definitionId: string): string {
    return targetId + '|' + definitionId;
  }

  private candidateFor(
    actor: InteractionActorR35,
    target: InteractionTargetR35,
  ): InteractionCandidateR35 | null {
    const definition = this.#definitions.get(target.definitionId);
    if (!definition || definition.enabled === false) return null;
    if (!this.tagsAllowed(definition, actor)) return null;

    const distance = Math.sqrt(distanceSquared(actor.position, target.position));
    if (distance > definition.range) return null;

    const cooldown = this.#cooldowns.get(
      this.cooldownKey(target.id, definition.id),
    );
    if (cooldown !== undefined && cooldown > 0) return null;

    return {
      targetId: target.id,
      definitionId: definition.id,
      kind: definition.kind,
      label: definition.label,
      distance: Number(distance.toFixed(6)),
      priority: definition.priority ?? 0,
    };
  }

  query(
    actor: InteractionActorR35,
    limit = 8,
  ): readonly InteractionCandidateR35[] {
    const maxResults = Math.max(1, Math.floor(limit));
    const candidates: InteractionCandidateR35[] = [];

    for (const target of this.#targets.values()) {
      const candidate = this.candidateFor(actor, target);
      if (candidate) candidates.push(candidate);
    }

    candidates.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.distance - b.distance ||
        a.targetId.localeCompare(b.targetId),
    );

    return candidates.slice(0, maxResults);
  }

  nearest(
    actor: InteractionActorR35,
  ): InteractionCandidateR35 | null {
    return this.query(actor, 1)[0] ?? null;
  }

  execute(
    actor: InteractionActorR35,
    targetId: string,
  ): InteractionExecutionR35 {
    const target = this.#targets.get(targetId);
    if (!target) {
      return {
        ok: false,
        targetId,
        definitionId: '',
        reason: 'interaction target not found',
      };
    }

    const candidate = this.candidateFor(actor, target);
    if (!candidate) {
      return {
        ok: false,
        targetId,
        definitionId: target.definitionId,
        reason: 'interaction is unavailable',
      };
    }

    const definition = this.#definitions.get(candidate.definitionId);
    if (!definition) {
      return {
        ok: false,
        targetId,
        definitionId: candidate.definitionId,
        reason: 'interaction definition missing',
      };
    }

    this.#sequence += 1;
    if (definition.repeatable !== false && definition.cooldown) {
      this.#cooldowns.set(
        this.cooldownKey(targetId, definition.id),
        definition.cooldown,
      );
    }

    if (definition.repeatable === false) {
      this.#targets.delete(targetId);
    }

    return {
      ok: true,
      targetId,
      definitionId: definition.id,
      candidate,
    };
  }

  tick(deltaSeconds: number): void {
    const delta = Math.max(
      0,
      Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
    );
    for (const [key, value] of this.#cooldowns) {
      const next = Math.max(0, value - delta);
      if (next === 0) this.#cooldowns.delete(key);
      else this.#cooldowns.set(key, Number(next.toFixed(6)));
    }
  }

  canExecute(
    actor: InteractionActorR35,
    targetId: string,
  ): boolean {
    const target = this.#targets.get(targetId);
    return target ? this.candidateFor(actor, target) !== null : false;
  }

  setEnabled(definitionId: string, enabled: boolean): boolean {
    const definition = this.#definitions.get(definitionId);
    if (!definition) return false;
    this.#definitions.set(definitionId, {
      ...definition,
      enabled,
    });
    return true;
  }

  cooldownFor(targetId: string, definitionId: string): number {
    return this.#cooldowns.get(this.cooldownKey(targetId, definitionId)) ?? 0;
  }

  snapshot(): InteractionSnapshotR35 {
    return {
      version: 1,
      sequence: this.#sequence,
      cooldowns: [...this.#cooldowns.entries()]
        .map(([key, remaining]) => {
          const divider = key.indexOf('|');
          return {
            targetId: key.slice(0, divider),
            definitionId: key.slice(divider + 1),
            remaining,
          };
        })
        .sort(
          (a, b) =>
            a.targetId.localeCompare(b.targetId) ||
            a.definitionId.localeCompare(b.definitionId),
        ),
    };
  }

  restore(snapshot: InteractionSnapshotR35): void {
    if (snapshot.version !== 1) throw new Error('unsupported interaction snapshot');
    this.#sequence = Math.max(0, Math.floor(snapshot.sequence));
    this.#cooldowns.clear();

    for (const cooldown of snapshot.cooldowns) {
      if (!this.#targets.has(cooldown.targetId)) continue;
      if (!this.#definitions.has(cooldown.definitionId)) continue;
      if (!Number.isFinite(cooldown.remaining) || cooldown.remaining <= 0) continue;
      this.#cooldowns.set(
        this.cooldownKey(cooldown.targetId, cooldown.definitionId),
        cooldown.remaining,
      );
    }
  }
}
