import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { clamp, stableSort } from './coreTypes.js';

export type AudioBus = 'master' | 'music' | 'sfx' | 'ambient' | 'voice' | 'ui';
export type AudioState = 'stopped' | 'playing' | 'paused' | 'fading';

export interface AudioEmitter { readonly id: string; readonly entity: EntityId | null; readonly bus: AudioBus; readonly position: Vec3; readonly radius: number; readonly volume: number; readonly loop: boolean; readonly priority: number; readonly occlusion: number; }
export interface AudioVoice { readonly id: string; readonly clip: string; readonly emitter: string | null; readonly state: AudioState; readonly volume: number; readonly startedAt: number; readonly durationMs: number; }
export interface AudioMix { readonly master: number; readonly music: number; readonly sfx: number; readonly ambient: number; readonly voice: number; readonly ui: number; }
export interface AudioStats { readonly emitters: number; readonly voices: number; readonly playing: number; readonly virtualized: number; readonly mixedVolume: number; }

const DEFAULT_MIX: AudioMix = Object.freeze({ master: 1, music: 0.65, sfx: 0.85, ambient: 0.7, voice: 1, ui: 0.9 });
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function attenuation(distanceValue: number, radius: number): number { return distanceValue >= radius ? 0 : 1 - clamp(distanceValue / Math.max(0.1, radius), 0, 1); }

export class AudioRuntime implements Disposable {
  #emitters = new Map<string, AudioEmitter>();
  #voices = new Map<string, AudioVoice>();
  #mix: AudioMix = DEFAULT_MIX;
  #listener: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
  #tick = 0;
  #disposed = false;
  #muted = false;

  registerEmitter(emitter: AudioEmitter): boolean {
    if (this.#disposed || !emitter.id || this.#emitters.has(emitter.id)) return false;
    this.#emitters.set(emitter.id, Object.freeze({ ...emitter, radius: Math.max(0.1, emitter.radius), volume: clamp(emitter.volume, 0, 1), occlusion: clamp(emitter.occlusion, 0, 1) }));
    return true;
  }

  removeEmitter(id: string): boolean { return this.#emitters.delete(id); }
  setListener(position: Vec3): void { this.#listener = Object.freeze({ ...position }); }
  setMix(next: Partial<AudioMix>): void { this.#mix = Object.freeze({ ...this.#mix, ...Object.fromEntries(Object.entries(next).map(([key, value]) => [key, clamp(Number(value), 0, 1)])) } as AudioMix); }
  setMuted(muted: boolean): void { this.#muted = muted; }

  play(id: string, clip: string, durationMs = 5000, volume = 1): boolean {
    if (this.#disposed || this.#muted || !clip) return false;
    const emitter = this.#emitters.get(id);
    if (!emitter) return false;
    const voice: AudioVoice = Object.freeze({ id: `${id}:${this.#tick}:${this.#voices.size}`, clip, emitter: id, state: 'playing', volume: clamp(volume, 0, 1), startedAt: this.#tick, durationMs: Math.max(1, durationMs) });
    this.#voices.set(voice.id, voice);
    return true;
  }

  stopVoice(id: string): boolean { return this.#voices.delete(id); }

  update(tick: number): void {
    if (this.#disposed) return;
    this.#tick = Math.max(this.#tick, Math.trunc(tick));
    for (const [id, voice] of this.#voices) {
      if (this.#tick - voice.startedAt >= voice.durationMs / 16) this.#voices.delete(id);
    }
  }

  mix(): readonly Array<AudioVoice & { readonly gain: number; readonly virtualized: boolean }> {
    if (this.#disposed) return [];
    const values = stableSort([...this.#voices.values()], (a, b) => b.volume - a.volume || a.id.localeCompare(b.id));
    const output = values.map(voice => {
      const emitter = voice.emitter ? this.#emitters.get(voice.emitter) : undefined;
      const distanceValue = emitter ? distance(this.#listener, emitter.position) : 0;
      const spatial = emitter ? attenuation(distanceValue, emitter.radius) : 1;
      const bus = emitter ? this.#mix[emitter.bus] : this.#mix.master;
      const gain = this.#muted ? 0 : voice.volume * bus * spatial * (emitter ? 1 - emitter.occlusion * 0.75 : 1) * this.#mix.master;
      return Object.freeze({ ...voice, gain, virtualized: gain < 0.01 });
    });
    return Object.freeze(output);
  }

  stats(): AudioStats {
    const mixed = this.mix();
    const playing = mixed.filter(voice => voice.state === 'playing' && !voice.virtualized).length;
    const virtualized = mixed.filter(voice => voice.virtualized).length;
    return Object.freeze({ emitters: this.#emitters.size, voices: this.#voices.size, playing, virtualized, mixedVolume: mixed.reduce((sum, voice) => sum + voice.gain, 0) });
  }

  emitters(): readonly AudioEmitter[] { return Object.freeze(stableSort([...this.#emitters.values()], (a, b) => a.id.localeCompare(b.id))); }
  voices(): readonly AudioVoice[] { return Object.freeze(stableSort([...this.#voices.values()], (a, b) => a.id.localeCompare(b.id))); }
  dispose(): void { this.#disposed = true; this.#emitters.clear(); this.#voices.clear(); }
}
