import type { EntityId } from './types';

export type MotionState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'land'
  | 'attack'
  | 'hurt'
  | 'dead';

export interface MotionInput {
  readonly speed: number;
  readonly verticalSpeed: number;
  readonly grounded: boolean;
  readonly attacking: boolean;
  readonly damaged: boolean;
  readonly dead: boolean;
}

export interface MotionTransition {
  readonly from: MotionState;
  readonly to: MotionState;
  readonly reason: string;
}

const SPEED_WALK = 0.15;
const SPEED_RUN = 0.55;
const SPEED_SPRINT = 0.85;

/** Pure animation state machine: no Three.js dependency, making it safe to test and replay. */
export class MotionStateMachine {
  #state: MotionState = 'idle';
  #entity?: EntityId;

  constructor(entity?: EntityId | string) {
    this.#entity = entity as EntityId | undefined;
  }

  step(input: MotionInput): MotionTransition | null {
    const next = this.#derive(input);
    if (next === this.#state) return null;
    const transition = { from: this.#state, to: next, reason: this.#reason(input, next) };
    this.#state = next;
    return transition;
  }

  state(): MotionState { return this.#state; }
  entity(): EntityId | undefined { return this.#entity; }
  reset(state: MotionState = 'idle'): void { this.#state = state; }

  #derive(input: MotionInput): MotionState {
    if (input.dead) return 'dead';
    if (input.damaged) return 'hurt';
    if (input.attacking) return 'attack';
    if (!input.grounded) return input.verticalSpeed > 0.05 ? 'jump' : 'fall';
    if (input.verticalSpeed < -0.35) return 'land';
    if (input.speed >= SPEED_SPRINT) return 'sprint';
    if (input.speed >= SPEED_RUN) return 'run';
    if (input.speed >= SPEED_WALK) return 'walk';
    return 'idle';
  }

  #reason(input: MotionInput, state: MotionState): string {
    if (state === 'dead') return 'health-depleted';
    if (state === 'hurt') return 'damage-event';
    if (state === 'attack') return 'attack-input';
    if (state === 'jump' || state === 'fall' || state === 'land') return `vertical-speed:${input.verticalSpeed.toFixed(2)}`;
    return `horizontal-speed:${input.speed.toFixed(2)}`;
  }
}

export interface AnimationClipPolicy {
  readonly state: MotionState;
  readonly clip: string;
  readonly playbackRate: number;
  readonly loop: boolean;
  readonly fadeSeconds: number;
}

export function animationPolicy(state: MotionState, speed = 0): AnimationClipPolicy {
  switch (state) {
    case 'idle': return { state, clip: 'Idle', playbackRate: 1, loop: true, fadeSeconds: 0.12 };
    case 'walk': return { state, clip: 'Walk', playbackRate: Math.max(0.75, Math.min(1.25, speed / 0.35)), loop: true, fadeSeconds: 0.08 };
    case 'run': return { state, clip: 'Run', playbackRate: Math.max(0.85, Math.min(1.4, speed / 0.65)), loop: true, fadeSeconds: 0.06 };
    case 'sprint': return { state, clip: 'Sprint', playbackRate: Math.max(0.9, Math.min(1.5, speed / 0.95)), loop: true, fadeSeconds: 0.05 };
    case 'jump': return { state, clip: 'Jump', playbackRate: 1, loop: false, fadeSeconds: 0.03 };
    case 'fall': return { state, clip: 'Fall', playbackRate: 1, loop: true, fadeSeconds: 0.03 };
    case 'land': return { state, clip: 'Land', playbackRate: 1, loop: false, fadeSeconds: 0.02 };
    case 'attack': return { state, clip: 'Attack', playbackRate: 1, loop: false, fadeSeconds: 0.04 };
    case 'hurt': return { state, clip: 'Hurt', playbackRate: 1, loop: false, fadeSeconds: 0.02 };
    case 'dead': return { state, clip: 'Death', playbackRate: 1, loop: false, fadeSeconds: 0.08 };
  }
}
