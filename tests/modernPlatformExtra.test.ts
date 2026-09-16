import { describe, expect, it } from 'vitest';
import { RenderFrameBuilder } from '../src/3d/modern/renderPacket';
import { SaveSystem, type PersistenceAdapter } from '../src/3d/modern/saveSystem';
import { ResourceRegistry } from '../src/3d/modern/resourceRegistry';
import { Diagnostics } from '../src/3d/modern/diagnostics';

describe('render frame packets', () => {
  it('sorts transparent work after opaque work and creates a stable digest', () => {
    const pressure = { cpu: 0.1, gpu: 0.2, frame: 0.1, memory: 0, thermal: 0, combined: 0.12 };
    const camera = {
      position: { x: 0, y: 5, z: 10 }, target: { x: 0, y: 0, z: 0 }, fov: 60, near: 0.1, far: 1000,
      viewportWidth: 1920, viewportHeight: 1080, dpr: 1,
    };
    const builder = new RenderFrameBuilder().reset(8 as never).backend('webgpu').quality('high', 0.9).camera(camera).pressure(pressure);
    builder.add({ entityId: 'z', materialId: 'm', meshId: 'mesh', position: { x: 0, y: 0, z: 0 }, distance: 10, lod: 1, transparent: true, castShadow: false, receiveShadow: true });
    builder.add({ entityId: 'a', materialId: 'm', meshId: 'mesh', position: { x: 0, y: 0, z: 0 }, distance: 100, lod: 2, transparent: false, castShadow: true, receiveShadow: true });
    const packet = builder.build();
    expect(packet.draws[0]?.transparent).toBe(false);
    expect(packet.checksum).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('save system', () => {
  it('writes, reads and migrates a versioned payload', async () => {
    const storage = new Map<number, any>();
    const adapter: PersistenceAdapter<{ value: number }> = {
      async save(slot, envelope) { storage.set(slot, envelope); },
      async load(slot) { return storage.get(slot) ?? null; },
      async list() { return []; },
      async remove(slot) { storage.delete(slot); },
    };
    const system = new SaveSystem<{ value: number }>({ schema: 'aapw', version: 2, adapter, now: () => 100 as never });
    const saved = await system.save(0, { value: 4 });
    expect(saved.ok).toBe(true);
    const loaded = await system.load(0);
    expect(loaded).toEqual({ ok: true, value: { value: 4 } });
  });
});

describe('resource registry', () => {
  it('loads resources and respects reference-counted eviction', async () => {
    const registry = new ResourceRegistry<string>({ budgetBytes: 4, now: () => 1 as never });
    registry.registerLoader('json', {
      async load(descriptor) { return descriptor.id; },
      sizeOf() { return 4; },
    });
    registry.register({ id: 'one', url: '/one.json', kind: 'json', priority: 3, tags: [] });
    const acquired = await registry.acquire('one');
    expect(acquired).toEqual({ ok: true, value: 'one' });
    expect(registry.release('one')).toBe(true);
    expect(registry.evict('one')).toBe(true);
    expect(registry.stats().residentBytes).toBe(0);
  });
});

describe('diagnostics', () => {
  it('produces bounded health reports and round-trips JSON', () => {
    const diagnostics = new Diagnostics({ capacity: 64, now: () => 123 });
    diagnostics.info('BOOT_OK', 'boot complete', 'runtime');
    diagnostics.warning('GPU_HINT', 'fallback', 'render');
    const report = diagnostics.health();
    expect(report.ok).toBe(true);
    expect(report.warnings).toBe(1);
    const copy = new Diagnostics({ capacity: 64, now: () => 123 });
    const imported = copy.importJson(diagnostics.exportJson());
    expect(imported.ok).toBe(true);
    expect(copy.entries()).toHaveLength(2);
  });
});
