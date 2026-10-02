import type { QualityTier } from './contracts';

export interface ProductionProfile {
  readonly name:
    | 'high-end'
    | 'standard'
    | 'mobile'
    | 'constrained';
  readonly quality: QualityTier;
  readonly maxEntities: number;
  readonly maxParticles: number;
  readonly maxAudioVoices: number;
  readonly maxWorkers: number;
  readonly maxResidentBytes: number;
  readonly tickHz: number;
}

export const PRODUCTION_PROFILES:
  Readonly<Record<
    ProductionProfile['name'],
    ProductionProfile
  >> = Object.freeze({
    'high-end': Object.freeze({
      name: 'high-end',
      quality: 'cinematic',
      maxEntities: 100000,
      maxParticles: 12000,
      maxAudioVoices: 192,
      maxWorkers: 8,
      maxResidentBytes:
        1536 * 1024 * 1024,
      tickHz: 60,
    }),
    standard: Object.freeze({
      name: 'standard',
      quality: 'high',
      maxEntities: 50000,
      maxParticles: 6000,
      maxAudioVoices: 128,
      maxWorkers: 6,
      maxResidentBytes:
        768 * 1024 * 1024,
      tickHz: 60,
    }),
    mobile: Object.freeze({
      name: 'mobile',
      quality: 'balanced',
      maxEntities: 22000,
      maxParticles: 2500,
      maxAudioVoices: 64,
      maxWorkers: 4,
      maxResidentBytes:
        384 * 1024 * 1024,
      tickHz: 30,
    }),
    constrained: Object.freeze({
      name: 'constrained',
      quality: 'minimal',
      maxEntities: 8000,
      maxParticles: 700,
      maxAudioVoices: 32,
      maxWorkers: 2,
      maxResidentBytes:
        192 * 1024 * 1024,
      tickHz: 30,
    }),
  });

export function selectProductionProfile(
  hardwareConcurrency: number,
  memoryGb: number | null,
  saveData: boolean,
): ProductionProfile {
  if (
    saveData
    || (memoryGb !== null && memoryGb < 3)
  ) {
    return PRODUCTION_PROFILES.constrained;
  }

  if (
    hardwareConcurrency <= 4
    || (memoryGb !== null && memoryGb < 6)
  ) {
    return PRODUCTION_PROFILES.mobile;
  }

  if (
    hardwareConcurrency >= 12
    && (memoryGb === null || memoryGb >= 12)
  ) {
    return PRODUCTION_PROFILES['high-end'];
  }

  return PRODUCTION_PROFILES.standard;
}
