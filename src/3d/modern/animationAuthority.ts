export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land' | 'dodge' | 'attack' | 'hit' | 'stunned' | 'dead';
export type AnimationLayer = 'base' | 'upperBody' | 'face' | 'additive';

export interface AnimationClipDef {
  readonly id: string;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly playbackRate?: number;
  readonly footPlant?: boolean;
  readonly additive?: boolean;
}

export interface AnimationState {
  readonly layer: AnimationLayer;
  readonly clipId: string;
  readonly timeMs: number;
  readonly weight: number;
  readonly playing: boolean;
  readonly loops: number;
}

export interface AnimationTransition {
  readonly from: LocomotionState | '*';
  readonly to: LocomotionState;
  readonly priority: number;
  readonly durationMs: number;
  readonly interruptible: boolean;
}

export interface AnimationContext {
  readonly locomotion: LocomotionState;
  readonly speed: number;
  readonly grounded: boolean;
  readonly attack: boolean;
  readonly stunned: boolean;
  readonly dead: boolean;
  readonly aimWeight: number;
}

export interface AnimationSnapshot {
  readonly revision: number;
  readonly states: readonly AnimationState[];
  readonly transitions: number;
  readonly rootMotion: { readonly x: number; readonly y: number; readonly z: number };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const defaultAnimationClips: readonly AnimationClipDef[] = Object.freeze([
  Object.freeze({ id: 'idle', durationMs: 1600, loop: true, footPlant: true }),
  Object.freeze({ id: 'walk', durationMs: 900, loop: true, playbackRate: 1, footPlant: true }),
  Object.freeze({ id: 'run', durationMs: 650, loop: true, playbackRate: 1, footPlant: true }),
  Object.freeze({ id: 'sprint', durationMs: 540, loop: true, playbackRate: 1, footPlant: true }),
  Object.freeze({ id: 'jump', durationMs: 500, loop: false }),
  Object.freeze({ id: 'fall', durationMs: 700, loop: true }),
  Object.freeze({ id: 'land', durationMs: 260, loop: false }),
  Object.freeze({ id: 'dodge', durationMs: 260, loop: false }),
  Object.freeze({ id: 'attack_light', durationMs: 620, loop: false }),
  Object.freeze({ id: 'attack_heavy', durationMs: 920, loop: false }),
  Object.freeze({ id: 'hit', durationMs: 280, loop: false }),
  Object.freeze({ id: 'stunned', durationMs: 800, loop: true }),
  Object.freeze({ id: 'dead', durationMs: 1200, loop: false }),
  Object.freeze({ id: 'aim', durationMs: 700, loop: true, additive: true }),
]);

export class AnimationAuthority {
  readonly #clips = new Map<string, AnimationClipDef>();
  readonly #transitions: AnimationTransition[] = [];
  readonly #layers = new Map<AnimationLayer, AnimationState>();
  #revision = 0;
  #transitionCount = 0;
  #rootMotion = { x: 0, y: 0, z: 0 };

  constructor(clips: readonly AnimationClipDef[] = defaultAnimationClips) {
    for (const clip of clips) this.#clips.set(clip.id, Object.freeze({ ...clip }));
    this.addTransition({ from: '*', to: 'dead', priority: 1000, durationMs: 80, interruptible: false });
    this.addTransition({ from: '*', to: 'stunned', priority: 900, durationMs: 90, interruptible: true });
    this.addTransition({ from: 'idle', to: 'walk', priority: 100, durationMs: 120, interruptible: true });
    this.addTransition({ from: 'walk', to: 'run', priority: 120, durationMs: 100, interruptible: true });
    this.addTransition({ from: 'run', to: 'sprint', priority: 140, durationMs: 90, interruptible: true });
    this.addTransition({ from: '*', to: 'attack', priority: 200, durationMs: 55, interruptible: false });
  }

  addTransition(transition: AnimationTransition): void {
    this.#transitions.push(Object.freeze({ ...transition, priority: Math.floor(transition.priority), durationMs: Math.max(0, transition.durationMs) }));
    this.#transitions.sort((a, b) => b.priority - a.priority || a.to.localeCompare(b.to));
  }

  update(context: AnimationContext, deltaMs: number): AnimationSnapshot {
    const dt = clamp(deltaMs, 0, 100);
    const next = this.#selectState(context);
    const base = this.#layers.get('base');
    const clipId = this.#clipFor(next, context);
    const clip = this.#clips.get(clipId);
    if (!clip) throw new Error(`Missing animation clip ${clipId}.`);
    let timeMs = base?.clipId === clip.id ? base.timeMs + dt * (clip.playbackRate ?? 1) : 0;
    let loops = base?.clipId === clip.id ? base.loops : 0;
    if (clip.loop) {
      while (timeMs >= clip.durationMs) { timeMs -= clip.durationMs; loops += 1; }
    } else {
      timeMs = Math.min(clip.durationMs, timeMs);
    }
    const state: AnimationState = Object.freeze({ layer: 'base', clipId: clip.id, timeMs, weight: 1, playing: timeMs < clip.durationMs || clip.loop, loops });
    this.#layers.set('base', state);
    const aimClip = this.#clips.get('aim');
    if (aimClip && context.aimWeight > 0.001) {
      const previous = this.#layers.get('additive');
      let aimTime = (previous?.clipId === 'aim' ? previous.timeMs + dt : 0) % aimClip.durationMs;
      this.#layers.set('additive', Object.freeze({ layer: 'additive', clipId: 'aim', timeMs: aimTime, weight: clamp(context.aimWeight, 0, 1), playing: true, loops: previous?.clipId === 'aim' ? previous.loops : 0 }));
    } else this.#layers.delete('additive');
    this.#revision += 1;
    return Object.freeze({ revision: this.#revision, states: [...this.#layers.values()], transitions: this.#transitionCount, rootMotion: Object.freeze({ ...this.#rootMotion }) });
  }

  setRootMotion(x: number, y: number, z: number): void { this.#rootMotion = { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, z: Number.isFinite(z) ? z : 0 }; }
  clearRootMotion(): void { this.#rootMotion = { x: 0, y: 0, z: 0 }; }
  state(layer: AnimationLayer = 'base'): AnimationState | undefined { return this.#layers.get(layer); }
  layers(): readonly AnimationState[] { return [...this.#layers.values()]; }
  reset(): void { this.#layers.clear(); this.#revision = 0; this.#transitionCount = 0; this.clearRootMotion(); }

  #selectState(context: AnimationContext): LocomotionState {
    if (context.dead) return 'dead';
    if (context.stunned) return 'stunned';
    if (context.attack) return 'attack';
    if (!context.grounded) return context.speed > 0.1 ? 'jump' : 'fall';
    if (context.locomotion === 'dodge') return 'dodge';
    if (context.locomotion === 'land') return 'land';
    return context.locomotion;
  }

  #clipFor(state: LocomotionState, context: AnimationContext): string {
    if (state === 'attack') return context.speed > 0.15 ? 'attack_light' : 'attack_heavy';
    return state;
  }
}

export const sampleFootPlant = (state: AnimationState, clip: AnimationClipDef): number => {
  if (!clip.footPlant || clip.durationMs <= 0) return 0;
  const phase = (state.timeMs % clip.durationMs) / clip.durationMs;
  return phase < 0.12 ? 1 : phase < 0.26 ? 0.5 : phase > 0.62 && phase < 0.74 ? 0.5 : phase > 0.88 ? 1 : 0;
};
