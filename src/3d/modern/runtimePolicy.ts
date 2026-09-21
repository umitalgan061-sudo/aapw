import type { PlatformError, QualityTier, RenderBackend, Result } from './types';
import { checksum, clamp01 } from './deterministic';
import type { RuntimeProfile } from './runtimeConfig';

export interface RuntimePolicyInput {
  readonly backend: RenderBackend;
  readonly quality: QualityTier;
  readonly pressure: number;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
  readonly saveData: boolean;
  readonly batteryLevel?: number;
  readonly batteryCharging?: boolean;
  readonly reducedMotion?: boolean;
}

export interface RuntimePolicyDecision {
  readonly backend: RenderBackend;
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly simulationRate: number;
  readonly streamingMultiplier: number;
  readonly postProcessing: boolean;
  readonly shadows: boolean;
  readonly animationsRate: number;
  readonly reason: readonly string[];
  readonly digest: string;
}

const QUALITY_ORDER: readonly QualityTier[] = ['minimal', 'balanced', 'high', 'ultra'];

function lowerQuality(value: QualityTier, steps: number): QualityTier {
  const index = QUALITY_ORDER.indexOf(value);
  return QUALITY_ORDER[Math.max(0, index - Math.max(0, Math.trunc(steps)))] ?? 'minimal';
}

/** Central non-renderer policy that turns runtime pressure and user preferences into stable budgets. */
export function evaluateRuntimePolicy(input: RuntimePolicyInput): RuntimePolicyDecision {
  const pressure = clamp01(input.pressure);
  const memory = clamp01(input.memoryPressure);
  const thermal = clamp01(input.thermalPressure);
  let quality = input.quality;
  const reason: string[] = [];

  if (pressure >= 0.88 || memory >= 0.95 || thermal >= 0.9) {
    quality = lowerQuality(quality, 2);
    reason.push('critical-pressure');
  } else if (pressure >= 0.65 || memory >= 0.8 || thermal >= 0.75) {
    quality = lowerQuality(quality, 1);
    reason.push('high-pressure');
  }
  if (input.saveData) {
    quality = lowerQuality(quality, 1);
    reason.push('save-data');
  }
  if (input.reducedMotion) reason.push('reduced-motion');

  const battery = input.batteryLevel === undefined ? 1 : clamp01(input.batteryLevel);
  if (!input.batteryCharging && battery < 0.2) {
    quality = lowerQuality(quality, 1);
    reason.push('low-battery');
  }

  const renderScaleBase = quality === 'ultra' ? 1 : quality === 'high' ? 0.9 : quality === 'balanced' ? 0.78 : 0.66;
  const renderScale = Math.max(0.5, Math.min(1, renderScaleBase - Math.max(0, pressure - 0.45) * 0.22));
  const simulationRate = pressure >= 0.92 ? 0.75 : pressure >= 0.72 ? 0.9 : 1;
  const streamingMultiplier = pressure >= 0.9 || memory >= 0.9 ? 0.45 : pressure >= 0.65 || memory >= 0.75 ? 0.7 : 1;
  const postProcessing = quality !== 'minimal' && thermal < 0.85;
  const shadows = quality === 'high' || quality === 'ultra';
  const animationsRate = input.reducedMotion ? 0.55 : pressure >= 0.9 ? 0.75 : 1;

  return Object.freeze({
    backend: input.backend,
    quality,
    renderScale,
    simulationRate,
    streamingMultiplier,
    postProcessing,
    shadows,
    animationsRate,
    reason: Object.freeze(reason),
    digest: checksum({ backend: input.backend, quality, renderScale, simulationRate, streamingMultiplier, postProcessing, shadows, animationsRate, reason }),
  });
}

export interface RuntimePolicyEnvelope {
  readonly version: 1;
  readonly profile: RuntimeProfile['name'];
  readonly decision: RuntimePolicyDecision;
  readonly createdAtTick: number;
}

export function createPolicyEnvelope(profile: RuntimeProfile, input: RuntimePolicyInput, tick: number): RuntimePolicyEnvelope {
  const decision = evaluateRuntimePolicy(input);
  return Object.freeze({ version: 1, profile: profile.name, decision, createdAtTick: Math.max(0, Math.trunc(tick)) });
}

export function validatePolicyDecision(decision: RuntimePolicyDecision): Result<RuntimePolicyDecision> {
  if (decision.renderScale < 0.5 || decision.renderScale > 1) return invalid('POLICY_SCALE_INVALID', 'renderScale must be inside [0.5,1]');
  if (decision.simulationRate <= 0 || decision.simulationRate > 1) return invalid('POLICY_SIMULATION_INVALID', 'simulationRate must be inside (0,1]');
  if (decision.streamingMultiplier <= 0 || decision.streamingMultiplier > 1) return invalid('POLICY_STREAMING_INVALID', 'streamingMultiplier must be inside (0,1]');
  if (decision.animationsRate <= 0 || decision.animationsRate > 1) return invalid('POLICY_ANIMATION_INVALID', 'animationsRate must be inside (0,1]');
  if (!decision.digest || decision.digest.length !== 8) return invalid('POLICY_DIGEST_INVALID', 'decision digest is invalid');
  return { ok: true, value: decision };
}

function invalid(code: string, message: string): Result<never> {
  const error: PlatformError = { code, message, retryable: false };
  return { ok: false, error };
}
