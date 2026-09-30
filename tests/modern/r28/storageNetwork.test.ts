import { describe, expect, it } from 'vitest';
import { BrowserLocalSaveStorage, SaveStorageAdapter } from '../../../src/3d/modern/r28/saveStorage.ts';
import { ServiceWorkerClient } from '../../../src/3d/modern/r28/serviceWorkerClient.ts';
import { FetchAssetLoader } from '../../../src/3d/modern/r28/assetFetchAdapter.ts';
import { assetId, saveSlotId } from '../../../src/3d/modern/r27/contracts.ts';

describe('R28 storage, service worker and asset adapters', () => {
  it('uses memory fallback safely when localStorage is unavailable', async () => {
    const storage = new BrowserLocalSaveStorage('test:');
    const slot = saveSlotId('slot-a');
    await storage.set(slot, '{"ok":true}');
    expect(await storage.get(slot)).toBe('{"ok":true}');
    expect(await storage.keys()).toEqual([slot]);
    await storage.remove(slot);
    expect(await storage.get(slot)).toBeNull();
  });

  it('serializes typed records through the storage adapter', async () => {
    const map = new Map<string, string>();
    const fakeStorage = {
      async get(slot: ReturnType<typeof saveSlotId>) { return map.get(String(slot)) ?? null; },
      async set(slot: ReturnType<typeof saveSlotId>, value: string) { map.set(String(slot), value); },
      async remove(slot: ReturnType<typeof saveSlotId>) { map.delete(String(slot)); },
      async keys() { return [...map.keys()].map(saveSlotId); },
    };
    const adapter = new SaveStorageAdapter(
      fakeStorage,
      (value: { value: number }) => JSON.stringify(value),
      (value: string) => JSON.parse(value) as { value: number },
    );
    const record = {
      header: {
        magic: 'AAPW-R27' as const,
        schemaVersion: 1,
        slot: saveSlotId('slot-b'),
        createdAtTick: 1,
        updatedAtTick: 2,
        checksum: 'x',
      },
      data: { value: 4 },
      bytes: 10,
    };
    await adapter.write(record);
    expect(await adapter.read(saveSlotId('slot-b'))).toEqual(record);
    expect(await adapter.slots()).toEqual([saveSlotId('slot-b')]);
  });

  it('reports unsupported service worker environments without throwing', async () => {
    const client = new ServiceWorkerClient();
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      const result = await client.register();
      expect(result.supported).toBe(false);
      expect(result.registered).toBe(false);
    }
  });

  it('normalizes asset loader configuration at construction', () => {
    const loader = new FetchAssetLoader({ maxResponseBytes: 2048, requestTimeoutMs: 1000 });
    expect(loader.options.maxResponseBytes).toBe(2048);
    expect(loader.options.requestTimeoutMs).toBe(1000);
    expect(loader.options.allowedProtocols).toContain('https:');
    expect(assetId('terrain')).toBe('terrain');
  });
});
