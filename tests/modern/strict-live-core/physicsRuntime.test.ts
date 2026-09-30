import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHYSICS_POLICY,
  StrictPhysicsRuntime,
  aabbCollider,
  circleCollider,
  collideCircleAgainst,
  depenetrate,
  integrateJump,
  resolveGroundContact,
  sweepCircle,
} from '../../../src/3d/strict/physicsRuntime.ts';
import { entityId, vec3 } from '../../../src/3d/strict/liveCoreTypes.ts';

const ground = {
  sampleHeight: () => 0,
  sampleNormal: () => vec3(0, 1, 0),
  sampleMaterial: () => 'grass',
};

describe('physicsRuntime', () => {
  it('normalizes collider bounds', () => {
    const circle = circleCollider(entityId('rock'), 0, 0, 2);
    const box = aabbCollider(entityId('wall'), { minX: 5, maxX: 1, minZ: 8, maxZ: 4 });
    expect(circle.shape.value.radius).toBe(2);
    expect(box.shape.value.minX).toBe(1);
    expect(box.shape.value.maxZ).toBe(8);
  });
  it('detects circle collisions', () => {
    const hit = collideCircleAgainst(vec3(0, 0, 0), 1, [
      circleCollider(entityId('b'), 1.5, 0, 1),
      circleCollider(entityId('a'), 100, 0, 1),
    ]);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.colliderId).toBe('b');
  });
  it('sorts contacts by collider id', () => {
    const contacts = collideCircleAgainst(vec3(0, 0, 0), 1, [
      circleCollider(entityId('z'), .5, 0, 1),
      circleCollider(entityId('a'), -.5, 0, 1),
    ]);
    expect(contacts.map(contact => contact.colliderId)).toEqual(['a', 'z']);
  });
  it('depenetrates along the supplied normal', () => {
    const position = depenetrate(vec3(0, 0, 0), [
      { colliderId: entityId('wall'), normal: vec3(1, 0, 0), penetration: .5 },
    ]);
    expect(position.x).toBeGreaterThanOrEqual(.5);
  });
  it('integrates a complete jump arc', () => {
    let state = {
      heightAboveGround: 0,
      verticalVelocity: 0,
      grounded: true,
      coyoteRemaining: DEFAULT_PHYSICS_POLICY.coyoteTimeSeconds,
    };
    state = integrateJump(state, 1 / 60, true);
    expect(state.grounded).toBe(false);
    for (let i = 0; i < 120; i += 1) state = integrateJump(state, 1 / 60, false);
    expect(state.grounded).toBe(true);
    expect(state.heightAboveGround).toBe(0);
  });
  it('reads ground contact from a sampler', () => {
    const contact = resolveGroundContact(vec3(2, .01, 3), vec3(), ground);
    expect(contact.grounded).toBe(true);
    expect(contact.groundY).toBe(0);
    expect(contact.material).toBe('grass');
  });
  it('sweeps a moving circle into an obstacle', () => {
    const hit = sweepCircle(vec3(0, 0, 0), vec3(10, 0, 0), 1, [
      circleCollider(entityId('pillar'), 5, 0, 1),
    ]);
    expect(hit).not.toBeNull();
    expect(hit?.fraction).toBeLessThan(1);
  });
  it('returns no sweep hit when the path misses', () => {
    expect(sweepCircle(vec3(0, 0, 0), vec3(10, 0, 0), .5, [
      circleCollider(entityId('off'), 5, 5, 1),
    ])).toBeNull();
  });
  it('steps a grounded body deterministically', () => {
    const runtime = new StrictPhysicsRuntime(ground, DEFAULT_PHYSICS_POLICY, [
      circleCollider(entityId('rock'), 2, 0, .8),
    ]);
    const body = {
      entity: entityId('player'),
      position: vec3(0, 0, 0),
      velocity: vec3(),
      radius: .4,
      height: 1.8,
      onGround: true,
      groundedMaterial: 'grass',
    };
    const jump = { heightAboveGround: 0, verticalVelocity: 0, grounded: true, coyoteRemaining: .12 };
    const result = runtime.step(body, jump, vec3(1, 0, 0), false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.body.groundedMaterial).toBe('grass');
  });
  it('rejects duplicate collider ids', () => {
    const runtime = new StrictPhysicsRuntime(ground);
    const collider = circleCollider(entityId('rock'), 0, 0, 1);
    expect(runtime.addCollider(collider).ok).toBe(true);
    expect(runtime.addCollider(collider).ok).toBe(false);
  });
  it('rejects work after disposal', () => {
    const runtime = new StrictPhysicsRuntime(ground);
    runtime.dispose();
    expect(runtime.step({
      entity: entityId('p'), position: vec3(), velocity: vec3(), radius: .4,
      height: 1.8, onGround: true, groundedMaterial: 'grass',
    }, {
      heightAboveGround: 0, verticalVelocity: 0, grounded: true, coyoteRemaining: .1,
    }, vec3(), false).ok).toBe(false);
  });
});