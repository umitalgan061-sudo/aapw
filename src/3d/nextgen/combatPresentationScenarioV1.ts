/** Automated combat vertical-slice runner using the authoritative nextgen simulation. */
import { CombatSimulation, createCombatStats, type CombatEvent, type CombatantId } from './combatSimulation';
import { CombatPresentationDirector, type CombatPresentationFrame } from './combatPresentationV1';
import { CombatPresentationQueue, type CombatPresentationDispatch } from './combatPresentationQueueV1';
import { createCombatPresentationTimeline, validateCombatPresentationTimeline } from './combatPresentationTimelineV1';
import { buildCombatFeedbackSummary } from './combatPresentationAccessibilityV1';
import { replayCombatPresentation, compareCombatPresentationRecordings } from './combatPresentationReplayV1';
import { vec3 } from './deterministicMath';

export interface CombatPresentationScenarioStep { readonly tick: number; readonly action: string; readonly eventTypes: readonly CombatEvent['type'][]; readonly cueCount: number; readonly dispatchCount: number; readonly hitstopTicks: number; readonly digest: number; }
export interface CombatPresentationScenarioReport { readonly version: 1; readonly seed: number; readonly totalTicks: number; readonly totalEvents: number; readonly totalCues: number; readonly totalDispatches: number; readonly droppedCues: number; readonly eventTypes: Readonly<Record<CombatEvent['type'], number>>; readonly damageTypes: Readonly<Record<string, number>>; readonly feedbackSummary: ReturnType<typeof buildCombatFeedbackSummary>; readonly deterministicDigest: number; readonly replayEqual: boolean; readonly steps: readonly CombatPresentationScenarioStep[]; readonly frames: readonly CombatPresentationFrame[]; readonly dispatches: readonly CombatPresentationDispatch[]; }

const increment = (table: Record<string, number>, key: string): void => { table[key] = (table[key] ?? 0) + 1; };
const toId = (value: number) => value as CombatantId;

export function runCombatPresentationVerticalSlice(seed = 0xC0FFEE, totalTicks = 120): CombatPresentationScenarioReport {
  const combat = new CombatSimulation(seed);
  const director = new CombatPresentationDirector({ maxCuesPerTick: 12 });
  const queue = new CombatPresentationQueue({ maxDispatchPerFrame: 8 });
  const player = toId(1); const guard = toId(2); const target = toId(3);
  combat.spawn(player, vec3(0, 0, 0), createCombatStats({ maxHealth: 120, poise: 60 }));
  combat.spawn(guard, vec3(0, 0, 1.5), createCombatStats({ maxHealth: 120, poise: 70, armor: { slash: 25, blunt: 15 } }));
  combat.spawn(target, vec3(0, 0, 2.2), createCombatStats({ maxHealth: 70, poise: 35 }));
  combat.setPose(player, vec3(0, 0, 0), vec3(0, 0, 1));
  combat.setPose(guard, vec3(0, 0, 1.5), vec3(0, 0, -1));
  combat.setPose(target, vec3(0, 0, 2.2), vec3(0, 0, -1));
  const eventsByTick = new Map<number, readonly CombatEvent[]>();
  const frames: CombatPresentationFrame[] = []; const dispatches: CombatPresentationDispatch[] = []; const steps: CombatPresentationScenarioStep[] = []; const statesByTick = new Map<number, ReturnType<CombatSimulation['snapshot']>>();
  const eventTypes: Record<CombatEvent['type'], number> = { 'attack-start': 0, hit: 0, blocked: 0, critical: 0, stagger: 0, death: 0, dodge: 0 };
  const damageTypes: Record<string, number> = {};
  for (let tick = 0; tick < totalTicks; tick += 1) {
    if (tick === 0) combat.startAttack(player, 'light-1');
    if (tick === 32) { combat.setBlocking(guard, true); combat.startAttack(player, 'heavy-1'); }
    if (tick === 48) combat.setBlocking(guard, false);
    if (tick === 64) combat.dodge(guard, vec3(-1, 0, 0), 8);
    if (tick === 72) combat.startAttack(guard, 'frost-cut');
    if (tick === 92) combat.startAttack(player, 'heavy-1');
    const events = combat.step();
    if (events.length) eventsByTick.set(combat.tick, events);
    statesByTick.set(combat.tick, combat.snapshot());
    const frame = director.ingest(events, { states: combat.snapshot(), device: tick % 2 === 0 ? 'gamepad' : 'touch' });
    const pushed = queue.enqueue(frame.cues, tick % 2 === 0 ? 'gamepad' : 'touch', frame.tick);
    const delivered = queue.dispatch(frame.tick);
    frames.push(frame); dispatches.push(...delivered);
    for (const event of events) { increment(eventTypes, event.type); if (event.damageType) increment(damageTypes, event.damageType); }
    steps.push(Object.freeze({ tick: frame.tick, action: tick === 0 ? 'player-light' : tick === 32 ? 'guard-heavy-pressure' : tick === 64 ? 'guard-dodge' : tick === 72 ? 'frost-counter' : tick === 92 ? 'player-heavy' : 'simulation', eventTypes: Object.freeze(events.map((event) => event.type)), cueCount: frame.cues.length, dispatchCount: delivered.length, hitstopTicks: frame.hitstopTicks, digest: frame.deterministicDigest }));
  }
  const finalCues = frames.flatMap((frame) => frame.cues);
  const feedbackSummary = buildCombatFeedbackSummary(finalCues);
  const timelineChecks = finalCues.slice(0, 32).map((cue) => validateCombatPresentationTimeline(createCombatPresentationTimeline(cue)).valid);
  const deterministicDigest = frames.reduce((hash, frame) => ((hash * 16777619) ^ frame.deterministicDigest) >>> 0, seed >>> 0);
  const replay = replayCombatPresentation(eventsByTick, statesByTick);
  const originalRecording = Object.freeze({
    version: 1 as const,
    seed,
    frames: Object.freeze(frames.map((frame) => Object.freeze({
      tick: frame.tick,
      digest: frame.deterministicDigest,
      cueIds: Object.freeze(frame.cues.map((cue) => cue.id)),
      hitstopTicks: frame.hitstopTicks,
      cameraShake: frame.cameraShake,
      droppedCues: frame.droppedCues,
    }))),
    finalDigest: deterministicDigest,
    eventCount: eventsByTick.size,
  });
  const replayEqual = compareCombatPresentationRecordings(originalRecording, replay).equal;
  if (!timelineChecks.every(Boolean)) throw new Error('combat presentation timeline validation failed');
  return Object.freeze({ version: 1, seed, totalTicks, totalEvents: [...eventsByTick.values()].reduce((sum, events) => sum + events.length, 0), totalCues: finalCues.length, totalDispatches: dispatches.length, droppedCues: frames.reduce((sum, frame) => sum + frame.droppedCues, 0), eventTypes: Object.freeze(eventTypes), damageTypes: Object.freeze(damageTypes), feedbackSummary, deterministicDigest, replayEqual, steps: Object.freeze(steps), frames: Object.freeze(frames), dispatches: Object.freeze(dispatches) });
}

export function validateCombatPresentationScenario(report: CombatPresentationScenarioReport): Readonly<{ valid: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (report.version !== 1) errors.push('unsupported scenario version');
  if (report.totalTicks <= 0) errors.push('scenario has no simulation ticks');
  if (report.totalEvents <= 0) errors.push('scenario produced no combat events');
  if (report.totalCues <= 0) errors.push('scenario produced no presentation cues');
  if (!report.replayEqual) errors.push('scenario replay diverged');
  if (report.droppedCues > 0) errors.push('scenario dropped presentation cues');
  if (report.eventTypes.hit + report.eventTypes.blocked === 0) errors.push('scenario did not exercise hit/block feedback');
  if (report.eventTypes.dodge === 0) errors.push('scenario did not exercise dodge feedback');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}