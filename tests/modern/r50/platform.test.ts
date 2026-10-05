import { describe, expect, it } from 'vitest';
import {
  createR50Platform,
} from '../../../src/3d/modern/r50/platform.ts';

describe('R50 unified platform', () => {
  it('composes the major production boundaries', () => {
    const platform=createR50Platform();

    expect(platform.application).toBeDefined();
    expect(platform.render).toBeDefined();
    expect(platform.performance).toBeDefined();
    expect(platform.recovery).toBeDefined();
    expect(platform.input).toBeDefined();
    expect(platform.persistence).toBeDefined();
    expect(platform.entities).toBeDefined();
    expect(platform.world).toBeNull();

    platform.start();

    const snapshot=platform.tick(
      1/60,
    );

    expect(snapshot.diagnostics.mode).toBe(
      'running',
    );

    expect(snapshot.performance.score)
      .toBeGreaterThanOrEqual(0);

    platform.captureSnapshot(1);

    expect(platform.snapshots.latest())
      .not.toBeNull();

    platform.shutdown();
  });

  it('creates an optional world runtime when a source is provided', () => {
    const platform=createR50Platform({
      worldSource:{
        load:async coordinate=>({
          key:String(coordinate.x)+':'+String(coordinate.z),
          coordinate,
          sizeMeters:256,
          revision:1,
          cells:[],
        }),
      },
    });

    expect(platform.world).not.toBeNull();
    expect(platform.world?.stats().residentChunks)
      .toBe(0);

    platform.dispose();
  });
});
