import { clamp, digest, normalize, stableSort, vec3, type Disposable, type EntityId, type Vec3 } from './primitives.js';

export type PresentationCue = 'idle' | 'locomotion' | 'attack' | 'hit' | 'stagger' | 'defeat' | 'dodge' | 'guard' | 'parry';
export interface AnimationLayer { readonly name: string; readonly weight: number; readonly speed: number; readonly blendMs: number; }
export interface CameraPose { readonly position: Vec3; readonly target: Vec3; readonly distance: number; readonly fov: number; readonly shake: number; }
export interface PresentationState { readonly actor: EntityId; readonly cue: PresentationCue; readonly layers: readonly AnimationLayer[]; readonly camera: CameraPose; readonly revision: number; readonly digest: string; }
export interface PresentationInput { readonly actor: EntityId; readonly position: Vec3; readonly velocity: Vec3; readonly facing: Vec3; readonly cue: PresentationCue; readonly speed01?: number; readonly impact01?: number; readonly defeated?: boolean; }

const profiles: Readonly<Record<PresentationCue, readonly AnimationLayer[]>> = Object.freeze({
  idle: Object.freeze([{ name: 'idle', weight: 1, speed: 1, blendMs: 180 }]),
  locomotion: Object.freeze([{ name: 'locomotion', weight: 1, speed: 1, blendMs: 120 }]),
  attack: Object.freeze([{ name: 'upper-body', weight: 1, speed: 1.05, blendMs: 50 }, { name: 'locomotion', weight: .25, speed: 1, blendMs: 90 }]),
  hit: Object.freeze([{ name: 'hit-react', weight: 1, speed: 1.1, blendMs: 35 }]),
  stagger: Object.freeze([{ name: 'stagger', weight: 1, speed: .9, blendMs: 30 }]),
  defeat: Object.freeze([{ name: 'defeat', weight: 1, speed: .75, blendMs: 0 }]),
  dodge: Object.freeze([{ name: 'dodge', weight: 1, speed: 1.15, blendMs: 20 }]),
  guard: Object.freeze([{ name: 'guard', weight: 1, speed: 1, blendMs: 45 }]),
  parry: Object.freeze([{ name: 'parry', weight: 1, speed: 1.1, blendMs: 25 }]),
});

export class PresentationDirector implements Disposable {
  #states = new Map<EntityId, PresentationState>(); #disposed = false; #revision = 0;
  evaluate(input: PresentationInput): PresentationState | null {
    if (this.#disposed) return null; const cue = input.defeated ? 'defeat' : input.cue; const speed = clamp(input.speed01 ?? Math.min(1, Math.hypot(input.velocity.x, input.velocity.z) / 10), 0, 1); const impact = clamp(input.impact01 ?? 0, 0, 1); const layers = profiles[cue].map((layer) => Object.freeze({ ...layer, speed: layer.speed * (cue === 'locomotion' ? .65 + speed * .7 : 1), weight: clamp(layer.weight * (cue === 'hit' || cue === 'stagger' ? .6 + impact * .4 : 1), 0, 1) })); const facing = normalize(input.facing); const position = Object.freeze({ ...input.position }); const camera: CameraPose = Object.freeze({ position: vec3(position.x - facing.x * 4, position.y + 2.2, position.z - facing.z * 4), target: vec3(position.x, position.y + 1.3, position.z), distance: 4, fov: cue === 'attack' ? 62 : 58, shake: impact * .35 }); const state = Object.freeze({ actor: input.actor, cue, layers: Object.freeze(layers), camera, revision: ++this.#revision, digest: digest(input.actor, cue, layers, camera) }); this.#states.set(input.actor, state); return state;
  }
  get(actor: EntityId): PresentationState | undefined { return this.#states.get(actor); }
  all(): readonly PresentationState[] { return Object.freeze(stableSort([...this.#states.values()], (a, b) => String(a.actor).localeCompare(String(b.actor)))); }
  dispose(): void { this.#disposed = true; this.#states.clear(); }
}
