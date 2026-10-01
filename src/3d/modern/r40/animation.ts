import { clamp, criticallyDamped, hashJson } from './deterministic';

export type AnimationState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'attack' | 'hurt' | 'dead';
export interface AnimationInput { readonly speed: number; readonly grounded: boolean; readonly verticalSpeed: number; readonly attack: boolean; readonly hurt: boolean; readonly dead: boolean; }
export interface AnimationPose { readonly locomotion: AnimationState; readonly blend: number; readonly normalizedTime: number; readonly playbackRate: number; readonly digest: string; }

const ORDER: readonly AnimationState[] = ['dead', 'hurt', 'attack', 'jump', 'fall', 'run', 'walk', 'idle'];

export function resolveAnimationState(input: AnimationInput): AnimationState {
  if (input.dead) return 'dead';
  if (input.hurt) return 'hurt';
  if (input.attack) return 'attack';
  if (!input.grounded && input.verticalSpeed > 1) return 'jump';
  if (!input.grounded) return 'fall';
  if (input.speed > 5.5) return 'run';
  if (input.speed > 0.15) return 'walk';
  return 'idle';
}

export class AnimationDirector {
  #state: AnimationState = 'idle';
  #normalizedTime = 0;
  #blendVelocity = 0;
  #blend = 0;
  update(input: AnimationInput, dt: number): AnimationPose {
    const next = resolveAnimationState(input);
    if (next !== this.#state) { this.#state = next; this.#normalizedTime = 0; }
    this.#normalizedTime = (this.#normalizedTime + Math.max(0, dt) * this.playbackRate(input.speed)) % 1;
    const target = this.#state === 'run' ? 1 : this.#state === 'walk' ? clamp(input.speed / 5.5, 0, 1) : 0;
    const damped = criticallyDamped(this.#blend, target, this.#blendVelocity, Math.max(0, dt), 8);
    this.#blend = clamp(damped.value, 0, 1);
    this.#blendVelocity = damped.velocity;
    return Object.freeze({ locomotion: this.#state, blend: this.#blend, normalizedTime: this.#normalizedTime, playbackRate: this.playbackRate(input.speed), digest: hashJson({ state: this.#state, blend: this.#blend, time: this.#normalizedTime }) });
  }
  playbackRate(speed: number): number { return clamp(0.8 + Math.abs(speed) / 6, 0.75, 1.8); }
  reset(): void { this.#state = 'idle'; this.#normalizedTime = 0; this.#blend = 0; this.#blendVelocity = 0; }
  state(): AnimationState { return this.#state; }
  rank(state: AnimationState): number { return ORDER.indexOf(state); }
}

export function footstepInterval(speed: number): number { return 0.2 + clamp(5 / Math.max(0.25, speed), 0, 1.2); }
