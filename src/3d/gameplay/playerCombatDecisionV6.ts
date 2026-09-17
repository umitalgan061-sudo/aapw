import type { TickId } from '../modern/runtimeContractsV4';
import type { InputSnapshotV6, PlayerStateV6, Vec3V4 } from '../modern/typedSceneContractsV6';
import { validatePlayerV6 } from '../modern/typedSceneContractsV6';

export const PLAYER_COMBAT_ACTIONS_V6 = [
  'light',
  'heavy',
  'guard',
  'parry',
  'dodge',
  'ranged',
  'archery',
  'lock-on',
] as const;
export type PlayerCombatActionV6 = typeof PLAYER_COMBAT_ACTIONS_V6[number];
export type PlayerCombatOutcomeV6 =
  | 'accepted'
  | 'buffered'
  | 'rejected-resource'
  | 'rejected-state'
  | 'rejected-target'
  | 'completed'
  | 'interrupted';
export type PlayerCombatPhaseV6 = 'ready' | 'windup' | 'active' | 'recovery' | 'cooldown';

export interface CombatEquipmentStatsV6 {
  readonly attackPower?: number;
  readonly guardPower?: number;
  readonly poise?: number;
  readonly staminaCostMultiplier?: number;
  readonly reachMeters?: number;
  readonly weightKg?: number;
  readonly rangedPower?: number;
}

export interface CombatTargetV6 {
  readonly id: string;
  readonly position: Vec3V4;
  readonly priority?: number;
  readonly visible?: boolean;
  readonly alive?: boolean;
  readonly radiusMeters?: number;
}

export interface PlayerCombatDecisionConfigV6 {
  readonly light?: Partial<ActionTimingV6>;
  readonly heavy?: Partial<ActionTimingV6>;
  readonly ranged?: Partial<ActionTimingV6>;
  readonly archery?: Partial<ActionTimingV6>;
  readonly maxComboSteps?: number;
  readonly bufferLimit?: number;
  readonly parryWindowSeconds?: number;
  readonly dodgeIFrameStartSeconds?: number;
  readonly dodgeIFrameEndSeconds?: number;
  readonly guardStaminaCostPerSecond?: number;
  readonly parryStaminaCost?: number;
  readonly dodgeStaminaCost?: number;
  readonly lockOnMaxDistanceMeters?: number;
  readonly lockOnMaxAngleRadians?: number;
}

interface ActionTimingV6 {
  readonly durationSeconds: number;
  readonly activeStartSeconds: number;
  readonly activeEndSeconds: number;
  readonly staminaCost: number;
  readonly reachMeters: number;
  readonly damageScale: number;
  readonly poiseDamageScale: number;
  readonly crossFadeSeconds: number;
}

const DEFAULT_TIMINGS: Record<'light' | 'heavy' | 'ranged' | 'archery', ActionTimingV6> = {
  light: {
    durationSeconds: 0.44,
    activeStartSeconds: 0.14,
    activeEndSeconds: 0.26,
    staminaCost: 12,
    reachMeters: 1.65,
    damageScale: 1,
    poiseDamageScale: 0.9,
    crossFadeSeconds: 0.08,
  },
  heavy: {
    durationSeconds: 0.72,
    activeStartSeconds: 0.28,
    activeEndSeconds: 0.46,
    staminaCost: 24,
    reachMeters: 2.05,
    damageScale: 1.65,
    poiseDamageScale: 1.6,
    crossFadeSeconds: 0.1,
  },
  ranged: {
    durationSeconds: 0.62,
    activeStartSeconds: 0.24,
    activeEndSeconds: 0.38,
    staminaCost: 10,
    reachMeters: 18,
    damageScale: 1.2,
    poiseDamageScale: 0.55,
    crossFadeSeconds: 0.12,
  },
  archery: {
    durationSeconds: 0.84,
    activeStartSeconds: 0.34,
    activeEndSeconds: 0.56,
    staminaCost: 14,
    reachMeters: 42,
    damageScale: 1.45,
    poiseDamageScale: 0.75,
    crossFadeSeconds: 0.14,
  },
};

const DEFAULT_CONFIG: Required<Omit<PlayerCombatDecisionConfigV6, 'light' | 'heavy' | 'ranged' | 'archery'>> = Object.freeze({
  maxComboSteps: 3,
  bufferLimit: 8,
  parryWindowSeconds: 0.16,
  dodgeIFrameStartSeconds: 0.06,
  dodgeIFrameEndSeconds: 0.28,
  guardStaminaCostPerSecond: 11,
  parryStaminaCost: 8,
  dodgeStaminaCost: 28,
  lockOnMaxDistanceMeters: 24,
  lockOnMaxAngleRadians: Math.PI * 0.75,
});

const ACTION_ALIASES: Readonly<Record<string, PlayerCombatActionV6>> = Object.freeze({
  lightAttack: 'light',
  heavyAttack: 'heavy',
  block: 'guard',
  perfectGuard: 'parry',
  roll: 'dodge',
  bow: 'archery',
  lockOn: 'lock-on',
});

const ACTION_PRIORITY: Readonly<Record<PlayerCombatActionV6, number>> = Object.freeze({
  'lock-on': 90,
  parry: 80,
  guard: 70,
  dodge: 60,
  heavy: 50,
  light: 40,
  archery: 30,
  ranged: 20,
});

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const positive = (value: unknown, fallback: number): number => Math.max(0, finite(value, fallback));
const freezeVec = (value: Vec3V4): Vec3V4 => Object.freeze({ x: finite(value.x), y: finite(value.y), z: finite(value.z) });
const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return value;
};

const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export interface PlayerCombatAnimationIntentV6 {
  readonly layer: 'base' | 'upper-body' | 'lower-body' | 'additive-reaction';
  readonly action: PlayerCombatActionV6;
  readonly weight: number;
  readonly crossFadeSeconds: number;
  readonly interruptible: boolean;
}

export interface PlayerCombatHitboxIntentV6 {
  readonly active: boolean;
  readonly shape: 'capsule' | 'arc' | 'projectile';
  readonly reachMeters: number;
  readonly radiusMeters: number;
  readonly widthMeters: number;
  readonly angleRadians: number;
  readonly damageScale: number;
  readonly poiseDamageScale: number;
}

export interface PlayerCombatFeedbackIntentV6 {
  readonly cue: 'swing' | 'heavy-swing' | 'guard' | 'parry' | 'dodge' | 'ranged-release' | 'archery-release' | 'lock-on';
  readonly intensity: number;
  readonly durationSeconds: number;
  readonly channels: readonly ('vfx' | 'sfx' | 'haptic')[];
}

export interface PlayerCombatLockOnReceiptV6 {
  readonly action: 'lock-on';
  readonly targetId: string | null;
  readonly candidates: readonly string[];
  readonly score: number;
  readonly distanceMeters: number;
  readonly angleRadians: number;
}

export interface PlayerCombatDecisionReceiptV6 {
  readonly version: 6;
  readonly serial: number;
  readonly tick: TickId;
  readonly action: PlayerCombatActionV6;
  readonly outcome: PlayerCombatOutcomeV6;
  readonly phase: PlayerCombatPhaseV6;
  readonly comboStep: number;
  readonly buffered: readonly PlayerCombatActionV6[];
  readonly staminaCost: number;
  readonly attackPower: number;
  readonly guardPower: number;
  readonly poiseDamage: number;
  readonly targetId: string | null;
  readonly animation: readonly PlayerCombatAnimationIntentV6[];
  readonly hitbox: PlayerCombatHitboxIntentV6;
  readonly feedback: PlayerCombatFeedbackIntentV6 | null;
  readonly lockOn: PlayerCombatLockOnReceiptV6 | null;
  readonly checksum: string;
}

export interface PlayerCombatReplayCommandV6 {
  readonly action: string;
  readonly tick: number;
  readonly stamina: number;
  readonly alive: boolean;
}

export interface PlayerCombatReplayResultV6 {
  readonly receipts: readonly PlayerCombatDecisionReceiptV6[];
  readonly checksum: string;
}

export class PlayerCombatDecisionV6 {
  readonly config: Required<PlayerCombatDecisionConfigV6>;
  #serial = 0;
  #comboStep = 0;
  #currentAction: PlayerCombatActionV6 | null = null;
  #phase: PlayerCombatPhaseV6 = 'ready';
  #elapsed = 0;
  #remaining = 0;
  #active = false;
  #parryRemaining = 0;
  #buffer: PlayerCombatActionV6[] = [];
  #targetId: string | null = null;
  #disposed = false;

  constructor(config: PlayerCombatDecisionConfigV6 = {}) {
    const timings = {
      light: Object.freeze({ ...DEFAULT_TIMINGS.light, ...config.light }),
      heavy: Object.freeze({ ...DEFAULT_TIMINGS.heavy, ...config.heavy }),
      ranged: Object.freeze({ ...DEFAULT_TIMINGS.ranged, ...config.ranged }),
      archery: Object.freeze({ ...DEFAULT_TIMINGS.archery, ...config.archery }),
    };
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      ...timings,
    }) as Required<PlayerCombatDecisionConfigV6>;
  }

  submit(actionInput: string, player: PlayerStateV6, tick: TickId, targets: readonly CombatTargetV6[] = []): PlayerCombatDecisionReceiptV6 {
    if (this.#disposed) return this.#receipt('ready', this.#normalize(actionInput), 'rejected-state', tick, player, null, null);
    validatePlayerV6(player);
    const action = this.#normalize(actionInput);
    if (!action) return this.#receipt('ready', 'light', 'rejected-state', tick, player, null, null);

    if (action === 'lock-on') return this.#handleLockOn(player, tick, targets);
    if (!player.alive) return this.#receipt('ready', action, 'rejected-state', tick, player, null, null);

    const buffered = this.#isBusy();
    if (buffered) {
      if (this.#buffer.length >= this.config.bufferLimit) {
        this.#buffer.shift();
      }
      this.#buffer.push(action);
      return this.#receipt(this.#phase, action, 'buffered', tick, player, this.#targetId, null);
    }

    const outcome = this.#tryStart(action, player.stamina);
    if (outcome !== 'accepted') return this.#receipt('ready', action, outcome, tick, player, this.#targetId, null);
    return this.#receipt(this.#phase, action, outcome, tick, player, this.#targetId, null);
  }

  tick(player: PlayerStateV6, deltaSeconds: number, tick: TickId): PlayerCombatDecisionReceiptV6 | null {
    if (this.#disposed) return null;
    validatePlayerV6(player);
    const dt = clamp(finite(deltaSeconds, 1 / 60), 0, 0.1);
    this.#parryRemaining = Math.max(0, this.#parryRemaining - dt);
    if (!this.#currentAction) {
      if (this.#buffer.length === 0) return null;
      const next = this.#buffer.shift();
      if (!next) return null;
      const outcome = this.#tryStart(next, player.stamina);
      return this.#receipt('ready', next, outcome, tick, player, this.#targetId, null);
    }

    const timing = this.#timing(this.#currentAction);
    this.#elapsed += dt;
    this.#remaining = Math.max(0, this.#remaining - dt);
    const activeNow = this.#elapsed >= timing.activeStartSeconds && this.#elapsed < timing.activeEndSeconds;
    if (activeNow && !this.#active) {
      this.#active = true;
      this.#phase = 'active';
      return this.#receipt('active', this.#currentAction, 'accepted', tick, player, this.#targetId, null);
    }
    if (!activeNow && this.#active) {
      this.#active = false;
      this.#phase = 'recovery';
      return this.#receipt('recovery', this.#currentAction, 'accepted', tick, player, this.#targetId, null);
    }
    if (this.#remaining > 0) {
      this.#phase = this.#elapsed < timing.activeStartSeconds ? 'windup' : this.#phase;
      return null;
    }

    const finishedAction = this.#currentAction;
    this.#currentAction = null;
    this.#phase = 'ready';
    this.#active = false;
    this.#elapsed = 0;
    this.#remaining = 0;
    if (finishedAction === 'heavy') this.#comboStep = 0;
    return this.#receipt('ready', finishedAction, 'completed', tick, player, this.#targetId, null);
  }

  openParryWindow(): void {
    if (this.#disposed) return;
    this.#parryRemaining = clamp(this.config.parryWindowSeconds, 0, 1);
  }

  parryWindowOpen(): boolean {
    return this.#parryRemaining > 0;
  }

  dodgeIFrames(elapsedSeconds: number): boolean {
    return this.#currentAction === 'dodge'
      && this.#elapsed >= this.config.dodgeIFrameStartSeconds
      && this.#elapsed < this.config.dodgeIFrameEndSeconds
      && elapsedSeconds >= 0;
  }

  currentAction(): PlayerCombatActionV6 | null {
    return this.#currentAction;
  }

  phase(): PlayerCombatPhaseV6 {
    return this.#phase;
  }

  bufferedActions(): readonly PlayerCombatActionV6[] {
    return Object.freeze([...this.#buffer]);
  }

  reset(): void {
    if (this.#disposed) return;
    this.#serial = 0;
    this.#comboStep = 0;
    this.#currentAction = null;
    this.#phase = 'ready';
    this.#elapsed = 0;
    this.#remaining = 0;
    this.#active = false;
    this.#parryRemaining = 0;
    this.#buffer.length = 0;
    this.#targetId = null;
  }

  dispose(): void {
    this.reset();
    this.#disposed = true;
  }

  replay(player: PlayerStateV6, commands: readonly PlayerCombatReplayCommandV6[]): PlayerCombatReplayResultV6 {
    validatePlayerV6(player);
    this.reset();
    const receipts: PlayerCombatDecisionReceiptV6[] = [];
    for (const command of commands) {
      const receipt = this.submit(command.action, { ...player, stamina: clamp(finite(command.stamina, player.stamina), 0, player.maxStamina), alive: command.alive }, command.tick as TickId);
      receipts.push(receipt);
      const completion = this.tick(player, 1 / 60, command.tick as TickId);
      if (completion) receipts.push(completion);
    }
    const body = receipts.map((receipt) => ({
      serial: receipt.serial,
      tick: Number(receipt.tick),
      action: receipt.action,
      outcome: receipt.outcome,
      phase: receipt.phase,
      comboStep: receipt.comboStep,
      targetId: receipt.targetId,
    }));
    return Object.freeze({ receipts: Object.freeze(receipts), checksum: digest(body) });
  }

  private #normalize(actionInput: string): PlayerCombatActionV6 | null {
    const action = String(actionInput ?? '').trim();
    if ((PLAYER_COMBAT_ACTIONS_V6 as readonly string[]).includes(action)) return action as PlayerCombatActionV6;
    return ACTION_ALIASES[action] ?? null;
  }

  private #isBusy(): boolean {
    return this.#currentAction !== null;
  }

  private #timing(action: PlayerCombatActionV6): ActionTimingV6 {
    if (action === 'light') return this.config.light;
    if (action === 'heavy') return this.config.heavy;
    if (action === 'ranged') return this.config.ranged;
    if (action === 'archery') return this.config.archery;
    return {
      durationSeconds: action === 'dodge' ? 0.38 : action === 'parry' ? this.config.parryWindowSeconds : 0.001,
      activeStartSeconds: action === 'dodge' ? this.config.dodgeIFrameStartSeconds : 0,
      activeEndSeconds: action === 'dodge' ? this.config.dodgeIFrameEndSeconds : action === 'parry' ? this.config.parryWindowSeconds : 0.001,
      staminaCost: action === 'dodge' ? this.config.dodgeStaminaCost : action === 'parry' ? this.config.parryStaminaCost : 0,
      reachMeters: action === 'dodge' ? 1.1 : 0,
      damageScale: 0,
      poiseDamageScale: 0,
      crossFadeSeconds: 0.06,
    };
  }

  private #tryStart(action: PlayerCombatActionV6, stamina: number): PlayerCombatOutcomeV6 {
    if (action === 'lock-on') return 'accepted';
    const timing = this.#timing(action);
    const multiplier = positive((this.config as unknown as Record<string, unknown>).staminaCostMultiplier, 1);
    const cost = timing.staminaCost * (multiplier > 0 ? multiplier : 1);
    if (stamina < cost) return 'rejected-resource';
    if (action === 'guard' && this.#phase !== 'ready') return 'rejected-state';
    if (action === 'parry' && !this.parryWindowOpen()) return 'rejected-state';
    this.#currentAction = action;
    this.#phase = timing.durationSeconds <= 0.01 ? 'active' : 'windup';
    this.#elapsed = 0;
    this.#remaining = timing.durationSeconds;
    this.#active = this.#phase === 'active';
    if (action === 'light' || action === 'heavy') this.#comboStep = Math.min(this.config.maxComboSteps, this.#comboStep + 1);
    if (action === 'dodge') this.#comboStep = 0;
    return 'accepted';
  }

  private #handleLockOn(player: PlayerStateV6, tick: TickId, targets: readonly CombatTargetV6[]): PlayerCombatDecisionReceiptV6 {
    const yaw = player.yaw;
    const candidates = targets
      .filter((target) => target.alive !== false && target.visible !== false)
      .map((target) => {
        const dx = target.position.x - player.position.x;
        const dz = target.position.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        const targetYaw = Math.atan2(dx, dz);
        const angle = Math.abs(((targetYaw - yaw + Math.PI) % (Math.PI * 2)) - Math.PI);
        const score = (finite(target.priority) * 10) - distance - angle * 2;
        return { target, distance, angle, score };
      })
      .filter((entry) => entry.distance <= this.config.lockOnMaxDistanceMeters && entry.angle <= this.config.lockOnMaxAngleRadians)
      .sort((a, b) => b.score - a.score || a.distance - b.distance || a.target.id.localeCompare(b.target.id));
    const selected = candidates[0] ?? null;
    this.#targetId = selected?.target.id ?? null;
    return this.#receipt('ready', 'lock-on', selected ? 'accepted' : 'rejected-target', tick, player, this.#targetId, selected ? {
      action: 'lock-on',
      targetId: selected.target.id,
      candidates: Object.freeze(candidates.map((entry) => entry.target.id)),
      score: Number(selected.score.toFixed(5)),
      distanceMeters: Number(selected.distance.toFixed(4)),
      angleRadians: Number(selected.angle.toFixed(5)),
    } : {
      action: 'lock-on',
      targetId: null,
      candidates: Object.freeze([]),
      score: 0,
      distanceMeters: 0,
      angleRadians: 0,
    });
  }

  private #receipt(
    phase: PlayerCombatPhaseV6,
    action: PlayerCombatActionV6,
    outcome: PlayerCombatOutcomeV6,
    tick: TickId,
    player: PlayerStateV6,
    targetId: string | null,
    lockOn: PlayerCombatLockOnReceiptV6 | null,
  ): PlayerCombatDecisionReceiptV6 {
    const timing = this.#timing(action);
    const equipment: CombatEquipmentStatsV6 = {};
    const staminaCost = Number(timing.staminaCost.toFixed(4));
    const attackPower = Number((positive(equipment.attackPower, 1) * timing.damageScale).toFixed(4));
    const guardPower = Number((positive(equipment.guardPower, 1)).toFixed(4));
    const animation = this.#animation(action, timing, outcome);
    const hitbox = this.#hitbox(action, timing, phase);
    const feedback = this.#feedback(action, outcome);
    const base = {
      version: 6 as const,
      serial: ++this.#serial,
      tick,
      action,
      outcome,
      phase,
      comboStep: this.#comboStep,
      buffered: Object.freeze([...this.#buffer]),
      staminaCost,
      attackPower,
      guardPower,
      poiseDamage: Number((timing.poiseDamageScale * attackPower).toFixed(4)),
      targetId,
      animation: Object.freeze(animation),
      hitbox,
      feedback,
      lockOn,
    };
    const receipt = { ...base, checksum: digest(base) } as PlayerCombatDecisionReceiptV6;
    return deepFreeze(receipt);
  }

  private #animation(action: PlayerCombatActionV6, timing: ActionTimingV6, outcome: PlayerCombatOutcomeV6): PlayerCombatAnimationIntentV6[] {
    if (outcome.startsWith('rejected')) return [];
    const highImpact = action === 'heavy' || action === 'parry' || action === 'dodge';
    return [
      {
        layer: action === 'dodge' ? 'lower-body' : 'upper-body',
        action,
        weight: highImpact ? 1 : 0.85,
        crossFadeSeconds: clamp(timing.crossFadeSeconds, 0, 0.4),
        interruptible: action !== 'heavy',
      },
    ];
  }

  private #hitbox(action: PlayerCombatActionV6, timing: ActionTimingV6, phase: PlayerCombatPhaseV6): PlayerCombatHitboxIntentV6 {
    const active = phase === 'active' && timing.damageScale > 0;
    const shape = action === 'ranged' || action === 'archery' ? 'projectile' : 'capsule';
    return deepFreeze({
      active,
      shape,
      reachMeters: Number(clamp(timing.reachMeters, 0, 50).toFixed(4)),
      radiusMeters: action === 'heavy' ? 0.42 : 0.3,
      widthMeters: action === 'heavy' ? 1.15 : 0.8,
      angleRadians: action === 'heavy' ? Math.PI * 0.72 : Math.PI * 0.52,
      damageScale: Number(clamp(timing.damageScale, 0, 4).toFixed(4)),
      poiseDamageScale: Number(clamp(timing.poiseDamageScale, 0, 4).toFixed(4)),
    });
  }

  private #feedback(action: PlayerCombatActionV6, outcome: PlayerCombatOutcomeV6): PlayerCombatFeedbackIntentV6 | null {
    if (outcome.startsWith('rejected')) return null;
    const cue: PlayerCombatFeedbackIntentV6['cue'] = action === 'heavy'
      ? 'heavy-swing'
      : action === 'parry'
        ? 'parry'
        : action === 'guard'
          ? 'guard'
          : action === 'dodge'
            ? 'dodge'
            : action === 'ranged'
              ? 'ranged-release'
              : action === 'archery'
                ? 'archery-release'
                : action === 'lock-on'
                  ? 'lock-on'
                  : 'swing';
    const channels: readonly ('vfx' | 'sfx' | 'haptic')[] = action === 'guard' ? ['sfx', 'haptic'] : ['vfx', 'sfx', 'haptic'];
    return Object.freeze({ cue, intensity: action === 'heavy' ? 1 : 0.72, durationSeconds: action === 'dodge' ? 0.18 : 0.24, channels });
  }
}

export const createPlayerCombatDecisionV6 = (config: PlayerCombatDecisionConfigV6 = {}): PlayerCombatDecisionV6 => new PlayerCombatDecisionV6(config);

export const replayPlayerCombatDecisionV6 = (
  player: PlayerStateV6,
  commands: readonly PlayerCombatReplayCommandV6[],
  config: PlayerCombatDecisionConfigV6 = {},
): PlayerCombatReplayResultV6 => createPlayerCombatDecisionV6(config).replay(player, commands);

export function vectorToCombatTargetV6(id: string, position: Vec3V4, priority = 0): CombatTargetV6 {
  return deepFreeze({ id: String(id).slice(0, 64), position: freezeVec(position), priority });
}

export function commandFromInputV6(input: Pick<InputSnapshotV6, 'interact' | 'sprint'> & { readonly attack?: boolean; readonly heavy?: boolean; readonly guard?: boolean; }): PlayerCombatActionV6 | null {
  if (input.guard) return 'guard';
  if (input.heavy) return 'heavy';
  if (input.attack) return 'light';
  if (input.interact) return 'lock-on';
  if (input.sprint) return 'dodge';
  return null;
}
