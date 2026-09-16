import { AnimationComponent, clamp } from './domain.ts';

export type AnimationLayer = 'locomotion' | 'upperBody' | 'additive' | 'facial';
export type AnimationCondition = (state: Readonly<Record<string, number | boolean | string>>) => boolean;

export interface AnimationClip {
  readonly id: string;
  readonly durationSeconds: number;
  readonly loop: boolean;
  readonly additive: boolean;
  readonly tags: readonly string[];
}

export interface AnimationTransition {
  readonly from: string;
  readonly to: string;
  readonly durationSeconds: number;
  readonly exitTime: number;
  readonly priority: number;
  readonly conditions: readonly AnimationCondition[];
}

export interface AnimationStateDefinition {
  readonly id: string;
  readonly clip: AnimationClip;
  readonly speedMultiplier: number;
}

export interface AnimationGraphDefinition {
  readonly layers: Readonly<Record<AnimationLayer, readonly AnimationStateDefinition[]>>;
  readonly transitions: readonly AnimationTransition[];
}

export interface AnimationGraphSnapshot {
  readonly layer: AnimationLayer;
  readonly state: string;
  readonly previous: string | null;
  readonly blend: number;
  readonly time: number;
}

export class AnimationGraphV5 {
  readonly #states = new Map<AnimationLayer, Map<string, AnimationStateDefinition>>();
  readonly #transitions: readonly AnimationTransition[];
  readonly #active = new Map<AnimationLayer, string>();
  readonly #previous = new Map<AnimationLayer, string | null>();
  readonly #blend = new Map<AnimationLayer, number>();
  readonly #time = new Map<AnimationLayer, number>();

  constructor(definition: AnimationGraphDefinition) {
    this.#transitions = [...definition.transitions];
    for (const layer of ['locomotion', 'upperBody', 'additive', 'facial'] as const) {
      const states = new Map<string, AnimationStateDefinition>();
      for (const state of definition.layers[layer] ?? []) {
        if (states.has(state.id)) throw new Error(`duplicate animation state: ${state.id}`);
        states.set(state.id, state);
      }
      this.#states.set(layer, states);
      const first = definition.layers[layer]?.[0];
      if (first) {
        this.#active.set(layer, first.id);
        this.#previous.set(layer, null);
        this.#blend.set(layer, 1);
        this.#time.set(layer, 0);
      }
    }
  }

  update(deltaSeconds: number, conditions: Readonly<Record<string, number | boolean | string>> = {}): void {
    const delta = Math.max(0, deltaSeconds);
    for (const layer of this.#states.keys()) {
      const currentId = this.#active.get(layer);
      if (!currentId) continue;
      const current = this.#states.get(layer)?.get(currentId);
      if (!current) continue;
      const currentTime = (this.#time.get(layer) ?? 0) + delta * Math.max(0, current.speedMultiplier);
      this.#time.set(layer, current.clip.loop ? (currentTime % Math.max(0.001, current.clip.durationSeconds)) : Math.min(currentTime, current.clip.durationSeconds));
      const transition = this.#selectTransition(layer, currentId, conditions);
      if (transition) {
        this.#previous.set(layer, currentId);
        this.#active.set(layer, transition.to);
        this.#time.set(layer, 0);
        this.#blend.set(layer, 0);
      }
      const blend = this.#blend.get(layer) ?? 1;
      const transitionDuration = transition?.durationSeconds ?? 0.15;
      this.#blend.set(layer, clamp(blend + delta / Math.max(0.001, transitionDuration), 0, 1));
    }
  }

  state(layer: AnimationLayer): AnimationGraphSnapshot | null {
    const state = this.#active.get(layer);
    if (!state) return null;
    return { layer, state, previous: this.#previous.get(layer) ?? null, blend: this.#blend.get(layer) ?? 1, time: this.#time.get(layer) ?? 0 };
  }

  component(): AnimationComponent {
    const locomotion = this.state('locomotion');
    const upperBody = this.state('upperBody');
    const additive = this.state('additive');
    return {
      kind: 'animation',
      locomotion: locomotion?.state ?? 'idle',
      upperBody: upperBody?.state ?? 'empty',
      additiveWeight: additive?.blend ?? 0,
      playbackRate: 1,
      normalizedTime: locomotion ? this.#normalizedTime('locomotion', locomotion.state) : 0,
    };
  }

  setState(layer: AnimationLayer, state: string, immediate = false): boolean {
    if (!this.#states.get(layer)?.has(state)) return false;
    const current = this.#active.get(layer);
    if (current === state) return true;
    this.#previous.set(layer, current ?? null);
    this.#active.set(layer, state);
    this.#time.set(layer, 0);
    this.#blend.set(layer, immediate ? 1 : 0);
    return true;
  }

  snapshot(): readonly AnimationGraphSnapshot[] {
    return (['locomotion', 'upperBody', 'additive', 'facial'] as AnimationLayer[]).map((layer) => this.state(layer)).filter((value): value is AnimationGraphSnapshot => !!value);
  }

  private #selectTransition(layer: AnimationLayer, from: string, conditions: Readonly<Record<string, number | boolean | string>>): AnimationTransition | undefined {
    return this.#transitions
      .filter((transition) => transition.from === from && transition.conditions.every((condition) => condition(conditions)))
      .sort((a, b) => b.priority - a.priority || a.to.localeCompare(b.to))[0];
  }

  private #normalizedTime(layer: AnimationLayer, state: string): number {
    const definition = this.#states.get(layer)?.get(state);
    if (!definition) return 0;
    return clamp((this.#time.get(layer) ?? 0) / Math.max(0.001, definition.clip.durationSeconds), 0, 1);
  }
}

export const clip = (id: string, durationSeconds: number, options: Partial<Pick<AnimationClip, 'loop' | 'additive' | 'tags'>> = {}): AnimationClip => ({ id, durationSeconds: Math.max(0.001, durationSeconds), loop: options.loop ?? true, additive: options.additive ?? false, tags: options.tags ?? [] });
export const state = (id: string, animation: AnimationClip, speedMultiplier = 1): AnimationStateDefinition => ({ id, clip: animation, speedMultiplier });
export const when = (key: string, expected: number | boolean | string): AnimationCondition => (values) => values[key] === expected;
