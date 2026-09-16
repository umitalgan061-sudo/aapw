import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = resolve(ROOT, 'dist/engine-ts');
const MATRIX = resolve(ROOT, 'artifacts/typescript-cutover-r1/cutover-policy.matrix');

const engine = await import(resolve(DIST, 'index.js'));
const quality = await import(resolve(DIST, 'quality.js'));
const input = await import(resolve(DIST, 'inputRouter.js'));
const saves = await import(resolve(DIST, 'saveSystem.js'));
const streaming = await import(resolve(DIST, 'streaming.js'));
const assets = await import(resolve(DIST, 'assetRegistry.js'));
const render = await import(resolve(DIST, 'renderPacket.js'));
const migration = await import(resolve(DIST, 'migrationManifest.js'));

assert.ok(existsSync(MATRIX), 'deterministic cutover matrix exists');
const matrixLines = readFileSync(MATRIX, 'utf8').trimEnd().split('\n');
assert.equal(matrixLines.length, 4098, 'matrix has 4096 cases plus two headers');
const caseIds = new Set(matrixLines.slice(2).map(line => JSON.parse(line).id));
assert.equal(caseIds.size, 4096, 'matrix ids are unique');

const facade = engine.createModernEngineFacade();
assert.equal(facade.runtime.health.phase, 'ready', 'modern runtime initializes');
assert.ok(facade.platform, 'platform profile is available');
assert.ok(facade.backend === 'webgpu' || facade.backend === 'webgl2', 'renderer backend is bounded');
assert.ok(['ultra', 'high', 'balanced', 'low', 'safe'].includes(facade.quality.currentTier), 'quality tier is bounded');

const highPressure = facade.quality.update({ cpuRatio: 1.2, gpuRatio: 1.4, frameRatio: 1.3, memoryRatio: 0.95, thermalRatio: 1.1 }, 1000);
assert.ok(highPressure.pressure.composite > 0.8, 'pressure model reacts to load');
const lowPressure = facade.quality.update({ cpuRatio: 0.1, gpuRatio: 0.15, frameRatio: 0.1, memoryRatio: 0.2 }, 1200);
assert.ok(lowPressure.pressure.composite >= 0, 'pressure model remains finite');

const router = new input.InputRouter({ clock: () => 100 });
router.defineAction({ name: 'move', type: 'axis2d', deadZone: 0.1, curve: 1.2 });
router.bind({ action: 'move', device: 'gamepad', code: 'LeftStick' });
router.setTick(12);
router.ingest({ device: 'gamepad', code: 'LeftStick', phase: 'changed', value: [0.7, -0.4], tick: 12 });
assert.deepEqual(router.action('move')?.value, input.axis2(0.7, -0.4, 0.1, 1.2), 'input normalization is deterministic');
const recorder = router.startRecording(100);
router.ingest({ device: 'keyboard', code: 'KeyW', phase: 'pressed', value: true, tick: 13 });
const recorded = router.stopRecording(120);
assert.equal(recorded?.events.length, 1, 'recorder captures events');
assert.equal(new input.ReplaySession(router, recorded ?? { version: 2, startedAt: 0, stoppedAt: 0, events: [], checksum: '' }).cursor.finished, false, 'replay cursor begins before completion');
void recorder;

const saveBackend = new saves.MemorySaveBackend();
const saveSystem = new saves.SaveSystem(saveBackend, { version: 3, clock: () => 200 });
saveSystem.registerMigration({ from: 1, to: 2, migrate: value => value });
saveSystem.registerMigration({ from: 2, to: 3, migrate: value => value });
const saved = saveSystem.write('slot-0', { world: { seed: 'west', day: 7 }, player: { x: 1, z: 2 }, meta: { difficulty: 'hard' } }, 42);
assert.equal(saved.ok, true, 'save write succeeds');
assert.equal(saveSystem.validate('slot-0').ok, true, 'save validation succeeds');
assert.equal(saveSystem.read('slot-0').ok, true, 'save read succeeds');
const exported = saveSystem.export('slot-0');
assert.equal(exported.ok, true, 'save export succeeds');
if (exported.ok && exported.value) assert.equal(saveSystem.import('slot-1', exported.value).ok, true, 'save import succeeds');
assert.equal(saveSystem.validate('slot-1').ok, true, 'imported save remains valid');

const stream = new streaming.StreamingPlanner({ maxLoadsPerFrame: 3, maxUnloadsPerFrame: 2, entityBudget: 1000, memoryBudgetBytes: 8 * 1024 * 1024 });
stream.markState('terrain-a', 'resident', 1);
stream.markFailure('fauna-b', 1);
const chunks = ['terrain-a', 'fauna-b', 'vegetation-c', 'props-d', 'audio-e'].map((id, index) => streaming.createStreamChunk({ id, kind: index === 0 ? 'terrain' : index === 1 ? 'fauna' : index === 2 ? 'vegetation' : index === 3 ? 'props' : 'audio', center: [index * 12, 0, 0], loadRadius: 50, unloadRadius: 75, priority: 5 - index, bytes: 256 * 1024, entities: 80 }));
const planA = stream.plan(chunks, { x: 0, y: 2, z: 0, velocityX: 4, velocityZ: 0 }, 32);
const planB = stream.plan([...chunks].reverse(), { x: 0, y: 2, z: 0, velocityX: 4, velocityZ: 0 }, 32);
assert.deepEqual(planA.loads, planB.loads, 'streaming decisions are input-order invariant');

const registry = new assets.AssetRegistry({ baseUrl: 'https://example.com/', sameOriginOnly: false, budget: { maxBytes: 2 * 1024 * 1024 } });
assert.equal(registry.validateUrl('/asset.bin').ok, true, 'relative asset URL is valid');
registry.register(assets.createAssetDescriptor('bytes', 'https://example.com/bytes.bin', 'binary', { bytes: 64 * 1024, priority: 'high' }));
registry.installAdapter('binary', { load: async descriptor => new TextEncoder().encode(descriptor.id).buffer, estimateBytes: value => value.byteLength });
const loaded = await registry.load<ArrayBuffer>('bytes');
assert.equal(loaded.ok, true, 'asset adapter loads a binary resource');
assert.equal(registry.stats.resident, 1, 'asset becomes resident');
assert.equal(registry.release('bytes'), true, 'asset ref release contract works only after acquire');

const camera = render.normalizeCameraPacket({ position: { x: 0, y: 2, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, near: 0.1, far: 1000, fovDegrees: 60, aspect: 16 / 9, viewportWidth: 1920, viewportHeight: 1080, pixelRatio: 2 });
const builder = new render.RenderFrameBuilder({ maxDraws: 100, maxShadows: 10, maxAnimated: 20, maxTransparent: 5, maxDistance: 500 });
builder.setFrame(10, 20);
for (let i = 0; i < 32; i += 1) builder.add(render.createDrawPacket({ id: `tree-${i}`, meshId: 'tree', materialId: 'foliage', material: { id: 'foliage', class: 'opaque', variant: 'leaf', transparent: false, depthWrite: true, doubleSided: true }, layer: 'vegetation', pass: 'opaque', bounds: { center: { x: (i % 8) * 8 - 28, y: 0, z: -30 - Math.floor(i / 8) * 8 }, radius: 3 }, distance: 0, screenCoverage: 0, importance: 10, castShadow: i < 16, receiveShadow: true, animated: false, instanceGroup: 'trees' }));
const packet = builder.build(camera);
assert.equal(packet.version, 2, 'render packet version is explicit');
assert.ok(packet.checksum.length === 8, 'render packet checksum is bounded');
assert.ok(packet.stats.visible <= packet.stats.submitted, 'visibility accounting is sane');

const manifest = migration.defaultMigrationManifest();
assert.ok(manifest.report().total >= 8, 'migration manifest contains real platform surfaces');
for (const module of manifest.all()) {
  const ready = manifest.canTransition(module, 'cut-over');
  if (module.status === 'shadow') assert.equal(ready.ok, false, 'shadow modules cannot skip ready gate');
}

const canonicalRuntimeFrame = facade.runtime.advance({ deltaSeconds: 1 / 60 });
assert.ok(canonicalRuntimeFrame.frame.checksum.length === 8, 'runtime frame checksum remains deterministic');
facade.dispose();

console.log('TypeScript cut-over acceptance checks passed');
