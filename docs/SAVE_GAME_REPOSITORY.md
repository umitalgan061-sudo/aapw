# Save Game Repository R1

`saveGameRepository.js` is the persistence boundary for the 3D game. It keeps storage concerns out of gameplay and uses a versioned `aapw.save` envelope with deterministic canonical serialization, integrity checking, bounded payload size and fail-closed validation.

## Contract

Version 3 stores namespace, normalized slot, creation/update timestamps, exact payload byte count, JSON-safe metadata, canonical payload and checksum. Object keys are recursively sorted while array order is preserved, so equivalent snapshots serialize deterministically.

The checksum is an integrity/error-detection mechanism, not cryptographic authentication. Browser storage remains client-controlled.

## Storage

The repository supports injected/local `localStorage` for synchronous lightweight saves and IndexedDB for asynchronous durable saves. Eight slots are retained by default. Malformed storage, unknown future versions, stale data and checksum mismatches return explicit reason codes instead of being restored silently.

The durable IndexedDB path is optional. A browser without IndexedDB gets a bounded error result, not a render-loop exception. The synchronous adapter remains useful for lightweight recovery/autosave metadata and tests.

## Gameplay snapshot boundary

`saveGameSnapshotAdapter.js` is a separate whitelist boundary. It preserves only authoritative JSON-safe data such as player transform/resources/inventory/equipment, world calendar/settlement/flags, quest progress and a bounded recent-event list. Renderer instances, DOM nodes and arbitrary object graphs never cross the persistence boundary.

Restoration is callback-driven: persistence returns a validated restore plan, while the owning game systems decide how to apply it. This prevents the save layer from becoming a second authoritative game-state owner and makes partial system restoration observable.

## Versioning and migration

Legacy version 1/2 envelopes are migrated into version 3 explicitly. Unknown future versions are rejected rather than guessed. Migration records the source version in metadata so diagnostics can explain how a save reached the current schema.

## Limits

A 768 KiB payload ceiling keeps compact state compact. Large procedural worlds should be reconstructed from deterministic seeds and state deltas rather than serialized wholesale. Slot metadata is capped at eight entries so the save index cannot become an unbounded storage leak.

## Operational guidance

Autosave should be event/checkpoint driven, not frame driven. Suitable checkpoints include settlement transitions, quest-objective completion, inventory/equipment changes and major world-event changes. Do not serialize every render frame.

Recovery UI should distinguish at least: no save, invalid save, stale save and storage unavailable. A corrupt save should not be silently overwritten before the user has had a chance to understand that recovery failed.

## Security boundary

Browser storage is client-controlled. The checksum detects accidental corruption and incompatible writes but does not establish trust. Any server-authoritative or competitive system must validate state independently on a trusted backend.

## Verification

The acceptance suite covers canonicalization, deterministic checksums, v3 envelopes, tamper detection, CRUD, namespace and age guards, migration, disposal, snapshot clamping/whitelisting and restore callbacks. CI also generates a deterministic 4096-case save contract corpus and replays it byte-for-byte.
