import {
  type CombatFeedbackCue,
  type PlayerCombatFeedbackPlan,
  isPlayerCombatFeedbackPlan,
} from './playerCombatFeedbackPlan.ts';

export type CombatFeedbackDispatch = Readonly<{
  channel: CombatFeedbackCue['channel'];
  audioKey: string;
  vfxKey: string;
  cameraImpulse: number;
  hapticMs: number;
  priority: number;
}>;

export type PlayerCombatFeedbackDispatchPlan = Readonly<{
  version: 1;
  dispatches: readonly CombatFeedbackDispatch[];
  dominantChannel: CombatFeedbackCue['channel'] | null;
  replayKey: string;
}>;

const freezeDispatch = (cue: CombatFeedbackCue): CombatFeedbackDispatch => Object.freeze({
  channel: cue.channel,
  audioKey: cue.audioKey,
  vfxKey: cue.vfxKey,
  cameraImpulse: cue.cameraImpulse,
  hapticMs: cue.hapticMs,
  priority: cue.priority,
});

export function buildPlayerCombatFeedbackDispatchPlan(
  feedbackPlan: PlayerCombatFeedbackPlan,
): PlayerCombatFeedbackDispatchPlan {
  if (!isPlayerCombatFeedbackPlan(feedbackPlan)) {
    return Object.freeze({
      version: 1,
      dispatches: Object.freeze([]),
      dominantChannel: null,
      replayKey: 'v1|invalid',
    });
  }

  const dispatches = Object.freeze(feedbackPlan.cues.map(freezeDispatch));
  return Object.freeze({
    version: 1,
    dispatches,
    dominantChannel: feedbackPlan.dominantCue?.channel ?? null,
    replayKey: `v1|${feedbackPlan.replayKey}|dispatch=${dispatches.map((dispatch) => [
      dispatch.channel,
      dispatch.audioKey,
      dispatch.vfxKey,
      dispatch.cameraImpulse.toFixed(4),
      dispatch.hapticMs,
      dispatch.priority,
    ].join(':')).join('|') || 'none'}`,
  });
}

export function isPlayerCombatFeedbackDispatchPlan(
  value: unknown,
): value is PlayerCombatFeedbackDispatchPlan {
  try {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as PlayerCombatFeedbackDispatchPlan;
    if (candidate.version !== 1 || !Array.isArray(candidate.dispatches)) return false;
    if (!Object.isFrozen(candidate) || !Object.isFrozen(candidate.dispatches)) return false;
    if (candidate.dominantChannel !== null && typeof candidate.dominantChannel !== 'string') return false;
    if (!candidate.dispatches.every((dispatch) => Object.isFrozen(dispatch) &&
      typeof dispatch.channel === 'string' &&
      typeof dispatch.audioKey === 'string' &&
      typeof dispatch.vfxKey === 'string' &&
      Number.isFinite(dispatch.cameraImpulse) &&
      Number.isInteger(dispatch.hapticMs) &&
      Number.isInteger(dispatch.priority))) return false;
    return typeof candidate.replayKey === 'string' && candidate.replayKey.startsWith('v1|');
  } catch {
    return false;
  }
}
