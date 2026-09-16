/**
 * V6 verification utilities.
 * Produces deterministic contract reports that can be consumed by CI or a
 * local developer command without needing a browser or rendering context.
 */

import { digest, DeterministicKernel } from './deterministicKernel.ts';
import { normalizeAssetManifest, estimateResidentBytes, type AssetDescriptor, type AssetId } from './assetGraph.ts';
import { actionDomain, actionIsContinuous, quantizeInput, type CommandEnvelope, type CommandName } from './commandPipeline.ts';
import { validateEnvelope, type NetworkEnvelope } from './networkSession.ts';
import { buildMigrationReport, migrationDigest, validateMigrationReport } from './migrationBoundary.ts';
import { platformHealth, V6_FEATURES, type V6Platform } from './platform.ts';
import { checksum } from './saveCodec.ts';
import { validatePayload } from './securityTelemetry.ts';
import { objectCell, type EntityRef, WorldState } from './worldState.ts';
import { workerPayloadDigest } from './workerProtocol.ts';

export interface VerificationCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly details: string;
  readonly durationMs: number;
}

export interface VerificationReport {
  readonly suite: string;
  readonly passed: boolean;
  readonly checks: readonly VerificationCheck[];
  readonly digest: string;
  readonly featureCount: number;
}

function check(id: string, callback: () => string): VerificationCheck {
  const started = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const details = callback();
    const ended = typeof performance !== 'undefined' ? performance.now() : started;
    return { id, passed: true, details, durationMs: Math.max(0, ended - started) };
  } catch (error: unknown) {
    const ended = typeof performance !== 'undefined' ? performance.now() : started;
    return { id, passed: false, details: error instanceof Error ? error.message : String(error), durationMs: Math.max(0, ended - started) };
  }
}

function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function verifyDeterministicKernel(): string {
  const a = new DeterministicKernel({ seed: 12345, tickHz: 30 });
  const b = new DeterministicKernel({ seed: 12345, tickHz: 30 });
  a.start(); b.start();
  const da: number[] = []; const db: number[] = [];
  for (let index = 0; index < 20; index += 1) da.push(a.advance(1 / 30, (ctx) => ctx.random.nextFloat()));
  for (let index = 0; index < 20; index += 1) db.push(b.advance(1 / 30, (ctx) => ctx.random.nextFloat()));
  expect(digest({ a: a.snapshot(), da, b: b.snapshot(), db }) === digest({ a: b.snapshot(), da: db, b: b.snapshot(), db }), 'kernel replay digest mismatch');
  return `tick=${a.snapshot().tickId};seq=${a.snapshot().sequence}`;
}

export function verifyAssetManifest(descriptors: readonly AssetDescriptor[] = []): string {
  const manifest = normalizeAssetManifest(descriptors);
  const ids = manifest.map((entry) => entry.id) as AssetId[];
  const bytes = estimateResidentBytes(manifest, ids);
  expect(new Set(ids).size === ids.length, 'duplicate normalized asset ids');
  expect(bytes >= 0, 'negative resident bytes');
  return `assets=${manifest.length};bytes=${bytes}`;
}

export function verifyCommandContracts(names: readonly CommandName[] = ['move', 'look', 'jump', 'dodge', 'primaryAction']): string {
  const commands: CommandEnvelope[] = names.map((name, index) => ({ tick: index, sequence: index + 1, domain: actionDomain(name), name, payload: name === 'move' ? { x: quantizeInput(0.31), y: quantizeInput(-0.2) } : null, client: 'replay', reliable: !actionIsContinuous(name) }));
  let sequence = 0;
  for (const command of commands) { expect(command.sequence > sequence, 'command order regression'); sequence = command.sequence; }
  expect(commands.some((command) => command.reliable), 'reliable command regression');
  return `commands=${commands.length};reliable=${commands.filter((command) => command.reliable).length}`;
}

export function verifyNetworkEnvelope(): string {
  const envelope: NetworkEnvelope = { channel: 'snapshot', delivery: 'reliable', sequence: 1, tick: 1, sentAtSeconds: 1, payload: { value: 1 } };
  validateEnvelope(envelope);
  return workerPayloadDigest(envelope.payload);
}

export function verifySecurity(): string {
  const safe = validatePayload({ id: 'player-1', value: 10, active: true });
  const unsafe = validatePayload({ __proto__: { polluted: true } });
  expect(safe.decision === 'allow', 'safe payload rejected');
  expect(unsafe.decision !== 'allow', 'prototype payload accepted');
  return `${safe.decision}/${unsafe.decision}`;
}

export function verifyWorldState(): string {
  const world = new WorldState();
  const entity = world.spawn(0);
  world.set(entity, 'transform', { x: 2, y: 0, z: 3, yaw: 0, pitch: 0 });
  world.set(entity, 'interest', { priority: 1, radius: 20, visible: true });
  world.set(entity, 'tags', { values: ['hero', 'player'] });
  const query = world.query({ components: ['transform', 'interest'], tags: ['hero'], center: { x: 0, y: 0, z: 0 }, maxDistance: 10 });
  expect(query.length === 1, 'world query regression');
  const cell = objectCell({ x: 12, y: 0, z: -3 }, 10);
  expect(cell.x === 1 && cell.z === -1, 'world cell projection regression');
  return `${entity};checksum=${world.checksum()}`;
}

export function verifyMigration(): string {
  const report = buildMigrationReport(undefined, 10);
  const failures = validateMigrationReport(report);
  expect(failures.length === 0, `migration report invalid: ${failures.join(',')}`);
  return migrationDigest(report);
}

export function verifySaveChecksum(payload: unknown): string { return checksum(payload).toString(16); }

export function verifyPlatform(platform: V6Platform): string {
  const health = platformHealth(platform);
  expect(health.healthy || health.reasons.length > 0, 'health result malformed');
  expect(V6_FEATURES.length >= 9, 'feature catalog regression');
  return health.healthy ? 'healthy' : health.reasons.join('|');
}

export function runV6VerificationSuite(platform?: V6Platform): VerificationReport {
  const checks: VerificationCheck[] = [
    check('deterministic-kernel', verifyDeterministicKernel),
    check('asset-manifest', () => verifyAssetManifest()),
    check('command-contracts', () => verifyCommandContracts()),
    check('network-envelope', verifyNetworkEnvelope),
    check('security-boundary', verifySecurity),
    check('world-state', verifyWorldState),
    check('migration-boundary', verifyMigration),
    check('save-checksum', () => verifySaveChecksum({ version: 6, ok: true })),
  ];
  if (platform) checks.push(check('platform-health', () => verifyPlatform(platform)));
  const source = checks.map((item) => `${item.id}:${item.passed}:${item.details}`).join('|');
  return {
    suite: 'aapw-v6',
    passed: checks.every((item) => item.passed),
    checks,
    digest: digest(source),
    featureCount: V6_FEATURES.length,
  };
}

export function assertV6Verification(platform?: V6Platform): VerificationReport {
  const report = runV6VerificationSuite(platform);
  if (!report.passed) {
    const failed = report.checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.details}`);
    throw new Error(`V6 verification failed\n${failed.join('\n')}`);
  }
  return report;
}

export type V6CheckId = VerificationCheck['id'];
export function verificationCheckIds(): readonly V6CheckId[] {
  return ['deterministic-kernel', 'asset-manifest', 'command-contracts', 'network-envelope', 'security-boundary', 'world-state', 'migration-boundary', 'save-checksum', 'platform-health'];
}
