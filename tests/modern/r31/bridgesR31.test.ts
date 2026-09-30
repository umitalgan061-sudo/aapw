import { describe, expect, it } from 'vitest';
import { GameplayRuntimeBridgeR31, normalizeGameplayInputR31 } from '../../../src/3d/strict/r31/gameplayRuntimeBridgeR31.ts';
import { WorldRuntimeBridgeR31 } from '../../../src/3d/strict/r31/worldRuntimeBridgeR31.ts';
import { RenderRuntimeBridgeR31 } from '../../../src/3d/strict/r31/renderRuntimeBridgeR31.ts';

describe('R31 world/gameplay/render bridges', () => {
  it('normalizes gameplay input into a bounded typed shape', () => {
    const input = normalizeGameplayInputR31({
      move: { x: 5, y: -8 },
      look: { x: Number.NaN, y: 0.5 },
      sprint: true,
    });
    expect(input.move).toEqual({ x: 1, y: -1 });
    expect(input.look.x).toBe(0);
    expect(input.sprint).toBe(true);
  });

  it('filters world entities at the typed boundary', () => {
    const bridge = new WorldRuntimeBridgeR31({
      sampleGround: () => 42,
      queryEntities: () => [
        { id: 'b', position: { x: 0, y: 0, z: 1 }, enabled: true, layer: 1, lod: 2, chunkKey: '0:0' },
        { id: 'a', position: { x: 0, y: 0, z: 2 }, enabled: true, layer: 1, lod: 1, chunkKey: '0:0' },
        { id: 'c', position: { x: 0, y: 0, z: 3 }, enabled: false, layer: 1, lod: 0, chunkKey: '0:0' },
      ],
      streamChunk: () => undefined,
      unloadChunk: () => undefined,
    });
    expect(bridge.groundY(0, 0)).toBe(42);
    expect(bridge.visibleEntities({ x: 0, y: 0, z: 0 }, 10).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('renders through a narrow port and handles re-entrancy', () => {
    let draws = 0;
    const bridge = new RenderRuntimeBridgeR31({
      beginFrame: () => undefined,
      draw: () => { draws++; },
      endFrame: () => undefined,
      resize: () => undefined,
      dispose: () => undefined,
    });
    expect(bridge.render({ frame: 1, simulationTick: 1, deltaSeconds: 1 / 60, elapsedSeconds: 0.01, alpha: 0, phase: 'render' })).toBe(true);
    expect(draws).toBe(1);
    bridge.resize(1920, 1080, 2);
    expect(bridge.diagnostics().resizeCalls).toBe(1);
  });

  it('returns gameplay snapshots through a stable adapter', () => {
    const bridge = new GameplayRuntimeBridgeR31({
      applyInput: () => undefined,
      executeCommand: () => undefined,
      snapshot: () => ({
        playerPosition: { x: 1, y: 2, z: 3 },
        playerVelocity: { x: 0, y: 0, z: 0 },
        health: 100,
        stamina: 50,
        combatState: 'idle',
        activeQuestCount: 1,
      }),
    });
    expect(bridge.update({ frame: 1, simulationTick: 1, deltaSeconds: 1 / 60, elapsedSeconds: 0.01, alpha: 0, phase: 'gameplay' }).health).toBe(100);
  });
});
