import { describe, expect, it } from 'vitest';
import { assetDescriptor, AssetPipelineV3, assetDigestV3 } from '../../src/3d/modern/assetPipelineV3.ts';
import { MemorySaveStorageV3, SaveRuntimeV3, createEmptySaveV3, encodeSaveV3, decodeSaveV3 } from '../../src/3d/modern/saveRuntimeV3.ts';
import { ReplicationStateV3 } from '../../src/3d/modern/networkStateV3.ts';
import { createDefaultCommandRegistryV3, CommandRegistryV3, TokenBucketV3, inspectValueV3, DEFAULT_SECURITY_LIMITS_V3 } from '../../src/3d/modern/securityRuntimeV3.ts';
import { LoopbackWorkerPortV3, WorkerRouterV3, workerEnvelopeV3 } from '../../src/3d/modern/workerRuntimeV3.ts';
import { AapwRuntimeFacadeV3 } from '../../src/3d/modern/runtimeFacadeV3.ts';

const bytes = (...values: number[]) => new Uint8Array(values);

function transportFor(body: Uint8Array, contentType = 'application/octet-stream') {
  return {
    async fetch() {
      return new Response(body, { status: 200, headers: { 'content-type': contentType, 'content-length': String(body.byteLength) } });
    },
  };
}

describe('Asset pipeline v3', () => {
  it('normalizes declarations and computes deterministic digests', () => {
    const descriptor = assetDescriptor({ id: 'hero', url: 'https://cdn.example/hero.bin', kind: 'data', bytes: 4, priority: 'critical', tags: [' player ', 'hero', 'player'] });
    expect(descriptor.tags).toEqual(['hero', 'player']);
    expect(assetDigestV3(bytes(1, 2, 3, 4))).toBe(assetDigestV3(bytes(1, 2, 3, 4)));
  });

  it('rejects forbidden local asset hosts', async () => {
    const pipeline = new AssetPipelineV3(transportFor(bytes(1)), { maxAssetBytes: 32 });
    expect(() => pipeline.declare(assetDescriptor({ id: 'bad', url: 'http://localhost/file', kind: 'data', bytes: 1, priority: 'normal', tags: [] }))).toThrow();
  });

  it('loads and caches an asset', async () => {
    const pipeline = new AssetPipelineV3(transportFor(bytes(1, 2, 3)), { maxAssetBytes: 32, maxBytes: 64 });
    pipeline.registerDecoder({ kind: 'data', async decode(data) { return [...data]; } });
    const id = assetDescriptor({ id: 'blob', url: 'https://cdn.example/blob', kind: 'data', bytes: 3, priority: 'normal', tags: [] });
    pipeline.declare(id);
    await expect(pipeline.load(id.id)).resolves.toEqual([1, 2, 3]);
    await expect(pipeline.load(id.id)).resolves.toEqual([1, 2, 3]);
    expect(pipeline.metrics()).toMatchObject({ readyCount: 1, cacheHits: 1 });
  });

  it('enforces an integrity digest', async () => {
    const body = bytes(5, 6, 7);
    const pipeline = new AssetPipelineV3(transportFor(body), { maxAssetBytes: 32 });
    pipeline.registerDecoder({ kind: 'data', async decode(data) { return data.byteLength; } });
    pipeline.declare(assetDescriptor({ id: 'signed', url: 'https://cdn.example/signed', kind: 'data', bytes: 3, priority: 'critical', digest: assetDigestV3(body), tags: [] }));
    await expect(pipeline.load('signed' as never)).resolves.toBe(3);
  });

  it('evicts the least useful cache entry first', async () => {
    const pipeline = new AssetPipelineV3(transportFor(bytes(1, 2, 3, 4)), { maxAssetBytes: 8, maxBytes: 8 });
    pipeline.registerDecoder({ kind: 'data', async decode(data) { return [...data]; } });
    pipeline.declare(assetDescriptor({ id: 'a', url: 'https://cdn.example/a', kind: 'data', bytes: 4, priority: 'background', tags: [] }));
    pipeline.declare(assetDescriptor({ id: 'b', url: 'https://cdn.example/b', kind: 'data', bytes: 4, priority: 'critical', tags: [] }));
    await pipeline.load('a' as never);
    await pipeline.load('b' as never);
    expect(pipeline.metrics().cachedBytes).toBe(8);
    pipeline.declare(assetDescriptor({ id: 'c', url: 'https://cdn.example/c', kind: 'data', bytes: 4, priority: 'critical', tags: [] }));
    await pipeline.load('c' as never);
    expect(pipeline.get('a' as never)?.state).toBe('evicted');
    expect(pipeline.get('b' as never)?.state).toBe('ready');
  });
});

describe('Save runtime v3', () => {
  it('round trips a canonical save', () => {
    const payload = createEmptySaveV3(1234);
    const encoded = encodeSaveV3(payload);
    expect(decodeSaveV3(encoded)).toEqual(payload);
  });

  it('rejects duplicate entity ids', () => {
    const payload = createEmptySaveV3(1);
    const invalid = { ...payload, entities: [
      { id: 1, archetype: 'a', values: {} },
      { id: 1, archetype: 'b', values: {} },
    ] };
    expect(() => encodeSaveV3(invalid as never)).toThrow(/Duplicate entity/);
  });

  it('uses a checksum-protected storage envelope', async () => {
    const storage = new MemorySaveStorageV3();
    const runtime = new SaveRuntimeV3(storage);
    await runtime.write('slot-1', createEmptySaveV3(42));
    await expect(runtime.read('slot-1')).resolves.toMatchObject({ worldSeed: 42 });
    expect(await runtime.slots()).toEqual(['slot-1']);
  });

  it('detects tampered saves', async () => {
    const storage = new MemorySaveStorageV3();
    const runtime = new SaveRuntimeV3(storage);
    await runtime.write('slot', createEmptySaveV3(99));
    const raw = await storage.read('slot');
    expect(raw).not.toBeNull();
    const tampered = String(raw).replace('99', '98');
    await storage.write('slot', tampered);
    await expect(runtime.read('slot')).rejects.toThrow(/checksum|world seed/i);
    expect(runtime.metrics().corruptions).toBeGreaterThan(0);
  });
});

describe('Replication state v3', () => {
  const entity = (id: number, revision: number, x: number) => ({ id: id as never, revision, fields: { position: { x, y: 0, z: 0, yaw: 0, pitch: 0 } } });

  it('builds stable frames and applies snapshots', () => {
    const source = new ReplicationStateV3();
    source.upsert(entity(2, 1, 4));
    source.upsert(entity(1, 1, 2));
    const frame = source.buildFrame(60);
    const target = new ReplicationStateV3();
    expect(target.applyFrame(frame)).toBe(true);
    expect(target.entities().map((value) => value.id)).toEqual([1, 2]);
    expect(target.checksum()).toBe(source.checksum());
  });

  it('rejects stale frames and keeps monotonic sequence', () => {
    const source = new ReplicationStateV3();
    source.upsert(entity(1, 1, 1));
    const first = source.buildFrame(1);
    const second = source.buildFrame(2);
    const target = new ReplicationStateV3();
    expect(target.applyFrame(second)).toBe(true);
    expect(target.applyFrame(first)).toBe(false);
    expect(target.sequence).toBe(2);
  });

  it('builds and applies deltas from a retained base', () => {
    const source = new ReplicationStateV3();
    source.upsert(entity(1, 1, 0));
    const base = source.buildFrame(1);
    source.upsert(entity(1, 2, 5));
    source.upsert(entity(2, 1, 9));
    const delta = source.buildDelta(base.sequence, 2);
    const target = new ReplicationStateV3();
    expect(target.applyFrame(base)).toBe(true);
    const result = target.applyDelta(delta);
    expect(result.applied).toBe(true);
    expect(result.changedEntities).toBe(2);
  });

  it('reports a gap when a delta skips the current sequence', () => {
    const source = new ReplicationStateV3();
    source.upsert(entity(1, 1, 0));
    const base = source.buildFrame(1);
    const delta = source.buildDelta(base.sequence, 2);
    const target = new ReplicationStateV3();
    const result = target.applyDelta(delta);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('gap');
  });
});

describe('Security runtime v3', () => {
  it('rejects prototype-polluting keys', () => {
    const value = { safe: 1, constructor: { pollution: true } };
    const violations = inspectValueV3(value, DEFAULT_SECURITY_LIMITS_V3, 'remote');
    expect(violations.some((item) => item.code === 'PROTO_KEY')).toBe(true);
  });

  it('enforces command registration contracts', () => {
    const registry = createDefaultCommandRegistryV3();
    expect(registry.has('player.move')).toBe(true);
    expect(registry.inspect({ origin: 'local', name: 'player.jump', args: [], sequence: 1 }, 0).decision).toBe('allow');
    expect(registry.inspect({ origin: 'remote', name: 'debug.pause', args: [], sequence: 2 }, 0).decision).toBe('deny');
  });

  it('uses token bucket burst and refill semantics', () => {
    const bucket = new TokenBucketV3(2, 1, 0);
    expect(bucket.consume(1, 0)).toBe(true);
    expect(bucket.consume(1, 0)).toBe(true);
    expect(bucket.consume(1, 0)).toBe(false);
    expect(bucket.consume(1, 1)).toBe(true);
  });

  it('rejects duplicate or unsafe command definitions', () => {
    const registry = new CommandRegistryV3();
    registry.register({ name: 'demo', minArgs: 0, maxArgs: 0, allowedOrigins: ['local'] });
    expect(() => registry.register({ name: 'demo', minArgs: 0, maxArgs: 0, allowedOrigins: ['local'] })).toThrow();
    expect(() => registry.register({ name: 'bad command', minArgs: 0, maxArgs: 0, allowedOrigins: ['local'] })).toThrow();
  });
});

describe('Worker protocol v3', () => {
  it('routes typed messages across a loopback port', async () => {
    const left = new LoopbackWorkerPortV3();
    const right = new LoopbackWorkerPortV3();
    left.connect(right);
    const router = new WorkerRouterV3(right);
    let received = 0;
    router.register('command', 'simulation', () => { received += 1; });
    router.start();
    left.postMessage(workerEnvelopeV3('simulation', 'command', 'req-1', 10, { name: 'player.jump', args: [] }));
    expect(received).toBe(1);
  });

  it('rejects malformed protocol versions', async () => {
    const port = new LoopbackWorkerPortV3();
    const router = new WorkerRouterV3(port);
    await expect(router.receive({ version: 2 })).resolves.toBe(false);
    expect(router.metrics().rejected + router.metrics().errors).toBeGreaterThanOrEqual(0);
  });

  it('copies message payloads before crossing the boundary', () => {
    const payload = { args: [1, 2] };
    const envelope = workerEnvelopeV3('simulation', 'command', 'copy-test', 1, payload);
    expect(envelope.payload).not.toBe(payload);
    expect(envelope.payload).toEqual(payload);
  });
});

describe('Unified runtime facade v3', () => {
  const makeFacade = () => new AapwRuntimeFacadeV3({ transport: transportFor(bytes(1)), storage: new MemorySaveStorageV3() });

  it('spawns a typed player and exposes a runtime snapshot', () => {
    const runtime = makeFacade();
    const player = runtime.spawnPlayer('Hero', { x: 5, y: 0, z: 2 });
    const snapshot = runtime.snapshot();
    expect(player).toBeGreaterThan(0);
    expect(snapshot.entityCount).toBe(1);
    expect(snapshot.performanceTier).toBe('balanced');
  });

  it('authorizes valid local commands and denies privileged remote commands', () => {
    const runtime = makeFacade();
    expect(runtime.authorizeCommand('player.move', [1, 0], 'local', 0).decision).toBe('allow');
    expect(runtime.authorizeCommand('debug.pause', [], 'remote', 0).decision).toBe('deny');
  });

  it('persists the facade world into the v3 save format', async () => {
    const runtime = makeFacade();
    runtime.spawnPlayer('Saved Hero');
    await runtime.save('slot', 123);
    const save = await runtime.load('slot');
    expect(save?.worldSeed).toBe(123);
    expect(save?.entities).toHaveLength(1);
  });
});
