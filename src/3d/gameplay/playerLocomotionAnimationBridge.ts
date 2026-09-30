/** Production TypeScript owner for the consumer-facing deterministic locomotion-animation bridge. */

import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  resolvePlayerDirectionalFingerprint,
  resolvePlayerDirectionalFullPresentation,
} from './playerDirectionalLocomotionPolicy.js';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_VERSION,
  resolvePlayerLocomotionAnticipationProfile,
} from './playerLocomotionAnticipationPolicy.js';

export const PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION = '2026-09-15-v1' as const;

export const PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS = Object.freeze([
  'idle',
  'forward',
  'forwardRight',
  'right',
  'backRight',
  'back',
  'backLeft',
  'left',
  'forwardLeft',
  'start',
  'accelerate',
  'cruise',
  'brake',
  'stop',
  'strafe',
  'pivot',
  'recover',
] as const);

export type PlayerLocomotionChannel = typeof PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS[number];
export type PlayerDirectionalKey = typeof PLAYER_DIRECTIONAL_DIRECTIONS[number];

export interface PlayerLocomotionAnimationProfile extends Record<string, unknown> {
  readonly anticipatedBlendWeights?: Partial<Record<PlayerDirectionalKey, unknown>>;
  readonly mode?: unknown;
  readonly recoveryWeight?: unknown;
  readonly startWeight?: unknown;
  readonly brakeWeight?: unknown;
  readonly pivotWeight?: unknown;
  readonly confidence?: unknown;
  readonly groundRisk?: unknown;
  readonly contact?: { readonly plant?: unknown };
  readonly lookAheadSeconds?: unknown;
  readonly anticipatedDirection?: unknown;
  readonly playbackRate?: unknown;
  readonly phase?: unknown;
  readonly semanticState?: unknown;
}

export interface PlayerLocomotionAnimationRequestInput extends Record<string, unknown> {
  readonly planarSpeedMps?: unknown;
  readonly turnRateDegreesPerSecond?: unknown;
  readonly surfaceConfidence?: unknown;
  readonly surfaceSlip?: unknown;
  readonly velocity?: unknown;
  readonly facing?: unknown;
  readonly deltaSeconds?: unknown;
}

export interface PlayerLocomotionAnimationRequest {
  readonly version: typeof PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION;
  readonly anticipationVersion: typeof PLAYER_LOCOMOTION_ANTICIPATION_VERSION;
  readonly semanticState: string;
  readonly mode: string;
  readonly presentDirection: PlayerDirectionalKey;
  readonly anticipatedDirection: PlayerDirectionalKey;
  readonly channels: Readonly<Record<PlayerLocomotionChannel, number>>;
  readonly envelope: Readonly<{
    directional: number;
    gait: number;
    contact: number;
    anticipation: number;
    confidence: number;
    groundRisk: number;
    primaryDirection: PlayerDirectionalKey;
  }>;
  readonly playbackRate: number;
  readonly phase: number;
  readonly footPlant: number;
  readonly confidence: number;
  readonly fingerprint: string;
}

export interface PlayerLocomotionAnimationRequestValidation {
  readonly ok: boolean;
  readonly channelsOk: boolean;
  readonly phaseOk: boolean;
  readonly rateOk: boolean;
  readonly confidenceOk: boolean;
  readonly directionOk: boolean;
}

export interface PlayerLocomotionAnimationRequestController {
  readonly update: (
    input?: PlayerLocomotionAnimationRequestInput,
  ) => Readonly<{ request: PlayerLocomotionAnimationRequest; frameCount: number }>;
  readonly read: () => Readonly<{ frameCount: number; lastFingerprint: string }>;
  readonly reset: () => void;
}

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const round = (value: unknown, digits = 4): number => {
  const numeric = finite(value, 0);
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
};

const freeze = <T>(value: T): T => Object.freeze(value);

function normalizePlayerLocomotionAnimationDirectionalWeights(
  weights: Partial<Record<PlayerDirectionalKey, unknown>> = {},
): Readonly<Record<PlayerDirectionalKey, number>> {
  const result = {} as Record<PlayerDirectionalKey, number>;
  for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) {
    result[direction] = clamp(finite(weights[direction]), 0, 1);
  }

  const sum = Object.values(result).reduce((total, value) => total + value, 0);
  if (sum <= 0) {
    result.forward = 1;
  } else {
    for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) {
      result[direction] = round(result[direction] / sum);
    }
  }
  return freeze(result);
}

export function resolvePlayerLocomotionChannelWeights(
  profile: PlayerLocomotionAnimationProfile = {},
): Readonly<Record<PlayerLocomotionChannel, number>> {
  const channels = {} as Record<PlayerLocomotionChannel, number>;
  for (const channel of PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS) channels[channel] = 0;

  const directional = normalizePlayerLocomotionAnimationDirectionalWeights(profile.anticipatedBlendWeights);
  for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) {
    const channel = (
      {
        forward: 'forward',
        'forward-right': 'forwardRight',
        right: 'right',
        'back-right': 'backRight',
        back: 'back',
        'back-left': 'backLeft',
        left: 'left',
        'forward-left': 'forwardLeft',
      } as const
    )[direction];
    channels[channel] = directional[direction];
  }

  const mode = String(profile.mode ?? 'idle') as PlayerLocomotionChannel;
  const recovery = finite(profile.recoveryWeight, mode === 'recover' ? 1 : 0);
  const modeValue =
    mode === 'start' || mode === 'accelerate'
      ? profile.startWeight
      : mode === 'cruise'
        ? 1
        : mode === 'brake' || mode === 'stop'
          ? profile.brakeWeight
          : mode === 'strafe'
            ? Math.max(finite(profile.startWeight), finite(profile.brakeWeight) * 0.25)
            : mode === 'pivot'
              ? profile.pivotWeight
              : mode === 'recover'
                ? recovery
                : 0;

  if (mode in channels) {
    channels[mode] = Math.max(channels[mode], round(clamp(finite(modeValue), 0, 1)));
  }

  return freeze(channels);
}

export function resolvePlayerLocomotionChannelEnvelope(
  profile: PlayerLocomotionAnimationProfile = {},
): Readonly<{
  directional: number;
  gait: number;
  contact: number;
  anticipation: number;
  confidence: number;
  groundRisk: number;
  primaryDirection: PlayerDirectionalKey;
}> {
  const confidence = clamp(finite(profile.confidence, 1), 0, 1);
  const groundRisk = clamp(finite(profile.groundRisk), 0, 1);
  const damping = clamp(0.72 + confidence * 0.28 - groundRisk * 0.18, 0.5, 1);
  const mode = String(profile.mode ?? 'idle');

  return freeze({
    directional: round(damping),
    gait: round(clamp(damping * (mode === 'pivot' ? 0.84 : 1), 0.5, 1)),
    contact: round(clamp(finite(profile.contact?.plant) * damping, 0, 1)),
    anticipation: round(clamp(0.45 + finite(profile.lookAheadSeconds) * 1.2, 0, 1)),
    confidence: round(confidence),
    groundRisk: round(groundRisk),
    primaryDirection: PLAYER_DIRECTIONAL_DIRECTIONS.includes(profile.anticipatedDirection as PlayerDirectionalKey)
      ? profile.anticipatedDirection as PlayerDirectionalKey
      : 'forward',
  });
}

export function resolvePlayerLocomotionAnimationRequest(
  input: PlayerLocomotionAnimationRequestInput = {},
  previous: PlayerLocomotionAnimationRequestInput | null = null,
): PlayerLocomotionAnimationRequest {
  const previousState = String(previous?.semanticState ?? 'idle');
  const directional = resolvePlayerDirectionalFullPresentation(input, previousState);
  const profile = resolvePlayerLocomotionAnticipationProfile(input, previous);
  const channels = resolvePlayerLocomotionChannelWeights(profile);
  const envelope = resolvePlayerLocomotionChannelEnvelope(profile);
  const anticipatedDirection = PLAYER_DIRECTIONAL_DIRECTIONS.includes(profile.anticipatedDirection as PlayerDirectionalKey)
    ? profile.anticipatedDirection as PlayerDirectionalKey
    : 'forward';

  return freeze({
    version: PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION,
    anticipationVersion: PLAYER_LOCOMOTION_ANTICIPATION_VERSION,
    semanticState: String(profile.semanticState ?? 'idle'),
    mode: String(profile.mode ?? 'idle'),
    presentDirection: PLAYER_DIRECTIONAL_DIRECTIONS.includes(directional.dominantDirection as PlayerDirectionalKey)
      ? directional.dominantDirection as PlayerDirectionalKey
      : 'forward',
    anticipatedDirection,
    channels,
    envelope,
    playbackRate: round(profile.playbackRate, 4),
    phase: round(profile.phase, 4),
    footPlant: round(profile.contact?.plant, 4),
    confidence: round(profile.confidence, 4),
    fingerprint: String(resolvePlayerDirectionalFingerprint({
      semanticState: profile.semanticState,
      mode: profile.mode,
      channels,
      envelope,
      playbackRate: profile.playbackRate,
    })),
  });
}

export function validatePlayerLocomotionAnimationRequest(
  request: Partial<PlayerLocomotionAnimationRequest> | null | undefined,
): PlayerLocomotionAnimationRequestValidation {
  const channels = request?.channels ? Object.values(request.channels) : [];
  const channelsOk =
    channels.length === PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length &&
    channels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const phase = finite(request?.phase, Number.NaN);
  const rate = finite(request?.playbackRate, Number.NaN);
  const confidence = finite(request?.confidence, Number.NaN);

  return freeze({
    ok: channelsOk
      && phase >= 0 && phase < 1
      && rate >= 0.72 && rate <= 1.35
      && confidence >= 0 && confidence <= 1
      && PLAYER_DIRECTIONAL_DIRECTIONS.includes(request?.anticipatedDirection as PlayerDirectionalKey),
    channelsOk,
    phaseOk: Number.isFinite(phase) && phase >= 0 && phase < 1,
    rateOk: Number.isFinite(rate) && rate >= 0.72 && rate <= 1.35,
    confidenceOk: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1,
    directionOk: PLAYER_DIRECTIONAL_DIRECTIONS.includes(request?.anticipatedDirection as PlayerDirectionalKey),
  });
}

export function createPlayerLocomotionAnimationRequestController({
  onRequest = null,
}: {
  readonly onRequest?: ((request: PlayerLocomotionAnimationRequest) => void) | null;
} = {}): PlayerLocomotionAnimationRequestController {
  let previous: PlayerLocomotionAnimationRequestInput | null = null;
  let frameCount = 0;
  let lastFingerprint = '';

  return freeze({
    update(input: PlayerLocomotionAnimationRequestInput = {}) {
      const request = resolvePlayerLocomotionAnimationRequest(input, previous);
      frameCount += 1;
      previous = freeze({
        planarSpeedMps: input.planarSpeedMps,
        semanticState: request.semanticState,
        directionAngleRadians: finite(input.directionAngleRadians),
        phase: request.phase,
        turnRateDegreesPerSecond: input.turnRateDegreesPerSecond,
        surfaceConfidence: input.surfaceConfidence,
        surfaceSlip: input.surfaceSlip,
      });

      if (typeof onRequest === 'function' && request.fingerprint !== lastFingerprint) onRequest(request);
      lastFingerprint = request.fingerprint;

      return freeze({ request, frameCount });
    },
    read() {
      return freeze({ frameCount, lastFingerprint });
    },
    reset() {
      previous = null;
      frameCount = 0;
      lastFingerprint = '';
    },
  });
}

export function resolvePlayerLocomotionChannelCapabilities(): readonly string[] {
  return Object.freeze([
    'explicit-eight-way',
    'start-stop-channels',
    'pivot-channel',
    'contact-envelope',
    'ground-risk-damping',
    'immutable-request',
    'deterministic-fingerprint',
    'consumer-only',
  ]);
}

export function auditPlayerLocomotionAnimationBridge(): Readonly<{
  version: typeof PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION;
  channelCount: number;
  valid: boolean;
  immutable: boolean;
  fingerprintLength: number;
}> {
  const request = resolvePlayerLocomotionAnimationRequest({
    velocity: { x: 0, y: 1 },
    facing: { x: 0, y: 1 },
    planarSpeedMps: 3.5,
    deltaSeconds: 1 / 60,
    surfaceConfidence: 1,
    surfaceSlip: 0,
  });

  return freeze({
    version: PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION,
    channelCount: PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length,
    valid: validatePlayerLocomotionAnimationRequest(request).ok,
    immutable: Object.isFrozen(request) && Object.isFrozen(request.channels),
    fingerprintLength: request.fingerprint.length,
  });
}
