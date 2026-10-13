/**
 * Observation-only player vitals/combat frame for runtime presentation consumers.
 * `player.ts` remains authoritative for health, stamina, poise and combat mutation.
 */

export type PlayerVitalsCombatInput = Readonly<{
  health?: number;
  maxHealth?: number;
  stamina?: number;
  maxStamina?: number;
  poise?: number;
  maxPoise?: number;
  isGrounded?: boolean;
  guarding?: boolean;
  parryWindowRemaining?: number;
  dodgeRemaining?: number;
  hitStaggerRemaining?: number;
  guardBreakRemaining?: number;
  attackKind?: 'none' | 'light' | 'heavy' | 'ranged';
  attackActive?: boolean;
  attackComboStep?: number;
  lastDefenseResult?: 'none' | 'blocked' | 'parried' | 'dodged' | 'hit' | 'staggered' | 'guard-break';
}>;

export type PlayerVitalsCombatFrame = Readonly<{
  health: number;
  maxHealth: number;
  healthRatio: number;
  stamina: number;
  maxStamina: number;
  staminaRatio: number;
  poise: number;
  maxPoise: number;
  poiseRatio: number;
  combatState: 'idle' | 'guard' | 'parry' | 'dodge' | 'attack' | 'stagger' | 'guard-break';
  attackKind: 'none' | 'light' | 'heavy' | 'ranged';
  attackComboStep: number;
  isGrounded: boolean;
  locomotionLocked: boolean;
  presentationSeverity: 'clear' | 'warning' | 'critical';
  frameKey: string;
}>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const finitePositive = (value: unknown, fallback: number) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
};
const freeze = <T>(value: T): T => Object.freeze(value);

function severity(healthRatio: number, staminaRatio: number, poiseRatio: number, combatState: PlayerVitalsCombatFrame['combatState']) {
  if (combatState === 'stagger' || combatState === 'guard-break' || healthRatio <= 0.2 || poiseRatio <= 0.2) return 'critical' as const;
  if (healthRatio <= 0.5 || staminaRatio <= 0.25 || poiseRatio <= 0.5) return 'warning' as const;
  return 'clear' as const;
}

function chooseCombatState(input: PlayerVitalsCombatInput): PlayerVitalsCombatFrame['combatState'] {
  if (Number(input.guardBreakRemaining) > 0) return 'guard-break';
  if (Number(input.hitStaggerRemaining) > 0) return 'stagger';
  if (Number(input.dodgeRemaining) > 0) return 'dodge';
  if (Number(input.parryWindowRemaining) > 0) return 'parry';
  if (input.attackActive || input.attackKind !== 'none') return 'attack';
  if (input.guarding) return 'guard';
  return 'idle';
}

export function createPlayerVitalsCombatFrame(input: PlayerVitalsCombatInput = {}): PlayerVitalsCombatFrame {
  const maxHealth = finitePositive(input.maxHealth, 100);
  const maxStamina = finitePositive(input.maxStamina, 100);
  const maxPoise = finitePositive(input.maxPoise, 100);
  const health = clamp(Number(input.health ?? maxHealth), 0, maxHealth);
  const stamina = clamp(Number(input.stamina ?? maxStamina), 0, maxStamina);
  const poise = clamp(Number(input.poise ?? maxPoise), 0, maxPoise);
  const healthRatio = health / maxHealth;
  const staminaRatio = stamina / maxStamina;
  const poiseRatio = poise / maxPoise;
  const combatState = chooseCombatState(input);
  const attackKind = input.attackKind === 'light' || input.attackKind === 'heavy' || input.attackKind === 'ranged' ? input.attackKind : 'none';
  const attackComboStep = Math.max(0, Math.min(3, Math.floor(Number(input.attackComboStep) || 0)));
  const isGrounded = input.isGrounded !== false;
  const locomotionLocked = !isGrounded || combatState === 'dodge' || combatState === 'stagger' || combatState === 'guard-break' || (combatState === 'attack' && Boolean(input.attackActive));
  const presentationSeverity = severity(healthRatio, staminaRatio, poiseRatio, combatState);
  const frameKey = [health.toFixed(3), stamina.toFixed(3), poise.toFixed(3), combatState, attackKind, attackComboStep, isGrounded ? 1 : 0].join('|');
  return freeze({ health, maxHealth, healthRatio, stamina, maxStamina, staminaRatio, poise, maxPoise, poiseRatio, combatState, attackKind, attackComboStep, isGrounded, locomotionLocked, presentationSeverity, frameKey });
}

export function isPlayerVitalsCombatFrame(value: unknown): value is PlayerVitalsCombatFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as PlayerVitalsCombatFrame;
  return Number.isFinite(frame.health) && Number.isFinite(frame.stamina) && Number.isFinite(frame.poise)
    && ['idle', 'guard', 'parry', 'dodge', 'attack', 'stagger', 'guard-break'].includes(frame.combatState)
    && ['none', 'light', 'heavy', 'ranged'].includes(frame.attackKind)
    && ['clear', 'warning', 'critical'].includes(frame.presentationSeverity)
    && typeof frame.frameKey === 'string';
}
