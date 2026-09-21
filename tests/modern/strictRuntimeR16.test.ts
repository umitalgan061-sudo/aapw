import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { resolveRenderQuality, type RenderQuality } from '../../src/3d/renderQuality.ts';
import { createFog, updateFog } from '../../src/3d/fog.ts';
import { updateEntitiesSafely, updateSystemSafely } from '../../src/3d/safeMode.ts';
import { createHealthState, stageDamageResolution, readDamageResolution } from '../../src/3d/gameplay/health.ts';

describe('R16 strict runtime contracts', () => {
  it('resolves bounded renderer quality without breaking the mobile invariant', () => {
    const desktop = resolveRenderQuality({ coarsePointer: false, manualLevel: 'ultra' });
    const mobile = resolveRenderQuality({ coarsePointer: true, manualLevel: 'ultra' });
    const typed: RenderQuality = desktop;
    expect(typed.level).toBe('ultra');
    expect(typed.shadowsEnabled).toBe(true);
    expect(mobile.level).toBe('low');
    expect(mobile.shadowsEnabled).toBe(false);
  });

  it('produces bounded, deterministic fog snapshots', () => {
    const fog = createFog();
    const state = {
      horizonColor: new THREE.Color(0.65, 0.72, 0.81),
      nightFactor: 0.8,
    };
    const first = updateFog(fog, state);
    const second = updateFog(fog, state);
    expect(first).toEqual(second);
    expect(first.density).toBeGreaterThan(0);
    expect(first.density).toBeLessThan(0.001);
    expect(first.horizonChroma).toBeGreaterThanOrEqual(0);
    expect(first.horizonChroma).toBeLessThanOrEqual(1);
  });

  it('isolates a broken entity and latches a broken singleton system', () => {
    const removed: unknown[] = [];
    const disposed: string[] = [];
    const scene = { remove(object: unknown) { removed.push(object); } } as THREE.Scene;
    const good = { object3D: { name: 'good' } as THREE.Object3D, dispose() { disposed.push('good'); } };
    const bad = { object3D: { name: 'bad' } as THREE.Object3D, dispose() { disposed.push('bad'); } };
    const result = updateEntitiesSafely({
      entities: [good, bad],
      scene,
      label: 'NPC',
      update: (entity) => { if (entity === bad) throw new Error('boom'); },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(good);
    expect(removed).toHaveLength(1);
    expect(disposed).toContain('bad');

    let calls = 0;
    let cleanup = 0;
    expect(updateSystemSafely({
      disabled: false,
      label: 'world-events',
      update: () => { calls += 1; throw new Error('boom'); },
      disposeOnError: () => { cleanup += 1; },
    })).toBe(true);
    expect(updateSystemSafely({
      disabled: true,
      label: 'world-events',
      update: () => { calls += 1; },
    })).toBe(true);
    expect(calls).toBe(1);
    expect(cleanup).toBe(1);
  });

  it('keeps staged damage resolution immutable and available across same-event reads', () => {
    const payload = { amount: 12, sourceId: 'player' };
    const snapshot = stageDamageResolution(payload, { amount: 7, appliedAmount: 7 });
    expect(snapshot).not.toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(readDamageResolution(payload)).toEqual(snapshot);
    expect(payload.amount).toBe(7);
    expect(payload.appliedAmount).toBe(7);
  });

  it('keeps the health event contract deterministic and clamped', () => {
    const emitted: Array<{ event: string; payload: any }> = [];
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    const eventsBus = {
      on(event: string, handler: (payload: unknown) => void) {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
      },
      off(event: string, handler: (payload: unknown) => void) {
        handlers.get(event)?.delete(handler);
      },
      emit(event: string, payload?: unknown) {
        emitted.push({ event, payload });
        for (const handler of handlers.get(event) ?? []) handler(payload);
      },
    };
    const health = createHealthState({
      eventsBus,
      maxHealth: 100,
      damageEventName: 'damage',
      healthChangedEventName: 'health',
      diedEventName: 'died',
    });
    expect(health.current).toBe(100);
    const payload = { amount: 45, sourceId: 'npc-1' };
    eventsBus.emit('damage', payload);
    expect(health.current).toBe(55);
    health.heal(500);
    expect(health.current).toBe(100);
    health.reset();
    expect(health.current).toBe(100);
    expect(emitted.some((entry) => entry.event === 'health')).toBe(true);
    health.dispose();
  });
});
