import { clamp, distance3, type Vec3 } from './math.ts';

export type AudioBusId = 'master' | 'music' | 'ambience' | 'sfx' | 'voice' | 'ui';

export interface AudioEmitter {
  readonly id: number;
  readonly position: Vec3;
  readonly bus: AudioBusId;
  readonly radius: number;
  readonly gain: number;
  readonly loop: boolean;
  readonly priority: number;
}

export interface AudioMixState { readonly master: number; readonly music: number; readonly ambience: number; readonly sfx: number; readonly voice: number; readonly ui: number; }
export interface AudioVoiceDecision { readonly emitterId: number; readonly volume: number; readonly pan: number; readonly virtualized: boolean; }

export class AudioRouter {
  #emitters = new Map<number, AudioEmitter>();
  #mix: AudioMixState = { master: 1, music: 1, ambience: 1, sfx: 1, voice: 1, ui: 1 };
  #maxVoices: number;

  constructor(maxVoices = 64) { this.#maxVoices = Math.max(4, Math.floor(maxVoices)); }
  setBusGain(bus: AudioBusId, gain: number): void { this.#mix = { ...this.#mix, [bus]: clamp(gain, 0, 1) }; }
  getBusGain(bus: AudioBusId): number { return this.#mix[bus]; }
  mix(): AudioMixState { return { ...this.#mix }; }
  addEmitter(emitter: AudioEmitter): void { this.#emitters.set(emitter.id, { ...emitter, radius: Math.max(0.001, emitter.radius), gain: clamp(emitter.gain, 0, 4) }); }
  removeEmitter(id: number): boolean { return this.#emitters.delete(id); }
  emitters(): AudioEmitter[] { return [...this.#emitters.values()].sort((a, b) => b.priority - a.priority || a.id - b.id); }

  updateListener(listener: Vec3, listenerRight: Vec3): AudioVoiceDecision[] {
    const candidates = this.emitters().map((emitter) => {
      const distance = distance3(listener, emitter.position);
      const attenuation = clamp(1 - distance / emitter.radius, 0, 1);
      const gain = emitter.gain * attenuation * this.#mix[emitter.bus] * this.#mix.master;
      const deltaX = emitter.position.x - listener.x;
      const deltaZ = emitter.position.z - listener.z;
      const pan = clamp((deltaX * listenerRight.x + deltaZ * listenerRight.z) / Math.max(0.001, Math.hypot(deltaX, deltaZ)), -1, 1);
      return { emitter, volume: gain, pan, virtualized: gain < 0.003 };
    }).filter((voice) => !voice.virtualized).sort((a, b) => b.volume - a.volume || b.emitter.priority - a.emitter.priority || a.emitter.id - b.emitter.id);
    const active = candidates.slice(0, this.#maxVoices);
    const activeIds = new Set(active.map((voice) => voice.emitter.id));
    return this.emitters().map((emitter) => {
      const voice = active.find((candidate) => candidate.emitter.id === emitter.id);
      return { emitterId: emitter.id, volume: voice?.volume ?? 0, pan: voice?.pan ?? 0, virtualized: !activeIds.has(emitter.id) };
    });
  }
}

export function ambientGain(distance: number, radius: number, minGain = 0): number { return clamp(minGain + (1 - Math.max(0, distance) / Math.max(0.001, radius)) * (1 - minGain), 0, 1); }
