
import { clamp, stableHash, type R35Id, type R35Result } from './contracts';

export type AnimationLayer =
  | 'base'
  | 'locomotion'
  | 'upper'
  | 'facial'
  | 'additive'
  | 'reaction';

export interface AnimationClip {
  readonly id: R35Id;
  readonly duration: number;
  readonly tags: readonly string[];
  readonly loop: boolean;
  readonly speed: number;
}

export interface AnimationState {
  readonly id: R35Id;
  readonly clip: R35Id;
  readonly time: number;
  readonly weight: number;
  readonly speed: number;
  readonly layer: AnimationLayer;
  readonly active: boolean;
}

export interface AnimationTransition {
  readonly from: R35Id;
  readonly to: R35Id;
  readonly priority: number;
  readonly blend: number;
  readonly condition: R35Id;
}

export interface AnimationSnapshot {
  readonly actorId: R35Id;
  readonly layers: readonly AnimationState[];
  readonly digest: string;
}

interface MutableLayer {
  state: AnimationState | null;
  transition: AnimationTransition | null;
}

export class AnimationRuntimeR35 {
  #clips = new Map<R35Id, AnimationClip>();
  #transitions: AnimationTransition[] = [];
  #actors = new Map<R35Id, Map<AnimationLayer, MutableLayer>>();
  #parameters = new Map<R35Id, Map<R35Id, number>>();
  #tick = 0;

  registerClip(clip: AnimationClip): R35Result<AnimationClip> {
    if (this.#clips.has(clip.id)) {
      return {
        ok: false,
        error: {
          code: 'ANIMATION_DUPLICATE',
          message: 'Animation clip exists',
          retryable: false,
        },
      };
    }
    if (
      !clip.id
      || clip.duration <= 0
      || clip.speed <= 0
      || clip.tags.length > 64
    ) {
      return {
        ok: false,
        error: {
          code: 'ANIMATION_INVALID',
          message: 'Animation clip values are invalid',
          retryable: false,
        },
      };
    }
    this.#clips.set(
      clip.id,
      Object.freeze({
        ...clip,
        tags: Object.freeze([...clip.tags]),
      }),
    );
    return { ok: true, value: clip };
  }

  registerTransition(transition: AnimationTransition): R35Result<void> {
    if (
      !transition.from
      || !transition.to
      || !transition.condition
      || transition.priority < 0
    ) {
      return {
        ok: false,
        error: {
          code: 'TRANSITION_INVALID',
          message: 'Animation transition is invalid',
          retryable: false,
        },
      };
    }
    this.#transitions.push(
      Object.freeze({
        ...transition,
        priority: clamp(Math.trunc(transition.priority), 0, 1000),
        blend: clamp(transition.blend, 0, 1),
      }),
    );
    this.#transitions.sort(
      (a, b) =>
        b.priority - a.priority
        || a.to.localeCompare(b.to),
    );
    return { ok: true, value: undefined };
  }

  createActor(actorId: R35Id): boolean {
    if (this.#actors.has(actorId)) return false;
    const layers = new Map<AnimationLayer, MutableLayer>();
    const layerNames: readonly AnimationLayer[] = [
      'base',
      'locomotion',
      'upper',
      'facial',
      'additive',
      'reaction',
    ];
    for (const layer of layerNames) {
      layers.set(layer, {
        state: null,
        transition: null,
      });
    }
    this.#actors.set(actorId, layers);
    this.#parameters.set(actorId, new Map());
    return true;
  }

  setParameter(
    actorId: R35Id,
    parameter: R35Id,
    value: number,
  ): boolean {
    const parameters = this.#parameters.get(actorId);
    if (!parameters || !parameter) return false;
    parameters.set(
      parameter,
      Number.isFinite(value) ? value : 0,
    );
    return true;
  }

  play(
    actorId: R35Id,
    layer: AnimationLayer,
    clipId: R35Id,
    weight = 1,
    speed = 1,
  ): R35Result<AnimationState> {
    const layers = this.#actors.get(actorId);
    const clip = this.#clips.get(clipId);
    if (!layers || !clip) {
      return {
        ok: false,
        error: {
          code: 'ANIMATION_ACTOR',
          message: 'Actor or clip missing',
          retryable: false,
        },
      };
    }

    const state: AnimationState = Object.freeze({
      id: stableHash({
        actorId,
        layer,
        clipId,
        tick: this.#tick,
      }),
      clip: clipId,
      time: 0,
      weight: clamp(weight, 0, 1),
      speed: clamp(speed, 0.05, 4) * clip.speed,
      layer,
      active: true,
    });

    layers.get(layer)!.state = state;
    layers.get(layer)!.transition = null;
    return {
      ok: true,
      value: state,
    };
  }

  stop(
    actorId: R35Id,
    layer: AnimationLayer,
  ): void {
    const layers = this.#actors.get(actorId);
    if (!layers) return;
    layers.get(layer)!.state = null;
    layers.get(layer)!.transition = null;
  }

  step(deltaSeconds = 1 / 60): void {
    const delta = clamp(deltaSeconds, 0, 0.25);
    this.#tick += 1;

    for (const [actorId, layers] of this.#actors) {
      const parameters = this.#parameters.get(actorId)!;

      for (const [layer, slot] of layers) {
        if (!slot.state) continue;

        const state = slot.state;
        const clip = this.#clips.get(state.clip)!;
        const nextTime = state.time + delta * state.speed;
        const wrapped = clip.loop
          ? nextTime % clip.duration
          : Math.min(nextTime, clip.duration);

        let next: AnimationState = Object.freeze({
          ...state,
          time: wrapped,
          active: clip.loop || wrapped < clip.duration,
        });

        const transition = this.#pickTransition(
          state,
          parameters,
        );

        if (transition) {
          const target = this.#clips.get(transition.to);

          if (target) {
            slot.transition = transition;
            next = Object.freeze({
              ...next,
              id: stableHash({
                actorId,
                layer,
                clip: target.id,
                tick: this.#tick,
              }),
              clip: target.id,
              time: 0,
              weight: clamp(
                Math.max(next.weight, transition.blend),
                0,
                1,
              ),
            });
          }
        }

        slot.state = next;
      }
    }
  }

  snapshot(
    actorId: R35Id,
  ): AnimationSnapshot | null {
    const layers = this.#actors.get(actorId);
    if (!layers) return null;

    const states = [...layers.values()]
      .map((slot) => slot.state)
      .filter(
        (state): state is AnimationState =>
          Boolean(state),
      )
      .sort(
        (a, b) =>
          a.layer.localeCompare(b.layer)
          || a.clip.localeCompare(b.clip),
      );

    return Object.freeze({
      actorId,
      layers: Object.freeze(states),
      digest: stableHash(states),
    });
  }

  snapshots(): readonly AnimationSnapshot[] {
    return Object.freeze(
      [...this.#actors.keys()]
        .sort()
        .map((actorId) => this.snapshot(actorId)!)
        .filter(Boolean),
    );
  }

  graphDigest(): string {
    return stableHash({
      clips: [...this.#clips.values()].sort(
        (a, b) => a.id.localeCompare(b.id),
      ),
      transitions: this.#transitions,
      snapshots: this.snapshots(),
    });
  }

  #pickTransition(
    current: AnimationState,
    parameters: Map<R35Id, number>,
  ): AnimationTransition | null {
    for (const transition of this.#transitions) {
      if (transition.from !== current.clip) continue;
      const value =
        parameters.get(transition.condition) ?? 0;
      if (value > 0.5) return transition;
    }
    return null;
  }
}
