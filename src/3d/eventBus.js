/**
 * Compatibility barrel for legacy JavaScript imports.
 *
 * The authoritative event bus implementation now lives in eventBus.ts. Existing runtime modules,
 * browser probes and QA scripts keep this .js import surface during the TypeScript migration.
 * @module eventBus
 */
export { EventBus, gameEvents } from './eventBus.ts';
export type {
  AssetErrorEvent,
  AssetLoadedEvent,
  AssetProgressEvent,
  EventBusDiagnostics,
  EventHandler,
  EventPayload,
  EventSubscription,
  GameErrorEvent,
  GameEventMap,
  GameReadyEvent,
  PlayerDamagedEvent,
  PlayerDiedEvent,
  PlayerHealthChangedEvent,
  WorldEventTriggeredEvent,
} from './eventBus.ts';
