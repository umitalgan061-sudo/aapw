import type { TickId } from '../modern/runtimeContractsV4';
import type { InputSnapshotV6, PlayerStateV6, Vec3V4 } from '../modern/typedSceneContractsV6';
import { validatePlayerV6 } from '../modern/typedSceneContractsV6';

export const PLAYER_COMBAT_ACTIONS_V6 = [
  'light', 'heavy', 'guard', 'parry', 'dodge', 'ranged', 'archery', 'lock-on',
] as const;
export type PlayerCombatActionV6 = typeof PLAYER_COMBAT_ACTIONS_V6[number];
export type PlayerCombatOutcomeV6 =
  | 'accepted' | 'buffered' | 'rejected-resource' | 'rejected-state'
  | 'rejected-target' | 'completed';
export type PlayerCombatPhaseV6 = 'ready' | 'windup' | 'active' | 'recovery';

export interface CombatEquipmentStatsV6 {
  readonly attackPower?: number;
  readonly guardPower?: number;
  readonly staminaCostMultiplier?: number;
  readonly reachMeters?: number;
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

interface ResolvedConfigV6 {
  readonly light: ActionTimingV6;
  readonly heavy: ActionTimingV6;
  readonly ranged: ActionTimingV6;
  readonly archery: ActionTimingV6;
  readonly maxComboSteps: number;
  readonly bufferLimit: number;
  readonly parryWindowSeconds: number;
  readonly dodgeIFrameStartSeconds: number;
  readonly dodgeIFrameEndSeconds: number;
  readonly guardStaminaCostPerSecond: number;
  readonly parryStaminaCost: number;
  readonly dodgeStaminaCost: number;
  readonly lockOnMaxDistanceMeters: number;
  readonly lockOnMaxAngleRadians: number;
}

const DEFAULT_TIMINGS: Record<'light' | 'heavy' | 'ranged' | 'archery', ActionTimingV6> = {
  light: { durationSeconds: 0.44, activeStartSeconds: 0.14, activeEndSeconds: 0.26, staminaCost: 12, reachMeters: 1.65, damageScale: 1, poiseDamageScale: 0.9, crossFadeSeconds: 0.08 },
  heavy: { durationSeconds: 0.72, activeStartSeconds: 0.28, activeEndSeconds: 0.46, staminaCost: 24, reachMeters: 2.05, damageScale: 1.65, poiseDamageScale: 1.6, crossFadeSeconds: 0.1 },
  ranged: { durationSeconds: 0.62, activeStartSeconds: 0.24, activeEndSeconds: 0.38, staminaCost: 10, reachMeters: 18, damageScale: 1.2, poiseDamageScale: 0.55, crossFadeSeconds: 0.12 },
  archery: { durationSeconds: 0.84, activeStartSeconds: 0.34, activeEndSeconds: 0.56, staminaCost: 14, reachMeters: 42, damageScale: 1.45, poiseDamageScale: 0.75, crossFadeSeconds: 0.14 },
};

const ALIASES: Readonly<Record<string, PlayerCombatActionV6>> = Object.freeze({
  lightAttack: 'light', heavyAttack: 'heavy', block: 'guard', perfectGuard: 'parry',
  roll: 'dodge', bow: 'archery', lockOn: 'lock-on',
});

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const positive = (value: unknown, fallback = 0): number => Math.max(0, finite(value, fallback));
const freezeVec = (value: Vec3V4): Vec3V4 => Object.freeze({ x: finite(value.x), y: finite(value.y), z: finite(value.z) });
const freezeDeep = <T>(value: T): T => {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === 'object') freezeDeep(child);
  return value;
};
const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export interface PlayerCombatAnimationIntentV6 {
  readonly layer: 'upper-body' | 'lower-body';
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

export interface PlayerCombatContextV6 {
  readonly targets?: readonly CombatTargetV6[];
  readonly equipment?: CombatEquipmentStatsV6;
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
  readonly config: ResolvedConfigV6;
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
    this.config = Object.freeze({
      light: Object.freeze({ ...DEFAULT_TIMINGS.light, ...config.light }),
      heavy: Object.freeze({ ...DEFAULT_TIMINGS.heavy, ...config.heavy }),
      ranged: Object.freeze({ ...DEFAULT_TIMINGS.ranged, ...config.ranged }),
      archery: Object.freeze({ ...DEFAULT_TIMINGS.archery, ...config.archery }),
      maxComboSteps: Math.max(1, Math.floor(finite(config.maxComboSteps, 3))),
      bufferLimit: Math.max(1, Math.floor(finite(config.bufferLimit, 8))),
      parryWindowSeconds: clamp(finite(config.parryWindowSeconds, 0.16), 0, 1),
      dodgeIFrameStartSeconds: clamp(finite(config.dodgeIFrameStartSeconds, 0.06), 0, 1),
      dodgeIFrameEndSeconds: clamp(finite(config.dodgeIFrameEndSeconds, 0.28), 0, 1),
      guardStaminaCostPerSecond: positive(config.guardStaminaCostPerSecond, 11),
      parryStaminaCost: positive(config.parryStaminaCost, 8),
      dodgeStaminaCost: positive(config.dodgeStaminaCost, 28),
      lockOnMaxDistanceMeters: clamp(finite(config.lockOnMaxDistanceMeters, 24), 0, 100),
      lockOnMaxAngleRadians: clamp(finite(config.lockOnMaxAngleRadians, Math.PI * 0.75), 0, Math.PI),
    });
  }

  submit(inputAction: string, player: PlayerStateV6, tick: TickId, context: PlayerCombatContextV6 = {}): PlayerCombatDecisionReceiptV6 {
    const action = normalizePlayerCombatActionV6(inputAction);
    if (this.#disposed) return this.#receipt(action ?? 'light', 'rejected-state', tick, player, context, 'ready');
    validatePlayerV6(player);
    if (!action) return this.#receipt('light', 'rejected-state', tick, player, context, 'ready');
    if (action === 'lock-on') return this.#lockOn(player, tick, context.targets ?? []);
    if (!player.alive) return this.#receipt(action, 'rejected-state', tick, player, context, 'ready');

    if (this.#currentAction) {
      if (this.#buffer.length >= this.config.bufferLimit) this.#buffer.shift();
      this.#buffer.push(action);
      return this.#receipt(action, 'buffered', tick, player, context, this.#phase);
    }

    const outcome = this.#tryStart(action, player.stamina);
    return this.#receipt(action, outcome, tick, player, context, this.#phase);
  }

  tick(player: PlayerStateV6, deltaSeconds: number, tick: TickId, context: PlayerCombatContextV6 = {}): PlayerCombatDecisionReceiptV6 | null {
    if (this.#disposed) return null;
    validatePlayerV6(player);
    const dt = clamp(finite(deltaSeconds, 1 / 60), 0, 0.1);
    this.#parryRemaining = Math.max(0, this.#parryRemaining - dt);

    if (!this.#currentAction) {
      const next = this.#buffer.shift();
      if (!next) return null;
      const outcome = this.#tryStart(next, player.stamina);
      return this.#receipt(next, outcome, tick, player, context, this.#phase);
    }

    const action = this.#currentAction;
    const timing = this.#timing(action, context.equipment);
    this.#elapsed += dt;
    this.#remaining = Math.max(0, this.#remaining - dt);
    const activeNow = this.#elapsed >= timing.activeStartSeconds && this.#elapsed < timing.activeEndSeconds;
    if (activeNow && !this.#active) {
      this.#active = true;
      this.#phase = 'active';
      return this.#receipt(action, 'accepted', tick, player, context, 'active');
    }
    if (!activeNow && this.#active) {
      this.#active = false;
      this.#phase = 'recovery';
      return this.#receipt(action, 'accepted', tick, player, context, 'recovery');
    }
    if (this.#remaining > 0) {
      this.#phase = this.#elapsed < timing.activeStartSeconds ? 'windup' : this.#phase;
      return null;
    }

    const finished = action;
    this.#currentAction = null;
    this.#phase = 'ready';
    this.#active = false;
    this.#elapsed = 0;
    this.#remaining = 0;
    if (finished === 'heavy') this.#comboStep = 0;
    return this.#receipt(finished, 'completed', tick, player, context, 'ready');
  }

  openParryWindow(): void { if (!this.#disposed) this.#parryRemaining = this.config.parryWindowSeconds; }
  parryWindowOpen(): boolean { return this.#parryRemaining > 0; }
  dodgeIFramesOpen(): boolean { return this.#currentAction === 'dodge' && this.#elapsed >= this.config.dodgeIFrameStartSeconds && this.#elapsed < this.config.dodgeIFrameEndSeconds; }
  currentAction(): PlayerCombatActionV6 | null { return this.#currentAction; }
  phase(): PlayerCombatPhaseV6 { return this.#phase; }
  bufferedActions(): readonly PlayerCombatActionV6[] { return Object.freeze([...this.#buffer]); }
  targetId(): string | null { return this.#targetId; }

  reset(): void {
    if (this.#disposed) return;
    this.#serial = 0; this.#comboStep = 0; this.#currentAction = null; this.#phase = 'ready';
    this.#elapsed = 0; this.#remaining = 0; this.#active = false; this.#parryRemaining = 0;
    this.#buffer.length = 0; this.#targetId = null;
  }

  dispose(): void { this.reset(); this.#disposed = true; }

  replay(player: PlayerStateV6, commands: readonly PlayerCombatReplayCommandV6[]): PlayerCombatReplayResultV6 {
    validatePlayerV6(player);
    this.reset();
    const receipts: PlayerCombatDecisionReceiptV6[] = [];
    for (const command of commands) {
      const snapshot = { ...player, stamina: clamp(finite(command.stamina, player.stamina), 0, player.maxStamina), alive: command.alive };
      receipts.push(this.submit(command.action, snapshot, command.tick as TickId));
      const next = this.tick(snapshot, 1 / 60, command.tick as TickId);
      if (next) receipts.push(next);
    }
    const checksum = digest(receipts.map((receipt) => ({ serial: receipt.serial, tick: Number(receipt.tick), action: receipt.action, outcome: receipt.outcome, phase: receipt.phase, comboStep: receipt.comboStep, targetId: receipt.targetId })));
    return Object.freeze({ receipts: Object.freeze(receipts), checksum });
  }

  #tryStart(action: PlayerCombatActionV6, stamina: number): PlayerCombatOutcomeV6 {
    const timing = this.#timing(action);
    const cost = timing.staminaCost;
    if (action !== 'guard' && action !== 'lock-on' && stamina < cost) return 'rejected-resource';
    if (action === 'parry' && !this.parryWindowOpen()) return 'rejected-state';
    if (action === 'dodge' && this.#phase !== 'ready') return 'rejected-state';
    this.#currentAction = action;
    this.#elapsed = 0;
    this.#remaining = timing.durationSeconds;
    this.#active = false;
    this.#phase = timing.durationSeconds <= 0.001 ? 'active' : 'windup';
    if (action === 'light' || action === 'heavy') this.#comboStep = Math.min(this.config.maxComboSteps, this.#comboStep + 1);
    if (action === 'dodge') this.#comboStep = 0;
    return 'accepted';
  }

  #timing(action: PlayerCombatActionV6, equipment: CombatEquipmentStatsV6 = {}): ActionTimingV6 {
    if (action === 'light' || action === 'heavy' || action === 'ranged' || action === 'archery') {
      const base = this.config[action];
      const costMultiplier = clamp(positive(equipment.staminaCostMultiplier, 1), 0.25, 4);
      const reachBonus = clamp(positive(equipment.reachMeters, 0), 0, 10);
      const power = action === 'ranged' || action === 'archery' ? positive(equipment.rangedPower, 0) : positive(equipment.attackPower, 0);
      return Object.freeze({
        ...base,
        staminaCost: base.staminaCost * costMultiplier,
        reachMeters: clamp(base.reachMeters + reachBonus, 0, 50),
        damageScale: clamp(base.damageScale * (1 + power * 0.01), 0, 4),
      });
    }
    const cost = action === 'dodge' ? this.config.dodgeStaminaCost : action === 'parry' ? this.config.parryStaminaCost : 0;
    const durationSeconds = action === 'dodge' ? 0.38 : action === 'parry' ? this.config.parryWindowSeconds : 0.001;
    return Object.freeze({ durationSeconds, activeStartSeconds: action === 'dodge' ? this.config.dodgeIFrameStartSeconds : 0, activeEndSeconds: action === 'dodge' ? this.config.dodgeIFrameEndSeconds : durationSeconds, staminaCost: cost, reachMeters: action === 'dodge' ? 1.1 : 0, damageScale: 0, poiseDamageScale: 0, crossFadeSeconds: 0.06 });
  }

  #lockOn(player: PlayerStateV6, tick: TickId, targets: readonly CombatTargetV6[]): PlayerCombatDecisionReceiptV6 {
    const entries = targets.filter((target) => target.alive !== false && target.visible !== false).map((target) => {
      const dx = target.position.x - player.position.x;
      const dz = target.position.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      const angle = Math.abs(((yaw - player.yaw + Math.PI) % (Math.PI * 2)) - Math.PI);
      const score = positive(target.priority, 0) * 10 - distance - angle * 2;
      return { target, distance, angle, score };
    }).filter((entry) => entry.distance <= this.config.lockOnMaxDistanceMeters && entry.angle <= this.config.lockOnMaxAngleRadians)
      .sort((a, b) => b.score - a.score || a.distance - b.distance || a.target.id.localeCompare(b.target.id));
    const selected = entries[0];
    this.#targetId = selected?.target.id ?? null;
    const lockOn: PlayerCombatLockOnReceiptV6 = {
      action: 'lock-on', targetId: this.#targetId,
      candidates: Object.freeze(entries.map((entry) => entry.target.id)),
      score: Number((selected?.score ?? 0).toFixed(5)),
      distanceMeters: Number((selected?.distance ?? 0).toFixed(4)),
      angleRadians: Number((selected?.angle ?? 0).toFixed(5)),
    };
    return this.#receipt('lock-on', selected ? 'accepted' : 'rejected-target', tick, player, {}, 'ready', lockOn);
  }

  #receipt(action: PlayerCombatActionV6, outcome: PlayerCombatOutcomeV6, tick: TickId, player: PlayerStateV6, context: PlayerCombatContextV6, phase: PlayerCombatPhaseV6, lockOn: PlayerCombatLockOnReceiptV6 | null = null): PlayerCombatDecisionReceiptV6 {
    const timing = this.#timing(action, context.equipment);
    const base = {
      version: 6 as const,
      serial: ++this.#serial,
      tick,
      action,
      outcome,
      phase,
      comboStep: this.#comboStep,
      buffered: Object.freeze([...this.#buffer]),
      staminaCost: Number(timing.staminaCost.toFixed(4)),
      attackPower: Number((positive(context.equipment?.attackPower, 1) * timing.damageScale).toFixed(4)),
      guardPower: Number(positive(context.equipment?.guardPower, 1).toFixed(4)),
      poiseDamage: Number((timing.poiseDamageScale * timing.damageScale).toFixed(4)),
      targetId: this.#targetId,
      animation: outcome.startsWith('rejected') ? Object.freeze([]) : Object.freeze([{
        layer: action === 'dodge' ? 'lower-body' : 'upper-body', action,
        weight: action === 'heavy' || action === 'parry' ? 1 : 0.82,
        crossFadeSeconds: clamp(timing.crossFadeSeconds, 0, 0.4),
        interruptible: action !== 'heavy',
      }]),
      hitbox: freezeDeep({
        active: phase === 'active' && timing.damageScale > 0,
        shape: action === 'ranged' || action === 'archery' ? 'projectile' : action === 'heavy' ? 'arc' : 'capsule',
        reachMeters: Number(clamp(timing.reachMeters, 0, 50).toFixed(4)),
        radiusMeters: action === 'heavy' ? 0.42 : 0.3,
        widthMeters: action === 'heavy' ? 1.15 : 0.8,
        angleRadians: action === 'heavy' ? Math.PI * 0.72 : Math.PI * 0.52,
        damageScale: Number(clamp(timing.damageScale, 0, 4).toFixed(4)),
        poiseDamageScale: Number(clamp(timing.poiseDamageScale, 0, 4).toFixed(4)),
      }),
      feedback: outcome.startsWith('rejected') ? null : feedbackForActionV6(action),
      lockOn,
    };
    return freezeDeep({ ...base, checksum: digest(base) });
  }
}

export function normalizePlayerCombatActionV6(input: string): PlayerCombatActionV6 | null {
  const value = String(input ?? '').trim();
  if ((PLAYER_COMBAT_ACTIONS_V6 as readonly string[]).includes(value)) return value as PlayerCombatActionV6;
  return ALIASES[value] ?? null;
}

export function feedbackForActionV6(action: PlayerCombatActionV6): PlayerCombatFeedbackIntentV6 {
  const cue: PlayerCombatFeedbackIntentV6['cue'] = action === 'heavy' ? 'heavy-swing'
    : action === 'parry' ? 'parry' : action === 'guard' ? 'guard' : action === 'dodge' ? 'dodge'
      : action === 'ranged' ? 'ranged-release' : action === 'archery' ? 'archery-release' : action === 'lock-on' ? 'lock-on' : 'swing';
  const channels: readonly ('vfx' | 'sfx' | 'haptic')[] = action === 'guard' ? ['sfx', 'haptic'] : ['vfx', 'sfx', 'haptic'];
  return Object.freeze({ cue, intensity: action === 'heavy' ? 1 : 0.72, durationSeconds: action === 'dodge' ? 0.18 : 0.24, channels });
}

export function vectorToCombatTargetV6(id: string, position: Vec3V4, priority = 0): CombatTargetV6 {
  return freezeDeep({ id: String(id).slice(0, 64), position: freezeVec(position), priority });
}

export function validatePlayerCombatDecisionV6(receipt: PlayerCombatDecisionReceiptV6): void {
  if (receipt.version !== 6) throw new Error('Unsupported player combat decision version');
  if (!Number.isInteger(receipt.serial) || receipt.serial <= 0) throw new Error('Invalid combat decision serial');
  if (!Number.isFinite(Number(receipt.tick))) throw new Error('Invalid combat decision tick');
  if (receipt.staminaCost < 0 || receipt.attackPower < 0 || receipt.guardPower < 0 || receipt.poiseDamage < 0) throw new Error('Negative combat resource value');
  if (receipt.comboStep < 0 || receipt.comboStep > 3) throw new Error('Invalid combo step');
  if (!Number.isFinite(receipt.hitbox.reachMeters) || receipt.hitbox.reachMeters < 0) throw new Error('Invalid hitbox reach');
}

export const createPlayerCombatDecisionV6 = (config: PlayerCombatDecisionConfigV6 = {}): PlayerCombatDecisionV6 => new PlayerCombatDecisionV6(config);

export const replayPlayerCombatDecisionV6 = (
  player: PlayerStateV6,
  commands: readonly PlayerCombatReplayCommandV6[],
  config: PlayerCombatDecisionConfigV6 = {},
): PlayerCombatReplayResultV6 => createPlayerCombatDecisionV6(config).replay(player, commands);
