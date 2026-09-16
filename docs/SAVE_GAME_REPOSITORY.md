# Save Game Repository R1

`saveGameRepository.js` is the persistence boundary for the 3D game. It keeps storage concerns out of gameplay and uses a versioned `aapw.save` envelope with a deterministic checksum, bounded payload size and fail-closed validation.

## Contract

Version 3 stores namespace, normalized slot, creation/update timestamps, exact payload byte count, JSON-safe metadata, canonical payload and checksum. Object keys are recursively sorted while array order is preserved, so equivalent snapshots serialize deterministically.

The checksum is an integrity/error-detection mechanism, not cryptographic authentication. Browser storage remains client-controlled.

## Storage

The repository supports injected/local `localStorage` for synchronous lightweight saves and IndexedDB for asynchronous durable saves. Eight slots are retained by default. Malformed storage, unknown future versions, stale data and checksum mismatches return explicit reason codes instead of being restored silently.

Legacy version 1/2 envelopes can be migrated to version 3. Unknown versions are rejected rather than guessed.

## Gameplay snapshot boundary

`saveGameSnapshotAdapter.js` is a separate whitelist boundary. It preserves only authoritative JSON-safe data such as player transform/resources/inventory/equipment, world calendar/settlement/flags, quest progress and a bounded recent-event list. Renderer instances, DOM nodes and arbitrary object graphs never cross the persistence boundary.

Restoration is callback-driven: persistence returns a validated restore plan, while the owning game systems decide how to apply it. This prevents the save layer from becoming a second authoritative game-state owner.

## Operational guidance

Autosave should be event/checkpoint driven, not frame driven. Compact procedural seeds and state deltas should be preferred to serializing an entire generated world. UI should distinguish missing, invalid, stale and unavailable storage states.

The acceptance tests exercise canonicalization, checksum/tamper detection, CRUD, namespace and age guards, migration, disposal, snapshot clamping/whitelisting and restore callback behavior. CI also generates a deterministic 4096-case save contract corpus and replays it byte-for-byte.
