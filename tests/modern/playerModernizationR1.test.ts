import { describe, expect, it } from 'vitest';
import { normalizePlayerMovementInput, PLAYER_RUNTIME_VERSION } from '../../src/3d/gameplay/player.ts';
import { PLAYER_CONFIG } from '../../src/3d/gameplay/playerConfig.ts';
import { NPC_CONFIG } from '../../src/3d/gameplay/npcConfig.ts';
import { ANIMAL_CONFIG } from '../../src/3d/gameplay/animalConfig.ts';
import { DRAGON_CONFIG } from '../../src/3d/gameplay/dragonConfig.ts';
import { createWorldEventSystem } from '../../src/3d/gameplay/worldEvents.ts';
import { applyCreatureGait, resetCreatureGaitPose } from '../../src/3d/gameplay/creatureGait.ts';
import { findBodyPlan } from '../../src/3d/gameplay/creatureBodyPlans.ts';
import { Bone } from 'three';
import { EventBus } from '../../src/3d/eventBus.ts';
describe('Kızıl Ufuk player modernization R1', () => {
  it('normalizes hostile runtime input without allowing NaN or out-of-range motion', () => {
    const invalid = normalizePlayerMovementInput({ x: Number.NaN, z: Number.POSITIVE_INFINITY, guarding: true });
    expect(invalid).toEqual({ x: 0, z: 0, guarding: true });
    const input = normalizePlayerMovementInput({ x: 7, z: -4, guarding: true });
    expect(input).toEqual({ x: 1, z: -1, guarding: true });
    expect(PLAYER_RUNTIME_VERSION).toBe(1);
  });
  it('keeps the shipped player asset family explicit and typed', () => {
    expect(PLAYER_CONFIG.MODEL_URL).toBe('assets/models/characters/peasant_girl.fbx');
    expect(Object.keys(PLAYER_CONFIG.ANIMATION_URLS).sort()).toEqual(['idle', 'running', 'walking']);
    expect(PLAYER_CONFIG.WALK_SPEED_MPS).toBeGreaterThan(0);
    expect(PLAYER_CONFIG.RUN_SPEED_MPS).toBeGreaterThan(PLAYER_CONFIG.WALK_SPEED_MPS);
  });
  it('keeps the gameplay configuration owners typed and internally consistent', () => {
    expect(NPC_CONFIG.IDLE_ANIMATION_URL).toBe(PLAYER_CONFIG.ANIMATION_URLS.idle);
    expect(NPC_CONFIG.WALK_ANIMATION_URL).toBe(PLAYER_CONFIG.ANIMATION_URLS.walking);
    expect(Object.keys(ANIMAL_CONFIG.SPECIES).length).toBeGreaterThanOrEqual(10);
    expect(DRAGON_CONFIG.MODEL_URL).toContain('Dragon_Baked_Actions');
    expect(DRAGON_CONFIG.SPAWNS.find((spawn) => spawn.seatId === 'umit')?.seatId).toBe('umit');
  });

  it('keeps world-event runtime deterministic and disposable', () => {
    const emitted: Array<{ id: string }> = [];
    const eventsBus = new EventBus();
    eventsBus.on('world:event', (payload: unknown) => {
      const event = payload as { id: string };
      emitted.push({ id: event.id });
    });
    const a = createWorldEventSystem({ eventsBus, seed: 1337, eventName: 'world:event' });
    const b = createWorldEventSystem({ eventsBus, seed: 1337, eventName: 'world:event' });
    a.update(90);
    b.update(90);
    expect(emitted[0]?.id).toBe(emitted[1]?.id);
    a.dispose();
    const before = emitted.length;
    a.update(999);
    expect(emitted.length).toBe(before);
    b.dispose();
  });

  it('keeps creature gait deterministic and resettable', () => {
    const bones = Object.fromEntries([
      ['hindKneeL', new Bone()], ['hindKneeR', new Bone()], ['foreKneeL', new Bone()], ['foreKneeR', new Bone()],
      ['hindAnkleL', new Bone()], ['hindAnkleR', new Bone()], ['foreAnkleL', new Bone()], ['foreAnkleR', new Bone()],
      ['tailBase', new Bone()], ['wingL', new Bone()], ['wingR', new Bone()], ['wingTipL', new Bone()], ['wingTipR', new Bone()],
    ]);
    const rig = { bones, plan: findBodyPlan('wolf') };
    applyCreatureGait(rig, { gaitName: 'gallop', elapsedSeconds: 1.25 });
    const first = rig.bones.hindKneeL?.rotation.x ?? 0;
    applyCreatureGait(rig, { gaitName: 'gallop', elapsedSeconds: 1.25 });
    expect(rig.bones.hindKneeL?.rotation.x).toBe(first);
    expect(Number.isFinite(first)).toBe(true);
    resetCreatureGaitPose(rig);
    expect(rig.bones.hindKneeL?.rotation.x).toBe(0);
    expect(rig.bones.tailBase?.rotation.y).toBe(0);
  });

  it('keeps combat-safe grounding and camera bounds finite', () => {
    expect(PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS).toBeGreaterThan(1);
    expect(PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS).toBeGreaterThan(PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS);
    expect(PLAYER_CONFIG.CAMERA_COLLISION_MIN_DISTANCE_METERS).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(PLAYER_CONFIG.GRAVITY_MPS2)).toBe(true);
    expect(Number.isFinite(PLAYER_CONFIG.JUMP_SPEED_MPS)).toBe(true);
  });
});