import { describe, expect, it } from 'vitest';
import { createTypeSafeLegacyGameAdapter } from '../../src/3d/modern/v3/legacyGameAdapter.js';

describe('TypeSafeLegacyGameAdapter', () => {
  it('loads the legacy module only through the declared init contract', async () => {
    let initCalls = 0;
    const events: string[] = [];
    const adapter = createTypeSafeLegacyGameAdapter({
      loader: async () => ({ initGame3D: async () => { initCalls += 1; } }),
      onBridgeEvent: event => events.push(`${event.operation}:${event.succeeded}`),
    });
    await expect(adapter.load()).resolves.toBe(true);
    expect(adapter.isLoaded()).toBe(true);
    expect(initCalls).toBe(1);
    await adapter.invoke('probe', async () => undefined);
    await adapter.unload();
    expect(adapter.isLoaded()).toBe(false);
    expect(events).toEqual(['load:true', 'probe:true', 'unload:true']);
  });

  it('fails safely when the legacy init export is missing', async () => {
    const adapter = createTypeSafeLegacyGameAdapter({ loader: async () => ({}) });
    await expect(adapter.load()).rejects.toThrow('LEGACY_GAME_INIT_MISSING');
    expect(adapter.isLoaded()).toBe(false);
  });

  it('does not execute arbitrary actions after a failed callback', async () => {
    const adapter = createTypeSafeLegacyGameAdapter({ loader: async () => ({ initGame3D: () => undefined }) });
    const events: boolean[] = [];
    adapter['#unused'] = undefined as never;
    await adapter.load();
    await expect(adapter.invoke('failure', async () => { throw new Error('expected'); })).rejects.toThrow('expected');
    events.push(adapter.isLoaded());
    expect(events).toEqual([true]);
  });
});
