export type AudioBusName = 'master' | 'music' | 'ambience' | 'effects' | 'ui' | 'voice';

export interface AudioState {
  readonly muted: boolean;
  readonly volumes: Readonly<Record<AudioBusName, number>>;
}

const DEFAULT_VOLUMES: Readonly<Record<AudioBusName, number>> = Object.freeze({ master: 1, music: 0.8, ambience: 0.75, effects: 0.9, ui: 0.8, voice: 1 });

export interface AudioNodeLike { readonly gain: { value: number; setTargetAtTime?: (value: number, startTime: number, timeConstant: number) => void } }

/** Small dependency-free audio routing state model; WebAudio nodes are attached by an adapter. */
export class AudioBusGraph {
  #volumes: Record<AudioBusName, number> = { ...DEFAULT_VOLUMES };
  #muted = false;
  #nodes = new Map<AudioBusName, AudioNodeLike>();

  attach(bus: AudioBusName, node: AudioNodeLike): void {
    this.#nodes.set(bus, node);
    this.#apply(bus);
  }

  detach(bus: AudioBusName): void { this.#nodes.delete(bus); }

  setMuted(muted: boolean): void {
    this.#muted = Boolean(muted);
    for (const bus of Object.keys(this.#volumes) as AudioBusName[]) this.#apply(bus);
  }

  setVolume(bus: AudioBusName, volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError('Audio volume must be in [0, 1]');
    this.#volumes[bus] = volume;
    this.#apply(bus);
  }

  getVolume(bus: AudioBusName): number { return this.#volumes[bus]; }
  get muted(): boolean { return this.#muted; }

  effectiveVolume(bus: AudioBusName): number {
    return this.#muted ? 0 : this.#volumes.master * this.#volumes[bus];
  }

  state(): AudioState {
    return Object.freeze({ muted: this.#muted, volumes: Object.freeze({ ...this.#volumes }) });
  }

  #apply(bus: AudioBusName): void {
    const node = this.#nodes.get(bus);
    if (!node) return;
    node.gain.value = this.effectiveVolume(bus);
  }
}

export function clampAudioVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}
