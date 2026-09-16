import type { EntityId } from './contracts.ts';
import { clamp, stableNumber } from './contracts.ts';

export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land' | 'attack' | 'block' | 'dodge' | 'stunned' | 'dead';
export type AnimationLayer = 'base' | 'upperBody' | 'additive' | 'facial';

export interface AnimationClip {
  readonly id: string;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly speed: number;
  readonly rootMotion: boolean;
  readonly tags: readonly string[];
}

export interface AnimationState {
  readonly entity: EntityId;
  readonly locomotion: LocomotionState;
  readonly previous: LocomotionState;
  readonly clip: string;
  readonly timeMs: number;
  readonly normalizedTime: number;
  readonly playbackRate: number;
  readonly grounded: boolean;
  readonly speed: number;
  readonly turnRate: number;
  readonly revision: number;
}

export interface AnimationTransition {
  readonly from: LocomotionState;
  readonly to: LocomotionState;
  readonly blendMs: number;
  readonly condition: (state: AnimationInput) => boolean;
}

export interface AnimationInput {
  readonly speed: number;
  readonly grounded: boolean;
  readonly verticalVelocity: number;
  readonly attacking: boolean;
  readonly blocking: boolean;
  readonly dodging: boolean;
  readonly stunned: boolean;
  readonly dead: boolean;
  readonly sprinting: boolean;
}

export interface AnimationSnapshot { readonly entity: EntityId; readonly layers: ReadonlyMap<AnimationLayer, AnimationState>; readonly revision: number }

const locomotionRank: Record<LocomotionState, number> = { idle: 0, walk: 1, run: 2, sprint: 3, jump: 4, fall: 4, land: 5, attack: 6, block: 6, dodge: 7, stunned: 8, dead: 9 };

export class AnimationGraph {
  readonly #clips = new Map<string, AnimationClip>();
  readonly #transitions: AnimationTransition[] = [];
  readonly #states = new Map<EntityId, AnimationState>();

  registerClip(clip: AnimationClip): void {
    if (!clip.id.trim() || clip.durationMs <= 0 || clip.speed <= 0) throw new Error(`invalid animation clip: ${clip.id}`);
    this.#clips.set(clip.id, Object.freeze({ ...clip, tags: Object.freeze([...clip.tags]) }));
  }

  registerTransition(transition: AnimationTransition): void { this.#transitions.push(Object.freeze(transition)); }

  create(entity: EntityId): AnimationState {
    const state = Object.freeze({ entity, locomotion: 'idle' as const, previous: 'idle' as const, clip: 'idle', timeMs: 0, normalizedTime: 0, playbackRate: 1, grounded: true, speed: 0, turnRate: 0, revision: 0 });
    this.#states.set(entity, state);
    return state;
  }

  update(entity: EntityId, input: AnimationInput, deltaMs: number): AnimationState {
    const previous = this.#states.get(entity) ?? this.create(entity);
    const locomotion = this.#resolve(input);
    const clip = this.#chooseClip(locomotion);
    const duration = this.#clips.get(clip)?.durationMs ?? 1;
    const playbackRate = clamp(this.#clips.get(clip)?.speed ?? 1, 0.05, 4) * clamp(0.75 + input.speed / 6, 0.5, 1.75);
    const elapsed = previous.locomotion === locomotion ? previous.timeMs + Math.max(0, deltaMs) * playbackRate : 0;
    const timeMs = this.#clips.get(clip)?.loop ? elapsed % duration : Math.min(duration, elapsed);
    const next = Object.freeze({ entity, locomotion, previous: previous.locomotion, clip, timeMs: stableNumber(timeMs), normalizedTime: stableNumber(duration > 0 ? timeMs / duration : 0), playbackRate: stableNumber(playbackRate), grounded: input.grounded, speed: stableNumber(Math.max(0, input.speed)), turnRate: stableNumber(Math.max(-8, Math.min(8, input.speed * 0.2))), revision: previous.revision + 1 });
    this.#states.set(entity, next);
    return next;
  }

  get(entity: EntityId): AnimationState | undefined { return this.#states.get(entity); }
  remove(entity: EntityId): void { this.#states.delete(entity); }

  private #resolve(input: AnimationInput): LocomotionState {
    if (input.dead) return 'dead';
    if (input.stunned) return 'stunned';
    if (input.dodging) return 'dodge';
    if (input.attacking) return 'attack';
    if (input.blocking) return 'block';
    if (!input.grounded && input.verticalVelocity > 0.2) return 'jump';
    if (!input.grounded) return 'fall';
    if (input.speed < 0.15) return 'idle';
    if (input.sprinting) return 'sprint';
    if (input.speed < 2.2) return 'walk';
    return 'run';
  }

  private #chooseClip(state: LocomotionState): string {
    const exact = `${state}`;
    if (this.#clips.has(exact)) return exact;
    const fallback = state === 'run' || state === 'sprint' ? 'walk' : state === 'jump' || state === 'fall' || state === 'land' ? 'jump' : 'idle';
    return this.#clips.has(fallback) ? fallback : [...this.#clips.keys()][0] ?? 'idle';
  }

  transitionScore(from: LocomotionState, to: LocomotionState): number { return locomotionRank[to] - locomotionRank[from]; }
}

export class LayeredAnimationController {
  readonly #graph: AnimationGraph;
  readonly #layers = new Map<EntityId, Map<AnimationLayer, AnimationState>>();
  #revision = 0;
  constructor(graph: AnimationGraph) { this.#graph = graph; }
  update(entity: EntityId, input: AnimationInput, deltaMs: number): AnimationSnapshot {
    const base = this.#graph.update(entity, input, deltaMs);
    const layers = this.#layers.get(entity) ?? new Map<AnimationLayer, AnimationState>();
    layers.set('base', base);
    if (input.attacking || input.blocking) layers.set('upperBody', base);
    else layers.delete('upperBody');
    if (Math.abs(input.speed) > 0.01) layers.set('additive', Object.freeze({ ...base, clip: 'turn', timeMs: base.timeMs * 0.35, normalizedTime: clamp(base.normalizedTime * 0.35, 0, 1) }));
    else layers.delete('additive');
    this.#layers.set(entity, layers);
    this.#revision += 1;
    return Object.freeze({ entity, layers, revision: this.#revision });
  }
  remove(entity: EntityId): void { this.#layers.delete(entity); this.#graph.remove(entity); }
  snapshot(entity: EntityId): AnimationSnapshot | undefined { const layers = this.#layers.get(entity); return layers ? Object.freeze({ entity, layers, revision: this.#revision }) : undefined; }
}
