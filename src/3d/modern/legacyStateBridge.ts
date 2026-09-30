import { checksum } from './deterministic';
import type { FrameId, QualityTier } from './types';
import type { PlayerFrameState, SessionSnapshot, WorldFrameState } from './runtimeContracts';

export interface LegacyStateTarget {
  set?(key: string, value: unknown): void;
  get?(key: string): unknown;
}

export interface LegacyRenderTarget {
  setPixelRatio?(ratio: number): void;
  setQuality?(quality: QualityTier): void;
  setBackend?(backend: string): void;
}

export interface LegacyParitySnapshot {
  readonly frame: FrameId;
  readonly player: PlayerFrameState;
  readonly world: WorldFrameState;
  readonly quality: QualityTier;
  readonly backend: string;
  readonly digest: string;
}

export interface LegacyBridgeOptions {
  readonly state?: LegacyStateTarget;
  readonly renderer?: LegacyRenderTarget;
  readonly mirrorPrefix?: string;
  readonly epsilon?: number;
}

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function approx(a: number, b: number, epsilon: number): boolean { return Math.abs(a - b) <= epsilon; }
function clonePlayer(player: PlayerFrameState): PlayerFrameState {
  return Object.freeze({ position: Object.freeze({ ...player.position }), velocity: Object.freeze({ ...player.velocity }), grounded: Boolean(player.grounded), health: Math.max(0, finite(player.health)), maxHealth: Math.max(0, finite(player.maxHealth)) });
}
function cloneWorld(world: WorldFrameState): WorldFrameState {
  return Object.freeze({ timeOfDaySeconds: Math.max(0, finite(world.timeOfDaySeconds)), weather: String(world.weather), loadedCells: Object.freeze([...world.loadedCells]), discoveredSettlements: Object.freeze([...world.discoveredSettlements]) });
}

/**
 * A deliberately tiny compatibility surface for the still-JavaScript 3D renderer. The bridge never
 * mutates the source snapshot and can prove parity against values observed from the legacy target.
 */
export class LegacyStateBridge {
  readonly mirrorPrefix: string;
  readonly epsilon: number;
  #state: LegacyStateTarget;
  #renderer: LegacyRenderTarget;
  #last: LegacyParitySnapshot | null = null;
  #framesMirrored = 0;
  #parityFailures = 0;

  constructor(options: LegacyBridgeOptions = {}) {
    this.mirrorPrefix = options.mirrorPrefix ?? 'modern.';
    this.epsilon = Math.max(0.000001, options.epsilon ?? 0.001);
    this.#state = options.state ?? {};
    this.#renderer = options.renderer ?? {};
  }

  mirror(snapshot: SessionSnapshot, backend: string): LegacyParitySnapshot {
    const player = clonePlayer(snapshot.player);
    const world = cloneWorld(snapshot.world);
    const parity: LegacyParitySnapshot = Object.freeze({ frame: snapshot.frame, player, world, quality: snapshot.quality, backend, digest: checksum({ frame: snapshot.frame, player, world, quality: snapshot.quality, backend }) });
    this.#state.set?.(`${this.mirrorPrefix}frame`, Number(parity.frame));
    this.#state.set?.(`${this.mirrorPrefix}player`, player);
    this.#state.set?.(`${this.mirrorPrefix}world`, world);
    this.#state.set?.(`${this.mirrorPrefix}quality`, parity.quality);
    this.#state.set?.(`${this.mirrorPrefix}backend`, parity.backend);
    this.#state.set?.(`${this.mirrorPrefix}digest`, parity.digest);
    this.#renderer.setQuality?.(parity.quality);
    this.#renderer.setBackend?.(parity.backend);
    this.#renderer.setPixelRatio?.(Math.max(0.5, Math.min(2, snapshot.runtime.pressure > 0.9 ? 0.75 : 1)));
    this.#last = parity;
    this.#framesMirrored += 1;
    return parity;
  }

  compareLegacy(observed: { readonly frame?: number; readonly quality?: QualityTier; readonly backend?: string; readonly player?: Partial<PlayerFrameState>; readonly world?: Partial<WorldFrameState> }): boolean {
    const expected = this.#last;
    if (!expected) return false;
    let passed = true;
    if (observed.frame !== undefined && observed.frame !== Number(expected.frame)) passed = false;
    if (observed.quality !== undefined && observed.quality !== expected.quality) passed = false;
    if (observed.backend !== undefined && observed.backend !== expected.backend) passed = false;
    if (observed.player?.position && (!approx(observed.player.position.x ?? expected.player.position.x, expected.player.position.x, this.epsilon) || !approx(observed.player.position.y ?? expected.player.position.y, expected.player.position.y, this.epsilon) || !approx(observed.player.position.z ?? expected.player.position.z, expected.player.position.z, this.epsilon))) passed = false;
    if (observed.player?.health !== undefined && !approx(observed.player.health, expected.player.health, this.epsilon)) passed = false;
    if (observed.world?.weather !== undefined && observed.world.weather !== expected.world.weather) passed = false;
    if (!passed) this.#parityFailures += 1;
    return passed;
  }

  readMirrored<T>(key: string, fallback: T): T { return (this.#state.get?.(`${this.mirrorPrefix}${key}`) as T | undefined) ?? fallback; }
  last(): LegacyParitySnapshot | null { return this.#last; }

  stats(): Readonly<Record<string, number>> {
    return Object.freeze({ framesMirrored: this.#framesMirrored, parityFailures: this.#parityFailures, parityRate: this.#framesMirrored ? Math.max(0, 1 - this.#parityFailures / this.#framesMirrored) : 1 });
  }

  reset(): void { this.#last = null; this.#framesMirrored = 0; this.#parityFailures = 0; }
}

export function createLegacyStateBridge(options: LegacyBridgeOptions = {}): LegacyStateBridge { return new LegacyStateBridge(options); }
