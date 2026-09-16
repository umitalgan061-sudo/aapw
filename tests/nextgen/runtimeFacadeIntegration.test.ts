import { describe, expect, it } from 'vitest';
import { createNextGenRuntime } from '../../src/3d/nextgen/runtimeFacadeV3';
import { createNetworkEntity } from '../../src/3d/nextgen/networkProtocolV3';

describe('NextGenRuntimeV3 integration', () => {
  it('advances a complete runtime frame', async () => {
    const runtime = createNextGenRuntime({ navigationWidth: 12, navigationHeight: 12, navigationCellSize: 2 });
    const player = runtime.createPlayer();
    runtime.createAi(player);
    const result = await runtime.frame(async () => new Response('{}', { status: 200 }));
    expect(result.tick).toBe(1);
    expect(result.snapshot.tick).toBe(1);
    expect(result.aiDecisions).toHaveLength(1);
  });

  it('produces a replicable network delta after a player frame', async () => {
    const runtime = createNextGenRuntime({ navigationWidth: 8, navigationHeight: 8, navigationCellSize: 2 });
    const first = runtime.buildNetworkSnapshot([createNetworkEntity(1, { x: 0, y: 0, z: 0 })]);
    await runtime.frame(async () => new Response('{}', { status: 200 }));
    const second = runtime.buildNetworkSnapshot([createNetworkEntity(1, { x: 1, y: 0, z: 0 }), createNetworkEntity(2, { x: 2, y: 0, z: 0 })]);
    const delta = runtime.buildNetworkDelta(second);
    const applied = runtime.applyNetworkDelta(first, delta);
    expect(applied.entities).toEqual(second.entities);
  });

  it('round trips the runtime save payload', () => {
    const runtime = createNextGenRuntime({ navigationWidth: 8, navigationHeight: 8, navigationCellSize: 2 });
    runtime.createPlayer({ position: { x: 10, y: 2, z: -4 }, stamina: 73 });
    const bytes = runtime.save();
    const other = createNextGenRuntime({ navigationWidth: 8, navigationHeight: 8, navigationCellSize: 2 });
    other.createPlayer();
    expect(() => other.load(bytes)).not.toThrow();
    expect(other.summary().tick).toBe(runtime.summary().tick);
  });
});
