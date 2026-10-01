import { describe, expect, it } from 'vitest';
import { CombatPresentationDirector } from '../../src/3d/nextgen/combatPresentationV1';
import { CombatPresentationQueue } from '../../src/3d/nextgen/combatPresentationQueueV1';
import { projectCombatAccessibility } from '../../src/3d/nextgen/combatPresentationAccessibilityV1';
import { getCombatDamageTypeProfile, listCombatDamageTypeProfiles, resolveCombatSurfaceReaction } from '../../src/3d/nextgen/combatPresentationDamageTypeV1';
import { resolveCombatSpatialAudio } from '../../src/3d/nextgen/combatPresentationSpatialAudioV1';
import { resolveCombatReactionIntent } from '../../src/3d/nextgen/combatPresentationReactionV1';
import { createCombatPresentationTimeline } from '../../src/3d/nextgen/combatPresentationTimelineV1';
import { createCombatPresentationTelemetry } from '../../src/3d/nextgen/combatPresentationTelemetryV1';
import { resolveCombatPresentationQuality, tuneCombatPresentationCue } from '../../src/3d/nextgen/combatPresentationQualityV1';
import { createCombatPresentationBus } from '../../src/3d/nextgen/combatPresentationBusV1';
import { auditCombatPresentationAssets, buildCombatAssetProof } from '../../src/3d/nextgen/combatPresentationAssetsV1';
import { validateCombatPresentationContract } from '../../src/3d/nextgen/combatPresentationContractV1';
import { buildCombatPresentationNetworkPacket, encodeCombatPresentationNetworkPacket, decodeCombatPresentationNetworkPacket, buildCombatPresentationNetworkAudit, sortAndDedupeCombatPresentationPackets } from '../../src/3d/nextgen/combatPresentationNetworkV1';
import { resolveCombatCameraFocus, smoothCombatCameraFocus, validateCombatCameraFocus } from '../../src/3d/nextgen/combatPresentationCameraFocusV1';
import { buildCombatSurfaceImpactMatrix, summarizeCombatSurfaceImpactMatrix, validateCombatSurfaceImpactRoute } from '../../src/3d/nextgen/combatPresentationSurfaceImpactV1';
import { combatInputPresentationBudget, resolveCombatInputDeviceParity, resolveCombatPresentationInputLatency, validateCombatPresentationInputResult } from '../../src/3d/nextgen/combatPresentationInputLatencyV1';
import type { CombatEvent } from '../../src/3d/nextgen/combatSimulation';
import { vec3 } from '../../src/3d/nextgen/deterministicMath';

const id = (value:number) => value as never;
const combatId = id;
const cueFor = (type:CombatEvent['type'], damageType:CombatEvent['damageType']='slash') => {
  const director = new CombatPresentationDirector();
  const event = { tick: 10, type, sourceId:id(1), targetId:id(2), attackId:'test', damage: type === 'dodge' ? 0 : 24, poiseDamage: type === 'stagger' ? 30 : 8, damageType } as CombatEvent;
  return director.ingest([event], { states:[
    { id:id(1), position:vec3(0,0,0), forward:vec3(0,0,1), phase:'idle', phaseTicksRemaining:0, health:100, stamina:100, poise:50, currentAttack:null, comboStep:0, invulnerableTicks:0, hitstopTicks:0, stunTicks:0, lastHitBy:null, counterWindowTicks:0, counterAttack:false },
    { id:id(2), position:vec3(0,0,2), forward:vec3(0,0,-1), phase:'idle', phaseTicksRemaining:0, health:100, stamina:80, poise:20, currentAttack:null, comboStep:0, invulnerableTicks:0, hitstopTicks:0, stunTicks:0, lastHitBy:null, counterWindowTicks:0, counterAttack:false },
  ] }).cues[0]!;
};

describe('combat presentation contract matrix', () => {
  it('covers every authoritative damage type with finite presentation output', () => {
    for (const profile of listCombatDamageTypeProfiles()) {
      const cue = cueFor('hit', profile.damageType);
      expect(cue.damageType).toBe(profile.damageType);
      expect(Number.isFinite(cue.vfx.intensity)).toBe(true);
      expect(Number.isFinite(cue.camera.amplitude)).toBe(true);
      expect(Number.isFinite(cue.audio.volume)).toBe(true);
      expect(cue.materialResponse).toBe(profile.materialResponse);
    }
  });

  it('keeps surface reaction matrix bounded across all six damage types', () => {
    const surfaces = ['skin','cloth','leather','metal','stone','ice'] as const;
    for (const profile of listCombatDamageTypeProfiles()) for (const surface of surfaces) {
      const surfaceReaction = resolveCombatSurfaceReaction(profile.damageType, surface);
      const spatial = resolveCombatSpatialAudio(vec3(3,0,4), { position:vec3(0,0,0), forward:vec3(0,0,1) });
      expect(surfaceReaction.intensity).toBeGreaterThanOrEqual(0);
      expect(surfaceReaction.pulse).toBeGreaterThanOrEqual(0);
      expect(spatial.volumeMultiplier).toBeGreaterThanOrEqual(0);
      expect(spatial.volumeMultiplier).toBeLessThanOrEqual(1);
      expect(getCombatDamageTypeProfile(profile.damageType).damageType).toBe(profile.damageType);
    }
  });

  it('covers all combat event families with non-null semantic cues', () => {
    for (const type of ['attack-start','hit','blocked','critical','stagger','death','dodge'] as const) {
      const cue = cueFor(type);
      expect(cue.semantic.length).toBeGreaterThan(0);
      expect(cue.id.startsWith('combat-')).toBe(true);
    }
  });

  it('keeps reduced-motion/accessibility projections semantically identical', () => {
    const cue = cueFor('critical', 'frost');
    const standard = projectCombatAccessibility([cue], { mode:'standard', device:'gamepad' })[0]!;
    const reduced = projectCombatAccessibility([cue], { mode:'reduced-motion', device:'gamepad' })[0]!;
    expect(reduced.semantic).toBe(standard.semantic);
    expect(reduced.label).toBe(standard.label);
    expect(reduced.motionScale).toBeLessThan(standard.motionScale);
  });

  it('keeps queue budgets bounded even with burst traffic', () => {
    const director = new CombatPresentationDirector({ maxCuesPerTick:64 });
    const events = Array.from({length:64},(_,index)=>({ tick:30, type:index%3===0?'critical':index%3===1?'hit':'blocked', sourceId:id(index+1), targetId:id(100+index), damage:20, poiseDamage:4, damageType:index%2?'slash':'blunt' })) as CombatEvent[];
    const cues = director.ingest(events, { states:[] }).cues;
    const queue = new CombatPresentationQueue({ maxDispatchPerFrame:8, maxPerChannelPerFrame:{vfx:4,sfx:4,haptic:3,camera:4} });
    queue.enqueue(cues, 'gamepad', 30);
    const dispatches = queue.dispatch(30);
    expect(dispatches.length).toBeLessThanOrEqual(8);
    expect(queue.pendingCount()).toBeLessThanOrEqual(256);
  });

  it('preserves critical presentation under adaptive shedding', () => {
    const cue = cueFor('critical', 'arcane');
    const decision = resolveCombatPresentationQuality({ frameP95Ms:28, pendingQueue:180, droppedCues:12, reducedMotion:false, device:'gamepad' });
    const tuned = tuneCombatPresentationCue(cue, decision);
    expect(decision.quality).toBe('reduced');
    expect(tuned.vfx.intensity).toBeGreaterThanOrEqual(cue.intensity*0.9);
  });

  it('generates valid timeline/reaction/spatial artifacts together', () => {
    const cue = cueFor('stagger', 'blunt');
    const timeline = createCombatPresentationTimeline(cue);
    const reaction = resolveCombatReactionIntent({ cue, targetPoiseRatio:0.05, targetGrounded:true });
    const spatial = resolveCombatSpatialAudio(cue.position, { position:vec3(-2,0,-2), forward:vec3(0,0,1) }, 0.15);
    expect(timeline.totalDurationMs).toBeGreaterThan(0);
    expect(reaction.animationLayer).toBe('stagger');
    expect(spatial.pan).toBeGreaterThanOrEqual(-1);
    expect(spatial.pan).toBeLessThanOrEqual(1);
  });

  it('tracks telemetry and bus delivery without coupling to DOM', () => {
    const cue = cueFor('hit');
    const queue = new CombatPresentationQueue();
    queue.enqueue([cue], 'touch', 10);
    const dispatches = queue.dispatch(10);
    const telemetry = createCombatPresentationTelemetry();
    const director = new CombatPresentationDirector();
    const frame = director.ingest([{ tick:10,type:'hit',sourceId:id(1),targetId:id(2),damage:10 }] as CombatEvent[], { states:[] });
    telemetry.record(frame, dispatches, queue.pendingCount());
    const bus = createCombatPresentationBus();
    let consumed = 0;
    bus.subscribe({ id:'capture', channels:['vfx','sfx','camera'], consume(){ consumed += 1; } });
    const report = bus.dispatch(dispatches, [], 10);
    expect(report.consumerFailures).toBe(0);
    expect(consumed).toBeGreaterThan(0);
    expect(telemetry.summary().health).toBe('healthy');
  });

  it('exposes honest asset readiness without pretending missing combat assets exist', () => {
    const audit = auditCombatPresentationAssets();
    const proof = buildCombatAssetProof();
    expect(audit.total).toBeGreaterThan(0);
    expect(audit.missingCombatVfx).toBeGreaterThan(0);
    expect(audit.missingCombatAudio).toBeGreaterThan(0);
    expect(proof.disclosedFallbacks.length).toBeGreaterThan(0);
  });

  it('passes the unified acceptance contract for a healthy frame', () => {
    const cue = cueFor('critical', 'fire');
    const director = new CombatPresentationDirector();
    const frame = director.ingest([{ tick:10,type:'critical',sourceId:id(1),targetId:id(2),damage:40,damageType:'fire' }] as CombatEvent[], { states:[] });
    const queue = new CombatPresentationQueue();
    queue.enqueue(frame.cues,'gamepad',10);
    const dispatches = queue.dispatch(10);
    const telemetry = createCombatPresentationTelemetry(); telemetry.record(frame,dispatches,queue.pendingCount());
    const report = validateCombatPresentationContract({ frame, dispatches, accessibility:projectCombatAccessibility(frame.cues,{device:'gamepad'}), assetAudit:auditCombatPresentationAssets(), quality:resolveCombatPresentationQuality({frameP95Ms:5,pendingQueue:queue.pendingCount(),droppedCues:frame.droppedCues,reducedMotion:false,device:'gamepad'}), telemetry:telemetry.summary(), timelineSamples:[createCombatPresentationTimeline(cue).sample(0)] });
    expect(report.valid).toBe(true);
  });
});

describe('camera focus framing adapter', () => {
  it('ranks lock-on presentation targets without replacing authoritative selection', () => {
    const result = resolveCombatCameraFocus(vec3(0,0,0), vec3(0,0,1), [
      { id:'far', position:vec3(0,0,14), priority:1, healthRatio:1, targetable:true },
      { id:'locked', position:vec3(2,0,5), priority:0, healthRatio:0.6, locked:true, targetable:true },
      { id:'near', position:vec3(-1,0,4), priority:1, healthRatio:0.8, targetable:true },
      { id:'hidden', position:vec3(0,0,2), targetable:false },
    ]);
    expect(validateCombatCameraFocus(result)).toBe(true);
    expect(result.targetId).toBe('locked');
    expect(result.targetCount).toBe(3);
    expect(result.framingDistanceMeters).toBeGreaterThan(2);
  });

  it('smooths focus transitions while keeping the winning target identity', () => {
    const previous = resolveCombatCameraFocus(vec3(0,0,0), vec3(0,0,1), [
      { id:'a', position:vec3(0,0,4), priority:1, targetable:true },
    ]);
    const current = resolveCombatCameraFocus(vec3(0.5,0,0), vec3(0.2,0,1), [
      { id:'b', position:vec3(2,0,5), priority:3, targetable:true },
    ]);
    const smoothed = smoothCombatCameraFocus(previous, current, 0.4);
    expect(smoothed.targetId).toBe('b');
    expect(smoothed.focusPoint.x).toBeGreaterThan(previous.focusPoint.x);
    expect(smoothed.focusPoint.x).toBeLessThan(current.focusPoint.x);
    expect(validateCombatCameraFocus(smoothed)).toBe(true);
  });
});


describe('combat input latency parity', () => {
  it('keeps all supported devices on bounded latency rules', () => {
    const devices = ['keyboard','mouse','gamepad','touch','virtual','replay'] as const;
    for (const device of devices) {
      const result = resolveCombatPresentationInputLatency({
        action: device === 'touch' ? 'dodge' : 'lightAttack',
        device,
        sourceTick: 98,
        simulationTick: 100,
        timestampMs: 1600,
        held: true,
        strength: 0.8,
      });
      expect(validateCombatPresentationInputResult(result)).toBe(true);
      expect(result.ageTicks).toBe(2);
      expect(result.queuePriority).toBeGreaterThanOrEqual(1);
      expect(combatInputPresentationBudget(device).allowedAgeTicks).toBeGreaterThanOrEqual(2);
    }
  });

  it('prewarms combat-critical actions without accepting stale input', () => {
    const early = resolveCombatPresentationInputLatency({
      action: 'parry',
      device: 'gamepad',
      sourceTick: 100,
      simulationTick: 101,
      timestampMs: 1700,
      held: true,
    });
    const late = resolveCombatPresentationInputLatency({
      action: 'parry',
      device: 'touch',
      sourceTick: 80,
      simulationTick: 100,
      timestampMs: 1700,
      held: true,
    });
    expect(early.prewarm).toBe(true);
    expect(early.accepted).toBe(true);
    expect(late.late).toBe(true);
    expect(late.accepted).toBe(false);
    expect(late.prewarm).toBe(false);
  });

  it('reports cross-device parity without a separate input framework', () => {
    const report = resolveCombatInputDeviceParity([
      { action:'lightAttack', device:'keyboard', sourceTick:1, simulationTick:1, timestampMs:0, held:false },
      { action:'lightAttack', device:'mouse', sourceTick:1, simulationTick:2, timestampMs:17, held:false },
      { action:'dodge', device:'gamepad', sourceTick:2, simulationTick:3, timestampMs:34, held:true },
      { action:'dodge', device:'touch', sourceTick:2, simulationTick:3, timestampMs:34, held:true },
      { action:'block', device:'virtual', sourceTick:3, simulationTick:3, timestampMs:50, held:true },
      { action:'parry', device:'replay', sourceTick:4, simulationTick:4, timestampMs:67, held:true },
    ]);
    expect(report.accepted).toBe(6);
    expect(report.late).toBe(0);
    expect(report.prewarm).toBeGreaterThan(0);
    expect(Object.values(report.byDevice).reduce((sum, value) => sum + value, 0)).toBe(6);
  });
});


describe('network presentation and impulse stack', () => {
  it('round-trips a presentation packet with bounded remote validation', () => {
    const cue = cueFor('critical', 'frost');
    const packet = buildCombatPresentationNetworkPacket(cue, 11);
    const encoded = encodeCombatPresentationNetworkPacket(packet);
    const decoded = decodeCombatPresentationNetworkPacket(encoded);
    expect(decoded).toEqual(packet);
    const audit = buildCombatPresentationNetworkAudit([packet, packet], { localTick: 10, maxAgeTicks: 8, maxFutureTicks: 2, maxPackets: 4 });
    expect(audit.valid).toBe(true);
    expect(audit.accepted).toBe(1);
    expect(audit.dropped).toBe(1);
    expect(sortAndDedupeCombatPresentationPackets([packet, packet])).toHaveLength(1);
  });

  it('bounds remote packet age and future-lead without mutating combat state', () => {
    const cue = cueFor('hit');
    const packet = buildCombatPresentationNetworkPacket(cue, 5);
    const stale = { ...packet, tick: 0 };
    const future = { ...packet, tick: 99 };
    expect(buildCombatPresentationNetworkAudit([stale], { localTick: 20, maxAgeTicks: 4 }).valid).toBe(false);
    expect(buildCombatPresentationNetworkAudit([future], { localTick: 20, maxFutureTicks: 2 }).valid).toBe(false);
  });

  it('accumulates multi-impact recoil deterministically and clamps the camera envelope', () => {
    const director = new CombatPresentationDirector();
    const frame = director.ingest([
      { tick: 3, type: 'hit', sourceId: combatId(1), targetId: combatId(2), damage: 12, damageType: 'slash' },
      { tick: 3, type: 'critical', sourceId: combatId(2), targetId: combatId(1), damage: 58, damageType: 'blunt' },
      { tick: 3, type: 'stagger', sourceId: combatId(2), targetId: combatId(1), damage: 10, poiseDamage: 30, damageType: 'blunt' },
    ] as never, { states: [] });
    const stackA = createCombatImpulseStack({ maxImpulses: 8 });
    const stackB = createCombatImpulseStack({ maxImpulses: 8 });
    stackA.addCues(frame.cues);
    stackB.addCues(frame.cues);
    const a = stackA.sample(0.04);
    const b = stackB.sample(0.04);
    expect(a).toEqual(b);
    expect(validateCombatImpulseState(a)).toBe(true);
    expect(Math.abs(a.yawDegrees)).toBeLessThanOrEqual(10);
    expect(Math.abs(a.pitchDegrees)).toBeLessThanOrEqual(8);
    expect(Math.hypot(a.recoil.x, a.recoil.y, a.recoil.z)).toBeLessThanOrEqual(0.18);
  });
});


describe('shared-material surface impact routing', () => {
  it('covers all damage/surface combinations without mutating the shared material authority', () => {
    const routes = buildCombatSurfaceImpactMatrix();
    expect(routes).toHaveLength(54);
    expect(routes.every(validateCombatSurfaceImpactRoute)).toBe(true);
    const summary = summarizeCombatSurfaceImpactMatrix(routes);
    expect(summary.routes).toBe(54);
    expect(summary.metallicRoutes).toBeGreaterThan(0);
    expect(summary.fireRoutes).toBeGreaterThan(0);
    expect(summary.frostRoutes).toBeGreaterThan(0);
    expect(summary.maxVisual).toBeLessThanOrEqual(1);
    expect(summary.maxHaptic).toBeLessThanOrEqual(1);
  });
});
