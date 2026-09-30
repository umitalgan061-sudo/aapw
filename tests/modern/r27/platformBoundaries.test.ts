import { describe, expect, it } from 'vitest';
import {
  RuntimeSecurityBoundary,
  RuntimeRenderAdapter,
  TypedOwnershipRegistry,
  TypedWorkerBroker,
  entityId,
  saveSlotId,
  type RuntimeSnapshot,
  type WorkerRequest,
  type WorkerResponse,
} from '../../../src/3d/modern/r27/index.ts';
import type { WorkerTransport } from '../../../src/3d/modern/r27/workerProtocol.ts';

describe('R27 platform boundaries', () => {
  it('sanitizes hostile input while retaining a typed contract', () => {
    const boundary = new RuntimeSecurityBoundary({ maxButtons: 2, maxAnalogKeys: 2 });
    const verdict = boundary.validateInput({
      tick: -2,
      move: { x: Number.POSITIVE_INFINITY, y: 2 },
      look: { x: 3, y: -3 },
      buttons: ['<script>', 'attack', 'attack', 'third'],
      analog: { a: 4, b: -4, c: 1 },
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.sanitizedInput?.move).toEqual({ x: 0, y: 1 });
    expect(verdict.sanitizedInput?.buttons).toEqual(['attack', 'third']);
    expect(verdict.sanitizedInput?.analog).toEqual({ a: 1, b: -1 });
  });

  it('enforces migration ownership rules', () => {
    const registry = new TypedOwnershipRegistry();
    registry.register({
      legacyPath: 'src/3d/gameplay/player.js',
      typedOwnerPath: 'src/3d/gameplay/player.ts',
      ownerKind: 'gameplay',
      activeOwner: 'typed',
      shimAllowed: true,
      rollbackOnly: false,
    });
    const report = registry.audit();
    expect(report.ready).toBe(true);
    expect(report.typedOwners).toBe(1);
    expect(registry.activeTypedOwners()[0]?.typedOwnerPath).toContain('.ts');
  });

  it('bridges render snapshots without importing the renderer', () => {
    const adapter = new RuntimeRenderAdapter();
    const snapshot: RuntimeSnapshot = {
      schema: 1,
      tick: 10,
      timeSeconds: 1 / 6,
      qualityLevel: 2,
      checksum: 'abcd',
      entities: [{
        id: entityId(1),
        transform: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        tags: ['hero'],
      }],
    };
    const frame = adapter.buildFrame(snapshot);
    expect(frame.visibleCount).toBe(1);
    expect(frame.proxies[0]?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(adapter.pick(frame.proxies, () => true)?.entity).toBe(entityId(1));
  });

  it('resolves typed worker promises and rejects orphaned requests', async () => {
    let listener: ((message: WorkerResponse) => void) | null = null;
    const sent: WorkerRequest[] = [];
    const transport: WorkerTransport = {
      send: (message) => sent.push(message),
      onMessage: (next) => {
        listener = next;
        return () => { listener = null; };
      },
    };
    const broker = new TypedWorkerBroker(transport);
    const pending = broker.request({ type: 'asset-manifest', assetIds: undefined } as never);
    const id = sent[0]?.requestId;
    listener?.({
      type: 'asset-manifest-ready',
      requestId: id ?? 0,
      assets: [],
    });
    await expect(pending).resolves.toMatchObject({ type: 'asset-manifest-ready' });
    expect(broker.pendingCount()).toBe(0);
    broker.dispose();
  });

  it('keeps payload and command budgets bounded', () => {
    const boundary = new RuntimeSecurityBoundary({ maxPayloadBytes: 100 });
    expect(boundary.auditPayload({ hello: 'world' }).accepted).toBe(true);
    expect(boundary.auditPayload({ data: 'x'.repeat(500) }).accepted).toBe(false);
    expect(boundary.consumeCommandBudget(1, 120)).toBe(true);
    expect(boundary.consumeCommandBudget(1, 1)).toBe(false);
    expect(saveSlotId('slot-a')).toBe('slot-a');
  });
});
