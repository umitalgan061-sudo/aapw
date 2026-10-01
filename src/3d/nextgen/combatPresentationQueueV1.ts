/** Budgeted delivery queue for next-generation combat presentation cues. */
import type { CombatPresentationCue, CombatPresentationDevice } from './combatPresentationV1';

export interface CombatPresentationQueueConfig {
  readonly maxDispatchPerFrame: number;
  readonly maxPerChannelPerFrame: Readonly<Record<'vfx' | 'sfx' | 'haptic' | 'camera', number>>;
  readonly maxLifetimeTicks: number;
  readonly cooldownTicks: Readonly<Record<'impact' | 'blocked-impact' | 'critical-impact' | 'stagger' | 'death' | 'dodge' | 'attack-start', number>>;
}

export interface CombatPresentationDispatch {
  readonly cue: CombatPresentationCue;
  readonly device: CombatPresentationDevice;
  readonly channels: Readonly<{ vfx: boolean; sfx: boolean; haptic: boolean; camera: boolean }>;
  readonly scheduledTick: number;
  readonly dispatchedTick: number;
  readonly ageTicks: number;
}

export interface CombatPresentationQueueSnapshot {
  readonly version: 1;
  readonly tick: number;
  readonly queue: readonly CombatPresentationDispatch[];
  readonly lastDispatched: readonly string[];
  readonly channelCounts: Readonly<Record<'vfx' | 'sfx' | 'haptic' | 'camera', number>>;
}

const DEFAULT_QUEUE: CombatPresentationQueueConfig = Object.freeze({
  maxDispatchPerFrame: 10,
  maxPerChannelPerFrame: Object.freeze({ vfx: 6, sfx: 4, haptic: 3, camera: 4 }),
  maxLifetimeTicks: 8,
  cooldownTicks: Object.freeze({ 'attack-start': 1, impact: 1, 'blocked-impact': 1, 'critical-impact': 2, stagger: 2, death: 4, dodge: 1 }),
});

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function cueChannelEnabled(cue: CombatPresentationCue, channel: 'vfx' | 'sfx' | 'haptic' | 'camera'): boolean {
  if (channel === 'vfx') return cue.vfx.intensity > 0;
  if (channel === 'sfx') return cue.audio.path !== null && cue.audio.volume > 0;
  if (channel === 'haptic') return cue.haptics.length > 0;
  return cue.camera.mode !== 'none' && cue.camera.amplitude > 0;
}

export class CombatPresentationQueue {
  readonly config: CombatPresentationQueueConfig;
  #queue: CombatPresentationDispatch[] = [];
  #lastDispatched = new Map<string, number>();
  #tick = 0;

  constructor(config: Partial<CombatPresentationQueueConfig> = {}) {
    this.config = Object.freeze({ ...DEFAULT_QUEUE, ...config, maxPerChannelPerFrame: Object.freeze({ ...DEFAULT_QUEUE.maxPerChannelPerFrame, ...(config.maxPerChannelPerFrame ?? {}) }), cooldownTicks: Object.freeze({ ...DEFAULT_QUEUE.cooldownTicks, ...(config.cooldownTicks ?? {}) }) });
  }

  enqueue(cues: readonly CombatPresentationCue[], device: CombatPresentationDevice = 'virtual', tick = this.#tick): number {
    this.#tick = Math.max(this.#tick, tick);
    let accepted = 0;
    const ordered = [...cues].sort((a, b) => b.priority - a.priority || b.intensity - a.intensity || a.id.localeCompare(b.id));
    for (const cue of ordered) {
      const last = this.#lastDispatched.get(cue.id);
      const cooldown = this.config.cooldownTicks[cue.semantic] ?? 1;
      if (last !== undefined && tick - last < cooldown) continue;
      if (this.#queue.some((item) => item.cue.id === cue.id)) continue;
      const channels = Object.freeze({ vfx: cueChannelEnabled(cue, 'vfx'), sfx: cueChannelEnabled(cue, 'sfx'), haptic: cue.haptics.length > 0 && device !== 'keyboard' && device !== 'mouse', camera: cue.camera.mode !== 'none' });
      this.#queue.push(Object.freeze({ cue, device, channels, scheduledTick: tick, dispatchedTick: -1, ageTicks: 0 }));
      accepted += 1;
    }
    this.#queue.sort((a, b) => b.cue.priority - a.cue.priority || b.cue.intensity - a.cue.intensity || a.cue.id.localeCompare(b.cue.id));
    const overflow = this.#queue.length - this.config.maxDispatchPerFrame * 4;
    if (overflow > 0) this.#queue.splice(this.#queue.length - overflow, overflow);
    return accepted;
  }

  dispatch(tick = this.#tick): readonly CombatPresentationDispatch[] {
    this.#tick = Math.max(this.#tick, tick);
    const counts = { vfx: 0, sfx: 0, haptic: 0, camera: 0 };
    const selected: CombatPresentationDispatch[] = [];
    const remaining: CombatPresentationDispatch[] = [];
    for (const item of this.#queue) {
      const age = Math.max(0, tick - item.scheduledTick);
      if (age > this.config.maxLifetimeTicks) continue;
      const channels = { ...item.channels };
      if (channels.vfx && counts.vfx >= this.config.maxPerChannelPerFrame.vfx) channels.vfx = false;
      if (channels.sfx && counts.sfx >= this.config.maxPerChannelPerFrame.sfx) channels.sfx = false;
      if (channels.haptic && counts.haptic >= this.config.maxPerChannelPerFrame.haptic) channels.haptic = false;
      if (channels.camera && counts.camera >= this.config.maxPerChannelPerFrame.camera) channels.camera = false;
      const anyChannel = channels.vfx || channels.sfx || channels.haptic || channels.camera;
      if (selected.length < this.config.maxDispatchPerFrame && anyChannel) {
        if (channels.vfx) counts.vfx += 1;
        if (channels.sfx) counts.sfx += 1;
        if (channels.haptic) counts.haptic += 1;
        if (channels.camera) counts.camera += 1;
        const dispatched = Object.freeze({ ...item, channels: Object.freeze(channels), dispatchedTick: tick, ageTicks: age });
        selected.push(dispatched);
        this.#lastDispatched.set(item.cue.id, tick);
      } else if (anyChannel) remaining.push(Object.freeze({ ...item, ageTicks: age }));
    }
    this.#queue = remaining;
    return Object.freeze(selected);
  }

  tick(tick: number): readonly CombatPresentationDispatch[] { return this.dispatch(tick); }
  pendingCount(): number { return this.#queue.length; }
  tickValue(): number { return this.#tick; }

  snapshot(): CombatPresentationQueueSnapshot {
    return Object.freeze({
      version: 1 as const,
      tick: this.#tick,
      queue: Object.freeze([...this.#queue]),
      lastDispatched: Object.freeze([...this.#lastDispatched.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, tick]) => id + ':' + tick)),
      channelCounts: Object.freeze({ vfx: 0, sfx: 0, haptic: 0, camera: 0 }),
    });
  }

  restore(snapshot: CombatPresentationQueueSnapshot): void {
    if (snapshot.version !== 1) throw new Error('unsupported combat presentation queue snapshot');
    this.#tick = snapshot.tick;
    this.#queue = [...snapshot.queue].slice(0, this.config.maxDispatchPerFrame * 4);
    this.#lastDispatched.clear();
    for (const entry of snapshot.lastDispatched) {
      const separator = entry.lastIndexOf(':');
      if (separator <= 0) continue;
      const tick = Number(entry.slice(separator + 1));
      if (Number.isInteger(tick)) this.#lastDispatched.set(entry.slice(0, separator), tick);
    }
  }

  clear(): void { this.#queue = []; }
}

export function createCombatPresentationQueue(config: Partial<CombatPresentationQueueConfig> = {}): CombatPresentationQueue { return new CombatPresentationQueue(config); }

export function validateCombatPresentationDispatch(dispatch: CombatPresentationDispatch): boolean {
  const values = [dispatch.cue.intensity, dispatch.cue.camera.amplitude, dispatch.cue.audio.volume, dispatch.ageTicks];
  return values.every(Number.isFinite) && values.every((value) => value >= 0) && dispatch.dispatchedTick >= dispatch.scheduledTick;
}