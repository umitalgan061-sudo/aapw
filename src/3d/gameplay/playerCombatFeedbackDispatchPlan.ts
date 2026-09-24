/**
 * Runtime-facing dispatch projection over the existing combat feedback plan.
 *
 * This module does not own scene, mixer, health, stamina or combat mutation.
 * It only converts a validated presentation plan into immutable consumer packets.
 */
import { isPlayerCombatFeedbackPlan } from './playerCombatFeedbackPlan.ts';

const CHANNELS = Object.freeze(['animation', 'audio', 'camera', 'haptic', 'ui', 'vfx']);

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const freezePacket = (packet: Record<string, unknown>) => Object.freeze(packet);

export type PlayerCombatFeedbackDispatchPacket = Readonly<{
  channel: string;
  cue: string;
  intensity: number;
  priority: number;
  replayKey: string;
  dominant: boolean;
}>;

export type PlayerCombatFeedbackDispatchPlan = Readonly<{
  version: 1;
  accepted: boolean;
  sourceReplayKey: string;
  dominantCue: string | null;
  packets: readonly PlayerCombatFeedbackDispatchPacket[];
  dispatchKey: string;
}>;

function canonicalDispatchKey(sourceReplayKey: string, packets: readonly PlayerCombatFeedbackDispatchPacket[]): string {
  return [sourceReplayKey, ...packets.map((packet) => `${packet.channel}:${packet.cue}:${packet.intensity.toFixed(3)}:${packet.priority}`)].join('|');
}

export function buildPlayerCombatFeedbackDispatchPlan(input: unknown): PlayerCombatFeedbackDispatchPlan {
  if (!isPlayerCombatFeedbackPlan(input)) {
    return Object.freeze({
      version: 1,
      accepted: false,
      sourceReplayKey: 'invalid',
      dominantCue: null,
      packets: Object.freeze([]),
      dispatchKey: 'v1|invalid',
    });
  }

  const source = input as any;
  const dominantCue = typeof source.dominantCue?.cue === 'string' ? source.dominantCue.cue : null;
  const packets = CHANNELS.flatMap((channel) => {
    const cue = source.cues?.[channel];
    if (!cue || typeof cue.cue !== 'string') return [];
    return [freezePacket({
      channel,
      cue: cue.cue,
      intensity: clamp(cue.intensity, 0, 1, 0),
      priority: Math.round(clamp(cue.priority, 0, 100, 0)),
      replayKey: `${source.replayKey}|${channel}|${cue.cue}`,
      dominant: dominantCue === cue.cue,
    }) as PlayerCombatFeedbackDispatchPacket];
  });
  const frozenPackets = Object.freeze(packets);
  const dispatchKey = canonicalDispatchKey(source.replayKey, frozenPackets);
  return Object.freeze({
    version: 1,
    accepted: true,
    sourceReplayKey: source.replayKey,
    dominantCue,
    packets: frozenPackets,
    dispatchKey,
  });
}

export function isPlayerCombatFeedbackDispatchPlan(value: unknown): value is PlayerCombatFeedbackDispatchPlan {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as any;
  if (candidate.version !== 1 || typeof candidate.accepted !== 'boolean' || !Array.isArray(candidate.packets)) return false;
  if (!Object.isFrozen(candidate) || !Object.isFrozen(candidate.packets)) return false;
  if (typeof candidate.sourceReplayKey !== 'string' || typeof candidate.dispatchKey !== 'string') return false;
  for (const packet of candidate.packets) {
    if (!packet || typeof packet !== 'object' || !Object.isFrozen(packet)) return false;
    if (!CHANNELS.includes(packet.channel) || typeof packet.cue !== 'string') return false;
    if (!Number.isFinite(packet.intensity) || packet.intensity < 0 || packet.intensity > 1) return false;
    if (!Number.isInteger(packet.priority) || packet.priority < 0 || packet.priority > 100) return false;
  }
  if (!candidate.accepted) return candidate.dispatchKey === 'v1|invalid' && candidate.packets.length === 0;
  return candidate.dispatchKey === canonicalDispatchKey(candidate.sourceReplayKey, candidate.packets);
}

export default buildPlayerCombatFeedbackDispatchPlan;
