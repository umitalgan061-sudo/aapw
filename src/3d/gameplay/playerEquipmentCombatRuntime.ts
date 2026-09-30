/** Production TypeScript owner for src/3d/gameplay/playerEquipmentCombatRuntime.js. Legacy .js remains compatibility-only. */
/**
 * Runtime composition adapter for the existing player combat event stream.
 *
 * `player.js` remains authoritative for health, stamina, poise, movement, dodge, defense and
 * attack timing. This adapter only observes those events and derives the equipment-dependent
 * presentation/combat envelope that downstream runtime systems can consume. It is intentionally
 * DOM-free and does not create another state machine.
 *
 * The adapter is safe with an empty equipment provider, which maps to the shipped unarmed/
 * unarmored baseline. A real inventory owner can inject a provider later without changing the
 * event contract or importing editor UI code.
 *
 * @module gameplay/playerEquipmentCombatRuntime
 */

type UnknownRecord = Record<string, unknown>;
type PlayerObjectLike = { userData?: UnknownRecord; position: { x: number; y: number; z: number }; rotation?: { y: number } };
type PlayerRuntimeLike = { readonly object3D: PlayerObjectLike; readonly getMotionState?: () => UnknownRecord };
type EquipmentProvider = (() => unknown) | unknown;
type RuntimeTarget = {
  addEventListener?: (type: string, handler: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, handler: EventListenerOrEventListenerObject) => void;
  dispatchEvent?: (event: Event) => boolean;
  CustomEvent?: typeof CustomEvent;
};
type MotionSnapshot = UnknownRecord;
type AttackSnapshot = UnknownRecord;
type OutcomeSnapshot = UnknownRecord;
type CombatPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'defense' | 'dodge' | 'hit-stagger';

export interface PlayerEquipmentCombatRuntimeOptions {
  readonly player: PlayerRuntimeLike;
  readonly equipmentProvider?: EquipmentProvider;
  readonly target?: RuntimeTarget;
  readonly now?: () => number;
  readonly emitFrames?: boolean;
  readonly onFrame?: ((frame: PlayerEquipmentCombatFrame) => void) | null;
  readonly onAnimation?: ((animation: unknown, frame: PlayerEquipmentCombatFrame) => void) | null;
  readonly onEquipment?: ((equipment: Readonly<UnknownRecord>, sockets: unknown, frame: PlayerEquipmentCombatFrame) => void) | null;
  readonly onAudit?: ((audit: PlayerEquipmentCombatFrame['audit'], frame: PlayerEquipmentCombatFrame) => void) | null;
}

export interface PlayerEquipmentCombatRuntime {
  readonly update: (delta?: unknown, timestamp?: unknown) => PlayerEquipmentCombatFrame;
  readonly refreshEquipment: (timestamp?: unknown) => PlayerEquipmentCombatFrame;
  readonly read: () => PlayerEquipmentCombatFrame;
  readonly readHistory: () => readonly Readonly<PlayerEquipmentCombatFrame>[];
  readonly materialAudit: () => unknown;
  readonly dispose: () => void;
}

export interface PlayerEquipmentCombatFrame {
  readonly version: 1;
  readonly revision: number;
  readonly timestamp: number;
  readonly phase: CombatPhase;
  readonly attack: Readonly<UnknownRecord>;
  readonly defense: Readonly<UnknownRecord>;
  readonly movement: Readonly<UnknownRecord>;
  readonly animation: unknown;
  readonly equipment: Readonly<UnknownRecord>;
  readonly sockets: unknown;
  readonly material: unknown;
  readonly outcome: Readonly<UnknownRecord> | null;
  readonly audit: Readonly<{ ok: boolean; errors: readonly string[]; warnings: readonly string[] }>;
}

import {
  buildPlayerEquipmentRuntimeSnapshot,
  resolvePlayerAttackTuning,
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerAnimationPlan,
  buildPlayerEquipmentSocketPlan,
  buildPlayerMaterialAssignmentMetadata,
  auditPlayerEquipmentProfile,
} from './playerEquipmentCombatProfile.ts';

export const PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT = 'aapw:player-equipment-combat-frame';
export const PLAYER_EQUIPMENT_COMBAT_PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);

const MAX_HISTORY = 32;
const MAX_DT = 0.1;
const MIN_DT = 0;
const clamp = (value: unknown, min: number, max: number): number => Math.max(min, Math.min(max, finite(value, min)));
const finite = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizePhase(motion: MotionSnapshot, attack: AttackSnapshot): CombatPhase {
  const motionState = typeof motion?.state === 'string' ? motion.state : '';
  const attackPhase = typeof attack?.attackPhase === 'string' ? attack.attackPhase : '';
  const attackKind = typeof attack?.attackKind === 'string' ? attack.attackKind : '';
  if (motionState === 'dodge') return 'dodge';
  if (motionState === 'parry' || motionState === 'guard' || motionState === 'guard-break') return 'defense';
  if (motionState === 'hit-stagger') return 'hit-stagger';
  if (attackKind && attackPhase && attackPhase !== 'none') {
    return PLAYER_EQUIPMENT_COMBAT_PHASES.includes(attackPhase) ? attackPhase as CombatPhase : 'recovery';
  }
  if (motionState.startsWith('attack-')) return 'windup';
  return 'idle';
}

function normalizeAttackKind(value: unknown): 'none' | 'light' | 'heavy' {
  return value === 'heavy' ? 'heavy' : value === 'light' ? 'light' : 'none';
}

function readEquipmentProvider(provider: EquipmentProvider): UnknownRecord {
  try {
    if (typeof provider === 'function') return provider() || {};
    return provider && typeof provider === 'object' && !Array.isArray(provider) ? provider as UnknownRecord : {};
  } catch {
    return {};
  }
}

function stableHistoryAppend(history: Array<Readonly<PlayerEquipmentCombatFrame>>, value: PlayerEquipmentCombatFrame): void {
  history.push(Object.freeze(value));
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function canonicalEquipmentValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalEquipmentValue);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalEquipmentValue(source[key])]));
}

function equipmentFingerprint(equipment: UnknownRecord): string {
  return JSON.stringify(canonicalEquipmentValue(equipment));
}

function cloneEquipmentSnapshot(equipment: unknown): UnknownRecord {
  const source = equipment && typeof equipment === 'object' && !Array.isArray(equipment) ? equipment as UnknownRecord : {};
  const output: UnknownRecord = {};
  for (const key of ['head', 'chest', 'back', 'mainHand', 'offHand', 'helmet', 'weapon', 'shield']) {
    if (source[key] != null) output[key] = source[key];
  }
  return output;
}

function readRootForMaterial(rootOrGetter: unknown): unknown {
  try {
    return typeof rootOrGetter === 'function' ? rootOrGetter() : rootOrGetter;
  } catch {
    return null;
  }
}

function buildFrame({
  playerObject,
  equipment,
  motion,
  attack,
  outcome,
  timestamp,
  revision,
}: {
  playerObject: PlayerObjectLike;
  equipment: UnknownRecord;
  motion: MotionSnapshot;
  attack: AttackSnapshot;
  outcome: OutcomeSnapshot | null;
  timestamp: unknown;
  revision: number;
}): PlayerEquipmentCombatFrame {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  const attackKind = normalizeAttackKind(attack?.kind ?? motion?.attackKind);
  const tuning = resolvePlayerAttackTuning(null, profile, attackKind === 'none' ? 'light' : attackKind);
  const phase = normalizePhase(motion, attack);
  const comboStep = clamp(Math.floor(finite(attack?.comboStep ?? motion?.attackComboStep, 0)), 0, 3);
  const animation = resolvePlayerAnimationPlan(profile, {
    movementState: motion?.state || 'idle',
    attackKind,
    comboStep,
    speedMps: finite(motion?.speedMps, 0),
    grounded: Boolean(motion?.isGrounded ?? true),
  });
  const socketPlan = buildPlayerEquipmentSocketPlan(playerObject, profile);
  const material = buildPlayerMaterialAssignmentMetadata({ object: playerObject, profile });
  const audit = auditPlayerEquipmentProfile(profile, { socketPlan });
  return Object.freeze({
    version: 1,
    revision,
    timestamp: finite(timestamp, 0),
    phase,
    attack: Object.freeze({
      kind: attackKind,
      comboStep,
      active: Boolean(attack?.active ?? motion?.attackActive),
      serial: Math.max(0, Math.floor(finite(attack?.serial, 0))),
      reachMeters: tuning.reach,
      damageScale: tuning.damageScale,
      staminaCost: tuning.cost,
      duration: tuning.duration,
      activeStart: tuning.activeStart,
      activeEnd: tuning.activeEnd,
      commitMeters: tuning.commitMeters,
      ranged: tuning.isRanged,
      twoHanded: tuning.twoHanded,
    }),
    defense: Object.freeze({
      guarding: Boolean(motion?.guarding),
      result: String(motion?.defenseResult || outcome?.outcome || 'none'),
      guardDamageMultiplier: tuning.guardDamageMultiplier,
      poiseMultiplier: tuning.poiseMultiplier,
      guardBreakMultiplier: tuning.guardBreakMultiplier,
    }),
    movement: Object.freeze({
      state: String(motion?.state || 'idle'),
      speedMps: finite(motion?.speedMps, 0),
      grounded: Boolean(motion?.isGrounded ?? true),
      staminaRatio: clamp(finite(motion?.staminaRatio, 1), 0, 1),
      poiseRatio: clamp(finite(motion?.poiseRatio, 1), 0, 1),
      movementMultiplier: tuning.movementMultiplier,
      dodgeDistanceMultiplier: tuning.dodgeDistanceMultiplier,
      staminaRegenMultiplier: tuning.staminaRegenMultiplier,
    }),
    animation,
    equipment: Object.freeze({
      mainHandId: profile.sourceIds.mainHand,
      offHandId: profile.sourceIds.offHand,
      chestId: profile.sourceIds.chest,
      headId: profile.sourceIds.head,
      backId: profile.sourceIds.back,
      shieldEquipped: profile.shieldEquipped,
      ranged: profile.ranged,
      twoHanded: profile.twoHanded,
    }),
    sockets: socketPlan,
    material,
    outcome: outcome ? Object.freeze({
      outcome: String(outcome.outcome || 'none'),
      serial: Math.max(0, Math.floor(finite(outcome.serial, 0))),
      appliedAmount: Math.max(0, finite(outcome.appliedAmount, 0)),
      blockedAmount: Math.max(0, finite(outcome.blockedAmount, 0)),
      rawAmount: Math.max(0, finite(outcome.rawAmount, 0)),
    }) : null,
    audit,
  });
}

export function createPlayerEquipmentCombatRuntime({
  player,
  equipmentProvider = () => ({}),
  target = globalThis,
  now = () => 0,
  emitFrames = true,
  onFrame = null,
  onAnimation = null,
  onEquipment = null,
  onAudit = null,
}: PlayerEquipmentCombatRuntimeOptions): PlayerEquipmentCombatRuntime {
  if (!player?.object3D) throw new TypeError('createPlayerEquipmentCombatRuntime requires player.object3D');

  let disposed = false;
  let revision = 0;
  let currentMotion: MotionSnapshot = Object.freeze((player.getMotionState?.() || {}) as MotionSnapshot);
  let currentAttack: AttackSnapshot = Object.freeze({ kind: 'none', attackPhase: 'none', comboStep: 0, active: false, serial: 0 });
  let currentOutcome: OutcomeSnapshot | null = null;
  let equipment = cloneEquipmentSnapshot(readEquipmentProvider(equipmentProvider));
  let equipmentFingerprintValue = equipmentFingerprint(equipment);
  let frame = buildFrame({
    playerObject: player.object3D,
    equipment,
    motion: currentMotion,
    attack: currentAttack,
    outcome: currentOutcome,
    timestamp: now(),
    revision,
  });
  const history: Array<Readonly<PlayerEquipmentCombatFrame>> = [];
  const listeners: Array<readonly [string, EventListener]> = [];

  function subscribe(type: string, handler: EventListener): void {
    if (typeof target?.addEventListener !== 'function' || typeof handler !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push([type, handler]);
  }

  function publish(nextFrame: PlayerEquipmentCombatFrame): void {
    stableHistoryAppend(history, nextFrame);
    if (typeof onFrame === 'function') {
      try { onFrame(nextFrame); } catch { /* consumer isolation */ }
    }
    if (typeof onAnimation === 'function') {
      try { onAnimation(nextFrame.animation, nextFrame); } catch { /* consumer isolation */ }
    }
    if (typeof onEquipment === 'function') {
      try { onEquipment(nextFrame.equipment, nextFrame.sockets, nextFrame); } catch { /* consumer isolation */ }
    }
    if (typeof onAudit === 'function') {
      try { onAudit(nextFrame.audit, nextFrame); } catch { /* consumer isolation */ }
    }
    if (emitFrames && typeof target?.dispatchEvent === 'function' && typeof target?.CustomEvent === 'function') {
      target.dispatchEvent(new target.CustomEvent(PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT, { detail: nextFrame }));
    }
  }

  function compose(timestamp: unknown = now(), { force = false, publishFrame = false }: { force?: boolean; publishFrame?: boolean } = {}): PlayerEquipmentCombatFrame {
    if (disposed) return frame;
    const providerSnapshot = cloneEquipmentSnapshot(readEquipmentProvider(equipmentProvider));
    const nextFingerprint = equipmentFingerprint(providerSnapshot);
    const equipmentChanged = nextFingerprint !== equipmentFingerprintValue;
    if (equipmentChanged) {
      equipment = providerSnapshot;
      equipmentFingerprintValue = nextFingerprint;
    }
    if (force || equipmentChanged || publishFrame) revision += 1;
    frame = buildFrame({
      playerObject: player.object3D,
      equipment,
      motion: currentMotion,
      attack: currentAttack,
      outcome: currentOutcome,
      timestamp,
      revision,
    });
    if (force || equipmentChanged || publishFrame) publish(frame);
    return frame;
  }

  function onMotion(event: Event): void {
    const detail = event instanceof CustomEvent ? ((event as CustomEvent<UnknownRecord>).detail ?? {}) : {};
    currentMotion = Object.freeze(detail);
    compose(typeof detail.timestamp === 'number' ? detail.timestamp : now(), { publishFrame: true });
  }

  function onAttackWindow(event: Event): void {
    const detail = event instanceof CustomEvent ? ((event as CustomEvent<UnknownRecord>).detail ?? {}) : {};
    currentAttack = Object.freeze({
      kind: normalizeAttackKind(detail.kind),
      attackPhase: String(detail.phase || 'none'),
      comboStep: clamp(Math.floor(finite(detail.comboStep, 0)), 0, 3),
      active: Boolean(detail.active),
      serial: Math.max(0, Math.floor(finite(detail.serial, 0))),
      stamina: finite(detail.stamina, finite(currentMotion?.stamina, 0)),
      reachMeters: finite(detail.reachMeters, 0),
      damageScale: finite(detail.damageScale, 1),
    });
    compose(now(), { publishFrame: true });
  }

  function onFeedback(event: Event): void {
    const detail = event instanceof CustomEvent ? ((event as CustomEvent<UnknownRecord>).detail ?? {}) : {};
    currentOutcome = Object.keys(detail).length ? Object.freeze({ ...detail }) : null;
    compose(now(), { publishFrame: true });
  }

  subscribe('aapw:player-motion', onMotion);
  subscribe('aapw:player-attack-window', onAttackWindow);
  subscribe('aapw:player-combat-feedback', onFeedback);

  function update(delta: unknown = 0, timestamp: unknown = now()): PlayerEquipmentCombatFrame {
    if (disposed) return frame;
    const dt = clamp(finite(delta, 0), MIN_DT, MAX_DT);
    if (dt === 0) {
      const freshMotion = player.getMotionState?.();
      if (freshMotion) currentMotion = Object.freeze(freshMotion);
    }
    return compose(timestamp);
  }

  function refreshEquipment(timestamp: unknown = now()): PlayerEquipmentCombatFrame {
    if (disposed) return frame;
    equipment = cloneEquipmentSnapshot(readEquipmentProvider(equipmentProvider));
    equipmentFingerprintValue = equipmentFingerprint(equipment);
    revision += 1;
    frame = buildFrame({
      playerObject: player.object3D,
      equipment,
      motion: currentMotion,
      attack: currentAttack,
      outcome: currentOutcome,
      timestamp,
      revision,
    });
    publish(frame);
    return frame;
  }

  function read(): PlayerEquipmentCombatFrame { return frame; }
  function readHistory(): readonly PlayerEquipmentCombatFrame[] { return Object.freeze([...history]); }

  function materialAudit(): unknown {
    const nextProfile = resolvePlayerEquipmentCombatProfile(equipment);
    const socketPlan = buildPlayerEquipmentSocketPlan(player.object3D, nextProfile);
    return buildPlayerMaterialAssignmentMetadata({ object: player.object3D, profile: nextProfile });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const [type, handler] of listeners.splice(0)) target.removeEventListener?.(type, handler);
    history.length = 0;
    currentOutcome = null;
  }

  return Object.freeze({ update, refreshEquipment, read, readHistory, materialAudit, dispose });
}

export function composePlayerEquipmentCombatFrame({ playerObject, equipment = {}, motion = {}, attack = {}, outcome = null, timestamp = 0, revision = 0 }: { playerObject: PlayerObjectLike; equipment?: unknown; motion?: MotionSnapshot; attack?: AttackSnapshot; outcome?: OutcomeSnapshot | null; timestamp?: unknown; revision?: number } ): PlayerEquipmentCombatFrame {
  if (!playerObject) throw new TypeError('composePlayerEquipmentCombatFrame requires playerObject');
  return buildFrame({ playerObject, equipment: cloneEquipmentSnapshot(equipment), motion, attack, outcome, timestamp, revision });
}

export function isPlayerEquipmentCombatPhase(value: unknown): value is CombatPhase {
  return PLAYER_EQUIPMENT_COMBAT_PHASES.includes(String(value));
}
