export * from './assets.js';
export * from './events.js';
export * from './migration.js';
export * from './persistence.js';
export * from './rendering.js';
export * from './result.js';
export * from './runtimeContract.js';

import { createRuntimeBus } from './events.js';
import { DEFAULT_MIGRATION_POLICY } from './migration.js';
import type { RuntimeBus } from './events.js';
import type { MigrationPolicy } from './migration.js';

export interface TypedRuntimeFoundation {
  readonly bus: RuntimeBus;
  readonly migrationPolicy: MigrationPolicy;
  readonly version: '1.0.0';
}

export const createTypedRuntimeFoundation = (): TypedRuntimeFoundation => ({
  bus: createRuntimeBus(),
  migrationPolicy: DEFAULT_MIGRATION_POLICY,
  version: '1.0.0',
});
