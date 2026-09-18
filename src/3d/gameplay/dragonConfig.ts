/**
 * Strict TypeScript source of truth for the live dragon gameplay configuration.
 *
 * The legacy `dragonConfig.js` module remains a compatibility barrel so existing callers keep the
 * same import path while the domain moves to typed runtime contracts.
 */

export interface DragonNoticeToast {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly desc: string;
  readonly color: string;
}

export interface DragonSpawn {
  readonly id: string;
  readonly seatId: string;
  readonly altitudeMeters: number;
  readonly circleRadiusMeters: number;
  readonly speedMps: number;
  readonly bankAngleRadians: number;
  readonly noticeRadiusMeters: number;
  readonly noticeToast: DragonNoticeToast;
  readonly reactiveSpeedMultiplier: number;
  readonly reactiveBankAngleRadians: number;
  readonly reactiveTransitionSeconds: number;
  readonly alarmRadiusMeters: number;
  readonly diveDropMeters: number;
  readonly diveLateralPullFraction: number;
  readonly diveTransitionSeconds: number;
  readonly minAltitudeAboveGroundMeters: number;
  readonly pursuitRadiusMeters: number;
  readonly pursuitCenterSpeedMps: number;
  readonly pursuitCircleRadiusMeters: number;
  readonly pursuitTransitionSeconds: number;
  readonly pursuitMaxSeconds: number;
  readonly attackLateralPullFraction: number;
  readonly attackDropMeters: number;
  readonly biteDamage: number;
}

export interface DragonConfig {
  readonly MODEL_URL: string;
  readonly TEXTURES_RESOURCE_PATH: string;
  readonly FLY_CLIP_NAME: string;
  readonly SCALE: number;
  readonly TARGET_MAX_DIMENSION_METERS: number;
  readonly SPAWNS: readonly DragonSpawn[];
}

const DRAGON_CONFIG_SOURCE = {
  MODEL_URL: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx',
  TEXTURES_RESOURCE_PATH: 'assets/models/creatures/dragon/textures/',
  FLY_CLIP_NAME: 'Armature|Fly_New',
  SCALE: 20 / 9776.562514437788,
  TARGET_MAX_DIMENSION_METERS: 20,
  SPAWNS: [
    {
      id: 'umit-dragon-1',
      seatId: 'umit',
      altitudeMeters: 90,
      circleRadiusMeters: 150,
      speedMps: 12,
      bankAngleRadians: 0.35,
      noticeRadiusMeters: 220,
      noticeToast: {
        id: 'dragon_sighted_real',
        icon: '🐉',
        title: 'Ejderha Görüldü!',
        desc: 'Gökyüzünde gerçek bir ejderha süzülüyor — kalenin üzerinde daireler çiziyor.',
        color: '#c8430a',
      },
      reactiveSpeedMultiplier: 1.6,
      reactiveBankAngleRadians: 0.65,
      reactiveTransitionSeconds: 1.2,
      alarmRadiusMeters: 110,
      diveDropMeters: 30,
      diveLateralPullFraction: 0.3,
      diveTransitionSeconds: 0.8,
      minAltitudeAboveGroundMeters: 12,
      pursuitRadiusMeters: 160,
      pursuitCenterSpeedMps: 10,
      pursuitCircleRadiusMeters: 55,
      pursuitTransitionSeconds: 2.5,
      pursuitMaxSeconds: 18,
      attackLateralPullFraction: 0.9,
      attackDropMeters: 78,
      biteDamage: 20,
    },
  ],
} as const satisfies DragonConfig;

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested as object);
    }
  }
  return Object.freeze(value);
}

export const DRAGON_CONFIG: Readonly<DragonConfig> = deepFreeze({
  ...DRAGON_CONFIG_SOURCE,
  SPAWNS: DRAGON_CONFIG_SOURCE.SPAWNS.map((spawn) => ({
    ...spawn,
    noticeToast: { ...spawn.noticeToast },
  })),
});

const assertPositive = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
};

const assertUnitInterval = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be within [0, 1].`);
};

export function validateDragonConfig(config: DragonConfig = DRAGON_CONFIG): void {
  if (!config.MODEL_URL.endsWith('.fbx')) throw new Error('Dragon model must be an FBX asset path.');
  if (!config.TEXTURES_RESOURCE_PATH.endsWith('/')) throw new Error('Dragon texture resource path must end with /.');
  if (!config.FLY_CLIP_NAME) throw new Error('Dragon flight clip name is required.');
  assertPositive('Dragon scale', config.SCALE);
  assertPositive('Dragon target dimension', config.TARGET_MAX_DIMENSION_METERS);
  if (config.SPAWNS.length === 0) throw new Error('At least one dragon spawn is required.');

  for (const spawn of config.SPAWNS) {
    if (!spawn.id || !spawn.seatId) throw new Error('Dragon spawn identity is required.');
    assertPositive('Dragon altitude', spawn.altitudeMeters);
    assertPositive('Dragon circle radius', spawn.circleRadiusMeters);
    assertPositive('Dragon speed', spawn.speedMps);
    assertPositive('Dragon notice radius', spawn.noticeRadiusMeters);
    assertPositive('Dragon reactive transition', spawn.reactiveTransitionSeconds);
    assertPositive('Dragon alarm radius', spawn.alarmRadiusMeters);
    assertPositive('Dragon dive transition', spawn.diveTransitionSeconds);
    assertPositive('Dragon minimum terrain clearance', spawn.minAltitudeAboveGroundMeters);
    assertPositive('Dragon pursuit radius', spawn.pursuitRadiusMeters);
    assertPositive('Dragon pursuit center speed', spawn.pursuitCenterSpeedMps);
    assertPositive('Dragon pursuit ring radius', spawn.pursuitCircleRadiusMeters);
    assertPositive('Dragon pursuit transition', spawn.pursuitTransitionSeconds);
    assertPositive('Dragon pursuit timeout', spawn.pursuitMaxSeconds);
    assertPositive('Dragon bite damage', spawn.biteDamage);
    assertUnitInterval('Dragon dive lateral pull fraction', spawn.diveLateralPullFraction);
    assertUnitInterval('Dragon attack lateral pull fraction', spawn.attackLateralPullFraction);
    if (spawn.alarmRadiusMeters <= spawn.altitudeMeters) throw new Error('Dragon alarm radius must clear flight altitude.');
    if (spawn.pursuitRadiusMeters <= spawn.altitudeMeters) throw new Error('Dragon pursuit radius must clear flight altitude.');
    if (spawn.minAltitudeAboveGroundMeters >= spawn.altitudeMeters) throw new Error('Dragon terrain clearance must be below cruise altitude.');
    if (!spawn.noticeToast.id || !spawn.noticeToast.title || !spawn.noticeToast.desc) throw new Error('Dragon notice toast is incomplete.');
  }
}

validateDragonConfig();
