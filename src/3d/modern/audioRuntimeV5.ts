import { type OutcomeV4, okV4, failV4, createRuntimeErrorV4, clampV4 } from './runtimeContractsV4';

export type AudioBusV5 = 'master' | 'music' | 'sfx' | 'ambient' | 'ui' | 'voice' | 'footsteps' | 'combat';
export type AudioPriorityV5 = 'critical' | 'high' | 'normal' | 'low';

export interface AudioEmitterV5 {
  readonly id: string;
  readonly bus: AudioBusV5;
  readonly priority: AudioPriorityV5;
  position: { x: number; y: number; z: number };
  volume: number;
  radius: number;
  active: boolean;
  looping: boolean;
  startedAt: number;
}

export interface AudioVoiceV5 {
  readonly id: number;
  readonly emitterId: string;
  readonly startedAt: number;
  readonly expiresAt: number | null;
  readonly priority: AudioPriorityV5;
}

export interface AudioSceneStateV5 {
  readonly listener: { x: number; y: number; z: number };
  readonly busVolume: Readonly<Record<AudioBusV5, number>>;
  readonly muted: boolean;
  readonly activeVoices: number;
  readonly focused: boolean;
}

export interface AudioRuntimeMetricsV5 {
  readonly emitters: number;
  readonly activeVoices: number;
  readonly stolenVoices: number;
  readonly dropped: number;
  readonly starts: number;
  readonly stops: number;
  readonly busesMuted: number;
}

export interface AudioRuntimeOptionsV5 {
  readonly maxEmitters?: number;
  readonly maxVoices?: number;
  readonly now?: () => number;
}

const priorityRank: Record<AudioPriorityV5, number> = { critical: 100, high: 75, normal: 50, low: 10 };
const busList: readonly AudioBusV5[] = ['master', 'music', 'sfx', 'ambient', 'ui', 'voice', 'footsteps', 'combat'];
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class AudioRuntimeV5 {
  readonly maxEmitters: number;
  readonly maxVoices: number;
  #now: () => number;
  #emitters = new Map<string, AudioEmitterV5>();
  #voices = new Map<number, AudioVoiceV5>();
  #busVolume: Record<AudioBusV5, number> = { master: 1, music: 1, sfx: 1, ambient: 1, ui: 1, voice: 1, footsteps: 1, combat: 1 };
  #listener = { x: 0, y: 0, z: 0 };
  #muted = false;
  #focused = true;
  #sequence = 0;
  #stolenVoices = 0;
  #dropped = 0;
  #starts = 0;
  #stops = 0;

  constructor(options: AudioRuntimeOptionsV5 = {}) {
    this.maxEmitters = Math.max(16, Math.trunc(options.maxEmitters ?? 2048));
    this.maxVoices = Math.max(4, Math.trunc(options.maxVoices ?? 96));
    this.#now = options.now ?? (() => performance.now());
  }

  setListener(x: number, y: number, z: number): void { this.#listener = { x: finite(x), y: finite(y), z: finite(z) }; }
  setFocused(focused: boolean): void { this.#focused = Boolean(focused); }
  setMuted(muted: boolean): void { this.#muted = Boolean(muted); }
  isMuted(): boolean { return this.#muted; }

  setBusVolume(bus: AudioBusV5, value: number): void { this.#busVolume[bus] = clampV4(finite(value, 1), 0, 1); }
  busVolume(bus: AudioBusV5): number { return this.#busVolume[bus]; }

  registerEmitter(emitter: Omit<AudioEmitterV5, 'startedAt'>): OutcomeV4<AudioEmitterV5> {
    if (!emitter.id.trim()) return failV4(createRuntimeErrorV4('AUDIO_EMITTER_ID', 'Audio emitter id is required', false));
    if (!this.#emitters.has(emitter.id) && this.#emitters.size >= this.maxEmitters) return failV4(createRuntimeErrorV4('AUDIO_EMITTER_CAP', 'Audio emitter capacity reached', true));
    const normalized: AudioEmitterV5 = { ...emitter, volume: clampV4(finite(emitter.volume, 1), 0, 1), radius: Math.max(0.1, finite(emitter.radius, 25)), active: Boolean(emitter.active), looping: Boolean(emitter.looping), startedAt: this.#now() };
    this.#emitters.set(emitter.id, normalized);
    return okV4(normalized);
  }

  removeEmitter(id: string): boolean {
    this.stop(id);
    return this.#emitters.delete(id);
  }

  start(id: string, durationMs: number | null = null): OutcomeV4<AudioVoiceV5> {
    const emitter = this.#emitters.get(id);
    if (!emitter) return failV4(createRuntimeErrorV4('AUDIO_EMITTER_UNKNOWN', 'Audio emitter is not registered', false));
    if (this.#muted || !this.#focused) return failV4(createRuntimeErrorV4('AUDIO_AUDIO_SUPPRESSED', 'Audio is currently suppressed', true));
    const bus = this.#busVolume[emitter.bus];
    if (bus <= 0 || emitter.volume <= 0) return failV4(createRuntimeErrorV4('AUDIO_BUS_SILENT', 'Audio bus is silent', true));
    if (this.#voices.size >= this.maxVoices && !this.#steal(emitter.priority)) { this.#dropped += 1; return failV4(createRuntimeErrorV4('AUDIO_VOICE_CAP', 'Audio voice budget is full', true)); }
    const now = this.#now();
    const voice = Object.freeze({ id: ++this.#sequence, emitterId: id, startedAt: now, expiresAt: durationMs === null ? null : now + Math.max(0, durationMs), priority: emitter.priority });
    this.#voices.set(voice.id, voice);
    emitter.active = true;
    emitter.startedAt = now;
    this.#starts += 1;
    return okV4(voice);
  }

  stop(id: string): number {
    let count = 0;
    for (const [voiceId, voice] of this.#voices) if (voice.emitterId === id) { this.#voices.delete(voiceId); count += 1; }
    const emitter = this.#emitters.get(id);
    if (emitter) emitter.active = false;
    this.#stops += count;
    return count;
  }

  stopVoice(id: number): boolean { const removed = this.#voices.delete(id); if (removed) this.#stops += 1; return removed; }

  tick(): number {
    const now = this.#now();
    let expired = 0;
    for (const [id, voice] of this.#voices) if (voice.expiresAt !== null && now >= voice.expiresAt) { this.#voices.delete(id); expired += 1; }
    for (const emitter of this.#emitters.values()) emitter.active = [...this.#voices.values()].some((voice) => voice.emitterId === emitter.id);
    return expired;
  }

  activeVoices(): readonly AudioVoiceV5[] { return Object.freeze([...this.#voices.values()].sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || a.id - b.id)); }
  emitters(): readonly AudioEmitterV5[] { return Object.freeze([...this.#emitters.values()].sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || a.id.localeCompare(b.id))); }

  attenuation(emitterId: string): number {
    const emitter = this.#emitters.get(emitterId);
    if (!emitter) return 0;
    const dx = emitter.position.x - this.#listener.x;
    const dy = emitter.position.y - this.#listener.y;
    const dz = emitter.position.z - this.#listener.z;
    const distance = Math.hypot(dx, dy, dz);
    return clampV4(1 - distance / Math.max(0.1, emitter.radius), 0, 1) * emitter.volume * this.#busVolume[emitter.bus] * (this.#muted || !this.#focused ? 0 : 1);
  }

  state(): AudioSceneStateV5 { return Object.freeze({ listener: Object.freeze({ ...this.#listener }), busVolume: Object.freeze({ ...this.#busVolume }), muted: this.#muted, activeVoices: this.#voices.size, focused: this.#focused }); }
  metrics(): AudioRuntimeMetricsV5 { return Object.freeze({ emitters: this.#emitters.size, activeVoices: this.#voices.size, stolenVoices: this.#stolenVoices, dropped: this.#dropped, starts: this.#starts, stops: this.#stops, busesMuted: busList.filter((bus) => this.#busVolume[bus] <= 0).length }); }
  clear(): void { this.#voices.clear(); this.#emitters.clear(); this.#sequence = 0; }

  #steal(priority: AudioPriorityV5): boolean {
    let candidate: AudioVoiceV5 | null = null;
    for (const voice of this.#voices.values()) if (priorityRank[voice.priority] < priorityRank[priority] && (!candidate || priorityRank[voice.priority] < priorityRank[candidate.priority] || (voice.startedAt < candidate.startedAt && priorityRank[voice.priority] === priorityRank[candidate.priority]))) candidate = voice;
    if (!candidate) return false;
    this.#voices.delete(candidate.id);
    this.#stolenVoices += 1;
    return true;
  }
}

export function createAudioRuntimeV5(options: AudioRuntimeOptionsV5 = {}): AudioRuntimeV5 { return new AudioRuntimeV5(options); }
