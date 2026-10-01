/** Deterministic micro-timeline for combat impact presentation. */
import type { CombatPresentationCue } from './combatPresentationV1';
import { criticallyDamped, roundDeterministic } from './deterministicMath';

export type CombatTimelineStage = 'hitstop' | 'impact-flash' | 'recoil' | 'camera-settle' | 'clear';
export interface CombatTimelineConfig { readonly hitstopMsPerTick: number; readonly impactFlashMs: number; readonly recoilMs: number; readonly cameraSettleMs: number; readonly maxDurationMs: number; }
export interface CombatTimelineSample { readonly tick: number; readonly elapsedMs: number; readonly stage: CombatTimelineStage; readonly normalized: number; readonly intensity: number; readonly cameraWeight: number; readonly recoilWeight: number; readonly flashWeight: number; readonly hapticWeight: number; }
export interface CombatTimeline { readonly cueId: string; readonly totalDurationMs: number; readonly peakIntensity: number; readonly stages: readonly { readonly stage: CombatTimelineStage; readonly startMs: number; readonly endMs: number }[]; sample(elapsedMs: number): CombatTimelineSample; }

const DEFAULT_CONFIG: CombatTimelineConfig = Object.freeze({ hitstopMsPerTick: 16.667, impactFlashMs: 55, recoilMs: 110, cameraSettleMs: 180, maxDurationMs: 520 });
function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }

function stagesFor(cue: CombatPresentationCue, config: CombatTimelineConfig) {
  const hitstop = cue.hitstopTicks * config.hitstopMsPerTick;
  const flash = config.impactFlashMs;
  const recoil = cue.vfx.durationMs > 0 ? Math.min(config.recoilMs, cue.vfx.durationMs) : config.recoilMs;
  const settle = Math.min(config.cameraSettleMs, Math.max(0, config.maxDurationMs - hitstop - flash - recoil));
  let cursor = 0;
  const make = (stage: CombatTimelineStage, durationMs: number) => { const startMs = cursor; cursor += Math.max(0, durationMs); return Object.freeze({ stage, startMs, endMs: cursor }); };
  const stages = [make('hitstop', hitstop), make('impact-flash', flash), make('recoil', recoil), make('camera-settle', settle)];
  stages.push(Object.freeze({ stage: 'clear' as const, startMs: cursor, endMs: cursor }));
  return { stages: Object.freeze(stages), totalDurationMs: Math.min(config.maxDurationMs, cursor) };
}

function findStage(stages: readonly { stage: CombatTimelineStage; startMs: number; endMs: number }[], elapsedMs: number) {
  for (const stage of stages) if (elapsedMs >= stage.startMs && elapsedMs < Math.max(stage.endMs, stage.startMs + 0.001)) return stage;
  return stages.at(-1)!;
}

export function createCombatPresentationTimeline(cue: CombatPresentationCue, config: Partial<CombatTimelineConfig> = {}): CombatTimeline {
  const finalConfig = Object.freeze({ ...DEFAULT_CONFIG, ...config });
  const staged = stagesFor(cue, finalConfig);
  const sample = (elapsedMs: number): CombatTimelineSample => {
    const elapsed = clamp(elapsedMs, 0, staged.totalDurationMs);
    const stage = findStage(staged.stages, elapsed);
    const duration = Math.max(0.001, stage.endMs - stage.startMs);
    const local = clamp((elapsed - stage.startMs) / duration);
    const inverted = 1 - local;
    const ease = local * local * (3 - 2 * local);
    let cameraWeight = 0; let recoilWeight = 0; let flashWeight = 0; let hapticWeight = 0;
    if (stage.stage === 'hitstop') { cameraWeight = 0.6; hapticWeight = 1 - local * 0.35; }
    else if (stage.stage === 'impact-flash') { flashWeight = inverted; cameraWeight = 0.75 + inverted * 0.25; hapticWeight = inverted * 0.6; }
    else if (stage.stage === 'recoil') { recoilWeight = 1 - ease; cameraWeight = 0.6 * recoilWeight; }
    else if (stage.stage === 'camera-settle') { const settled = criticallyDamped(1, 0, 0, 0.12, Math.max(0.001, elapsed - stage.startMs) / 1000); cameraWeight = clamp(settled.value); }
    return Object.freeze({ tick: cue.tick, elapsedMs: roundDeterministic(elapsed, 3), stage: stage.stage, normalized: staged.totalDurationMs <= 0 ? 1 : clamp(elapsed / staged.totalDurationMs), intensity: roundDeterministic(cue.intensity * Math.max(cameraWeight, recoilWeight, flashWeight, hapticWeight), 4), cameraWeight: roundDeterministic(cameraWeight, 4), recoilWeight: roundDeterministic(recoilWeight, 4), flashWeight: roundDeterministic(flashWeight, 4), hapticWeight: roundDeterministic(hapticWeight, 4) });
  };
  return Object.freeze({ cueId: cue.id, totalDurationMs: staged.totalDurationMs, peakIntensity: cue.intensity, stages: staged.stages, sample });
}

export function sampleCombatPresentationTimeline(timeline: CombatTimeline, elapsedMs: number): CombatTimelineSample { return timeline.sample(elapsedMs); }

export function validateCombatPresentationTimeline(timeline: CombatTimeline): Readonly<{ valid: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (timeline.totalDurationMs < 0 || !Number.isFinite(timeline.totalDurationMs)) errors.push('timeline duration invalid');
  let previous = -1;
  for (const stage of timeline.stages) { if (stage.startMs < previous || stage.endMs < stage.startMs) errors.push('timeline stage order invalid'); previous = stage.endMs; }
  const midpoint = timeline.sample(timeline.totalDurationMs * 0.5);
  if (![midpoint.normalized, midpoint.intensity, midpoint.cameraWeight, midpoint.recoilWeight, midpoint.flashWeight, midpoint.hapticWeight].every(Number.isFinite)) errors.push('timeline sample is not finite');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function timelineEnvelope(cue: CombatPresentationCue): Readonly<{ start: CombatTimelineSample; peak: CombatTimelineSample; end: CombatTimelineSample }> {
  const timeline = createCombatPresentationTimeline(cue);
  return Object.freeze({ start: timeline.sample(0), peak: timeline.sample(Math.min(80, timeline.totalDurationMs)), end: timeline.sample(timeline.totalDurationMs) });
}