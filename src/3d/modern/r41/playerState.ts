import { stableHash } from './hash';

export interface PlayerState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
  readonly stamina: number;
  readonly grounded: boolean;
  readonly sprinting: boolean;
  readonly revision: number;
}
export interface PlayerPatch {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly yaw?: number;
  readonly health?: number;
  readonly stamina?: number;
  readonly grounded?: boolean;
  readonly sprinting?: boolean;
}
export class DeterministicPlayerState {
  #state: PlayerState;

  constructor(id = 'player') {
    this.#state = Object.freeze({
      id,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      health: 100,
      stamina: 100,
      grounded: true,
      sprinting: false,
      revision: 0,
    });
  }

  apply(
    patch: PlayerPatch,
  ): PlayerState {
    this.#state = Object.freeze({
      ...this.#state,
      ...patch,
      health: clamp(
        patch.health
          ?? this.#state.health,
        0,
        100,
      ),
      stamina: clamp(
        patch.stamina
          ?? this.#state.stamina,
        0,
        100,
      ),
      yaw: normalizeAngle(
        patch.yaw
          ?? this.#state.yaw,
      ),
      revision:
        this.#state.revision + 1,
    });
    return this.#state;
  }

  consumeStamina(
    amount: number,
  ): boolean {
    const cost = Math.max(0, amount);
    if (
      this.#state.stamina < cost
    ) {
      return false;
    }
    this.apply({
      stamina:
        this.#state.stamina - cost,
      sprinting: cost > 0
        ? this.#state.sprinting
        : false,
    });
    return true;
  }

  restoreStamina(
    amount: number,
  ): void {
    this.apply({
      stamina:
        this.#state.stamina
        + Math.max(0, amount),
    });
  }

  damage(amount: number): void {
    this.apply({
      health:
        this.#state.health
        - Math.max(0, amount),
    });
  }

  heal(amount: number): void {
    this.apply({
      health:
        this.#state.health
        + Math.max(0, amount),
    });
  }

  state(): PlayerState {
    return this.#state;
  }

  digest(): string {
    return stableHash(this.#state);
  }

  reset(): void {
    this.apply({
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      health: 100,
      stamina: 100,
      grounded: true,
      sprinting: false,
    });
  }
}
function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Number.isFinite(value)
    ? Math.max(
      min,
      Math.min(max, value),
    )
    : min;
}
function normalizeAngle(
  value: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const full = Math.PI * 2;
  return (
    (value % full + full) % full
  );
}
