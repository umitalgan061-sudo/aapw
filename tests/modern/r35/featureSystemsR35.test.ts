
import { describe, expect, it } from 'vitest';
import {
  AccessibilityRuntimeR35,
  ContentRegistryR35,
  LocalizationRuntimeR35,
  ReplayRuntimeR35,
  SaveRuntimeR35,
  FeatureHubRuntimeR35,
} from '../../../src/3d/modern/r35/index';

describe('R35 persistence and accessibility', () => {
  it('rejects tampered save payloads', () => {
    const runtime = new SaveRuntimeR35(1);
    const written = runtime.write(
      'slot',
      10,
      { coins: 50 },
    );

    expect(written.ok).toBe(true);

    const exported = runtime.exportSlot('slot');

    expect(exported.ok).toBe(true);

    if (exported.ok) {
      const tampered = exported.value.replace(
        '50',
        '51',
      );
      expect(
        runtime.importSlot(tampered).ok,
      ).toBe(false);
    }
  });

  it('requires contiguous save migrations', () => {
    const runtime = new SaveRuntimeR35(3);

    expect(
      runtime.registerMigration({
        from: 1,
        to: 3,
        migrate: (value) => value,
      }).ok,
    ).toBe(false);
  });

  it('keeps accessibility transforms bounded', () => {
    const runtime = new AccessibilityRuntimeR35();

    runtime.setProfile({
      textScale: 100,
      reducedMotion: true,
    });

    const profile = runtime.profile();

    expect(profile.textScale).toBe(2.5);
    expect(runtime.motionScale()).toBe(0.35);

    const transformed = runtime.colorTransform({
      r: 2,
      g: -1,
      b: 0.5,
    });

    expect(transformed.r).toBeGreaterThanOrEqual(0);
    expect(transformed.r).toBeLessThanOrEqual(1);
    expect(transformed.g).toBeGreaterThanOrEqual(0);
  });
});

describe('R35 content graph', () => {
  it('sorts dependencies before consumers', () => {
    const runtime = new ContentRegistryR35();

    runtime.register({
      id: 'mesh',
      kind: 'world',
      version: 1,
      digest: 'mesh',
      dependencies: ['material'],
    });

    runtime.register({
      id: 'material',
      kind: 'material',
      version: 1,
      digest: 'material',
      dependencies: ['texture'],
    });

    runtime.register({
      id: 'texture',
      kind: 'material',
      version: 1,
      digest: 'texture',
      dependencies: [],
    });

    const resolved = runtime.resolveOrder([
      'mesh',
    ]);

    expect(resolved.ok).toBe(true);

    if (resolved.ok) {
      expect(resolved.value).toEqual([
        'texture',
        'material',
        'mesh',
      ]);
    }
  });

  it('locks registration after manifest freeze', () => {
    const runtime = new ContentRegistryR35();

    runtime.register({
      id: 'a',
      kind: 'world',
      version: 1,
      digest: 'a',
      dependencies: [],
    });

    const manifest = runtime.freeze();

    expect(manifest.entries).toHaveLength(1);

    expect(
      runtime.register({
        id: 'b',
        kind: 'world',
        version: 1,
        digest: 'b',
        dependencies: [],
      }).ok,
    ).toBe(false);
  });
});

describe('R35 localization', () => {
  it('reports missing strings and coverage', () => {
    const runtime = new LocalizationRuntimeR35();

    runtime.register({
      locale: 'tr-TR',
      revision: 1,
      entries: {
        greeting: 'Merhaba',
        count: '{n}',
      },
      plurals: {},
    });

    const coverage = runtime.coverage([
      'greeting',
      'count',
      'missing',
    ]);

    expect(coverage.total).toBe(3);
    expect(coverage.translated).toBe(2);
    expect(coverage.missing).toEqual([
      'missing',
    ]);
    expect(coverage.ratio).toBeCloseTo(2 / 3);
  });

  it('supports plural formatting', () => {
    const runtime = new LocalizationRuntimeR35();

    runtime.register({
      locale: 'en-US',
      revision: 1,
      entries: {},
      plurals: {
        itemCount: {
          one: '{count} item',
          other: '{count} items',
        },
      },
    });

    expect(
      runtime.translate({
        key: 'itemCount',
        count: 1,
        args: { count: 1 },
      }),
    ).toBe('1 item');

    expect(
      runtime.translate({
        key: 'itemCount',
        count: 3,
        args: { count: 3 },
      }),
    ).toBe('3 items');
  });
});

describe('R35 replay', () => {
  it('rejects inputs that move backwards in time', () => {
    const runtime = new ReplayRuntimeR35();

    expect(
      runtime.recordInput({
        tick: 10,
        action: 'move',
        value: 1,
        device: 'keyboard',
      }).ok,
    ).toBe(true);

    expect(
      runtime.recordInput({
        tick: 5,
        action: 'jump',
        value: 1,
        device: 'keyboard',
      }).ok,
    ).toBe(false);
  });

  it('detects digest corruption', () => {
    const runtime = new ReplayRuntimeR35();

    runtime.recordInput({
      tick: 1,
      action: 'move',
      value: 1,
      device: 'keyboard',
    });

    const session = runtime.stop();

    const corrupted = {
      ...session,
      digest: 'corrupted',
    };

    expect(
      runtime.validate(corrupted).ok,
    ).toBe(false);
  });
});

describe('R35 feature hub', () => {
  it('produces a cross-system snapshot', () => {
    const runtime = new FeatureHubRuntimeR35({
      inventoryCapacity: 16,
      saveSchema: 1,
    });

    runtime.world.addAgent({
      id: 'npc',
      position: {
        x: 2,
        y: 0,
        z: 2,
      },
      disposition: 'friendly',
    });

    runtime.weather.registerZone({
      id: 'valley',
      center: {
        x: 0,
        y: 0,
        z: 0,
      },
      radius: 100,
      climate: 'temperate',
      priority: 1,
    });

    runtime.setPlayerPosition({
      x: 0,
      y: 0,
      z: 0,
    });

    const result = runtime.tick(4);

    expect(result.tick).toBe(4);
    expect(result.weather).toBeDefined();
    expect(result.digest).toHaveLength(16);

    const snapshot = runtime.snapshot();

    expect(snapshot).toBeDefined();
    expect(runtime.health().entities).toBe(1);
  });

  it('blocks ticking during recovery and resumes cleanly', () => {
    const runtime = new FeatureHubRuntimeR35();

    runtime.beginRecovery();
    const paused = runtime.tick(5);

    expect(paused.tick).toBe(0);

    runtime.finishRecovery();
    const resumed = runtime.tick(2);

    expect(resumed.tick).toBe(2);
  });

  it('keeps digest stable for identical feature setup', () => {
    const build = () => {
      const runtime = new FeatureHubRuntimeR35();

      runtime.world.addAgent({
        id: 'a',
        position: {
          x: 0,
          y: 0,
          z: 0,
        },
      });

      runtime.economy.register({
        id: 'ore',
        basePrice: 100,
        volatility: 0.2,
        minPrice: 10,
        maxPrice: 500,
        tags: ['resource'],
      });

      runtime.tick(6);

      return runtime.digest();
    };

    expect(build()).toBe(build());
  });
});
