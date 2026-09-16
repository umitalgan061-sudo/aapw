import { describe, expect, it } from 'vitest';
import { AudioRuntime } from '../../src/engine-ts/audioRuntime.js';
import { BrowserEngineFacade } from '../../src/engine-ts/publicFacade.js';
import { EditorRuntime } from '../../src/engine-ts/editorRuntime.js';
import { QuestRuntime } from '../../src/engine-ts/questRuntime.js';
import { ReplayRuntime } from '../../src/engine-ts/replayRuntime.js';
import { SceneRuntime } from '../../src/engine-ts/sceneRuntime.js';
import { SimulationRuntime } from '../../src/engine-ts/simulationRuntime.js';
import { StreamingRuntime } from '../../src/engine-ts/streamingRuntime.js';
import { TelemetryRuntime } from '../../src/engine-ts/telemetryRuntime.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('platform subsystems', () => {
  it('supports scene hierarchy creation and recursive traversal', () => {
    const scene = new SceneRuntime();
    expect(scene.create({ id: 'player', type: 'entity', parent: 'scene', position: { x: 0, y: 0, z: 0 }, visible: true, layer: 1, entity: ENTITY_ID('player') })).toBe(true);
    expect(scene.create({ id: 'weapon', type: 'entity', parent: 'player', position: { x: 0, y: 1, z: 0 }, visible: true, layer: 2, entity: ENTITY_ID('weapon') })).toBe(true);
    expect(scene.descendants('player')).toHaveLength(1);
    expect(scene.entityNode(ENTITY_ID('weapon'))?.parent).toBe('player');
  });

  it('supports editor transactions with undo and redo', () => {
    const editor = new EditorRuntime(() => 10);
    expect(editor.execute({ type: 'create', id: 'hero', position: { x: 0, y: 0, z: 0 }, tags: ['player'] })).toBe(true);
    expect(editor.execute({ type: 'move', id: 'hero', position: { x: 4, y: 0, z: 1 } })).toBe(true);
    expect(editor.entity(ENTITY_ID('hero'))?.position.x).toBe(4);
    expect(editor.undo()).toBe(true);
    expect(editor.entity(ENTITY_ID('hero'))?.position.x).toBe(0);
    expect(editor.redo()).toBe(true);
    expect(editor.entity(ENTITY_ID('hero'))?.position.x).toBe(4);
  });

  it('progresses quests and awards rewards only once', () => {
    const quests = new QuestRuntime();
    expect(quests.define({ id: 'intro', title: 'Intro', description: 'Start', prerequisites: [], objectives: [{ id: 'reach', kind: 'reach', target: 'camp', required: 2 }], rewardXp: 100, rewardItems: ['map'] })).toBe(true);
    quests.setTick(1);
    expect(quests.activate('intro')).toBe(true);
    expect(quests.progress('intro', 'reach', 1)).toBe(true);
    expect(quests.state('intro')?.status).toBe('active');
    quests.setTick(2);
    expect(quests.progress('intro', 'reach', 1)).toBe(true);
    expect(quests.state('intro')?.status).toBe('completed');
    expect(quests.stats().xpAwarded).toBe(100);
  });

  it('evicts least-recently-used streaming resources under budget', () => {
    const stream = new StreamingRuntime({ maxBytes: 100 });
    const a = ENTITY_ID('a'); const b = ENTITY_ID('b');
    stream.register({ id: a, priority: 1, bytes: 60, distance: 4, required: false });
    stream.register({ id: b, priority: 1, bytes: 60, distance: 8, required: false });
    expect(stream.request({ id: a, priority: 10, reason: 'visible' })).toBe(true);
    expect(stream.begin()).toEqual([a]);
    expect(stream.complete(a, true)).toBe(true);
    expect(stream.request({ id: b, priority: 10, reason: 'visible' })).toBe(true);
    expect(stream.begin()).toEqual([b]);
    expect(stream.complete(b, true)).toBe(true);
    expect(stream.stats().residentBytes).toBeLessThanOrEqual(100);
  });

  it('steps simulation deterministically and reports dropped catch-up', () => {
    const sim = new SimulationRuntime({ maxCatchUp: 2 });
    const body = ENTITY_ID('body');
    sim.add({ id: body, position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1, dynamic: true });
    expect(sim.advance(1 / 30)).toBe(2);
    expect(sim.stats().tick).toBe(2);
    expect(sim.body(body)?.position.y).toBeLessThan(5);
  });

  it('mixes audio with distance and occlusion attenuation', () => {
    const audio = new AudioRuntime();
    audio.registerEmitter({ id: 'fire', entity: ENTITY_ID('fire'), bus: 'ambient', position: { x: 1, y: 0, z: 0 }, radius: 10, volume: 1, loop: true, priority: 1, occlusion: 0.5 });
    audio.setListener({ x: 0, y: 0, z: 0 });
    expect(audio.play('fire', 'fire-loop', 10000)).toBe(true);
    expect(audio.mix()[0]?.gain).toBeGreaterThan(0);
    expect(audio.stats().voices).toBe(1);
  });

  it('computes health from runtime metrics', () => {
    const telemetry = new TelemetryRuntime();
    telemetry.sample({ name: 'runtime.frame.ms', value: 10, unit: 'ms', tick: 1, frame: 1, tags: {} });
    telemetry.sample({ name: 'runtime.frame.ms', value: 14, unit: 'ms', tick: 2, frame: 2, tags: {} });
    telemetry.sample({ name: 'runtime.errors', value: 0, unit: 'count', tick: 2, frame: 2, tags: {} });
    expect(telemetry.health().phase).toBe('healthy');
    expect(telemetry.stats().p95FrameMs).toBeGreaterThan(0);
  });

  it('records replay checkpoints and trims history', () => {
    const replay = new ReplayRuntime<{ hp: number }>(32, 8);
    for (let tick = 1; tick <= 10; tick += 1) replay.record(tick, 1 / 60, [], { hp: 100 - tick });
    expect(replay.stats().frames).toBe(10);
    replay.trimBefore(6);
    expect(replay.frames()[0]?.tick).toBe(6);
    expect(replay.nearestCheckpoint(9)?.tick).toBe(1);
  });

  it('exposes a browser facade without requiring a DOM in construction', async () => {
    const facade = new BrowserEngineFacade({ autoLifecycle: false });
    expect(facade.addPlayer('p', { x: 0, y: 0, z: 0 })).toBe(true);
    expect(await facade.start()).toBe(true);
    expect((await facade.tick())?.world.entities).toBe(1);
    facade.dispose();
  });
});
