import { describe, expect, it } from 'vitest';
import { AssetRegistryR42 } from '../../../src/3d/strict/r42/assets.ts';
import { NetworkAuthorityR42 } from '../../../src/3d/strict/r42/network.ts';

const state = (id: string, revision = 1) => ({
  id,
  revision,
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  velocity: {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  },
  combat: {
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    poise: 0,
    maxPoise: 100,
    guarding: false,
    attacking: false,
    dodging: false,
    invulnerable: false,
    cooldownUntilTick: 0,
    comboIndex: 0,
    revision: 1,
  },
  flags: 1,
});

describe('R42 asset and network contracts', () => {
  it('bounds asset residency and retains critical assets', () => {
    const assets = new AssetRegistryR42(1024 * 1024, 16);
    assets.declare({ id: 'critical', url: '/critical.glb', critical: true, priority: 'critical' });
    assets.declare({ id: 'optional', url: '/optional.glb', priority: 'low' });
    assets.request({ id: 'critical', priority: 'critical', requestedTick: 1 });
    assets.request({ id: 'optional', priority: 'low', requestedTick: 1 });
    expect(assets.dequeue(2)).toHaveLength(2);
    assets.markReady('critical', 900_000, 'sha-critical', 2);
    assets.markReady('optional', 900_000, 'sha-optional', 2);
    expect(assets.get('critical')?.state).toBe('ready');
  });

  it('builds and applies deterministic network deltas', () => {
    const network = new NetworkAuthorityR42();
    const base = network.buildSnapshot(1, 1, 1, [state('a')]);
    const target = network.buildSnapshot(2, 2, 1, [state('a', 2), state('b')]);
    const delta = network.buildDelta(base, target);
    const reconstructed = network.applyDelta(base, delta);
    expect(reconstructed.entities.map(entity => entity.id)).toEqual(['a', 'b']);
    expect(reconstructed.checksum).toBe(target.checksum);
  });

  it('keeps unacknowledged predictions for replay', () => {
    const network = new NetworkAuthorityR42();
    network.recordPrediction(1, 1, { move: 1 });
    network.recordPrediction(2, 2, { move: 2 });
    const authority = network.buildSnapshot(3, 3, 1, []);
    expect(network.reconcile(authority).map(frame => frame.sequence)).toEqual([2]);
  });
});
