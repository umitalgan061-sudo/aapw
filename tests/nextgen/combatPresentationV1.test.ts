import { describe, expect, it } from 'vitest';
import { CombatPresentationDirector, buildCombatPresentationFrame, validateCombatPresentationFrame } from '../../src/3d/nextgen/combatPresentationV1';
import { CombatPresentationQueue, validateCombatPresentationDispatch } from '../../src/3d/nextgen/combatPresentationQueueV1';
import { compareCombatPresentationRecordings, replayCombatPresentation, summarizeCombatPresentationRecording } from '../../src/3d/nextgen/combatPresentationReplayV1';
import { buildCombatFeedbackSummary, eventToSemanticHint, projectCombatAccessibility, validateCombatAccessibilitySignal } from '../../src/3d/nextgen/combatPresentationAccessibilityV1';
import { getCombatDamageTypeProfile, resolveCombatSurfaceReaction, validateCombatDamageTypeProfiles } from '../../src/3d/nextgen/combatPresentationDamageTypeV1';
import { createCombatPresentationTimeline, timelineEnvelope, validateCombatPresentationTimeline } from '../../src/3d/nextgen/combatPresentationTimelineV1';
import { createCombatPresentationTelemetry } from '../../src/3d/nextgen/combatPresentationTelemetryV1';
import { applyCombatPresentationQuality, resolveCombatPresentationQuality, tuneCombatPresentationCue } from '../../src/3d/nextgen/combatPresentationQualityV1';
import { CombatPresentationBus, validateCombatPresentationBusReport } from '../../src/3d/nextgen/combatPresentationBusV1';
import { resolveCombatSpatialAudio, validateCombatSpatialAudio } from '../../src/3d/nextgen/combatPresentationSpatialAudioV1';
import { resolveCombatReactionIntent, validateCombatReactionIntent } from '../../src/3d/nextgen/combatPresentationReactionV1';
import { buildCombatPresentationBrowserEnvelope, CombatPresentationBrowserBridge, validateCombatPresentationBrowserEnvelope } from '../../src/3d/nextgen/combatPresentationBrowserBridgeV1';
import { dispatchCombatHapticPulses, resolveHapticChannel, validateCombatHapticDispatch } from '../../src/3d/nextgen/combatPresentationHapticsV1';
import { runCombatPresentationVerticalSlice, validateCombatPresentationScenario } from '../../src/3d/nextgen/combatPresentationScenarioV1';
import { CombatSimulation, createCombatStats, type CombatEvent, type CombatantState } from '../../src/3d/nextgen/combatSimulation';
import { vec3, type Vec3 } from '../../src/3d/nextgen/deterministicMath';

const combatId = (value: number) => value as never;
const states = (combat: CombatSimulation) => combat.snapshot();

function runHitScenario(seed = 42) {
  const combat = new CombatSimulation(seed);
  const attacker = combatId(1); const target = combatId(2);
  combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
  combat.spawn(target, vec3(0, 0, 1.1), createCombatStats());
  combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
  combat.startAttack(attacker, 'light-1');
  const byTick = new Map<number, readonly CombatEvent[]>();
  for (let i = 0; i < 40; i += 1) {
    const events = combat.step();
    if (events.length) byTick.set(combat.tick, events);
  }
  return { combat, byTick, states: new Map([[combat.tick, states(combat)]]) };
}

describe('nextgen combat presentation', () => {
  it('maps all authoritative combat event families into semantic cues', () => {
    const director = new CombatPresentationDirector();
    const eventTypes = ['attack-start', 'hit', 'blocked', 'critical', 'stagger', 'death', 'dodge'] as const;
    for (const type of eventTypes) {
      const frame = director.ingest([{ tick: 1, type, sourceId: combatId(1), targetId: combatId(2), attackId: 'light-1', damage: 10, poiseDamage: 4 }] as never, { states: [] });
      expect(frame.cues.length).toBe(1);
      expect(frame.cues[0]?.semantic).toBe(eventToSemanticHint({ tick: 1, type, sourceId: combatId(1), targetId: combatId(2), attackId: 'light-1', damage: 10, poiseDamage: 4 } as never));
      expect(validateCombatPresentationFrame(frame).valid).toBe(true);
      director.reset();
    }
  });

  it('produces stronger critical feedback without exceeding presentation bounds', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([
      { tick: 3, type: 'critical', sourceId: combatId(1), targetId: combatId(2), attackId: 'heavy-1', damage: 60, poiseDamage: 20 },
      { tick: 3, type: 'hit', sourceId: combatId(1), targetId: combatId(2), attackId: 'heavy-1', damage: 20, poiseDamage: 8 },
    ], { states: [] });
    expect(frame.hitstopTicks).toBeGreaterThan(0);
    expect(frame.cameraShake).toBeGreaterThan(0);
    expect(frame.cues[0]?.priority).toBe(3);
    expect(frame.cues[0]?.audio.volume).toBeGreaterThan(frame.cues[1]?.audio.volume ?? 0);
    expect(validateCombatPresentationFrame(frame).valid).toBe(true);
  });

  it('deduplicates replayed events and keeps tick ordering monotonic', () => {
    const director = new CombatPresentationDirector();
    const event = { tick: 10, type: 'hit', sourceId: combatId(1), targetId: combatId(2), attackId: 'light-1', damage: 10, poiseDamage: 4 } as never;
    expect(director.ingest([event], { states: [] }).cues.length).toBe(1);
    expect(director.ingest([event], { states: [] }).cues.length).toBe(0);
    expect(() => director.ingest([{ ...event, tick: 9 }], { states: [] })).toThrow(/monotonic/);
  });

  it('creates deterministic cues from world state and event data', () => {
    const event = { tick: 20, type: 'hit', sourceId: combatId(1), targetId: combatId(2), attackId: 'light-1', damage: 15, poiseDamage: 7 } as never;
    const context = { states: [
      { id: combatId(1), position: vec3(0, 0, 0), forward: vec3(0, 0, 1) },
      { id: combatId(2), position: vec3(0, 0, 1), forward: vec3(0, 0, -1) },
    ] as never[] };
    const a = buildCombatPresentationFrame([event], context);
    const b = buildCombatPresentationFrame([event], context);
    expect(a).toEqual(b);
    expect(a.cues[0]?.position).toEqual({ x: 0, y: 0, z: 0.5 });
    expect(a.cues[0]?.direction).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('exports immutable snapshots that restore exactly', () => {
    const director = new CombatPresentationDirector();
    director.ingest([{ tick: 4, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 50 }] as never, { states: [] });
    const snapshot = director.snapshot();
    const restored = new CombatPresentationDirector();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
  });
});

describe('damage type profiles and timeline', () => {
  it('validates all authored damage-type presentation profiles', () => {
    const validation = validateCombatDamageTypeProfiles();
    expect(validation.valid).toBe(true);
    expect(getCombatDamageTypeProfile('frost').uiLabel).toBe('BUZ');
    expect(resolveCombatSurfaceReaction('slash', 'metal').response).toBe('metallic-spark');
  });

  it('builds an ordered hitstop → impact → recoil timeline', () => {
    const director = new CombatPresentationDirector();
    const cue = director.ingest([{ tick: 7, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 60, damageType: 'frost' }] as never, { states: [] }).cues[0];
    const timeline = createCombatPresentationTimeline(cue!);
    expect(validateCombatPresentationTimeline(timeline).valid).toBe(true);
    expect(timeline.stages[0]?.stage).toBe('hitstop');
    expect(timeline.stages[1]?.stage).toBe('impact-flash');
    expect(timeline.stages[2]?.stage).toBe('recoil');
    expect(timeline.sample(0).stage).toBe('hitstop');
    expect(timelineEnvelope(cue!).end.stage).toBe('clear');
  });
});

describe('presentation queue', () => {
  it('orders important cues first and budgets delivery by channel', () => {
    const director = new CombatPresentationDirector({ maxCuesPerTick: 20 });
    const cues = director.ingest(Array.from({ length: 16 }, (_, index) => ({ tick: 2, type: index % 2 ? 'hit' : 'critical', sourceId: combatId(index + 1), targetId: combatId(100 + index), damage: 10 + index })) as never[], { states: [] }).cues;
    const queue = new CombatPresentationQueue({ maxDispatchPerFrame: 4, maxPerChannelPerFrame: { vfx: 2, sfx: 2, haptic: 2, camera: 2 } });
    expect(queue.enqueue(cues, 'gamepad', 2)).toBe(16);
    const dispatches = queue.dispatch(2);
    expect(dispatches.length).toBe(4);
    expect(dispatches[0]?.cue.priority).toBe(3);
    expect(dispatches.every(validateCombatPresentationDispatch)).toBe(true);
  });

  it('expires stale pending effects rather than leaking memory', () => {
    const director = new CombatPresentationDirector();
    const cue = director.ingest([{ tick: 1, type: 'dodge', sourceId: combatId(1) }] as never, { states: [] }).cues;
    const queue = new CombatPresentationQueue({ maxLifetimeTicks: 2 });
    queue.enqueue(cue, 'touch', 1);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.dispatch(10)).toEqual([]);
    expect(queue.pendingCount()).toBe(0);
  });

  it('does not duplicate cooldown-limited impacts', () => {
    const director = new CombatPresentationDirector();
    const first = director.ingest([{ tick: 5, type: 'critical', sourceId: combatId(1), targetId: combatId(2), attackId: 'heavy-1', damage: 60 }] as never, { states: [] }).cues;
    const queue = new CombatPresentationQueue();
    expect(queue.enqueue(first, 'touch', 5)).toBe(1);
    queue.dispatch(5);
    expect(queue.enqueue(first, 'touch', 6)).toBe(0);
  });
});

describe('replay and accessibility', () => {
  it('replays the same presentation recording deterministically', () => {
    const { byTick } = runHitScenario(123);
    const ctx = new Map<number, readonly CombatantState[]>();
    for (const tick of byTick.keys()) ctx.set(tick, []);
    const a = replayCombatPresentation(byTick, ctx);
    const b = replayCombatPresentation(byTick, ctx);
    expect(compareCombatPresentationRecordings(a, b).equal).toBe(true);
    expect(summarizeCombatPresentationRecording(a).digest).toBe(summarizeCombatPresentationRecording(b).digest);
  });

  it('projects touch/gamepad haptics while keeping mouse/keyboard silent', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([{ tick: 8, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 55 }] as never, { states: [] });
    const touch = projectCombatAccessibility(frame.cues, { device: 'touch' });
    const keyboard = projectCombatAccessibility(frame.cues, { device: 'keyboard' });
    expect(touch[0]?.haptic).toBe(true);
    expect(keyboard[0]?.haptic).toBe(false);
    expect(touch[0]?.ariaLive).toBe('assertive');
    expect(touch.every(validateCombatAccessibilitySignal)).toBe(true);
  });

  it('keeps reduced motion independent of combat semantics', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([{ tick: 8, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 55 }] as never, { states: [] });
    const standard = projectCombatAccessibility(frame.cues, { mode: 'standard' });
    const reduced = projectCombatAccessibility(frame.cues, { mode: 'reduced-motion' });
    expect(reduced[0]?.semantic).toBe(standard[0]?.semantic);
    expect(reduced[0]?.motionScale).toBeLessThan(standard[0]?.motionScale ?? 1);
  });

  it('summarizes the feedback set for HUD/debug consumers', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([
      { tick: 1, type: 'hit', sourceId: combatId(1), targetId: combatId(2), damage: 10 },
      { tick: 1, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 40 },
      { tick: 1, type: 'blocked', sourceId: combatId(2), targetId: combatId(1), damage: 5 },
    ] as never, { states: [] });
    const summary = buildCombatFeedbackSummary(frame.cues);
    expect(summary.count).toBe(3);
    expect(summary.criticals).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.strongest).toBe('critical-impact');
  });
});

describe('runtime facade presentation integration', () => {
  it('returns presentation frame fields from the actual nextgen frame result', async () => {
    const { createNextGenRuntime } = await import('../../src/3d/nextgen/runtimeFacadeV3');
    const runtime = createNextGenRuntime({ navigationWidth: 8, navigationHeight: 8, navigationCellSize: 1 });
    const player = runtime.createPlayer();
    runtime.setPresentationDevice('gamepad');
    runtime.setPresentationAccessibility('reduced-motion');
    runtime.setMuted(true);
    runtime.queuePlayerInput(player, { tick: 0, move: { x: 0, y: 1 }, sprint: false, lookYaw: 0 });
    runtime.startCombatAttack(player, 'light-1');
    for (let i = 0; i < 14; i += 1) await runtime.frame(async () => new Response(new Uint8Array(0), { status: 404 }));
    const result = await runtime.frame(async () => new Response(new Uint8Array(0), { status: 404 }));
    expect(result.presentationFrame.version).toBe(1);
    expect(Array.isArray(result.presentationDispatches)).toBe(true);
    expect(Array.isArray(result.presentationAccessibility)).toBe(true);
    expect(Array.isArray(result.presentationNetworkPackets)).toBe(true);
    expect(runtime.summary().combatants).toBe(1);
  });
});

describe('defensive edge cases', () => {
  it('clamps pathological camera and audio values through the cue contract', () => {
    const frame = buildCombatPresentationFrame([{ tick: 1, type: 'hit', sourceId: combatId(1), targetId: combatId(2), damage: Number.POSITIVE_INFINITY, poiseDamage: Number.NaN }] as never, { states: [] });
    expect(validateCombatPresentationFrame(frame).valid).toBe(true);
    expect(frame.cues[0]?.intensity).toBeLessThanOrEqual(1);
    expect(frame.cues[0]?.audio.volume).toBeLessThanOrEqual(1);
  });

  it('keeps the presentation queue snapshot portable', () => {
    const director = new CombatPresentationDirector();
    const cue = director.ingest([{ tick: 3, type: 'death', sourceId: combatId(1), targetId: combatId(2), damage: 100 }] as never, { states: [] }).cues;
    const queue = new CombatPresentationQueue();
    queue.enqueue(cue, 'replay', 3);
    const restored = new CombatPresentationQueue();
    restored.restore(queue.snapshot());
    expect(restored.pendingCount()).toBe(queue.pendingCount());
    expect(restored.tickValue()).toBe(queue.tickValue());
  });
});

describe('combat presentation vertical slice', () => {
  it('exercises authoritative combat events and produces a validated presentation report', () => {
    const report = runCombatPresentationVerticalSlice(77, 110);
    expect(validateCombatPresentationScenario(report).valid).toBe(true);
    expect(report.totalEvents).toBeGreaterThan(0);
    expect(report.totalCues).toBeGreaterThan(0);
    expect(report.feedbackSummary.count).toBe(report.totalCues);
    expect(report.eventTypes.dodge).toBeGreaterThan(0);
    expect(Object.keys(report.damageTypes).length).toBeGreaterThan(0);
    expect(report.droppedCues).toBe(0);
  });
});


describe('adaptive presentation quality and telemetry', () => {
  it('drops optional presentation load under pressure while preserving critical cues', () => {
    const decision = resolveCombatPresentationQuality({
      frameP95Ms: 25,
      pendingQueue: 120,
      droppedCues: 8,
      reducedMotion: false,
      device: 'gamepad',
    });
    expect(decision.quality).toBe('reduced');
    expect(decision.preserveCritical).toBe(true);
    expect(decision.vfxScale).toBeLessThan(1);

    const director = new CombatPresentationDirector();
    const cue = director.ingest([{ tick: 1, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 50, damageType: 'slash' }] as never, { states: [] }).cues[0]!;
    const tuned = tuneCombatPresentationCue(cue, decision);
    expect(tuned.vfx.intensity).toBeGreaterThanOrEqual(0.9 * cue.intensity);
    expect(tuned.camera.amplitude).toBeLessThanOrEqual(cue.camera.amplitude);
    expect(applyCombatPresentationQuality(decision, cue).preserved).toBe(true);
  });

  it('reports healthy presentation telemetry without drops', () => {
    const telemetry = createCombatPresentationTelemetry(12);
    const director = new CombatPresentationDirector();
    for (let tick = 1; tick <= 12; tick += 1) {
      const frame = director.ingest([{ tick, type: 'hit', sourceId: combatId(1), targetId: combatId(2), damage: 10 }] as never, { states: [] });
      telemetry.record(frame, [], tick % 2);
    }
    const summary = telemetry.summary();
    expect(summary.samples).toBe(12);
    expect(summary.totalDropped).toBe(0);
    expect(summary.health).toBe('healthy');
    expect(summary.peakPendingQueue).toBeGreaterThan(0);
  });
});


describe('presentation consumer bus', () => {
  it('fans out only enabled channels and isolates consumer failures', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([{ tick: 12, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 50, damageType: 'slash' }] as never, { states: [] });
    const queue = new CombatPresentationQueue();
    queue.enqueue(frame.cues, 'gamepad', 12);
    const dispatches = queue.dispatch(12);
    const bus = new CombatPresentationBus();
    const deliveries: string[] = [];
    bus.subscribe({
      id: 'vfx-consumer',
      channels: ['vfx'],
      priority: 10,
      consume() { deliveries.push('vfx'); },
    });
    bus.subscribe({
      id: 'telemetry-failing-consumer',
      channels: ['camera'],
      priority: 5,
      consume() { throw new Error('telemetry-test-failure'); },
    });
    const report = bus.dispatch(dispatches, [], 12);
    expect(report.dispatched).toBe(dispatches.length);
    expect(report.delivered).toBeGreaterThanOrEqual(1);
    expect(report.consumerFailures).toBe(1);
    expect(deliveries).toEqual(['vfx']);
    expect(validateCombatPresentationBusReport(report)).toBe(true);
    expect(bus.failureLog()[0]).toContain('telemetry-test-failure');
  });
});


describe('spatial audio and animation reaction', () => {
  it('derives stable pan, attenuation and occlusion without renderer dependencies', () => {
    const state = resolveCombatSpatialAudio(
      vec3(4, 0, 2),
      { position: vec3(0, 0, 0), forward: vec3(0, 0, 1) },
      0.25,
    );
    expect(validateCombatSpatialAudio(state)).toBe(true);
    expect(state.distanceMeters).toBeCloseTo(4.472, 3);
    expect(state.pan).toBeGreaterThan(0);
    expect(state.volumeMultiplier).toBeLessThan(state.attenuation);
  });

  it('turns damage and poise pressure into animation-ready recoil intent', () => {
    const director = new CombatPresentationDirector();
    const cue = director.ingest([{
      tick: 9,
      type: 'stagger',
      sourceId: combatId(1),
      targetId: combatId(2),
      damage: 34,
      poiseDamage: 22,
      damageType: 'blunt',
    }] as never, {
      states: [],
    }).cues[0]!;
    const intent = resolveCombatReactionIntent({
      cue,
      targetForward: vec3(0, 0, 1),
      targetVelocity: vec3(0, 0, 3),
      targetPoiseRatio: 0.1,
      targetGrounded: true,
    });
    expect(validateCombatReactionIntent(intent)).toBe(true);
    expect(intent.animationLayer).toBe('stagger');
    expect(intent.attackCancelRecommended).toBe(true);
    expect(intent.upperBodyAdditive).toBeGreaterThan(0);
    expect(intent.footPlantWeight).toBeGreaterThan(0);
  });
});


describe('browser bridge and haptic transport', () => {
  it('keeps browser event envelopes bounded and data-only', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([{ tick: 14, type: 'critical', sourceId: combatId(1), targetId: combatId(2), damage: 60 }] as never, { states: [] });
    const queue = new CombatPresentationQueue();
    queue.enqueue(frame.cues, 'gamepad', 14);
    const dispatches = queue.dispatch(14);
    const envelope = buildCombatPresentationBrowserEnvelope(dispatches, [], { maxDispatches: 4, now: () => 123.5 });
    expect(validateCombatPresentationBrowserEnvelope(envelope)).toBe(true);
    expect(envelope.createdAtMonotonicMs).toBe(123.5);
    expect(envelope.dispatches.length).toBe(1);
  });

  it('emits through an injected browser event transport without importing DOM UI code', () => {
    const received: Event[] = [];
    const bridge = new CombatPresentationBrowserBridge({ now: () => 77 });
    bridge.attach((event) => { received.push(event); return true; });
    const envelope = bridge.emit([], []);
    expect(bridge.connected()).toBe(true);
    expect(validateCombatPresentationBrowserEnvelope(envelope)).toBe(true);
    expect(received).toHaveLength(1);
    bridge.detach();
    expect(bridge.connected()).toBe(false);
  });

  it('maps gamepad and touch haptic channels while keeping desktop input silent', async () => {
    expect(resolveHapticChannel('gamepad')).toBe('gamepad');
    expect(resolveHapticChannel('touch')).toBe('vibrate');
    expect(resolveHapticChannel('mouse')).toBe('none');
    const pulses = [{ device: 'gamepad' as const, durationMs: 70, amplitude: 0.8, frequencyHz: 60, attack: 0.1, release: 0.3 }];
    let effects = 0;
    const result = await dispatchCombatHapticPulses(pulses, 'gamepad', {
      gamepad: {
        playEffect: async () => { effects += 1; },
      },
    });
    expect(result.gamepadEffects).toBe(1);
    expect(effects).toBe(1);
    expect(validateCombatHapticDispatch(result)).toBe(true);
    const desktop = await dispatchCombatHapticPulses(pulses, 'mouse', {});
    expect(desktop.attempted).toBe(0);
  });
});


describe('authoritative damage type propagation', () => {
  it('preserves damage type from attack definition into emitted combat events', () => {
    const combat = new CombatSimulation(909);
    const attacker = combatId(1);
    const target = combatId(2);
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(target, vec3(0, 0, 1), createCombatStats());
    combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
    expect(combat.startAttack(attacker, 'frost-cut')).toBe(true);
    const observed: string[] = [];
    for (let tick = 0; tick < 40; tick += 1) {
      for (const event of combat.step()) {
        if (event.damageType) observed.push(event.damageType);
      }
    }
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((type) => type === 'frost')).toBe(true);
  });

  it('keeps network presentation packets deterministic for equivalent cues', () => {
    const director = new CombatPresentationDirector();
    const event = {
      tick: 4,
      type: 'critical',
      sourceId: combatId(1),
      targetId: combatId(2),
      attackId: 'heavy-1',
      damage: 70,
      poiseDamage: 20,
      damageType: 'arcane',
    } as never;
    const cue = director.ingest([event], { states: [] }).cues[0]!;
    const first = buildCombatPresentationNetworkPacket(cue, 4);
    const second = buildCombatPresentationNetworkPacket(cue, 4);
    expect(first).toEqual(second);
    expect(first.damageType).toBe('arcane');
    expect(first.digest).toBe(second.digest);
  });
});


describe('deterministic parry presentation', () => {
  it('parries an active attack, deals zero damage, and stuns the attacker', () => {
    const combat = new CombatSimulation(1234);
    const attacker = combatId(1);
    const defender = combatId(2);
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(defender, vec3(0, 0, 1.5), createCombatStats());
    combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
    combat.setPose(defender, vec3(0, 0, 1.5), vec3(0, 0, -1));
    combat.setParrying(defender, true);
    expect(combat.startAttack(attacker, 'light-1')).toBe(true);
    let parry = null;
    for (let i = 0; i < 20 && !parry; i += 1) {
      parry = combat.step().find((event) => event.type === 'parried') ?? null;
    }
    expect(parry?.damage).toBe(0);
    expect(combat.getState(defender)?.health).toBe(100);
    expect(combat.getState(attacker)?.phase).toBe('stunned');
    expect(combat.getState(defender)?.counterWindowTicks).toBe(8);
    expect(combat.getState(defender)?.counterWindowTicks).toBe(8);
    expect(parry?.counterWindowTicks).toBe(8);
  });

  it('turns the simulation parry event into an explicit presentation defense outcome', () => {
    const combat = new CombatSimulation(77);
    const attacker = combatId(1);
    const defender = combatId(2);
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(defender, vec3(0, 0, 1.5), createCombatStats());
    combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
    combat.setPose(defender, vec3(0, 0, 1.5), vec3(0, 0, -1));
    combat.setParrying(defender, true);
    combat.startAttack(attacker, 'light-1');
    let events = [];
    for (let i = 0; i < 20 && !events.some((event) => event.type === 'parried'); i += 1) events = [...combat.step()];
    const frame = new CombatPresentationDirector().ingest(events, { states: combat.snapshot(), device: 'gamepad' });
    const cue = frame.cues.find((item) => item.defenseOutcome === 'parried');
    expect(cue?.blocked).toBe(true);
    expect(cue?.defenseOutcome).toBe('parried');
    expect(cue?.hitstopTicks).toBeGreaterThanOrEqual(4);
    expect(cue?.intensity).toBeGreaterThan(0.9);
    expect(cue?.counterWindowTicks).toBe(8);
  });
});


describe('deterministic parry counter attack', () => {
  it('consumes the parry window exactly once and amplifies the follow-up hit', () => {
    const combat = new CombatSimulation(41);
    const attacker = combatId(1);
    const defender = combatId(2);
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(defender, vec3(0, 0, 1.5), createCombatStats());
    combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
    combat.setPose(defender, vec3(0, 0, 1.5), vec3(0, 0, -1));
    combat.setParrying(defender, true);
    combat.startAttack(attacker, 'light-1');
    for (let i = 0; i < 20; i += 1) if (combat.step().some((e) => e.type === 'parried')) break;
    expect(combat.getState(defender)?.counterWindowTicks).toBe(8);
    combat.setParrying(defender, false);
    expect(combat.startAttack(defender, 'light-1')).toBe(true);
    expect(combat.getState(defender)?.counterWindowTicks).toBe(0);
    const observed: Array<{ damage?: number; counterAttack?: boolean }> = [];
    for (let i = 0; i < 20; i += 1) for (const event of combat.step()) if (event.sourceId === defender && (event.type === 'hit' || event.type === 'critical')) observed.push(event);
    expect(observed.some((event) => event.counterAttack === true)).toBe(true);
    expect(Math.max(...observed.map((event) => event.damage ?? 0))).toBeGreaterThan(18);
  });

  it('keeps counter presentation distinct from a normal hit without new asset authority', () => {
    const cue = new CombatPresentationDirector().ingest([{
      tick: 8, type: 'hit', sourceId: combatId(2), targetId: combatId(1), attackId: 'light-1',
      damage: 24.3, poiseDamage: 12, damageType: 'slash', counterAttack: true,
    }], { states: [], device: 'gamepad' }).cues[0];
    expect(cue?.counterAttack).toBe(true);
    expect(cue?.defenseOutcome).toBe('none');
    expect(cue?.intensity).toBeGreaterThan(0.8);
  });
});


describe('counter resource efficiency', () => {
  it('allows a counter-start below the normal attack cost', () => {
    const combat = new CombatSimulation(902, { counterStaminaMultiplier: 0.8 });
    const attacker = combatId(1);
    const defender = combatId(2);
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(defender, vec3(0, 0, 1.5), createCombatStats({ maxStamina: 9, staminaRegen: 0 }));
    combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
    combat.setPose(defender, vec3(0, 0, 1.5), vec3(0, 0, -1));
    combat.setParrying(defender, true);
    combat.startAttack(attacker, 'light-1');
    for (let i = 0; i < 20; i += 1) if (combat.step().some((e) => e.type === 'parried')) break;
    expect(combat.startAttack(defender, 'light-1')).toBe(true);
    expect(combat.getState(defender)?.counterWindowTicks).toBe(0);
  });
});
