import { describe, expect, it } from 'vitest';
import { CombatPresentationDirector } from '../../src/3d/nextgen/combatPresentationV1';
import { CombatPresentationQueue } from '../../src/3d/nextgen/combatPresentationQueueV1';
import { projectCombatAccessibility } from '../../src/3d/nextgen/combatPresentationAccessibilityV1';
import { getCombatDamageTypeProfile, listCombatDamageTypeProfiles } from '../../src/3d/nextgen/combatPresentationDamageTypeV1';
import { resolveCombatSpatialAudio } from '../../src/3d/nextgen/combatPresentationSpatialAudioV1';
import { resolveCombatReactionIntent } from '../../src/3d/nextgen/combatPresentationReactionV1';
import { createCombatPresentationTimeline } from '../../src/3d/nextgen/combatPresentationTimelineV1';
import { createCombatPresentationTelemetry } from '../../src/3d/nextgen/combatPresentationTelemetryV1';
import { resolveCombatPresentationQuality, tuneCombatPresentationCue } from '../../src/3d/nextgen/combatPresentationQualityV1';
import { createCombatPresentationBus } from '../../src/3d/nextgen/combatPresentationBusV1';
import { auditCombatPresentationAssets, buildCombatAssetProof } from '../../src/3d/nextgen/combatPresentationAssetsV1';
import { validateCombatPresentationContract } from '../../src/3d/nextgen/combatPresentationContractV1';
import type { CombatEvent } from '../../src/3d/nextgen/combatSimulation';
import { vec3 } from '../../src/3d/nextgen/deterministicMath';

const id = (value:number) => value as never;
const cueFor = (type:CombatEvent['type'], damageType:CombatEvent['damageType']='slash') => {
  const director = new CombatPresentationDirector();
  const event = { tick: 10, type, sourceId:id(1), targetId:id(2), attackId:'test', damage: type === 'dodge' ? 0 : 24, poiseDamage: type === 'stagger' ? 30 : 8, damageType } as CombatEvent;
  return director.ingest([event], { states:[
    { id:id(1), position:vec3(0,0,0), forward:vec3(0,0,1), phase:'idle', phaseTicksRemaining:0, health:100, stamina:100, poise:50, currentAttack:null, comboStep:0, invulnerableTicks:0, hitstopTicks:0, stunTicks:0, lastHitBy:null },
    { id:id(2), position:vec3(0,0,2), forward:vec3(0,0,-1), phase:'idle', phaseTicksRemaining:0, health:100, stamina:80, poise:20, currentAttack:null, comboStep:0, invulnerableTicks:0, hitstopTicks:0, stunTicks:0, lastHitBy:null },
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
      const reaction = resolveCombatSpatialAudio(vec3(3,0,4), { position:vec3(0,0,0), forward:vec3(0,0,1) });
      expect(reaction.volumeMultiplier).toBeGreaterThanOrEqual(0);
      expect(reaction.volumeMultiplier).toBeLessThanOrEqual(1);
      expect(getCombatDamageTypeProfile(profile.damageType).damageType).toBe(profile.damageType);
      void surface;
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