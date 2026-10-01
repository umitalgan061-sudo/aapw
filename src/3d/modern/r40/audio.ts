import type { AudioSourceState, Vec3 } from './types';
import { clamp, hashJson, stableSort, vec3Distance } from './deterministic';

export type AudioBus = AudioSourceState['bus'];
export interface AudioMixState { readonly master: number; readonly music: number; readonly dialogue: number; readonly ambience: number; readonly sfx: number; readonly ui: number; }
export interface SpatialAudioDecision { readonly sourceId: string; readonly gain: number; readonly lowpass: number; readonly pan: number; readonly priority: number; readonly culled: boolean; readonly digest: string; }
export interface AudioLimits { readonly maxSources: number; readonly maxVoices: number; readonly maxDistance: number; readonly maxGain: number; }
const DEFAULT_LIMITS: AudioLimits = Object.freeze({ maxSources: 1024, maxVoices: 96, maxDistance: 1200, maxGain: 1.5 });

export function defaultMix(): AudioMixState {
  return Object.freeze({ master: 1, music: 0.85, dialogue: 1, ambience: 0.75, sfx: 0.9, ui: 0.8 });
}
export function busGain(bus: AudioBus, mix: AudioMixState): number {
  return clamp(mix.master * mix[bus], 0, 1.5);
}
export function distanceAttenuation(distance: number, maxDistance = 1200): number {
  const normalized = clamp(distance / Math.max(1, maxDistance), 0, 1);
  return Math.pow(1 - normalized, 2);
}
export function occlusionFilter(occlusion: number): number {
  return 1 - clamp(occlusion, 0, 1) * 0.85;
}

export class SpatialAudioMixer {
  readonly limits: AudioLimits;
  #mix: AudioMixState = defaultMix();
  #sources = new Map<string, AudioSourceState>();
  constructor(limits: Partial<AudioLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }

  setMix(next: Partial<AudioMixState>): void {
    this.#mix = Object.freeze({
      master: clamp(next.master ?? this.#mix.master, 0, 1.5),
      music: clamp(next.music ?? this.#mix.music, 0, 1.5),
      dialogue: clamp(next.dialogue ?? this.#mix.dialogue, 0, 1.5),
      ambience: clamp(next.ambience ?? this.#mix.ambience, 0, 1.5),
      sfx: clamp(next.sfx ?? this.#mix.sfx, 0, 1.5),
      ui: clamp(next.ui ?? this.#mix.ui, 0, 1.5),
    });
  }
  mix(): AudioMixState { return this.#mix; }

  upsert(source: AudioSourceState): boolean {
    if (!source.id || this.#sources.size >= this.limits.maxSources && !this.#sources.has(source.id)) return false;
    this.#sources.set(source.id, Object.freeze({ ...source, gain: clamp(source.gain, 0, this.limits.maxGain), occlusion: clamp(source.occlusion, 0, 1), priority: clamp(source.priority, 0, 100) }));
    return true;
  }
  remove(id: string): boolean { return this.#sources.delete(id); }

  plan(listener: Vec3, accessibilityBoost = 1): readonly SpatialAudioDecision[] {
    const candidates = [...this.#sources.values()].map((source) => {
      const distance = vec3Distance(listener, source.position);
      const attenuation = distanceAttenuation(distance, this.limits.maxDistance);
      const gain = clamp(source.gain * busGain(source.bus, this.#mix) * attenuation * occlusionFilter(source.occlusion) * accessibilityBoost, 0, this.limits.maxGain);
      const cull = distance > this.limits.maxDistance || gain < 0.002;
      const lowpass = clamp(source.occlusion * 0.9, 0, 0.9);
      const pan = clamp((source.position.x - listener.x) / Math.max(1, this.limits.maxDistance * 0.25), -1, 1);
      return Object.freeze({ sourceId: source.id, gain, lowpass, pan, priority: source.priority + gain * 10, culled: cull, digest: hashJson({ id: source.id, gain, lowpass, pan }) });
    });
    return Object.freeze(stableSort(candidates, (a, b) => Number(b.culled) - Number(a.culled) || b.priority - a.priority || a.sourceId.localeCompare(b.sourceId)).slice(0, this.limits.maxVoices));
  }

  clear(): void { this.#sources.clear(); }
  size(): number { return this.#sources.size; }
}

export function duckingGain(priority: number, competing: number, floor = 0.25): number {
  const pressure = clamp(competing / Math.max(1, priority + competing), 0, 1);
  return 1 - pressure * (1 - clamp(floor, 0, 1));
}
export function accessibilityGain(base: number, reducedMotion: boolean, hearingAssist: boolean): number {
  const boost = hearingAssist ? 1.18 : 1;
  const motion = reducedMotion ? 1.04 : 1;
  return clamp(base * boost * motion, 0, 1.5);
}
