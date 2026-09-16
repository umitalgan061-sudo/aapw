import { clamp, damp } from './math.ts';

export type AnimationLocomotion = 'idle' | 'walk' | 'run' | 'sprint' | 'airborne' | 'land';
export type AnimationLayer = 'base' | 'upper' | 'additive' | 'facial';

export interface AnimationClip { readonly id: string; readonly durationSeconds: number; readonly loop: boolean; readonly playbackRate?: number; }
export interface LayerState { clip?: string; weight: number; timeSeconds: number; targetWeight: number; }

export class AnimationMixerState {
  readonly clips = new Map<string, AnimationClip>();
  readonly layers = new Map<AnimationLayer, LayerState>();
  locomotion: AnimationLocomotion = 'idle';
  turnRadians = 0;
  speed01 = 0;

  constructor() {
    for (const layer of ['base', 'upper', 'additive', 'facial'] as const) this.layers.set(layer, { weight: 0, timeSeconds: 0, targetWeight: 0 });
    this.layers.get('base')!.weight = 1;
    this.layers.get('base')!.targetWeight = 1;
  }

  registerClip(clip: AnimationClip): void {
    if (!clip.id.trim()) throw new TypeError('clip id required');
    if (!(clip.durationSeconds > 0)) throw new RangeError('clip duration must be positive');
    this.clips.set(clip.id, { ...clip, playbackRate: clip.playbackRate ?? 1 });
  }

  setLayerClip(layer: AnimationLayer, clipId: string | undefined, weight = 1): void {
    const state = this.layers.get(layer)!;
    if (clipId !== undefined && !this.clips.has(clipId)) throw new Error(`unknown animation clip: ${clipId}`);
    state.clip = clipId;
    state.timeSeconds = 0;
    state.targetWeight = clipId ? clamp(weight, 0, 1) : 0;
  }

  setLocomotion(state: AnimationLocomotion, speed01: number): void {
    this.locomotion = state;
    this.speed01 = clamp(speed01, 0, 1);
  }

  update(dtSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    for (const [layer, state] of this.layers) {
      state.weight = damp(state.weight, state.targetWeight, layer === 'base' ? 18 : 12, dt);
      const clip = state.clip ? this.clips.get(state.clip) : undefined;
      if (!clip || state.weight <= 0.001) continue;
      state.timeSeconds += dt * (clip.playbackRate ?? 1);
      if (clip.loop) state.timeSeconds %= clip.durationSeconds;
      else state.timeSeconds = Math.min(state.timeSeconds, clip.durationSeconds);
    }
    this.turnRadians = damp(this.turnRadians, 0, 10, dt);
  }

  sample(layer: AnimationLayer): { clip?: AnimationClip; normalizedTime: number; weight: number } {
    const state = this.layers.get(layer)!;
    const clip = state.clip ? this.clips.get(state.clip) : undefined;
    return { clip, normalizedTime: clip ? clamp(state.timeSeconds / clip.durationSeconds, 0, 1) : 0, weight: state.weight };
  }
}

export function locomotionClipId(state: AnimationLocomotion): string {
  switch (state) {
    case 'idle': return 'locomotion.idle';
    case 'walk': return 'locomotion.walk';
    case 'run': return 'locomotion.run';
    case 'sprint': return 'locomotion.sprint';
    case 'airborne': return 'locomotion.airborne';
    case 'land': return 'locomotion.land';
  }
}

export interface FootPlantState { readonly left: number; readonly right: number; }
export function solveFootPlant(speed01: number, phase01: number): FootPlantState {
  const phase = ((phase01 % 1) + 1) % 1;
  const stride = clamp(speed01, 0, 1);
  const left = Math.max(0, Math.cos((phase * Math.PI * 2)) * 0.5 + 0.5) * stride;
  const right = Math.max(0, Math.cos((phase * Math.PI * 2) + Math.PI) * 0.5 + 0.5) * stride;
  return { left, right };
}
