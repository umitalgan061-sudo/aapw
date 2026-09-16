import { describe, expect, it } from 'vitest';
import { IntegrationRuntime } from '../../src/engine-ts/integrationRuntime.js';
import { RuntimeManifestRegistry } from '../../src/engine-ts/runtimeManifest.js';
import { RestoreRuntime } from '../../src/engine-ts/restoreRuntime.js';
import { SnapshotRuntime } from '../../src/engine-ts/snapshotRuntime.js';
import { WorldStateRuntime } from '../../src/engine-ts/worldStateRuntime.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('world state replication', () => {
  it('accepts monotonic revisions and rejects stale state', () => {
    const state = new WorldStateRuntime();
    const entity = { id: ENTITY_ID('player'), revision: 1, owner: 'server', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, flags: 0, metadata: { alive: true } } as const;
    expect(state.upsert(entity)).toBe(true);
    expect(state.upsert({ ...entity, revision: 0 })).toBe(false);
    expect(state.stats().stale).toBe(1);
  });

  it('creates and applies deterministic deltas', () => {
    const server = new WorldStateRuntime();
    const client = new WorldStateRuntime();
    const entity = { id: ENTITY_ID('npc'), revision: 1, owner: 'server', transform: { position: { x: 3, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, flags: 0, metadata: {} } as const;
    server.upsert(entity);
    const delta = server.createDelta(0, 1);
    expect(client.applyDelta(delta).accepted).toBe(true);
    expect(client.entity(ENTITY_ID('npc'))?.transform.position.x).toBe(3);
  });

  it('filters replicated entities by radius', () => {
    const state = new WorldStateRuntime();
    const make = (id: string, x: number) => ({ id: ENTITY_ID(id), revision: 1, owner: 'server', transform: { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, flags: 0, metadata: {} } as const);
    state.upsert(make('a', 1)); state.upsert(make('b', 20));
    expect(state.queryRadius({ x: 0, y: 0, z: 0 }, 5)).toHaveLength(1);
  });
});

describe('runtime manifest', () => {
  it('orders dependencies and verifies the resulting manifest', () => {
    const registry = new RuntimeManifestRegistry();
    registry.register({ id: 'renderer', version: '1.0.0', entry: 'render', capabilities: ['gpu'], dependencies: ['core'], hash: 'r', enabled: true });
    registry.register({ id: 'core', version: '1.0.0', entry: 'core', capabilities: ['sim'], dependencies: [], hash: 'c', enabled: true });
    const manifest = registry.build('build-1', 10);
    expect(manifest.modules.map(module => module.id)).toEqual(['core', 'renderer']);
    expect(registry.verify(manifest)).toBe(true);
  });

  it('detects duplicate module registration', () => {
    const registry = new RuntimeManifestRegistry();
    const module = { id: 'core', version: '1', entry: 'core', capabilities: [], dependencies: [], hash: 'c', enabled: true };
    expect(registry.register(module)).toBe(true);
    expect(registry.register(module)).toBe(false);
    expect(registry.stats().collisions).toBe(1);
  });
});

describe('snapshot runtime', () => {
  it('captures, diffs and applies patches', () => {
    const snapshots = new SnapshotRuntime<{ score: number; items: string[] }>(8);
    snapshots.capture(1, { score: 1, items: ['a'] });
    const second = snapshots.capture(2, { score: 2, items: ['a', 'b'] });
    expect(second).not.toBeNull();
    const diff = snapshots.diff({ score: 1, items: ['a'] }, { score: 2, items: ['a', 'b'] });
    expect(diff.length).toBeGreaterThan(0);
    expect(snapshots.apply({ score: 1, items: ['a'] }, diff)).toEqual({ score: 2, items: ['a', 'b'] });
    expect(snapshots.verify(second!)).toBe(true);
  });
});

describe('restore runtime', () => {
  it('restores a versioned save payload', async () => {
    const restore = new RestoreRuntime<{ runtime: { scheduler: { tick: number } } }>({ schema: 'restore-test', version: 1, now: () => 100 });
    const save = await restore.persistence.save(0, { runtime: { scheduler: { tick: 42 } } });
    expect(save.ok).toBe(true);
    const report = await restore.restore(0);
    expect(report.accepted).toBe(true);
    expect(report.restoredTick).toBe(42);
  });
});

describe('integration runtime', () => {
  it('keeps a latest frame snapshot after orchestration', async () => {
    const integration = new IntegrationRuntime({ now: () => 0, autoSnapshotTicks: 1 });
    await integration.boot();
    integration.addEntity('box', { x: 0, y: 0, z: -3 }, ['prop']);
    const frame = await integration.frame({ deltaSeconds: 1 / 60, camera: { position: { x: 0, y: 2, z: 4 }, forward: { x: 0, y: 0, z: -1 }, near: 0.1, far: 100, width: 640, height: 360, pixelRatio: 1 } });
    expect(frame.frame).not.toBeNull();
    expect(integration.snapshot()).not.toBeNull();
    expect(integration.stats().frames).toBe(1);
    integration.dispose();
  });
});
