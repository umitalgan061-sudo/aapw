import { describe, expect, it } from 'vitest';
import { AdaptiveDirectorV7 } from '../../src/3d/modern/adaptiveDirectorV7';
import { InputCommandRouterV7, installDefaultBindingsV7 } from '../../src/3d/modern/inputCommandV7';
import { RenderCompilerV7 } from '../../src/3d/modern/renderCompilerV7';
import { RuntimeOrchestratorV7 } from '../../src/3d/modern/runtimeOrchestratorV7';
import { RuntimePersistenceV7, createCheckpointV7, createJsonCodecV7 } from '../../src/3d/modern/runtimePersistenceV7';
import { WorldStreamingV7 } from '../../src/3d/modern/worldStreamingV7';
import { createQuestDefinitionV7, QuestRuntimeV7 } from '../../src/3d/modern/questRuntimeV7';
import { entityIdV7, tickV7 } from '../../src/3d/modern/runtimeContractsV7';

describe('runtime v7 contracts', () => {
  it('keeps adaptive decisions stable under the same signal', () => {
    const options = { budget: { cpuMs: 8, gpuMs: 8, visibleEntities: 1000, simulationSteps: 2, networkBytes: 100_000, assetBytes: 10_000_000, drawCalls: 500, triangles: 500_000 } };
    const a = new AdaptiveDirectorV7(options);
    const b = new AdaptiveDirectorV7(options);
    const signal = { cpuMs: 4, gpuMs: 4, frameMs: 8, memoryBytes: 1_000_000, networkKbps: 20, loadedAssets: 4, visibleEntities: 300, simulationDebtMs: 0 };
    expect(a.sample(signal)).toEqual(b.sample(signal));
    expect(a.sample(signal)).toEqual(b.sample(signal));
  });

  it('deduplicates input and honors mode bindings', () => {
    const router = new InputCommandRouterV7();
    installDefaultBindingsV7(router);
    const intent = { tick: tickV7(4), source: 'keyboard' as const, move: { x: 2, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, actions: ['jump'], sequence: 7 };
    expect(router.receive(intent)).toBe(true);
    expect(router.receive(intent)).toBe(false);
    const decision = router.decide({ tick: tickV7(4), mode: 'gameplay', intents: [] });
    expect(decision.accepted).toBe(true);
    expect(decision.consumedActions).toEqual(['jump']);
    expect(decision.intent.move.x).toBe(1);
  });

  it('plans streaming in distance order and produces checksummed snapshots', () => {
    const streaming = new WorldStreamingV7({ cellSize: 32, nearRadius: 80, midRadius: 160, farRadius: 320 });
    streaming.registerGrid(-2, 2, -2, 2, 2048);
    const actions = streaming.plan({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(actions.some((action) => action.type === 'load')).toBe(true);
    const snapshot = streaming.snapshot();
    expect(snapshot.checksum.length).toBe(16);
    expect(snapshot.cells.length).toBeGreaterThan(0);
  });

  it('compiles deterministic render packets', () => {
    const compiler = new RenderCompilerV7({ maxItems: 10 });
    const candidate = {
      entity: entityIdV7(1),
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
      materialKey: 'stone',
      geometryKey: 'cube',
      layer: 0,
      enabled: true,
    };
    const view = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, near: 0.1, far: 100, viewportWidth: 1280, viewportHeight: 720, renderScale: 1 };
    const left = compiler.compile(1, 1, 'high', view, [candidate]);
    const right = compiler.compile(1, 1, 'high', view, [candidate]);
    expect(left).toEqual(right);
    expect(left.items).toHaveLength(1);
  });

  it('tracks quest prerequisites and bounded progress', () => {
    const quests = new QuestRuntimeV7();
    const definition = createQuestDefinitionV7('intro', 'First Steps', [{ id: 'reach', kind: 'reach', target: 'village', required: 1, optional: false }], ['gold']);
    quests.register(definition);
    expect(quests.accept(definition.id, new Set(), 1)).toBe(true);
    const progress = quests.apply(definition.id, 'reach', 2, 2);
    expect(progress?.completed).toBe(true);
    expect(quests.events()).toHaveLength(2);
  });

  it('keeps persistence bounded and checkpoints versioned state', () => {
    const store = new RuntimePersistenceV7<{ score: number }>({ maxSnapshots: 2, maxJournalEntries: 3 });
    const codec = createJsonCodecV7<{ score: number }>();
    const checkpoint = createCheckpointV7('runtime' as never, tickV7(4), 'running', { score: 10 }, codec);
    expect(checkpoint.codecVersion).toBe(1);
    for (let index = 0; index < 5; index += 1) store.append(index, 'score', { score: index });
    expect(store.stats().journalEntries).toBe(3);
    expect(store.replay(1, 4).entries).toHaveLength(3);
  });

  it('runs an integrated fixed-step frame without escaping the runtime boundary', () => {
    const runtime = new RuntimeOrchestratorV7({ id: 'test-v7', now: () => 1000, fixedStepMs: 10 });
    runtime.start();
    const result = runtime.step({
      deltaMs: 25,
      camera: { position: { x: 0, y: 0, z: 5 }, forward: { x: 0, y: 0, z: -1 }, near: 0.1, far: 100, viewportWidth: 800, viewportHeight: 600, renderScale: 1 },
    });
    expect(result.frame).toBe(1);
    expect(Number(result.tick)).toBe(2);
    expect(result.phase).toBe('running');
    expect(result.packet.checksum.length).toBe(16);
    expect(runtime.diagnostics().identity.protocol).toBe(7);
  });
});
