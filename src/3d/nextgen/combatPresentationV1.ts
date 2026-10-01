/** Deterministic presentation layer for the next-generation combat simulation. */

import type { CombatEvent, CombatantId, CombatantState } from './combatSimulation';
import { deterministicHash, directionFromYaw, normalize3, sub3, type Vec3 } from './deterministicMath';
import { resolveCombatPresentationAsset, type CombatCueSemantic } from './combatPresentationAssetsV1';
import { buildDamageTypeAudioCue, buildDamageTypeHapticCue, getCombatDamageTypeProfile } from './combatPresentationDamageTypeV1';
import { resolveCombatSpatialAudio, applySpatialAudioToVolume, type CombatListenerPose, type CombatSpatialAudioState } from './combatPresentationSpatialAudioV1';
import { resolveCombatReactionIntent, type CombatReactionIntent } from './combatPresentationReactionV1';

export type CombatPresentationDevice = 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'virtual' | 'replay';
export type CombatCuePriority = 0 | 1 | 2 | 3;
export type CombatDefenseOutcome = 'none' | 'guarded' | 'parried';
export type CombatVfxKind = 'swing-trail' | 'impact-spark' | 'guard-spark' | 'critical-burst' | 'poise-break' | 'death-burst' | 'dodge-trail';
export type CombatCameraCue = 'none' | 'micro-shake' | 'impact-shake' | 'critical-shake' | 'death-pulse';

export interface CombatPresentationConfig {
  readonly maxCuesPerTick: number;
  readonly maxPendingCues: number;
  readonly maxHistoryFrames: number;
  readonly hitstopMaxTicks: number;
  readonly cameraShakeMax: number;
  readonly hapticMaxAmplitude: number;
  readonly audioMaxVolume: number;
  readonly dedupeHistorySize: number;
  readonly reducedMotionCameraScale: number;
}

const DEFAULT_CONFIG: CombatPresentationConfig = Object.freeze({
  maxCuesPerTick: 12,
  maxPendingCues: 128,
  maxHistoryFrames: 64,
  hitstopMaxTicks: 6,
  cameraShakeMax: 0.85,
  hapticMaxAmplitude: 1,
  audioMaxVolume: 1,
  dedupeHistorySize: 512,
  reducedMotionCameraScale: 0.35,
});

const EVENT_PRIORITY: Readonly<Record<CombatEvent['type'], CombatCuePriority>> = Object.freeze({
  'attack-start': 1,
  hit: 2,
  blocked: 2,
  critical: 3,
  stagger: 3,
  death: 3,
  dodge: 1,
});

const SEMANTICS: Readonly<Record<CombatEvent['type'], CombatCueSemantic>> = Object.freeze({
  'attack-start': 'attack-start',
  hit: 'impact',
  blocked: 'blocked-impact',
  parried: 'blocked-impact',
  critical: 'critical-impact',
  stagger: 'stagger',
  death: 'death',
  dodge: 'dodge',
});

const VFX_BY_SEMANTIC: Readonly<Record<CombatCueSemantic, CombatVfxKind>> = Object.freeze({
  'attack-start': 'swing-trail',
  impact: 'impact-spark',
  'blocked-impact': 'guard-spark',
  'critical-impact': 'critical-burst',
  stagger: 'poise-break',
  death: 'death-burst',
  dodge: 'dodge-trail',
});

export interface CombatHapticPulse {
  readonly device: CombatPresentationDevice;
  readonly durationMs: number;
  readonly amplitude: number;
  readonly frequencyHz: number;
  readonly attack: number;
  readonly release: number;
}

export interface CombatAudioCue {
  readonly assetId: string | null;
  readonly path: string | null;
  readonly available: boolean;
  readonly fallback: boolean;
  readonly volume: number;
  readonly playbackRate: number;
  readonly semantic: CombatCueSemantic;
}

export interface CombatVfxCue {
  readonly kind: CombatVfxKind;
  readonly intensity: number;
  readonly scale: number;
  readonly durationMs: number;
  readonly seed: number;
  readonly direction: Readonly<Vec3>;
  readonly authoredAsset: boolean;
  readonly materialDriven: boolean;
}

export interface CombatCameraCueData {
  readonly mode: CombatCameraCue;
  readonly amplitude: number;
  readonly durationMs: number;
  readonly frequencyHz: number;
  readonly reducedMotionAmplitude: number;
}

export interface CombatPresentationCue {
  readonly id: string;
  readonly tick: number;
  readonly priority: CombatCuePriority;
  readonly semantic: CombatCueSemantic;
  readonly sourceId: CombatantId;
  readonly targetId: CombatantId | null;
  readonly attackId: string | null;
  readonly position: Readonly<Vec3>;
  readonly direction: Readonly<Vec3>;
  readonly intensity: number;
  readonly blocked: boolean;
  readonly defenseOutcome: CombatDefenseOutcome;
  readonly critical: boolean;
  readonly hitstopTicks: number;
  readonly vfx: CombatVfxCue;
  readonly audio: CombatAudioCue;
  readonly camera: CombatCameraCueData;
  readonly haptics: readonly CombatHapticPulse[];
  readonly fingerprint: number;
  readonly damageType: string;
  readonly damageFamily: string;
  readonly materialResponse: string;
  readonly spatialAudio: CombatSpatialAudioState | null;
  readonly reaction: CombatReactionIntent;
}

export interface CombatPresentationFrame {
  readonly version: 1;
  readonly tick: number;
  readonly cues: readonly CombatPresentationCue[];
  readonly hitstopTicks: number;
  readonly cameraShake: number;
  readonly eventCount: number;
  readonly droppedCues: number;
  readonly deterministicDigest: number;
}

export interface CombatPresentationContext {
  readonly states: readonly CombatantState[];
  readonly device?: CombatPresentationDevice;
  readonly reducedMotion?: boolean;
  readonly muted?: boolean;
  readonly listener?: CombatListenerPose;
  readonly targetPoiseRatio?: number;
  readonly targetGrounded?: boolean;
}

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, finite(value, min))); }
function round(value: number, decimals = 4): number { const factor = 10 ** decimals; return Math.round(value * factor) / factor; }
function stateOf(states: readonly CombatantState[], id: CombatantId | undefined): CombatantState | null { return id === undefined ? null : states.find((state) => state.id === id) ?? null; }
function midpoint(a: Vec3 | null, b: Vec3 | null): Vec3 {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  return a ? { ...a } : b ? { ...b } : { x: 0, y: 0, z: 0 };
}
function safeDirection(source: CombatantState | null, target: CombatantState | null): Vec3 {
  if (source && target) {
    const delta = normalize3(sub3(target.position, source.position));
    if (delta.x !== 0 || delta.y !== 0 || delta.z !== 0) return delta;
  }
  if (source) return normalize3(source.forward);
  return { x: 0, y: 0, z: 1 };
}
function semanticIntensity(event: CombatEvent): number {
  if (event.type === 'critical') return 1;
  if (event.type === 'death') return 0.95;
  if (event.type === 'stagger') return 0.88;
  if (event.type === 'parried') return 0.94;
  if (event.type === 'blocked') return 0.62;
  if (event.type === 'dodge') return 0.48;
  if (event.type === 'attack-start') return 0.34;
  return clamp(0.25 + finite(event.damage, 0) / 80 + finite(event.poiseDamage, 0) / 120, 0.25, 1);
}
function eventFingerprint(event: CombatEvent): string {
  return [event.tick, event.type, event.sourceId, event.targetId ?? 0, event.attackId ?? '', round(finite(event.damage)), round(finite(event.poiseDamage))].join('|');
}
function cameraFor(event: CombatEvent, intensity: number, reducedMotion: boolean, maxAmplitude: number): CombatCameraCueData {
  const semantic = SEMANTICS[event.type];
  const raw = clamp(intensity * (event.type === 'death' ? 1.05 : event.type === 'critical' ? 1 : 0.7), 0, maxAmplitude);
  const amplitude = reducedMotion ? raw * DEFAULT_CONFIG.reducedMotionCameraScale : raw;
  const mode: CombatCameraCue = event.type === 'parried' ? 'critical-shake' : event.type === 'death' ? 'death-pulse' : event.type === 'critical' ? 'critical-shake' : event.type === 'hit' || event.type === 'blocked' || event.type === 'parried' || event.type === 'stagger' ? 'impact-shake' : event.type === 'attack-start' || event.type === 'dodge' ? 'micro-shake' : 'none';
  const durationMs = event.type === 'parried' ? 105 : event.type === 'critical' ? 120 : event.type === 'death' ? 180 : event.type === 'stagger' ? 110 : event.type === 'dodge' ? 45 : 70;
  const frequencyHz = event.type === 'death' ? 7 : event.type === 'critical' ? 11 : 15;
  return Object.freeze({ mode, amplitude: round(amplitude), durationMs, frequencyHz, reducedMotionAmplitude: round(raw * DEFAULT_CONFIG.reducedMotionCameraScale) });
}
function hitstopFor(event: CombatEvent, maxTicks: number): number {
  if (event.type === 'critical') return Math.min(maxTicks, 4);
  if (event.type === 'stagger') return Math.min(maxTicks, 3);
  if (event.type === 'death') return Math.min(maxTicks, 5);
  if (event.type === 'parried') return Math.min(maxTicks, 4);
  if (event.type === 'blocked') return Math.min(maxTicks, 2);
  if (event.type === 'hit') return Math.min(maxTicks, 2);
  return 0;
}
function audioFor(event: CombatEvent, muted: boolean, maxVolume: number): CombatAudioCue {
  const semantic = SEMANTICS[event.type];
  const asset = resolveCombatPresentationAsset(semantic, 'sfx');
  const baseVolume = event.type === 'critical' ? 0.85 : event.type === 'death' ? 0.8 : event.type === 'blocked' ? 0.55 : event.type === 'attack-start' ? 0.35 : 0.65;
  const playbackRate = event.type === 'critical' ? 0.92 : event.type === 'dodge' ? 1.1 : 1;
  return buildDamageTypeAudioCue(event, Object.freeze({ assetId: asset?.id ?? null, path: asset?.path ?? null, available: asset?.available === true, fallback: asset?.source === 'fallback', volume: muted ? 0 : round(clamp(baseVolume, 0, maxVolume)), playbackRate: round(playbackRate), semantic }));
}
function hapticsFor(event: CombatEvent, device: CombatPresentationDevice, intensity: number, maxAmplitude: number): readonly CombatHapticPulse[] {
  if (device === 'keyboard' || device === 'mouse') return Object.freeze([]);
  const durationMs = event.type === 'critical' ? 90 : event.type === 'death' ? 120 : event.type === 'dodge' ? 45 : 65;
  const amplitude = clamp(intensity * (event.type === 'blocked' ? 0.55 : event.type === 'dodge' ? 0.45 : 0.8), 0, maxAmplitude);
  const frequencyHz = event.type === 'critical' ? 58 : event.type === 'death' ? 42 : event.type === 'blocked' ? 72 : 64;
  const typed = buildDamageTypeHapticCue(event, device, durationMs);
  if (typed.length === 0) return typed;
  const pulse = typed[0];
  return Object.freeze([Object.freeze({ ...pulse, amplitude: round(clamp(pulse.amplitude * amplitude / Math.max(0.001, intensity || 1), 0, maxAmplitude)) })]);
}

function vfxFor(event: CombatEvent, source: CombatantState | null, target: CombatantState | null, intensity: number): CombatVfxCue {
  const semantic = SEMANTICS[event.type];
  const asset = resolveCombatPresentationAsset(semantic, 'vfx');
  const direction = safeDirection(source, target);
  const seed = deterministicHash([event.tick, event.sourceId, event.targetId ?? 0, finite(event.damage, 0), finite(event.poiseDamage, 0)]);
  return Object.freeze({
    kind: VFX_BY_SEMANTIC[semantic],
    intensity: round(intensity),
    scale: round(0.75 + intensity * 0.8),
    durationMs: event.type === 'attack-start' ? 80 : event.type === 'dodge' ? 140 : event.type === 'death' ? 260 : 110,
    seed,
    direction: Object.freeze(direction),
    authoredAsset: asset?.source === 'shipped' && asset.available,
    materialDriven: true,
  });
}

function cueFor(event: CombatEvent, context: CombatPresentationContext, config: CombatPresentationConfig): CombatPresentationCue {
  const source = stateOf(context.states, event.sourceId);
  const target = stateOf(context.states, event.targetId);
  const position = midpoint(source?.position ?? null, target?.position ?? null);
  const direction = safeDirection(source, target);
  const intensity = semanticIntensity(event);
  const semantic = SEMANTICS[event.type];
  const critical = event.type === 'critical';
  const blocked = event.type === 'blocked' || event.type === 'parried';
  const defenseOutcome: CombatDefenseOutcome = event.type === 'parried' ? 'parried' : event.type === 'blocked' ? 'guarded' : 'none';
  const audio = audioFor(event, context.muted === true, config.audioMaxVolume);
  const camera = cameraFor(event, intensity, context.reducedMotion === true, config.cameraShakeMax);
  const hitstopTicks = hitstopFor(event, config.hitstopMaxTicks);
  const haptics = hapticsFor(event, context.device ?? 'virtual', intensity, config.hapticMaxAmplitude);
  const damageProfile = getCombatDamageTypeProfile(event.damageType);
  const baseVfx = vfxFor(event, source, target, intensity);
  const vfx = Object.freeze({ ...baseVfx, scale: round(baseVfx.scale * damageProfile.impactScale), durationMs: damageProfile.impactDurationMs });
  const spatialAudio = context.listener ? resolveCombatSpatialAudio(position, context.listener, 0) : null;
  const spatializedAudio = spatialAudio ? Object.freeze({ ...audio, volume: applySpatialAudioToVolume(audio.volume, spatialAudio) }) : audio;
  const reaction = resolveCombatReactionIntent({ cue: Object.freeze({ id: 'preview', tick: event.tick, priority: EVENT_PRIORITY[event.type], semantic, sourceId: event.sourceId, targetId: event.targetId ?? null, position: Object.freeze(position), direction: Object.freeze(direction), intensity: round(intensity), blocked, defenseOutcome, critical, hitstopTicks, vfx, audio, camera, haptics, fingerprint: 0, damageType: damageProfile.damageType, damageFamily: damageProfile.family, materialResponse: damageProfile.materialResponse, spatialAudio: null }), targetPoiseRatio: context.targetPoiseRatio, targetGrounded: context.targetGrounded });
  const fingerprint = deterministicHash([event.tick, event.sourceId, event.targetId ?? 0, EVENT_PRIORITY[event.type], Math.round(intensity * 1000)]);
  return Object.freeze({
    id: 'combat-' + eventFingerprint(event),
    tick: event.tick,
    priority: EVENT_PRIORITY[event.type],
    semantic,
    sourceId: event.sourceId,
    targetId: event.targetId ?? null,
    position: Object.freeze(position),
    direction: Object.freeze(direction),
    intensity: round(intensity),
    blocked, defenseOutcome, critical, hitstopTicks, vfx, audio: spatializedAudio, camera, haptics, fingerprint,
    damageType: damageProfile.damageType,
    damageFamily: damageProfile.family,
    materialResponse: damageProfile.materialResponse,
    spatialAudio,
    reaction,
  });
}

export class CombatPresentationDirector {
  readonly config: CombatPresentationConfig;
  #pending: CombatPresentationCue[] = [];
  #history: CombatPresentationFrame[] = [];
  #seen = new Set<string>();
  #seenOrder: string[] = [];
  #lastTick = -1;

  constructor(config: Partial<CombatPresentationConfig> = {}) { this.config = Object.freeze({ ...DEFAULT_CONFIG, ...config }); }

  ingest(events: readonly CombatEvent[], context: CombatPresentationContext): CombatPresentationFrame {
    const tick = events.reduce((max, event) => Math.max(max, event.tick), Math.max(0, this.#lastTick + 1));
    if (tick < this.#lastTick) throw new RangeError('combat presentation ticks must be monotonic');
    this.#lastTick = tick;
    const sorted = [...events].sort((a, b) => EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type] || a.sourceId - b.sourceId || (a.targetId ?? 0) - (b.targetId ?? 0) || a.type.localeCompare(b.type));
    let dropped = 0;
    const cues: CombatPresentationCue[] = [];
    for (const event of sorted) {
      const key = eventFingerprint(event);
      if (this.#seen.has(key)) continue;
      this.markSeen(key);
      if (cues.length >= this.config.maxCuesPerTick) { dropped += 1; continue; }
      cues.push(cueFor(event, context, this.config));
    }
    const hitstopTicks = cues.reduce((max, cue) => Math.max(max, cue.hitstopTicks), 0);
    const cameraShake = round(cues.reduce((sum, cue) => sum + cue.camera.amplitude, 0), 4);
    const digest = deterministicHash(cues.flatMap((cue) => [cue.tick, cue.sourceId, cue.targetId ?? 0, cue.fingerprint, Math.round(cue.intensity * 1000)]));
    const frame = Object.freeze({ version: 1 as const, tick, cues: Object.freeze(cues), hitstopTicks, cameraShake, eventCount: events.length, droppedCues: dropped, deterministicDigest: digest });
    this.#pending.push(...cues);
    if (this.#pending.length > this.config.maxPendingCues) this.#pending.splice(0, this.#pending.length - this.config.maxPendingCues);
    this.#history.push(frame);
    if (this.#history.length > this.config.maxHistoryFrames) this.#history.splice(0, this.#history.length - this.config.maxHistoryFrames);
    return frame;
  }

  drain(max = this.config.maxPendingCues): readonly CombatPresentationCue[] {
    const count = clamp(Math.floor(max), 0, this.#pending.length);
    return Object.freeze(this.#pending.splice(0, count));
  }

  latest(): CombatPresentationFrame | null { return this.#history.at(-1) ?? null; }
  history(): readonly CombatPresentationFrame[] { return Object.freeze([...this.#history]); }
  pendingCount(): number { return this.#pending.length; }
  seenCount(): number { return this.#seen.size; }

  snapshot(): Readonly<{ version: 1; lastTick: number; pending: readonly CombatPresentationCue[]; history: readonly CombatPresentationFrame[]; seen: readonly string[] }> {
    return Object.freeze({ version: 1 as const, lastTick: this.#lastTick, pending: Object.freeze([...this.#pending]), history: Object.freeze([...this.#history]), seen: Object.freeze([...this.#seenOrder]) });
  }

  restore(snapshot: Readonly<{ version: 1; lastTick: number; pending: readonly CombatPresentationCue[]; history: readonly CombatPresentationFrame[]; seen: readonly string[] }>): void {
    if (snapshot.version !== 1) throw new Error('unsupported combat presentation snapshot version');
    this.#lastTick = snapshot.lastTick;
    this.#pending = [...snapshot.pending].slice(-this.config.maxPendingCues);
    this.#history = [...snapshot.history].slice(-this.config.maxHistoryFrames);
    this.#seen = new Set(snapshot.seen.slice(-this.config.dedupeHistorySize));
    this.#seenOrder = [...snapshot.seen.slice(-this.config.dedupeHistorySize)];
  }

  reset(): void { this.#pending = []; this.#history = []; this.#seen.clear(); this.#seenOrder = []; this.#lastTick = -1; }

  private markSeen(key: string): void {
    this.#seen.add(key); this.#seenOrder.push(key);
    if (this.#seenOrder.length <= this.config.dedupeHistorySize) return;
    const stale = this.#seenOrder.shift();
    if (stale) this.#seen.delete(stale);
  }
}

export function createCombatPresentationDirector(config: Partial<CombatPresentationConfig> = {}): CombatPresentationDirector { return new CombatPresentationDirector(config); }

export function buildCombatPresentationFrame(events: readonly CombatEvent[], context: CombatPresentationContext, config: Partial<CombatPresentationConfig> = {}): CombatPresentationFrame {
  return new CombatPresentationDirector(config).ingest(events, context);
}

export function validateCombatPresentationFrame(frame: CombatPresentationFrame): Readonly<{ valid: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (frame.version !== 1) errors.push('unsupported presentation version');
  if (!Number.isInteger(frame.tick) || frame.tick < 0) errors.push('tick must be a non-negative integer');
  if (frame.cues.length > 128) errors.push('pending cue frame exceeds hard safety budget');
  if (!Number.isFinite(frame.cameraShake) || frame.cameraShake < 0) errors.push('camera shake must be finite and non-negative');
  for (const cue of frame.cues) {
    if (!Number.isFinite(cue.intensity) || cue.intensity < 0 || cue.intensity > 1) errors.push(cue.id + ': intensity out of bounds');
    if (![cue.position.x, cue.position.y, cue.position.z, cue.direction.x, cue.direction.y, cue.direction.z].every(Number.isFinite)) errors.push(cue.id + ': non-finite vector');
    if (cue.hitstopTicks < 0 || cue.hitstopTicks > 6) errors.push(cue.id + ': hitstop out of bounds');
    if (cue.audio.volume < 0 || cue.audio.volume > 1) errors.push(cue.id + ': audio volume out of bounds');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}