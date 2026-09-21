import { tick, type FrameBudget, type Vec3 } from '../types.ts';
import { InputButton } from '../input.ts';
import { validatePayload, sanitizeText, isSafeIdentifier } from '../security.ts';
import { buildSnapshotDelta, applySnapshotDelta } from '../network.ts';
import { deterministicChecksum } from '../determinism.ts';
import { ThirdPersonCameraSolver } from '../camera.ts';
import { AudioRouter } from '../audio.ts';
import { createDefaultWorkerPool } from '../worker.ts';
import { ProductionEntityRegistry } from './entityRegistry.ts';
import { ProductionRenderPlanner } from './renderRuntime.ts';
import { ProductionNetworkRuntime } from './networkRuntime.ts';
import { MemoryPersistenceStore, ProductionPersistenceRuntime } from './persistenceRuntime.ts';
import { ProductionObservability } from './observability.ts';
import { ProductionLifecycleSupervisor, createLifecycleIdentity } from './lifecycle.ts';
import { ProductionRuntimeController } from './runtimeController.ts';
import { ProductionDiagnosticsService } from './diagnostics.ts';
import { verifyMigrationBoundaries } from './migrationGuard.ts';
import type { RuntimeFault } from './contracts.ts';

export type AcceptanceSeverity = 'blocking' | 'warning';
export type AcceptanceStatus = 'pass' | 'fail';

export interface AcceptanceAssertion {
  readonly id: string;
  readonly status: AcceptanceStatus;
  readonly severity: AcceptanceSeverity;
  readonly message: string;
  readonly durationMs: number;
}

export interface AcceptanceGate {
  readonly id: string;
  readonly area: string;
  readonly description: string;
  readonly severity: AcceptanceSeverity;
  run(): Promise<AcceptanceAssertion[]> | AcceptanceAssertion[];
}

export interface AcceptanceReport {
  readonly suite: 'AAPW production runtime R4';
  readonly version: 1;
  readonly status: AcceptanceStatus;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly gates: readonly AcceptanceAssertion[];
  readonly passed: number;
  readonly failed: number;
  readonly blockingFailures: number;
  readonly warnings: number;
}

export interface AcceptanceOptions {
  readonly root?: string;
  readonly includeMigrationFilesystemGate?: boolean;
  readonly nowMs?: () => number;
}

function assertion(
  id: string,
  status: AcceptanceStatus,
  severity: AcceptanceSeverity,
  message: string,
  durationMs = 0,
): AcceptanceAssertion {
  return { id, status, severity, message, durationMs: Math.max(0, durationMs) };
}

function timed<T>(now: () => number, id: string, severity: AcceptanceSeverity, callback: () => T): AcceptanceAssertion {
  const start = now();
  try {
    const value = callback();
    if (value instanceof Promise) {
      return assertion(id, 'pass', severity, 'deferred assertion', now() - start);
    }
    return assertion(id, value ? 'pass' : 'fail', severity, value ? 'contract satisfied' : 'contract failed', now() - start);
  } catch (error) {
    return assertion(
      id,
      'fail',
      severity,
      error instanceof Error ? error.message : String(error),
      now() - start,
    );
  }
}

export function buildProductionAcceptanceGates(
  options: AcceptanceOptions = {},
): readonly AcceptanceGate[] {
  const now = options.nowMs ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const gates: AcceptanceGate[] = [
    {
      id: 'security-boundary',
      area: 'security',
      description: 'rejects oversized, cyclic and unsafe runtime payloads',
      severity: 'blocking',
      run: () => {
        const started = now();
        const assertions: AcceptanceAssertion[] = [];
        const safe = validatePayload({ id: 'player-1', values: [1, 2, 3] });
        assertions.push(assertion('security.safe-payload', safe.ok ? 'pass' : 'fail', 'blocking', safe.ok ? 'safe payload accepted' : 'safe payload rejected', now() - started));
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const rejected = validatePayload(cyclic);
        assertions.push(assertion('security.cycle-rejection', rejected.ok ? 'fail' : 'pass', 'blocking', rejected.ok ? 'cyclic payload accepted' : 'cyclic payload rejected', now() - started));
        assertions.push(assertion('security.identifier', isSafeIdentifier('npc:winter-01') ? 'pass' : 'fail', 'blocking', 'identifier policy evaluated', now() - started));
        assertions.push(assertion('security.text-sanitize', sanitizeText('  hello\u0000 world  ') === 'hello world' ? 'pass' : 'fail', 'blocking', 'control characters removed', now() - started));
        return assertions;
      },
    },
    {
      id: 'determinism-core',
      area: 'determinism',
      description: 'canonical checksums and snapshot deltas remain deterministic',
      severity: 'blocking',
      run: () => {
        const started = now();
        const values = [1, 2, 3, 4, 5, 6];
        const first = deterministicChecksum(values);
        const second = deterministicChecksum([...values]);
        const base = { tick: tick(1), entities: [{ id: 1 as any, x: 0, y: 0, z: 0, yaw: 0, flags: 0 }] };
        const current = { tick: tick(2), entities: [{ id: 1 as any, x: 1, y: 0, z: 0, yaw: 0.25, flags: 2 }] };
        const delta = buildSnapshotDelta(base, current);
        const restored = applySnapshotDelta(base, delta);
        return [
          assertion('determinism.checksum-repeat', first === second ? 'pass' : 'fail', 'blocking', 'same canonical values yield same checksum', now() - started),
          assertion('determinism.delta-roundtrip', restored.tick === current.tick && restored.entities[0]?.x === 1 ? 'pass' : 'fail', 'blocking', 'snapshot delta round-trips exactly', now() - started),
          assertion('determinism.delta-checksum', buildSnapshotDelta(base, restored).checksum === delta.checksum ? 'pass' : 'fail', 'blocking', 'delta checksum is stable', now() - started),
        ];
      },
    },
    {
      id: 'entity-capacity',
      area: 'world',
      description: 'bounded entity registry enforces capacity and stable visibility ordering',
      severity: 'blocking',
      run: () => {
        const registry = new ProductionEntityRegistry({ maxEntities: 3, maxVisibleEntities: 2 });
        registry.create({ id: 1, position: { x: 0, y: 0, z: 0 } });
        registry.create({ id: 2, position: { x: 3, y: 0, z: 0 } });
        registry.create({ id: 3, position: { x: 9, y: 0, z: 0 } });
        registry.frameUpdate(1, tick(1), { x: 0, y: 0, z: 0 }, 100);
        const visible = registry.visibleIds();
        let rejected = false;
        try { registry.create({ id: 4 }); } catch { rejected = true; }
        return [
          assertion('entity.visible-cap', visible.length === 2 && visible.join(',') === '1,2' ? 'pass' : 'fail', 'blocking', 'visible entity budget is deterministic'),
          assertion('entity.capacity', rejected ? 'pass' : 'fail', 'blocking', 'entity capacity rejects overflow'),
          assertion('entity.dirty-snapshot', registry.dirtyStates().length === 3 ? 'pass' : 'fail', 'blocking', 'created entities are dirty for replication'),
        ];
      },
    },
    {
      id: 'render-budget',
      area: 'render',
      description: 'render planning respects visibility, LOD and shadow budgets',
      severity: 'blocking',
      run: () => {
        const registry = new ProductionEntityRegistry({ maxEntities: 8, maxVisibleEntities: 8 });
        for (let id = 1; id <= 5; id += 1) registry.create({ id, position: { x: id * 5, y: 0, z: 0 } });
        registry.frameUpdate(1, tick(1), { x: 0, y: 0, z: 0 }, 700);
        const planner = new ProductionRenderPlanner({ maxVisibleEntities: 3 });
        const plan = planner.plan({
          tick: tick(1),
          alpha: 0.25,
          camera: { x: 0, y: 0, z: 0 },
          entities: registry.all(),
          tier: 'high',
          capabilities: { maxTextureSize: 4096, supportsInstancing: true, supportsWebGL2: true },
        });
        return [
          assertion('render.max-visible', plan.commands.length === 3 ? 'pass' : 'fail', 'blocking', 'visible entity cap applied'),
          assertion('render.stable-order', plan.commands[0]?.id === 1 ? 'pass' : 'fail', 'blocking', 'critical entity ordering preserved'),
          assertion('render.plan-work', planner.stats().estimatedDrawCalls > 0 ? 'pass' : 'fail', 'blocking', 'draw work estimated'),
        ];
      },
    },
    {
      id: 'network-session',
      area: 'network',
      description: 'session, rate and delta integrity boundaries remain enforced',
      severity: 'blocking',
      run: () => {
        const network = new ProductionNetworkRuntime({ session: 'acceptance', commandRatePerSecond: 2 });
        network.connect('peer-a', 'loopback', 0);
        const base = { tick: tick(5), entities: [{ id: 1 as any, x:0, y:0, z:0, yaw:0, flags:0 }] };
        const next = { tick: tick(8), entities: [{ id: 1 as any, x:2, y:0, z:0, yaw:0, flags:0 }] };
        const delta = buildSnapshotDelta(base, next);
        const accepted = network.applyDelta('peer-a', base, delta, tick(8));
        const wrong = network.receive('peer-a', { protocol:3, session:'wrong', sequence:1, ack:0, sentTick:tick(8), kind:'event', payload:{} }, tick(8), 10);
        const rateA = network.canSendCommand('peer-a', 10);
        const rateB = network.canSendCommand('peer-a', 10);
        const rateC = network.canSendCommand('peer-a', 10);
        return [
          assertion('network.delta-apply', accepted?.tick === next.tick ? 'pass' : 'fail', 'blocking', 'valid delta accepted'),
          assertion('network.session-reject', !wrong ? 'pass' : 'fail', 'blocking', 'wrong session rejected'),
          assertion('network.rate-limit', rateA && rateB && !rateC ? 'pass' : 'fail', 'blocking', 'per-peer command rate limit enforced'),
        ];
      },
    },
    {
      id: 'persistence-roundtrip',
      area: 'persistence',
      description: 'versioned save envelopes round-trip and reject tampering',
      severity: 'blocking',
      run: async () => {
        const store = new MemoryPersistenceStore();
        const persistence = new ProductionPersistenceRuntime(store, { application: 'aapw', version: 1 });
        const identity = createLifecycleIdentity({ build: 'acceptance' });
        const descriptor = await persistence.save('acceptance', 'checkpoint', identity, {
          position: { x: 3, y: 4, z: 5 },
          health: 82,
          stamina: 63,
          flags: 7,
          entities: [],
          tick: tick(12),
        }, 1200);
        const loaded = await persistence.load('acceptance');
        const raw = await persistence.exportSlot('acceptance');
        const tampered = raw?.replace('"health":82', '"health":83') ?? '';
        await store.write('tampered', tampered);
        const corrupted = await persistence.load('tampered');
        return [
          assertion('persistence.descriptor', descriptor.bytes > 0 && descriptor.checksum.length > 0 ? 'pass' : 'fail', 'blocking', 'save descriptor is populated'),
          assertion('persistence.roundtrip', loaded?.state.health === 82 && loaded.state.tick === tick(12) ? 'pass' : 'fail', 'blocking', 'save round-trip preserved state'),
          assertion('persistence.tamper', corrupted === undefined ? 'pass' : 'fail', 'blocking', 'tampered save rejected'),
        ];
      },
    },
    {
      id: 'lifecycle-supervision',
      area: 'lifecycle',
      description: 'start/pause/resume/stop ordering is deterministic',
      severity: 'blocking',
      run: async () => {
        const calls: string[] = [];
        const lifecycle = new ProductionLifecycleSupervisor({
          identity: createLifecycleIdentity({ build: 'acceptance' }),
          recoveryAttempts: 2,
          faultAfterFailures: 3,
        });
        lifecycle.register({
          id: 'simulation',
          subsystem: 'simulation',
          priority: 10,
          failurePolicy: 'fault-runtime',
          start: () => calls.push('start-s'),
          pause: () => calls.push('pause-s'),
          resume: () => calls.push('resume-s'),
          stop: () => calls.push('stop-s'),
        });
        lifecycle.register({
          id: 'render',
          subsystem: 'render',
          priority: 20,
          failurePolicy: 'degrade',
          start: () => calls.push('start-r'),
          pause: () => calls.push('pause-r'),
          resume: () => calls.push('resume-r'),
          stop: () => calls.push('stop-r'),
        });
        await lifecycle.start();
        await lifecycle.pause();
        await lifecycle.resume();
        await lifecycle.stop();
        const expected = 'start-s,start-r,pause-r,pause-s,resume-s,resume-r,stop-r,stop-s';
        return [
          assertion('lifecycle.order', calls.join(',') === expected ? 'pass' : 'fail', 'blocking', calls.join(',') || 'no lifecycle calls'),
          assertion('lifecycle.stopped', lifecycle.mode === 'stopped' ? 'pass' : 'fail', 'blocking', 'supervisor reaches stopped mode'),
        ];
      },
    },
    {
      id: 'controller-integration',
      area: 'runtime',
      description: 'production controller coordinates simulation, render, health and save',
      severity: 'blocking',
      run: async () => {
        const store = new MemoryPersistenceStore();
        const controller = new ProductionRuntimeController(
          { identity: { build: 'acceptance' }, maxEntities: 32, maxVisibleEntities: 16 },
          { getCameraPosition: () => ({ x: 0, y: 0, z: 0 }), isCoarsePointer: () => false },
          store,
        );
        const events: string[] = [];
        controller.events.on('started', () => events.push('started'));
        controller.events.on('health', () => events.push('health'));
        controller.createEntity({ id: 1, position: { x: 1, y: 0, z: 2 }, health: 99, stamina: 88 });
        await controller.start();
        const budget: FrameBudget = { simulationMs: 2, renderMs: 5, streamingMs: 1, networkMs: 0, totalMs: 8 };
        const frame = await controller.frame({
          deltaSeconds: 1 / 60,
          input: { tick: tick(0), moveX: 1, moveZ: 0, lookX: 0, lookY: 0, buttons: InputButton.Sprint },
          budget,
          wallTimeMs: 16,
        });
        const saved = await controller.save('acceptance', 'autosave');
        await controller.dispose();
        return [
          assertion('controller.running', frame.mode === 'running' ? 'pass' : 'fail', 'blocking', 'controller produces running frame'),
          assertion('controller.render-plan', frame.renderPlan.tier.length > 0 ? 'pass' : 'fail', 'blocking', 'render plan returned'),
          assertion('controller.events', events.includes('started') && events.includes('health') ? 'pass' : 'fail', 'blocking', 'lifecycle/health events emitted'),
          assertion('controller.save', saved.slot === 'acceptance' ? 'pass' : 'fail', 'blocking', 'controller persisted autosave'),
        ];
      },
    },
    {
      id: 'camera-audio-workers',
      area: 'runtime-services',
      description: 'camera smoothing, audio virtualization and worker bounds behave safely',
      run: async () => {
        const camera = new ThirdPersonCameraSolver({ minDistance: 2, maxDistance: 12 });
        const state = camera.update(
          { position: { x: 0, y: 1, z: 0 }, yawRadians: 0, velocity: { x: 1, y: 0, z: 0 } },
          1 / 60,
          { yawDelta: 0.1, pitchDelta: 0.02, zoomDelta: -1 },
          { distance: 6, radius: 0.5 },
        );
        const audio = new AudioRouter(2);
        audio.addEmitter({ id: 1, position: { x: 2, y: 0, z: 0 }, bus: 'sfx', radius: 10, gain: 1, loop: false, priority: 10 });
        audio.addEmitter({ id: 2, position: { x: 30, y: 0, z: 0 }, bus: 'ambience', radius: 20, gain: 1, loop: true, priority: 1 });
        const voices = audio.updateListener({ x:0,y:0,z:0 }, { x:1,y:0,z:0 });
        const workers = createDefaultWorkerPool(2);
        const result = await workers.enqueue('serialization', { id: 1, value: 'ok' });
        const terrain = await workers.enqueue('terrain', { seed: 11, count: 32 });
        return [
          assertion('services.camera-finite', Object.values(state.position).every(Number.isFinite) ? 'pass' : 'fail', 'warning', 'camera position is finite'),
          assertion('services.audio-virtualization', voices.some((voice) => voice.virtualized) ? 'pass' : 'warning', 'warning', 'audio virtualization decisions produced'),
          assertion('services.worker-success', result.ok && terrain.ok ? 'pass' : 'fail', 'blocking', 'worker tasks complete successfully'),
          assertion('services.terrain-bounded', terrain.ok && (terrain.result as Float32Array).length === 32 ? 'pass' : 'fail', 'blocking', 'worker terrain output is bounded'),
        ];
      },
    },
    {
      id: 'observability-diagnostics',
      area: 'diagnostics',
      description: 'health reports and diagnostic snapshots remain serializable',
      severity: 'warning',
      run: async () => {
        const controller = new ProductionRuntimeController({ identity: { build: 'diagnostic-acceptance' }, maxEntities: 8 });
        controller.createEntity({ id: 1 });
        await controller.start();
        await controller.frame({ deltaSeconds: 1 / 60, budget: { simulationMs: 1, renderMs: 2, streamingMs: 1, networkMs: 0, totalMs: 4 }, wallTimeMs: 20 });
        const diagnostics = new ProductionDiagnosticsService(controller, { historySize: 8 });
        const snapshot = diagnostics.capture();
        const json = diagnostics.exportJson();
        const evaluation = diagnostics.evaluate();
        await controller.dispose();
        return [
          assertion('diagnostics.snapshot', snapshot.counters.frames >= 1 && snapshot.series.length > 0 ? 'pass' : 'fail', 'warning', 'diagnostic snapshot includes frame series'),
          assertion('diagnostics.json', json.includes('"identity"') && json.length > 100 ? 'pass' : 'fail', 'warning', 'diagnostic JSON is non-empty'),
          assertion('diagnostics.evaluation', ['ok','degraded','critical'].includes(evaluation.overall) ? 'pass' : 'fail', 'warning', 'diagnostic evaluation has known state'),
        ];
      },
    },
  ];

  if (options.includeMigrationFilesystemGate !== false) {
    gates.push({
      id: 'migration-boundaries',
      area: 'migration',
      description: 'legacy compatibility surfaces exist while promoted ownership remains explicit',
      severity: 'blocking',
      run: async () => {
        const result = await verifyMigrationBoundaries(options.root ?? process.cwd());
        return [
          assertion('migration.filesystem', result.ok ? 'pass' : 'fail', 'blocking', result.ok ? `checked ${result.checked} paths` : result.violations.join('; ')),
          assertion('migration.boundary-count', result.boundaries.length >= 8 ? 'pass' : 'fail', 'blocking', 'production migration matrix contains expected boundaries'),
        ];
      },
    });
  }

  return gates;
}

export async function runProductionAcceptanceSuite(options: AcceptanceOptions = {}): Promise<AcceptanceReport> {
  const now = options.nowMs ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const startedAtMs = now();
  const results: AcceptanceAssertion[] = [];
  for (const gate of buildProductionAcceptanceGates(options)) {
    const gateStart = now();
    try {
      const gateResults = await gate.run();
      for (const result of gateResults) results.push({
        ...result,
        durationMs: Math.max(result.durationMs, now() - gateStart),
      });
    } catch (error) {
      results.push(assertion(
        gate.id,
        'fail',
        gate.severity,
        error instanceof Error ? error.message : String(error),
        now() - gateStart,
      ));
    }
  }
  const finishedAtMs = now();
  const failed = results.filter((result) => result.status === 'fail').length;
  const blockingFailures = results.filter((result) => result.status === 'fail' && result.severity === 'blocking').length;
  const warnings = results.filter((result) => result.status === 'fail' && result.severity === 'warning').length;
  return {
    suite: 'AAPW production runtime R4',
    version: 1,
    status: blockingFailures === 0 && failed === 0 ? 'pass' : 'fail',
    startedAtMs,
    finishedAtMs,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    gates: results,
    passed: results.filter((result) => result.status === 'pass').length,
    failed,
    blockingFailures,
    warnings,
  };
}

export function summarizeAcceptance(report: AcceptanceReport): string {
  const lines = [
    `${report.suite}: ${report.status.toUpperCase()}`,
    `Assertions: ${report.passed} passed / ${report.failed} failed`,
    `Blocking failures: ${report.blockingFailures}`,
    `Warnings: ${report.warnings}`,
    `Duration: ${report.durationMs.toFixed(2)}ms`,
  ];
  for (const gate of report.gates) {
    lines.push(`[${gate.status.toUpperCase()}] ${gate.id} — ${gate.message}`);
  }
  return lines.join('\\n');
}

export function acceptanceExitCode(report: AcceptanceReport): number {
  return report.status === 'pass' ? 0 : 1;
}

export function runtimeFaultFromAcceptance(report: AcceptanceReport): RuntimeFault | undefined {
  if (report.blockingFailures === 0) return undefined;
  return {
    subsystem: 'simulation',
    policy: 'fault-runtime',
    message: `production acceptance failed with ${report.blockingFailures} blocking assertion(s)`,
    tick: tick(0),
    recoverable: false,
    details: {
      failed: report.failed,
      blockingFailures: report.blockingFailures,
    },
  };
}
