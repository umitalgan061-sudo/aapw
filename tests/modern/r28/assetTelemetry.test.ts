import { describe, expect, it } from 'vitest';
import { RuntimeAssetCoordinator } from '../../../src/3d/modern/r28/assetCoordinator.ts';
import { RuntimeTelemetry } from '../../../src/3d/modern/r28/telemetry.ts';
import { assetId } from '../../../src/3d/modern/r27/contracts.ts';

describe('R28 asset coordination and telemetry', () => {
  it('loads dependency-aware asset requests and summarizes outcomes', async () => {
    const coordinator = new RuntimeAssetCoordinator({ maxConcurrent: 2, maxWeight: 100 });
    const dependency = assetId('base');
    const model = assetId('model');
    coordinator.register({
      id: dependency,
      uri: 'https://example.com/base.bin',
      kind: 'data',
      weight: 10,
      dependencies: [],
      priority: 2,
    });
    coordinator.register({
      id: model,
      uri: 'https://example.com/model.glb',
      kind: 'model',
      weight: 20,
      dependencies: [dependency],
      priority: 10,
    });
    coordinator.request([model]);

    const loader = {
      async load(definition: { id: typeof model; weight: number } | { id: typeof dependency; weight: number }, _signal: AbortSignal) {
        return definition.weight;
      },
      async unload() {},
    };
    const result = await coordinator.sync(loader, 1);
    expect(result.requested).toEqual([model]);
    expect(result.ready.map(String)).toEqual([dependency, model]);
  });

  it('records bounded metric points, spans and percentile histograms', () => {
    const telemetry = new RuntimeTelemetry(4, 4, 4);
    for (const value of [10, 20, 30, 40, 50]) {
      telemetry.record({ tick: value, name: 'frame', value, unit: 'ms' });
    }
    expect(telemetry.points('frame')).toHaveLength(4);
    expect(telemetry.histogram('frame').p50).toBe(40);

    const span = telemetry.startSpan('boot', 10, { mode: 'test' });
    expect(telemetry.endSpan(span, 14)?.durationTicks).toBe(4);

    telemetry.incident({ tick: 1, code: 'BOOT', severity: 'info', detail: 'ok' });
    expect(telemetry.incidents()).toHaveLength(1);
    expect(telemetry.summary().frame).toBe(140);
  });
});
