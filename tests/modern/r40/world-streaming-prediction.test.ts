import { describe, expect, it } from 'vitest';
import { AssetCatalog, AssetStreamingController, WorldStreamingOrchestrator, SpatialEntityWorld, WorldSimulationBudget, assetId, entityId, makeEntity, tick, InputPredictionController } from '../../../src/3d/modern/r40';

const velocity = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
describe('R40 world streaming and prediction', () => {
  it('creates streaming requests from world interest', () => {
    const world = new SpatialEntityWorld();
    const catalog = new AssetCatalog();
    const id = assetId('tree');
    catalog.register({ id, uri: 'https://example.com/tree.glb', bytes: 10, digest: 'abcdef12', priority: 10, optional: false, contentType: 'model' });
    const loader = new AssetStreamingController(catalog);
    world.upsert(makeEntity(entityId('tree-1'), { x: 10, y: 0, z: 0 }, velocity));
    const orchestrator = new WorldStreamingOrchestrator(world, loader, new WorldSimulationBudget(), { maxRequestsPerTick: 4 });
    orchestrator.bindEntityAsset('tree-1', id);
    const report = orchestrator.plan({ id: 'player', position: { x: 0, y: 0, z: 0 }, radius: 100, weight: 1 }, tick(1));
    expect(report.requests).toHaveLength(1);
    expect(report.requests[0]?.id).toBe(id);
  });
  it('queues planned world assets', () => {
    const world = new SpatialEntityWorld();
    const catalog = new AssetCatalog();
    const id = assetId('rock');
    catalog.register({ id, uri: 'https://example.com/rock.glb', bytes: 10, digest: 'abcdef12', priority: 10, optional: false, contentType: 'model' });
    const loader = new AssetStreamingController(catalog);
    world.upsert(makeEntity(entityId('rock-1'), { x: 5, y: 0, z: 0 }, velocity));
    const orchestrator = new WorldStreamingOrchestrator(world, loader);
    orchestrator.bindEntityAsset('rock-1', id);
    orchestrator.requestAll({ id: 'player', position: { x: 0, y: 0, z: 0 }, radius: 100, weight: 1 }, tick(1));
    expect(loader.queueDepth()).toBe(1);
  });
  it('uses placeholder policy outside near range', () => {
    const world = new SpatialEntityWorld();
    const catalog = new AssetCatalog();
    const id = assetId('house');
    catalog.register({ id, uri: 'https://example.com/house.glb', bytes: 10, digest: 'abcdef12', priority: 10, optional: false, contentType: 'model' });
    const loader = new AssetStreamingController(catalog);
    world.upsert(makeEntity(entityId('house-1'), { x: 100, y: 0, z: 0 }, velocity));
    const orchestrator = new WorldStreamingOrchestrator(world, loader);
    orchestrator.bindEntityAsset('house-1', id);
    const report = orchestrator.plan({ id: 'player', position: { x: 0, y: 0, z: 0 }, radius: 200, weight: 1 }, tick(1));
    expect(report.requests[0]?.allowPlaceholder).toBe(true);
  });
  it('creates deterministic predictions', () => {
    const actor = entityId('player');
    const a = new InputPredictionController(actor);
    const b = new InputPredictionController(actor);
    const left = a.predict(tick(1), { x: 1, y: 0, z: 0 }, 5);
    const right = b.predict(tick(1), { x: 1, y: 0, z: 0 }, 5);
    expect(left?.digest).toBe(right?.digest);
    expect(left?.command.sequence).toBe(1);
  });
  it('accumulates predicted movement', () => {
    const controller = new InputPredictionController(entityId('player'));
    controller.predict(tick(1), { x: 1, y: 0, z: 0 }, 6);
    controller.predict(tick(2), { x: 1, y: 0, z: 0 }, 6);
    expect(controller.position().x).toBeGreaterThan(0);
    expect(controller.pending()).toBe(2);
  });
  it('acknowledges prediction history', () => {
    const controller = new InputPredictionController(entityId('player'));
    controller.predict(tick(1), { x: 1, y: 0, z: 0 });
    controller.predict(tick(2), { x: 1, y: 0, z: 0 });
    controller.acknowledge(1);
    expect(controller.pending()).toBe(1);
  });
  it('corrects small authoritative errors smoothly', () => {
    const controller = new InputPredictionController(entityId('player'));
    controller.predict(tick(1), { x: 1, y: 0, z: 0 });
    const state = controller.reconcile(tick(1), { tick: tick(1), position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
    expect(state.error).toBeGreaterThan(0);
    expect(controller.position().x).toBeGreaterThan(0);
  });
  it('snaps large authoritative errors', () => {
    const controller = new InputPredictionController(entityId('player'), { maxCorrection: 0.1 });
    controller.predict(tick(1), { x: 1, y: 0, z: 0 });
    controller.reconcile(tick(1), { tick: tick(1), position: { x: 100, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
    expect(controller.position().x).toBe(100);
  });
  it('clears prediction state', () => {
    const controller = new InputPredictionController(entityId('player'));
    controller.predict(tick(1), { x: 1, y: 0, z: 0 });
    controller.clear();
    expect(controller.pending()).toBe(0);
    expect(controller.position()).toEqual({ x: 0, y: 0, z: 0 });
  });
});
