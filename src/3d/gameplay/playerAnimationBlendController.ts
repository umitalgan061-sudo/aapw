import { resolvePlayerAnimationPresentation, resolvePlayerAnimationTransition } from './playerAnimationDirector.ts';

export type AnimationBlendSemantic =
  | 'idle'
  | 'locomotion'
  | 'sprint'
  | 'guard'
  | 'dodge'
  | 'light-attack'
  | 'heavy-attack'
  | 'hit-stagger';

export interface PlayerAnimationBlendInput {
  movementState?: string;
  planarSpeedMps?: number;
  runIntent?: boolean;
  attackKind?: 'none' | 'light' | 'heavy';
  guarding?: boolean;
  dodgeRemaining?: number;
  hitStaggerRemaining?: number;
  previousSemanticState?: AnimationBlendSemantic;
  sprintEnterSpeedMps?: number;
  sprintExitSpeedMps?: number;
  environment?: Record<string, unknown>;
  baseSpeedMps?: number;
  leftFootGroundDeltaMeters?: number;
  rightFootGroundDeltaMeters?: number;
  pelvisGroundDeltaMeters?: number;
  walkSpeedMps?: number;
  runSpeedMps?: number;
}

export interface PlayerAnimationBlendFrame {
  semanticState: AnimationBlendSemantic | string;
  transitionState: AnimationBlendSemantic | string;
  action: string;
  timeScale: number;
  blendWeight: number;
  footPlantWeight: number;
  stepConfidence: number;
  environmentValid: boolean;
}

function finite(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveBlendWeight(blend: { locomotionWeight?: number; idleWeight?: number; sprintWeight?: number } | null | undefined): number {
  if (!blend) return 0;
  const locomotion = clamp(finite(blend.locomotionWeight), 0, 1);
  const idle = clamp(finite(blend.idleWeight), 0, 1);
  const sprint = clamp(finite(blend.sprintWeight), 0, 1);
  return Number(Math.max(idle, locomotion, sprint).toFixed(3));
}

/**
 * Typed presentation-only bridge for the existing player animation director.
 * It does not own movement, combat, collisions, or animation assets.
 */
export function resolvePlayerAnimationBlendFrame(input: PlayerAnimationBlendInput = {}): PlayerAnimationBlendFrame {
  const transitionState = resolvePlayerAnimationTransition({
    previousSemanticState: input.previousSemanticState ?? 'idle',
    planarSpeedMps: input.planarSpeedMps,
    runIntent: input.runIntent,
    attackKind: input.attackKind,
    guarding: input.guarding,
    dodgeRemaining: input.dodgeRemaining,
    hitStaggerRemaining: input.hitStaggerRemaining,
    sprintEnterSpeedMps: input.sprintEnterSpeedMps,
    sprintExitSpeedMps: input.sprintExitSpeedMps,
  });
  const presentation = resolvePlayerAnimationPresentation({
    movementState: input.movementState,
    planarSpeedMps: input.planarSpeedMps,
    runIntent: input.runIntent,
    attackKind: input.attackKind,
    guarding: input.guarding,
    dodgeRemaining: input.dodgeRemaining,
    hitStaggerRemaining: input.hitStaggerRemaining,
    environment: input.environment,
    baseSpeedMps: input.baseSpeedMps,
    leftFootGroundDeltaMeters: input.leftFootGroundDeltaMeters,
    rightFootGroundDeltaMeters: input.rightFootGroundDeltaMeters,
    pelvisGroundDeltaMeters: input.pelvisGroundDeltaMeters,
    walkSpeedMps: input.walkSpeedMps,
    runSpeedMps: input.runSpeedMps,
  });
  return Object.freeze({
    semanticState: presentation.semanticState,
    transitionState,
    action: presentation.action,
    timeScale: presentation.timeScale,
    blendWeight: resolveBlendWeight(presentation.blend),
    footPlantWeight: Number(clamp(finite(presentation.environmental?.footPlantWeight), 0, 1).toFixed(3)),
    stepConfidence: Number(clamp(finite(presentation.environmental?.stepConfidence), 0, 1).toFixed(3)),
    environmentValid: Boolean(presentation.environmentValid),
  });
}

export function createPlayerAnimationBlendController(initialSemanticState: AnimationBlendSemantic = 'idle') {
  let previousSemanticState: AnimationBlendSemantic = initialSemanticState;
  return Object.freeze({
    update(input: PlayerAnimationBlendInput = {}): PlayerAnimationBlendFrame {
      const frame = resolvePlayerAnimationBlendFrame({ ...input, previousSemanticState });
      previousSemanticState = frame.transitionState as AnimationBlendSemantic;
      return frame;
    },
    reset(nextSemanticState: AnimationBlendSemantic = 'idle') {
      previousSemanticState = nextSemanticState;
    },
    get semanticState(): AnimationBlendSemantic {
      return previousSemanticState;
    },
  });
}
