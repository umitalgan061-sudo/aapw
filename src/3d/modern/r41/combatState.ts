export type DamageType =
  | 'slash'
  | 'pierce'
  | 'blunt'
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'poison';

export interface Combatant {
  readonly id: string;
  readonly health: number;
  readonly stamina: number;
  readonly armor: number;
  readonly parryUntil: number;
  readonly staggerUntil: number;
}

export interface CombatEvent {
  readonly source: string;
  readonly target: string;
  readonly tick: number;
  readonly damage: number;
  readonly type: DamageType;
  readonly blocked: boolean;
  readonly parried: boolean;
  readonly critical: boolean;
}

export class CombatState {
  readonly maxHealth: number;
  readonly maxStamina: number;
  #actors =
    new Map<string, Combatant>();

  constructor(
    maxHealth = 100,
    maxStamina = 100,
  ) {
    this.maxHealth = Math.max(
      1,
      maxHealth,
    );
    this.maxStamina = Math.max(
      1,
      maxStamina,
    );
  }

  register(id: string): boolean {
    if (
      !id.trim()
      || this.#actors.has(id)
    ) {
      return false;
    }

    this.#actors.set(
      id,
      Object.freeze({
        id,
        health: this.maxHealth,
        stamina: this.maxStamina,
        armor: 0,
        parryUntil: -1,
        staggerUntil: -1,
      }),
    );
    return true;
  }

  setArmor(
    id: string,
    armor: number,
  ): boolean {
    const actor =
      this.#actors.get(id);
    if (!actor) {
      return false;
    }
    this.#actors.set(
      id,
      Object.freeze({
        ...actor,
        armor: Math.max(
          0,
          armor,
        ),
      }),
    );
    return true;
  }

  beginParry(
    id: string,
    tick: number,
    windowTicks = 8,
  ): boolean {
    const actor =
      this.#actors.get(id);
    if (!actor) {
      return false;
    }

    this.#actors.set(
      id,
      Object.freeze({
        ...actor,
        parryUntil:
          tick
          + Math.max(
            1,
            Math.trunc(
              windowTicks,
            ),
          ),
      }),
    );

    return true;
  }

  attack(
    source: string,
    target: string,
    tick: number,
    baseDamage: number,
    type: DamageType,
    critical = false,
  ): CombatEvent | null {
    const attacker =
      this.#actors.get(source);
    const defender =
      this.#actors.get(target);

    if (
      !attacker
      || !defender
      || defender.health <= 0
    ) {
      return null;
    }

    const parried =
      defender.parryUntil
      >= tick;
    const blocked =
      !parried
      && defender.armor > 0;
    const armorFactor =
      1 - Math.min(
        0.9,
        defender.armor / 100,
      );
    const damage =
      parried || blocked
        ? 0
        : Math.max(
          0,
          baseDamage,
        )
          * (critical ? 1.5 : 1)
          * armorFactor;

    this.#actors.set(
      target,
      Object.freeze({
        ...defender,
        health: Math.max(
          0,
          defender.health - damage,
        ),
        staggerUntil:
          parried
            ? tick + 8
            : defender.staggerUntil,
      }),
    );

    return Object.freeze({
      source,
      target,
      tick,
      damage,
      type,
      blocked,
      parried,
      critical,
    });
  }

  get(id: string): Combatant | null {
    return (
      this.#actors.get(id)
      ?? null
    );
  }

  all(): readonly Combatant[] {
    return Object.freeze(
      [...this.#actors.values()]
        .sort(
          (a, b) =>
            a.id.localeCompare(b.id),
        ),
    );
  }

  clear(): void {
    this.#actors.clear();
  }
}
