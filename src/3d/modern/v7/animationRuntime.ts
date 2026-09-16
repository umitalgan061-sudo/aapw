import { clamp, stableSort, type Disposable } from './primitives.js';

export type AnimationState = 'stopped' | 'playing' | 'paused' | 'completed';
export interface AnimationClip { readonly id: string; readonly duration: number; readonly loop: boolean; readonly speed: number; readonly tags: readonly string[]; }
export interface AnimationLayerState { readonly id: string; readonly clip: string | null; readonly time: number; readonly weight: number; readonly speed: number; readonly state: AnimationState; readonly revision: number; }
export interface AnimationBlend { readonly from: string | null; readonly to: string | null; readonly progress: number; readonly duration: number; }
export interface AnimationSnapshot { readonly tick: number; readonly layers: readonly AnimationLayerState[]; readonly blend: AnimationBlend | null; readonly digest: string; }

export class DeterministicAnimationRuntime implements Disposable {
  #clips = new Map<string, AnimationClip>();
  #layers = new Map<string, AnimationLayerState>();
  #blend: AnimationBlend | null = null;
  #tick = 0;
  #disposed = false;
  #revision = 0;

  registerClip(input: AnimationClip): boolean {
    if (this.#disposed || !input.id || this.#clips.has(input.id) || input.duration <= 0) return false;
    this.#clips.set(input.id, Object.freeze({ ...input, duration: Math.max(.001, input.duration), speed: clamp(input.speed, .01, 8), tags: Object.freeze([...new Set(input.tags)]) }));
    return true;
  }

  createLayer(id: string, clip: string | null = null): boolean {
    if (this.#disposed || !id || this.#layers.has(id) || (clip !== null && !this.#clips.has(clip))) return false;
    this.#layers.set(id, Object.freeze({ id, clip, time: 0, weight: 1, speed: 1, state: clip ? 'playing' : 'stopped', revision: ++this.#revision }));
    return true;
  }

  play(layerId: string, clipId: string, blendMs = 100, speed = 1): boolean {
    const layer = this.#layers.get(layerId);
    const clip = this.#clips.get(clipId);
    if (!layer || !clip) return false;
    if (layer.clip !== clipId) {
      this.#blend = Object.freeze({ from: layer.clip, to: clipId, progress: 0, duration: Math.max(0, blendMs) });
    }
    this.#layers.set(layerId, Object.freeze({ ...layer, clip: clipId, time: 0, weight: 1, speed: clamp(speed, .01, 8), state: 'playing', revision: ++this.#revision }));
    return true;
  }

  stop(layerId: string): boolean {
    const layer = this.#layers.get(layerId);
    if (!layer) return false;
    this.#layers.set(layerId, Object.freeze({ ...layer, state: 'stopped', time: 0, revision: ++this.#revision }));
    return true;
  }

  pause(layerId: string): boolean {
    const layer = this.#layers.get(layerId);
    if (!layer || layer.state !== 'playing') return false;
    this.#layers.set(layerId, Object.freeze({ ...layer, state: 'paused', revision: ++this.#revision }));
    return true;
  }

  resume(layerId: string): boolean {
    const layer = this.#layers.get(layerId);
    if (!layer || layer.state !== 'paused') return false;
    this.#layers.set(layerId, Object.freeze({ ...layer, state: 'playing', revision: ++this.#revision }));
    return true;
  }

  setWeight(layerId: string, weight: number): boolean {
    const layer = this.#layers.get(layerId);
    if (!layer) return false;
    this.#layers.set(layerId, Object.freeze({ ...layer, weight: clamp(weight, 0, 1), revision: ++this.#revision }));
    return true;
  }

  tick(deltaSeconds: number): void {
    if (this.#disposed) return;
    const delta = clamp(deltaSeconds, 0, 1 / 10);
    this.#tick += 1;
    for (const layer of this.layers()) {
      if (layer.state !== 'playing' || !layer.clip) continue;
      const clip = this.#clips.get(layer.clip);
      if (!clip) continue;
      let time = layer.time + delta * layer.speed * clip.speed;
      let state: AnimationState = 'playing';
      if (clip.loop) time %= clip.duration;
      else if (time >= clip.duration) { time = clip.duration; state = 'completed'; }
      this.#layers.set(layer.id, Object.freeze({ ...layer, time, state, revision: ++this.#revision }));
    }
    if (this.#blend) {
      const duration = this.#blend.duration / 1000;
      const progress = duration <= 0 ? 1 : clamp(this.#blend.progress + delta / duration, 0, 1);
      this.#blend = progress >= 1 ? null : Object.freeze({ ...this.#blend, progress });
    }
  }

  clip(id: string): AnimationClip | undefined { return this.#clips.get(id); }
  layer(id: string): AnimationLayerState | undefined { return this.#layers.get(id); }
  clips(): readonly AnimationClip[] { return Object.freeze(stableSort([...this.#clips.values()], (a, b) => a.id.localeCompare(b.id))); }
  layers(): readonly AnimationLayerState[] { return Object.freeze(stableSort([...this.#layers.values()], (a, b) => a.id.localeCompare(b.id))); }
  snapshot(): AnimationSnapshot { const layers = this.layers(); return Object.freeze({ tick: this.#tick, layers, blend: this.#blend, digest: `${this.#tick}:${layers.map((layer) => `${layer.id}:${layer.clip}:${layer.time.toFixed(4)}:${layer.weight.toFixed(3)}`).join('|')}` }); }
  reset(): void { this.#layers.clear(); this.#blend = null; this.#tick = 0; this.#revision = 0; }
  dispose(): void { this.#disposed = true; this.#clips.clear(); this.reset(); }
}
