import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PLAYER_SOCKET_DEFAULTS,
  PLAYER_SOCKET_LIMITS,
  applyPlayerSocketAttachment,
  auditPlayerSocketAttachmentPlan,
  buildPlayerSocketAttachmentPlan,
  buildSocketPlacementEvidence,
  normalizePlayerSocketOverrides,
  resolvePlayerSocketAttachment,
  validatePlayerSocketAttachment,
} from '../../src/3d/gameplay/playerEquipmentSocketAttachment.ts';

const equipment = {
  slots: {
    head: { id: 'hood' },
    chest: { id: 'brigandine' },
    back: { id: 'bow' },
    mainHand: { id: 'longsword' },
    offHand: { id: 'buckler' },
  },
};

function expectFiniteTransform(value: unknown): void {
  const record = value as { position: Record<string, number>; rotation: Record<string, number>; scale: Record<string, number> };
  for (const group of [record.position, record.rotation, record.scale]) {
    for (const axis of ['x', 'y', 'z']) expect(Number.isFinite(group[axis])).toBe(true);
  }
}

describe('player equipment socket attachment strict contract', () => {
  it('deep-freezes canonical defaults and normalizes aliases with bounded transforms', () => {
    expect(Object.isFrozen(PLAYER_SOCKET_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(PLAYER_SOCKET_DEFAULTS.head.position)).toBe(true);
    expect(Object.isFrozen(PLAYER_SOCKET_LIMITS.scale)).toBe(true);

    const overrides = normalizePlayerSocketOverrides({
      helmet: { position: { x: 0.2, y: 0.1, z: -0.1 }, rotation: { x: 0.1, y: 0.2, z: 0.3 }, scale: 1.2 },
      weapon: { position: { x: 99, y: -99, z: 3 }, rotation: { x: 99, y: -99, z: 5 }, scale: { x: 0.01, y: 9, z: 1.5 } },
      'left-hand': { position: { x: 0, y: 0, z: 0 } },
      unknown: { position: { x: 0 } },
    });

    expect(overrides.head).toBeDefined();
    expect(overrides.mainHand?.position.x).toBe(PLAYER_SOCKET_LIMITS.positionMeters);
    expect(overrides.mainHand?.scale.x).toBe(PLAYER_SOCKET_LIMITS.scale.min);
    expect(overrides.mainHand?.scale.y).toBe(PLAYER_SOCKET_LIMITS.scale.max);
    expect(overrides.offHand).toBeDefined();
    expect(Object.isFrozen(overrides.mainHand?.position)).toBe(true);
    expect((overrides as Record<string, unknown>).unknown).toBeUndefined();
  });

  it('preserves item-authored grip offsets when an override changes only one axis', () => {
    const resolved = resolvePlayerSocketAttachment('main-hand', {
      id: 'longsword',
      attachment: {
        position: { x: 0.31, y: 0.02, z: -0.04 },
        rotation: { x: 0.2, y: 0.3, z: 0.4 },
        scale: 1.15,
      },
    }, {
      overrides: { weapon: { position: { y: 0.12 } } },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.slot).toBe('mainHand');
    expect(resolved.transform.position).toEqual({ x: 0.31, y: 0.12, z: -0.04 });
    expect(resolved.transform.rotation).toEqual({ x: 0.2, y: 0.3, z: 0.4 });
    expect(resolved.transform.scale).toEqual({ x: 1.15, y: 1.15, z: 1.15 });
    expect(validatePlayerSocketAttachment(resolved, 'mainHand').ok).toBe(true);
  });

  it('fails closed on malformed external descriptors without throwing', () => {
    const malformed = {
      ok: true,
      slot: 'mainHand',
      socketName: 'RightHand',
      itemId: 'longsword',
      inheritScale: true,
      visible: true,
      transform: null,
    };
    expect(() => validatePlayerSocketAttachment(malformed)).not.toThrow();
    expect(validatePlayerSocketAttachment(malformed).ok).toBe(false);
    expect(validatePlayerSocketAttachment(malformed).errors).toContain('invalid-transform');

    const audit = auditPlayerSocketAttachmentPlan({
      version: 1,
      bindings: { mainHand: malformed, unrecognized: malformed },
    });
    expect(audit.ok).toBe(false);
    expect(audit.errors).toContain('mainHand:invalid-transform');
    expect(audit.errors).toContain('unsupported-slot:unrecognized');
    expect(auditPlayerSocketAttachmentPlan({ version: 9, bindings: [] }).errors).toContain('invalid-plan-version');
  });

  it('sanitizes hostile numeric values and symbol conversion without leaking NaN', () => {
    const resolved = resolvePlayerSocketAttachment('mainHand', {
      id: 'sword',
      attachment: {
        position: { x: Symbol('not-a-number'), y: Infinity, z: -Infinity },
        rotation: { x: NaN, y: Math.PI * 4, z: -Math.PI * 4 },
        scale: null,
      },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expectFiniteTransform(resolved.transform);
    expect(Math.abs(resolved.transform.position.x)).toBeLessThanOrEqual(PLAYER_SOCKET_LIMITS.positionMeters);
    expect(Math.abs(resolved.transform.rotation.y)).toBeLessThanOrEqual(Math.PI);
    expect(resolved.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('builds deterministic plans and evidence for the existing equipment profile contract', () => {
    const first = buildPlayerSocketAttachmentPlan(equipment, { rootScale: 5 });
    const second = buildPlayerSocketAttachmentPlan(equipment, { rootScale: 5 });
    expect(first).toEqual(second);
    expect(first.rootScale).toBe(2.5);
    expect(auditPlayerSocketAttachmentPlan(first).ok).toBe(true);

    const evidence = buildSocketPlacementEvidence(equipment);
    expect(evidence.audit.ok).toBe(true);
    expect(evidence.attachmentCount).toBe(5);
    expect(evidence.populatedSlots).toEqual(['head', 'chest', 'back', 'mainHand', 'offHand']);
  });

  it('applies a validated descriptor without freezing the live Three.js object', () => {
    const object = new THREE.Object3D();
    object.scale.set(3, 3, 3);
    const attachment = resolvePlayerSocketAttachment('mainHand', {
      id: 'longsword',
      attachment: { position: { x: 0.03, y: 0.01, z: -0.04 }, rotation: { x: 0.2, y: 0.3, z: 0.4 }, scale: 1.15 },
    });
    const applied = applyPlayerSocketAttachment(object, attachment, { preserveExistingScale: true });
    expect(applied.ok).toBe(true);
    expect(object.userData.playerSocketAttachment.slot).toBe('mainHand');
    expect(object.position.x).toBe(0.03);
    expect(object.rotation.z).toBe(0.4);
    expect(object.scale.toArray()).toEqual([3, 3, 3]);
    expect(Object.isFrozen(object)).toBe(false);
    expect(Object.isFrozen(object.userData)).toBe(false);
  });

  it('keeps a deterministic finite boundary across hostile transform samples', () => {
    const samples: unknown[] = [-1e9, -1.5, 0, 1.5, 1e9, NaN, Infinity, -Infinity, Symbol('x')];
    for (const sample of samples) {
      const resolved = resolvePlayerSocketAttachment('offHand', {
        id: 'buckler',
        attachment: {
          position: { x: sample, y: sample, z: sample },
          rotation: { x: sample, y: sample, z: sample },
          scale: { x: sample, y: sample, z: sample },
        },
      });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expectFiniteTransform(resolved.transform);
        expect(Math.abs(resolved.transform.position.x)).toBeLessThanOrEqual(PLAYER_SOCKET_LIMITS.positionMeters);
        expect(resolved.transform.scale.x).toBeGreaterThanOrEqual(PLAYER_SOCKET_LIMITS.scale.min);
        expect(resolved.transform.scale.x).toBeLessThanOrEqual(PLAYER_SOCKET_LIMITS.scale.max);
      }
    }
  });
});
