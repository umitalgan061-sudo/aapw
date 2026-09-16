import type { SnapshotVersion } from './platform.js';

export interface SchemaIdentity {
  readonly namespace: string;
  readonly version: SnapshotVersion;
  readonly hash: string;
}

export function parseSnapshotVersion(value: string): SnapshotVersion | undefined {
  return /^\d+\.\d+\.\d+$/.test(value) ? value as SnapshotVersion : undefined;
}

export function compareSnapshotVersions(left: SnapshotVersion, right: SnapshotVersion): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export function isUpgrade(left: SnapshotVersion, right: SnapshotVersion): boolean {
  return compareSnapshotVersions(left, right) < 0;
}

export function isDowngrade(left: SnapshotVersion, right: SnapshotVersion): boolean {
  return compareSnapshotVersions(left, right) > 0;
}

export function buildSchemaIdentity(namespace: string, version: SnapshotVersion, hash: string): SchemaIdentity {
  if (!namespace.trim()) throw new TypeError('Schema namespace is required');
  if (!hash.trim()) throw new TypeError('Schema hash is required');
  return Object.freeze({ namespace, version, hash });
}

export function schemaKey(identity: SchemaIdentity): string {
  return `${identity.namespace}@${identity.version}#${identity.hash}`;
}
