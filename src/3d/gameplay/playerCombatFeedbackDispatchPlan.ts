/**
 * Runtime-facing dispatch projection over the existing combat rules authority.
 * It never mutates scene, mixer, health, stamina or combat state.
 */
import {
  resolvePlayerCombatEnvelope,
  resolvePlayerDefenseRules,
  resolvePlayerHitReaction,
} from './playerEquipmentCombatRules.ts';

const CHANNELS = Object.freeze(['animation', 'audio', 'camera', 'haptic', 'ui', 'vfx']);
const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

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
  sourceKey: string;
  dominantCue: string | null;
  packets: readonly PlayerCombatFeedbackDispatchPacket[];
  dispatchKey: string;
}>;

function canonicalDispatchKey(sourceKey: string, packets: readonly PlayerCombatFeedbackDispatchPacket[]): string {
  return [sourceKey, ...packets.map((packet) => `${packet.channel}:${packet.cue}:${packet.intensity.toFixed(3)}:${packet.priority}`)].join('|');
}

function packet(channel: string, cue: string, intensity: number, priority: number, dominantCue: string | null, sourceKey: string): PlayerCombatFeedbackDispatchPacket {
  return Object.freeze({
    channel,
    cue,
    intensity: clamp(intensity, 0, 1, 0),
    priority: Math.round(clamp(priority, 0, 100, 0)),
    replayKey: `${sourceKey}|${channel}|${cue}`,
    dominant: cue === dominantCue,
  });
}

export function buildPlayerCombatFeedbackDispatchPlan({
  profile = {},
  kind = 'light',
  staminaRatio = 1,
  poiseRatio = 1,
  outcome = 'attack',
  guardInput = false,
  parryWindowOpen = false,
  dodgeInvulnerable = false,
  rawAmount = 0,
  blockedAmount = 0,
  poise = 100,
  maxPoise = 100,
}: Record<string, unknown> = {}): PlayerCombatFeedbackDispatchPlan {
  const envelope = resolvePlayerCombatEnvelope(profile, { kind, staminaRatio, poiseRatio });
  const defense = resolvePlayerDefenseRules(profile, { staminaRatio, poiseRatio, guardInput, parryWindowOpen, dodgeInvulnerable });
  const reaction = resolvePlayerHitReaction(profile, { rawAmount, blockedAmount, poise, maxPoise });
  const normalizedOutcome = typeof outcome === 'string' ? outcome : 'attack';
  const dominantCue = reaction.staggers ? 'stagger' : defense.parryAvailable ? 'parry' : normalizedOutcome;
  const sourceKey = [normalizedOutcome, kind === 'heavy' ? 'heavy' : 'light', envelope.staminaRatio.toFixed(3), envelope.poiseRatio.toFixed(3), reaction.effectiveImpact.toFixed(3)].join(':');
  const packets = [
    packet('animation', dominantCue, reaction.staggers ? 1 : 0.72, reaction.staggers ? 100 : 55, dominantCue, sourceKey),
    packet('audio', reaction.staggers ? 'impact-heavy' : defense.parryAvailable ? 'parry-ring' : 'combat-swish', reaction.staggers ? 1 : 0.64, reaction.staggers ? 95 : 45, dominantCue, sourceKey),
    packet('camera', reaction.staggers ? 'hit-stop' : normalizedOutcome === 'dodge' ? 'dodge-impulse' : 'attack-impulse', reaction.staggers ? 0.9 : 0.45, reaction.staggers ? 90 : 35, dominantCue, sourceKey),
    packet('haptic', reaction.staggers ? 'impact-pulse' : defense.parryAvailable ? 'parry-pulse' : 'combat-pulse', reaction.staggers ? 0.9 : 0.3, reaction.staggers ? 88 : 30, dominantCue, sourceKey),
    packet('ui', reaction.staggers ? 'poise-break' : defense.parryAvailable ? 'parry-window' : 'combat-state', reaction.staggers ? 1 : 0.5, reaction.staggers ? 85 : 20, dominantCue, sourceKey),
    packet('vfx', reaction.staggers ? 'stagger-burst' : defense.parryAvailable ? 'parry-sparks' : normalizedOutcome === 'dodge' ? 'dodge-trail' : 'weapon-trail', reaction.staggers ? 1 : 0.58, reaction.staggers ? 82 : 40, dominantCue, sourceKey),
  ];
  const frozenPackets = Object.freeze(packets);
  return Object.freeze({
    version: 1,
    accepted: true,
    sourceKey,
    dominantCue,
    packets: frozenPackets,
    dispatchKey: canonicalDispatchKey(sourceKey, frozenPackets),
  });
}

export function isPlayerCombatFeedbackDispatchPlan(value: unknown): value is PlayerCombatFeedbackDispatchPlan {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as any;
  if (candidate.version !== 1 || candidate.accepted !== true || !Array.isArray(candidate.packets)) return false;
  if (!Object.isFrozen(candidate) || !Object.isFrozen(candidate.packets)) return false;
  if (typeof candidate.sourceKey !== 'string' || typeof candidate.dispatchKey !== 'string') return false;
  for (const item of candidate.packets) {
    if (!item || typeof item !== 'object' || !Object.isFrozen(item)) return false;
    if (!CHANNELS.includes(item.channel) || typeof item.cue !== 'string') return false;
    if (!Number.isFinite(item.intensity) || item.intensity < 0 || item.intensity > 1) return false;
    if (!Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100) return false;
  }
  return candidate.dispatchKey === canonicalDispatchKey(candidate.sourceKey, candidate.packets);
}

export default buildPlayerCombatFeedbackDispatchPlan;
