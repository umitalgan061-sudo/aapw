import type { QualityTier } from './types';
import type { RuntimeSceneAdapter } from './runtimeSession';
import type { CameraFrameState, PlayerFrameState, WorldFrameState } from './runtimeContracts';

export interface MutableVector3Like { x: number; y: number; z: number }
export interface LivePlayerLike { object3D?: { position: MutableVector3Like; rotation?: { y: number } }; velocity?: MutableVector3Like; health?: number; maxHealth?: number; grounded?: boolean; }
export interface LiveCameraLike { position: MutableVector3Like; target?: MutableVector3Like; fov?: number; near?: number; far?: number; }
export interface LiveRendererLike { info?: { render?: { calls?: number; triangles?: number }; memory?: { textures?: number } }; }
export interface LiveWorldLike { loadedCells?: readonly string[]; discoveredSettlements?: readonly string[]; weather?: string; timeOfDaySeconds?: number; }
export interface LiveGameState { player?: LivePlayerLike; camera?: LiveCameraLike; renderer?: LiveRendererLike; world?: LiveWorldLike; quality?: QualityTier; }
export interface RuntimeFacadeAdapterOptions { readonly read: () => LiveGameState | null; readonly viewport?: () => { readonly width: number; readonly height: number; readonly dpr: number }; readonly writeQuality?: (quality: QualityTier) => void; }

function finite(value: number | undefined, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function vector(value: MutableVector3Like | undefined, fallback: MutableVector3Like): { x: number; y: number; z: number } { return { x: finite(value?.x, fallback.x), y: finite(value?.y, fallback.y), z: finite(value?.z, fallback.z) }; }

/** DOM-free typed adapter around the existing JavaScript world state. */
export class RuntimeFacadeAdapter implements RuntimeSceneAdapter {
  readonly #read: () => LiveGameState | null;
  readonly #viewport: () => { readonly width: number; readonly height: number; readonly dpr: number };
  readonly #writeQuality?: (quality: QualityTier) => void;

  constructor(options: RuntimeFacadeAdapterOptions) { this.#read = options.read; this.#viewport = options.viewport ?? (() => ({ width: typeof innerWidth === 'number' ? innerWidth : 1280, height: typeof innerHeight === 'number' ? innerHeight : 720, dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1 })); this.#writeQuality = options.writeQuality; }

  capturePlayer(): PlayerFrameState {
    const player = this.#read()?.player;
    const position = vector(player?.object3D?.position, { x: 0, y: 0, z: 0 });
    const velocity = vector(player?.velocity, { x: 0, y: 0, z: 0 });
    return Object.freeze({ position: Object.freeze(position), velocity: Object.freeze(velocity), grounded: player?.grounded ?? true, health: Math.max(0, finite(player?.health, 100)), maxHealth: Math.max(0, finite(player?.maxHealth, 100)) });
  }

  captureCamera(): CameraFrameState {
    const camera = this.#read()?.camera;
    return Object.freeze({ position: Object.freeze(vector(camera?.position, { x: 0, y: 3, z: 6 })), target: Object.freeze(vector(camera?.target, { x: 0, y: 1, z: 0 })), yaw: 0, pitch: 0.25, zoom: 6 });
  }

  captureWorld(): WorldFrameState {
    const world = this.#read()?.world;
    return Object.freeze({ timeOfDaySeconds: Math.max(0, finite(world?.timeOfDaySeconds)), weather: world?.weather ?? 'clear', loadedCells: Object.freeze([...(world?.loadedCells ?? [])]), discoveredSettlements: Object.freeze([...(world?.discoveredSettlements ?? [])]) });
  }

  getViewport(): { readonly width: number; readonly height: number; readonly dpr: number } { return this.#viewport(); }
  getRenderMetrics() { const render = this.#read()?.renderer?.info?.render; const memory = this.#read()?.renderer?.info?.memory; return Object.freeze({ drawCalls: Math.max(0, Math.trunc(finite(render?.calls))), triangles: Math.max(0, Math.trunc(finite(render?.triangles))), visibleObjects: Math.max(0, Math.trunc(finite(render?.calls))), textureBytes: Math.max(0, Math.trunc(finite(memory?.textures) * 1024 * 1024)) }); }
  setQuality(quality: QualityTier): void { this.#writeQuality?.(quality); }
}
export function createRuntimeFacadeAdapter(options: RuntimeFacadeAdapterOptions): RuntimeFacadeAdapter { return new RuntimeFacadeAdapter(options); }
