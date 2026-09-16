# Save Game Repository

`src/3d/persistence/saveGameRepository.js` is the persistence boundary for the 3D game. It deliberately does not subscribe to the game loop or mutate gameplay state.

## Why this exists

`STORAGE_KEYS.SAVE_SLOT` has existed as a storage namespace, but a gameplay save needs stronger rules than a raw JSON blob. Browser storage can contain stale, partially written, manually modified or schema-incompatible values. The repository therefore stores a versioned envelope with a canonical payload and checksum.

## Envelope contract

```text
schema       aapw.save
version      3
namespace    bounded owner namespace
slot         bounded slot id
createdAtMs  non-negative integer
updatedAtMs  non-decreasing integer
payloadBytes exact serialized UTF-8 byte count
metadata     JSON-safe object
payload      canonical JSON-safe snapshot
checksum     deterministic integrity digest
```

The checksum is intentionally not presented as cryptographic authentication. It is an integrity/error-detection mechanism for accidental corruption or incompatible writes. It should not be treated as proof against a malicious actor.

## Canonical serialization

Object keys are sorted recursively while array order is preserved. Equivalent object graphs therefore produce the same canonical string and checksum even when callers created them with a different insertion order.

Gameplay snapshots should contain only JSON-safe values. Functions, DOM objects, Three.js renderer instances, typed class instances with implicit private state and circular references do not belong in the persisted snapshot.

## Size guard

The default payload ceiling is 768 KiB. This is deliberately much smaller than an arbitrary browser quota. Large world data should remain derivable from deterministic seeds and compact state deltas rather than serializing the whole procedural world.

A caller receiving `SAVE_PAYLOAD_TOO_LARGE` should reduce the snapshot to authoritative state rather than raise the limit blindly.

## Version migration

Version 1 and version 2 are accepted by the migration helper and rewritten into the version 3 envelope. Unknown future versions are rejected rather than guessed.

A migration must preserve authoritative gameplay values. Migration metadata records the source version so diagnostics can explain how a save reached its current schema.

## Backends

### localStorage

The synchronous path is intended for lightweight autosave metadata and compact snapshots. A storage adapter can be injected in tests, which makes the repository deterministic and browser-free during contract tests.

### IndexedDB

IndexedDB support is asynchronous and suitable for a larger durable snapshot. The repository opens a dedicated object store, validates the envelope after retrieval and closes the database when the transaction completes.

The IndexedDB path is optional. A browser without IndexedDB returns a bounded error rather than crashing the game boot sequence.

## Slot behavior

The repository maintains a bounded slot list. Saving a slot moves it to the front and removes duplicate entries. The default maximum is eight slots. This prevents an unbounded metadata list from becoming its own storage leak.

Slots are normalized to a narrow ASCII-safe identifier. This prevents delimiter and whitespace surprises while keeping user-visible names readable enough for UI adapters.

## Validation order

Validation fails closed in a deliberate sequence:

1. schema;
2. version;
3. namespace;
4. expected slot;
5. timestamps;
6. maximum payload size;
7. optional age policy;
8. checksum;
9. exact byte count.

The caller gets a reason code suitable for telemetry/UI. No corrupted payload is returned as if it were valid.

## Ownership rule

The repository does not know what a “quest”, “NPC”, “inventory”, “combat” or “terrain chunk” is. Those systems decide what belongs in a snapshot. The persistence layer stores and restores a value; a separate adapter is responsible for applying that value to authoritative state.

This keeps persistence from becoming a second game-state authority.

## Autosave guidance

Autosave should be debounced by the caller. A save call should be triggered after authoritative state transitions such as:

- entering a new settlement;
- completing a quest objective;
- changing inventory;
- changing equipment;
- receiving a major world-event transition;
- moving across a meaningful checkpoint boundary.

Do not serialize every render frame.

## Recovery behavior

If the preferred durable backend is unavailable, callers may use the injected/local synchronous backend as a recovery path. A recovery UI should distinguish “no save”, “invalid save”, “stale save” and “storage unavailable”; these are different operational states.

A corrupt save should not be silently overwritten until the user has had a chance to understand that recovery failed.

## Security boundary

Browser storage is client-controlled. The integrity checksum detects corruption but does not establish trust. Competitive or server-authoritative systems must validate their own state on a trusted backend.

This repository is appropriate for local/offline persistence of the single-player world unless a future authoritative service introduces a server save protocol.

## Testing

The acceptance script covers canonical serialization, deterministic checksums, version 3 envelopes, tamper detection, CRUD, slot listing, namespace and age rejection, version migration and disposal behavior.

The deterministic matrix covers four schema versions, four storage backends, four payload classes, four corruption modes, four slot states and four lifecycle events: 4096 contract cases.

The matrix is materialized by CI and must remain reproducible byte-for-byte on repeated generation.
