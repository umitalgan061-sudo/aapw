/** Production TypeScript owner for the combat-frame director. Legacy JS remains compatibility-only. */

export const PLAYER_COMBAT_FRAME_DIRECTOR_VERSION = '2026-09-30-v2' as const;

export const ACTIONS = Object.freeze([
  'lightAttack',
  'heavyAttack',
  'block',
  'parry',
  'dodge',
  'lockOn',
] as const);

export const OUTCOMES = Object.freeze([
  'hit',
  'blocked',
  'parried',
  'dodged',
  'staggered',
  'guard-break',
  'defeated',
  'miss',
] as const);

export type PlayerCombatAction = typeof ACTIONS[number];
export type PlayerCombatOutcomeKind = typeof OUTCOMES[number];

export interface PlayerCombatIntentInput {
  readonly action?: unknown;
  readonly sequence?: unknown;
  readonly strength?: unknown;
  readonly targetId?: unknown;
  readonly [key: string]: unknown;
}

export interface PlayerCombatIntent {
  readonly action: string;
  readonly accepted: boolean;
  readonly sequence: number;
  readonly strength: number;
  readonly targetId: string | null;
}

export interface PlayerCombatOutcomeInput {
  readonly outcome?: unknown;
  readonly sequence?: unknown;
  readonly targetId?: unknown;
  readonly damage?: unknown;
  readonly poiseDamage?: unknown;
  readonly timestamp?: unknown;
  readonly [key: string]: unknown;
}

export interface PlayerCombatOutcome {
  readonly outcome: PlayerCombatOutcomeKind;
  readonly sequence: number;
  readonly targetId: string | null;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly timestamp: number;
}

export interface PlayerCombatTarget {
  readonly id?: string;
  readonly distance?: number;
  readonly [key: string]: unknown;
}

export interface PlayerCombatAnimationResult {
  readonly action: string;
  readonly locomotionWeight?: number;
  readonly attackWeight?: number;
  readonly reactionWeight?: number;
  readonly [key: string]: unknown;
}

export interface PlayerCombatDirectorCallbacks {
  readonly readInput?: (context: Readonly<{ readonly input: PlayerCombatStepInput; readonly frame: number }>) => PlayerCombatIntentInput | null | undefined;
  readonly resolveTarget?: (context: Readonly<{ readonly input: PlayerCombatStepInput; readonly intent: PlayerCombatIntent; readonly frame: number }>) => PlayerCombatTarget | null | undefined;
  readonly resolveHit?: (context: Readonly<{ readonly input: PlayerCombatStepInput; readonly intent: PlayerCombatIntent; readonly target: PlayerCombatTarget | null; readonly frame: number }>) => PlayerCombatOutcomeInput | null | undefined;
  readonly applyResources?: (context: Readonly<{ readonly input: PlayerCombatStepInput; readonly intent: PlayerCombatIntent; readonly target: PlayerCombatTarget | null; readonly frame: number }>) => unknown;
  readonly resolveAnimation?: (context: Readonly<{ readonly input: PlayerCombatStepInput; readonly intent: PlayerCombatIntent; readonly target: PlayerCombatTarget | null; readonly frame: number }>) => PlayerCombatAnimationResult | null | undefined;
  readonly resolveEquipment?: (context: Readonly<{ readonly input: PlayerCombatStepInput; readonly intent: PlayerCombatIntent; readonly target: PlayerCombatTarget | null; readonly frame: number }>) => unknown;
}

export interface PlayerCombatStepInput extends Record<string, unknown> {
  readonly intent?: PlayerCombatIntentInput | null;
}

export interface PlayerCombatFrameSnapshot {
  readonly version: typeof PLAYER_COMBAT_FRAME_DIRECTOR_VERSION;
  readonly frame: number;
  readonly intentCount: number;
  readonly outcomeCount: number;
  readonly intents: readonly PlayerCombatIntent[];
  readonly outcomes: readonly PlayerCombatOutcome[];
}

export interface PlayerCombatFrameResult {
  readonly version: typeof PLAYER_COMBAT_FRAME_DIRECTOR_VERSION;
  readonly frame: number;
  readonly intent: PlayerCombatIntent;
  readonly target: PlayerCombatTarget | null;
  readonly animation: PlayerCombatAnimationResult;
  readonly equipment: unknown;
  readonly resources: unknown;
  readonly outcome: PlayerCombatOutcome | null;
  readonly snapshot: PlayerCombatFrameSnapshot;
}

export interface PlayerCombatFrameDirectorOptions extends PlayerCombatDirectorCallbacks {
  readonly maxIntents?: unknown;
  readonly maxOutcomes?: unknown;
}

export interface PlayerCombatFrameDirector {
  readonly step: (input?: PlayerCombatStepInput) => PlayerCombatFrameResult | PlayerCombatDisposedResult;
  readonly snapshot: () => PlayerCombatFrameSnapshot;
  readonly reset: () => void;
  readonly dispose: () => void;
}

export interface PlayerCombatDisposedResult {
  readonly version: typeof PLAYER_COMBAT_FRAME_DIRECTOR_VERSION;
  readonly disposed: true;
  readonly frame: number;
  readonly intents: readonly [];
  readonly outcomes: readonly [];
}

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value: unknown, min: number, max: number): number =>
  Math.min(max, Math.max(min, finite(value, min)));

const stableId = (value: unknown, fallback: string): string => {
  const id = String(value ?? fallback).trim();
  return id || fallback;
};

const isAction = (value: unknown): value is PlayerCombatAction =>
  typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);

const isOutcome = (value: unknown): value is PlayerCombatOutcomeKind =>
  typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);

const freezeArray = <T>(value: T[]): readonly T[] => Object.freeze([...value]);

const boundedLimit = (value: unknown, fallback: number): number =>
  Math.max(1, Math.floor(finite(value, fallback)));

function normalizeIntent(intent: PlayerCombatIntentInput | null | undefined, sequence: number): PlayerCombatIntent {
  const source = intent ?? {};
  const action = stableId(source.action, 'none');
  const accepted = isAction(action);
  return Object.freeze({
    action,
    accepted,
    sequence: Math.max(0, Math.floor(finite(source.sequence, sequence))),
    strength: clamp(source.strength, 0, 1),
    targetId: source.targetId == null ? null : stableId(source.targetId, 'target'),
  });
}

function normalizeOutcome(
  outcome: PlayerCombatOutcomeInput,
  sequence: number,
): PlayerCombatOutcome {
  return Object.freeze({
    outcome: isOutcome(outcome.outcome) ? outcome.outcome : 'miss',
    sequence: Math.max(0, Math.floor(finite(outcome.sequence, sequence))),
    targetId: outcome.targetId == null ? null : stableId(outcome.targetId, 'target'),
    damage: clamp(outcome.damage, 0, 9999),
    poiseDamage: clamp(outcome.poiseDamage, 0, 9999),
    timestamp: Math.max(0, finite(outcome.timestamp, 0)),
  });
}

export function createPlayerCombatFrameDirector({
  readInput,
  resolveTarget,
  resolveHit,
  applyResources,
  resolveAnimation,
  resolveEquipment,
  maxIntents = 8,
  maxOutcomes = 16,
}: PlayerCombatFrameDirectorOptions = {}): PlayerCombatFrameDirector {
  const state: {
    frame: number;
    sequence: number;
    intents: PlayerCombatIntent[];
    outcomes: PlayerCombatOutcome[];
    disposed: boolean;
  } = {
    frame: 0,
    sequence: 0,
    intents: [],
    outcomes: [],
    disposed: false,
  };

  const call = <TArgs, TResult>(
    fn: ((args: TArgs) => TResult) | undefined,
    args: TArgs,
    fallback: TResult,
  ): TResult => {
    try {
      return typeof fn === 'function' ? fn(args) : fallback;
    } catch {
      return fallback;
    }
  };

  const pushBounded = <T>(list: T[], value: T, limit: unknown): void => {
    list.push(value);
    const resolvedLimit = boundedLimit(limit, 1);
    if (list.length > resolvedLimit) list.splice(0, list.length - resolvedLimit);
  };

  const snapshot = (): PlayerCombatFrameSnapshot => Object.freeze({
    version: PLAYER_COMBAT_FRAME_DIRECTOR_VERSION,
    frame: state.frame,
    intentCount: state.intents.length,
    outcomeCount: state.outcomes.length,
    intents: freezeArray(state.intents.map((entry) => ({ ...entry }))),
    outcomes: freezeArray(state.outcomes.map((entry) => ({ ...entry }))),
  });

  const step = (input: PlayerCombatStepInput = {}): PlayerCombatFrameResult | PlayerCombatDisposedResult => {
    if (state.disposed) {
      return Object.freeze({
        version: PLAYER_COMBAT_FRAME_DIRECTOR_VERSION,
        disposed: true,
        frame: state.frame,
        intents: [] as const,
        outcomes: [] as const,
      });
    }

    state.frame += 1;

    const rawIntent = call(
      readInput,
      { input, frame: state.frame },
      input.intent ?? {},
    );
    const intent = normalizeIntent(rawIntent, state.sequence++);
    if (intent.accepted) pushBounded(state.intents, intent, maxIntents);

    const target = call(
      resolveTarget,
      { input, intent, frame: state.frame },
      null,
    ) ?? null;

    const animation = call(
      resolveAnimation,
      { input, intent, target, frame: state.frame },
      { action: 'idle', locomotionWeight: 1, attackWeight: 0, reactionWeight: 0 },
    ) ?? { action: 'idle', locomotionWeight: 1, attackWeight: 0, reactionWeight: 0 };

    const equipment = call(
      resolveEquipment,
      { input, intent, target, frame: state.frame },
      null,
    );

    const resources = call(
      applyResources,
      { input, intent, target, frame: state.frame },
      null,
    );

    const rawOutcome = call(
      resolveHit,
      { input, intent, target, frame: state.frame },
      null,
    );
    const outcome = rawOutcome ? normalizeOutcome(rawOutcome, state.sequence++) : null;
    if (outcome) pushBounded(state.outcomes, outcome, maxOutcomes);

    return Object.freeze({
      version: PLAYER_COMBAT_FRAME_DIRECTOR_VERSION,
      frame: state.frame,
      intent,
      target,
      animation: Object.freeze({ ...animation }),
      equipment,
      resources,
      outcome,
      snapshot: snapshot(),
    });
  };

  const reset = (): void => {
    state.frame = 0;
    state.sequence = 0;
    state.intents.length = 0;
    state.outcomes.length = 0;
  };

  const dispose = (): void => {
    state.disposed = true;
    reset();
  };

  return Object.freeze({ step, snapshot, reset, dispose });
}
