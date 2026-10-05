import { describe, expect, it } from 'vitest';
import {
  CheckpointStore,
  MemorySaveStorage,
  RuntimeSaveManager,
  SaveCodec,
  SaveMigrationRegistry,
} from '../../src/engine-ts/r43/persistence.ts';
import {
  CommandSecurityGate,
  SnapshotAgeGuard,
  TextSanitizer,
  TokenBucket,
  createDefaultSecurityPolicy,
  sanitizeColor,
  sanitizeId,
} from '../../src/engine-ts/r43/security.ts';

describe('r43 persistence', () => {
  it('round-trips a save envelope', async () => {
    const codec = new SaveCodec<{ gold: number }>({ schema: 'test', version: 1, maxBytes: 4096 });
    const storage = new MemorySaveStorage();
    const manager = new RuntimeSaveManager(codec, storage, 'save');
    const saved = await manager.save({ gold: 42 }, 10);
    expect(saved.ok).toBe(true);
    const loaded = await manager.load();
    expect(loaded).toEqual(expect.objectContaining({ ok: true }));
    expect(loaded.value?.payload).toEqual({ gold: 42 });
  });

  it('detects tampered checksums before returning data', () => {
    const codec = new SaveCodec<{ gold: number }>({ schema: 'test', version: 1 });
    const encoded = codec.encode({ gold: 42 }, 1);
    expect(encoded.ok).toBe(true);
    const parsed = JSON.parse(encoded.value?.json ?? '{}') as Record<string, unknown>;
    parsed.payload = { gold: 999 };
    const decoded = codec.decode(JSON.stringify(parsed));
    expect(decoded.ok).toBe(false);
    expect(decoded.error?.code).toBe('SAVE_CHECKSUM_MISMATCH');
  });

  it('migrates versioned payloads one step at a time', () => {
    const migrations = new SaveMigrationRegistry<{ value: number }>();
    migrations.add({ fromVersion: 1, toVersion: 2, migrate: (value) => ({ value: value.value + 1 }) });
    migrations.add({ fromVersion: 2, toVersion: 3, migrate: (value) => ({ value: value.value * 2 }) });
    expect(migrations.migrate({ value: 3 }, 1, 3)).toEqual({ value: 8 });
    expect(migrations.versions()).toEqual([1, 2]);
  });

  it('bounds checkpoint history', () => {
    const store = new CheckpointStore(4);
    for (let i = 0; i < 8; i += 1) {
      store.push({
        version: 1,
        frame: i,
        tick: i,
        simTimeSeconds: i / 60,
        entities: [],
        digest: String(i),
      });
    }
    expect(store.values()).toHaveLength(4);
    expect(store.latest()?.tick).toBe(7);
    expect(store.atOrBefore(5)?.tick).toBe(5);
  });
});

describe('r43 security', () => {
  it('refills and consumes a token bucket deterministically', () => {
    const bucket = new TokenBucket(2, 1, 0);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(false);
    expect(bucket.consume(1, 1.1)).toBe(true);
  });

  it('sanitizes user-controlled text and identifiers', () => {
    const sanitizer = new TextSanitizer(12);
    expect(sanitizer.clean('  hello\u0000 world  ')).toBe('hello world');
    expect(sanitizeId('../evil<script>', 32)).toBe('..evilscript');
    expect(sanitizeColor('#ABCDEF')).toBe('#abcdef');
    expect(sanitizeColor('red')).toBe('#ffffff');
  });

  it('rejects commands after rate-limit exhaustion', () => {
    const gate = new CommandSecurityGate(createDefaultSecurityPolicy());
    const now = 0;
    for (let i = 0; i < 120; i += 1) {
      expect(gate.validateCommand({ type: 'resume' }, now).ok).toBe(true);
    }
    const rejected = gate.validateCommand({ type: 'resume' }, now);
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe('SECURITY_RATE_LIMIT');
  });

  it('enforces a snapshot freshness envelope', () => {
    const guard = new SnapshotAgeGuard(1000);
    expect(guard.accept(1000, 1200)).toBe(true);
    expect(guard.accept(1000, 2201)).toBe(false);
    expect(guard.accept(1000, 700)).toBe(true);
    expect(guard.accept(1000, 600)).toBe(false);
  });
});
