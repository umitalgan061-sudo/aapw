import type { CameraState, FrameId, PressureState, QualityTier, RenderBackend, Vec3 } from './types';
import { checksum, quantize } from './deterministic';

export interface DrawItem {
  readonly entityId: string;
  readonly materialId: string;
  readonly meshId: string;
  readonly position: Vec3;
  readonly distance: number;
  readonly lod: 0 | 1 | 2 | 3;
  readonly transparent: boolean;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly instanceGroup?: string;
}

export interface RenderFramePacket {
  readonly frame: FrameId;
  readonly backend: RenderBackend;
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly camera: CameraState;
  readonly pressure: PressureState;
  readonly draws: readonly DrawItem[];
  readonly checksum: string;
}

export class RenderFrameBuilder {
  #draws: DrawItem[] = [];
  #frame: FrameId = 0 as FrameId;
  #backend: RenderBackend = 'headless';
  #quality: QualityTier = 'balanced';
  #renderScale = 1;
  #camera?: CameraState;
  #pressure?: PressureState;

  reset(frame: FrameId): this {
    this.#frame = frame;
    this.#draws = [];
    return this;
  }

  backend(backend: RenderBackend): this { this.#backend = backend; return this; }
  quality(quality: QualityTier, renderScale: number): this {
    this.#quality = quality;
    this.#renderScale = Math.max(0.5, Math.min(1, renderScale));
    return this;
  }
  camera(camera: CameraState): this { this.#camera = structuredClone(camera); return this; }
  pressure(pressure: PressureState): this { this.#pressure = structuredClone(pressure); return this; }

  add(draw: DrawItem): this {
    if (!draw.entityId || !draw.meshId || !draw.materialId) throw new TypeError('Render item identifiers are required');
    this.#draws.push({ ...draw, distance: Math.max(0, draw.distance), position: { ...draw.position } });
    return this;
  }

  build(): RenderFramePacket {
    if (!this.#camera || !this.#pressure) throw new Error('Frame packet requires camera and pressure state');
    const draws = [...this.#draws].sort((a, b) =>
      a.transparent === b.transparent
        ? a.distance - b.distance || a.entityId.localeCompare(b.entityId)
        : Number(a.transparent) - Number(b.transparent),
    );
    const payload = {
      frame: this.#frame,
      backend: this.#backend,
      quality: this.#quality,
      renderScale: quantize(this.#renderScale, 0.0001),
      camera: this.#camera,
      pressure: this.#pressure,
      draws,
    };
    return Object.freeze({ ...payload, draws: Object.freeze(draws), checksum: checksum(payload) });
  }
}
