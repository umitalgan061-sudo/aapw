/** Damage-type response profiles for combat presentation consumers. */
import type { DamageType, CombatEvent } from './combatSimulation';
import type { CombatVfxKind, CombatAudioCue, CombatPresentationDevice, CombatHapticPulse } from './combatPresentationV1';

export type CombatImpactMaterialResponse = 'metallic-spark' | 'cloth-rip' | 'leather-hit' | 'stone-thud' | 'frost-shard' | 'arcane-pulse';
export interface CombatDamageTypeProfile {
  readonly damageType: DamageType;
  readonly family: 'physical' | 'elemental' | 'arcane';
  readonly materialResponse: CombatImpactMaterialResponse;
  readonly vfxKind: CombatVfxKind;
  readonly impactScale: number;
  readonly impactDurationMs: number;
  readonly cameraScale: number;
  readonly audioPitch: number;
  readonly audioGain: number;
  readonly hapticFrequencyHz: number;
  readonly hapticGain: number;
  readonly surfaceGlossResponse: number;
  readonly recoilBias: number;
  readonly uiLabel: string;
}

const PROFILES: Readonly<Record<DamageType, CombatDamageTypeProfile>> = Object.freeze({
  slash: Object.freeze({ damageType: 'slash', family: 'physical', materialResponse: 'metallic-spark', vfxKind: 'impact-spark', impactScale: 1, impactDurationMs: 100, cameraScale: 1, audioPitch: 1.04, audioGain: 0.68, hapticFrequencyHz: 68, hapticGain: 0.75, surfaceGlossResponse: 0.82, recoilBias: 1.1, uiLabel: 'KESİCİ' }),
  pierce: Object.freeze({ damageType: 'pierce', family: 'physical', materialResponse: 'leather-hit', vfxKind: 'impact-spark', impactScale: 0.9, impactDurationMs: 85, cameraScale: 0.9, audioPitch: 1.18, audioGain: 0.62, hapticFrequencyHz: 76, hapticGain: 0.68, surfaceGlossResponse: 0.65, recoilBias: 0.92, uiLabel: 'DELİCİ' }),
  blunt: Object.freeze({ damageType: 'blunt', family: 'physical', materialResponse: 'stone-thud', vfxKind: 'impact-spark', impactScale: 1.12, impactDurationMs: 135, cameraScale: 1.08, audioPitch: 0.78, audioGain: 0.72, hapticFrequencyHz: 54, hapticGain: 0.92, surfaceGlossResponse: 0.38, recoilBias: 1.22, uiLabel: 'EZİCİ' }),
  fire: Object.freeze({ damageType: 'fire', family: 'elemental', materialResponse: 'metallic-spark', vfxKind: 'critical-burst', impactScale: 1.18, impactDurationMs: 160, cameraScale: 1.04, audioPitch: 0.91, audioGain: 0.8, hapticFrequencyHz: 48, hapticGain: 0.82, surfaceGlossResponse: 0.58, recoilBias: 1.05, uiLabel: 'ATEŞ' }),
  frost: Object.freeze({ damageType: 'frost', family: 'elemental', materialResponse: 'frost-shard', vfxKind: 'critical-burst', impactScale: 1.05, impactDurationMs: 180, cameraScale: 0.95, audioPitch: 1.22, audioGain: 0.73, hapticFrequencyHz: 88, hapticGain: 0.7, surfaceGlossResponse: 0.92, recoilBias: 0.96, uiLabel: 'BUZ' }),
  arcane: Object.freeze({ damageType: 'arcane', family: 'arcane', materialResponse: 'arcane-pulse', vfxKind: 'critical-burst', impactScale: 1.25, impactDurationMs: 200, cameraScale: 1.12, audioPitch: 0.64, audioGain: 0.84, hapticFrequencyHz: 42, hapticGain: 0.9, surfaceGlossResponse: 0.98, recoilBias: 1.15, uiLabel: 'GİZEMLİ' }),
});

export function getCombatDamageTypeProfile(damageType: DamageType | null | undefined): CombatDamageTypeProfile { return PROFILES[damageType ?? 'slash']; }
export function listCombatDamageTypeProfiles(): readonly CombatDamageTypeProfile[] { return Object.freeze(Object.values(PROFILES)); }

export function scaleImpactByDamageType(damageType: DamageType | null | undefined, baseIntensity: number): number {
  const profile = getCombatDamageTypeProfile(damageType);
  return Math.max(0, Math.min(1, (Number.isFinite(baseIntensity) ? baseIntensity : 0) * profile.impactScale));
}

export function resolveCombatSurfaceReaction(damageType: DamageType | null | undefined, surface: 'skin' | 'cloth' | 'leather' | 'metal' | 'stone' | 'ice'): Readonly<{ response: CombatImpactMaterialResponse; intensity: number; pulse: number }> {
  const profile = getCombatDamageTypeProfile(damageType);
  const surfaceFactor = surface === 'metal' ? profile.surfaceGlossResponse : surface === 'ice' ? Math.min(1, profile.surfaceGlossResponse + 0.12) : surface === 'stone' ? 0.88 : surface === 'cloth' ? 0.75 : surface === 'leather' ? 0.82 : 0.9;
  return Object.freeze({ response: profile.materialResponse, intensity: Number(surfaceFactor.toFixed(3)), pulse: Number((profile.recoilBias * surfaceFactor).toFixed(3)) });
}

export function buildDamageTypeAudioCue(event: Pick<CombatEvent, 'damageType' | 'type'>, base: CombatAudioCue): CombatAudioCue {
  const profile = getCombatDamageTypeProfile(event.damageType);
  return Object.freeze({ ...base, volume: Number(Math.min(1, base.volume * profile.audioGain).toFixed(3)), playbackRate: Number((base.playbackRate * profile.audioPitch).toFixed(3)) });
}

export function buildDamageTypeHapticCue(event: Pick<CombatEvent, 'damageType' | 'type'>, device: CombatPresentationDevice, durationMs = 65): readonly CombatHapticPulse[] {
  if (device === 'keyboard' || device === 'mouse') return Object.freeze([]);
  const profile = getCombatDamageTypeProfile(event.damageType);
  return Object.freeze([Object.freeze({ device, durationMs: Math.round(durationMs * Math.max(0.7, profile.recoilBias)), amplitude: Number(profile.hapticGain.toFixed(3)), frequencyHz: profile.hapticFrequencyHz, attack: 0.1, release: 0.3 })]);
}

export function buildDamageTypeUiLabel(event: Pick<CombatEvent, 'damageType'>): string { return getCombatDamageTypeProfile(event.damageType).uiLabel; }

export function validateCombatDamageTypeProfiles(profiles: readonly CombatDamageTypeProfile[] = listCombatDamageTypeProfiles()): Readonly<{ valid: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (profiles.length !== 6) errors.push('expected six damage type profiles');
  for (const profile of profiles) {
    if (!(profile.damageType in PROFILES)) errors.push('unknown damage type ' + profile.damageType);
    const values = [profile.impactScale, profile.cameraScale, profile.audioPitch, profile.audioGain, profile.hapticFrequencyHz, profile.hapticGain, profile.surfaceGlossResponse, profile.recoilBias];
    if (!values.every(Number.isFinite)) errors.push(profile.damageType + ': non-finite profile value');
    if (profile.audioGain < 0 || profile.audioGain > 1) errors.push(profile.damageType + ': audio gain outside 0..1');
    if (profile.hapticGain < 0 || profile.hapticGain > 1) errors.push(profile.damageType + ': haptic gain outside 0..1');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}