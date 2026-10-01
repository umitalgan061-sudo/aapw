import { describe, expect, it } from 'vitest';
import { RuntimeOrchestratorR37 } from '../../../src/3d/strict/r37/orchestrator.ts';

describe('R37 production orchestrator', () => {
  it('combines input, commands, budgets, diagnostics and timeline', () => {
    const runtime = new RuntimeOrchestratorR37({ seed: 7, maxEntities: 16 });
    expect(runtime.registerEntity({ id: 'player', kind: 'player', position: { x: 0, y: 0, z: 0 } })).toBe(true);
    runtime.pushInput({
      tick: 1,
      move: { x: 1, y: 0 },
      look: { x: 0, y: 0 },
      jump: false,
      sprint: true,
      guard: false,
      attack: false,
      dodge: false,
      interact: false,
      timestampMs: 0,
    });
    const result = runtime.step({ deltaSeconds: 1 / 60, cameraPosition: { x: 0, y: 0, z: 0 } });
    expect(result.version).toBe(37);
    expect(result.metrics.entities).toBe(1);
    expect(result.budget.tick()).toBeGreaterThan(0);
    expect(result.replayFrames).toBe(1);
    expect(runtime.diagnosticsReport().telemetry.length).toBeGreaterThan(0);
  });

  it('rejects unsafe command payloads and validates assets', () => {
    const runtime = new RuntimeOrchestratorR37();
    const command = runtime.dispatch({
      tick: 1,
      kind: 'custom',
      source: 'test',
      payload: { nested: { deep: { deeper: { more: { too: { far: true } } } } } },
    });
    expect(command).toBeNull();
    const result = runtime.validateAsset({
      id: 'castle',
      url: 'https://example.invalid/castle.glb',
      contentType: 'model/gltf-binary',
      byteLength: 1024,
      version: 1,
    });
    expect(result.accepted).toBe(true);
  });

  it('resets every owned bounded subsystem', async () => {
    const runtime = new RuntimeOrchestratorR37();
    runtime.addContent({ id: 'audio', kind: 'audio', url: 'audio/test.wav', version: 1, bytes: 12, tags: ['ui'] });
    await runtime.runBackgroundTask('small', () => 3, 10);
    runtime.pushInput({
      tick: 1,
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      jump: false,
      sprint: false,
      guard: false,
      attack: false,
      dodge: false,
      interact: false,
      timestampMs: 0,
    });
    runtime.reset();
    expect(runtime.frame).toBe(0);
    expect(runtime.content.size()).toBe(0);
    expect(runtime.replay.size()).toBe(0);
    expect(runtime.timeline.size()).toBe(0);
  });

  it('disposes idempotently and blocks later mutations', () => {
    const runtime = new RuntimeOrchestratorR37();
    runtime.dispose();
    runtime.dispose();
    expect(() => runtime.snapshot()).toThrow(/disposed/);
    expect(() => runtime.registerEntity({ id: 'x', kind: 'prop' })).toThrow(/disposed/);
  });
});
