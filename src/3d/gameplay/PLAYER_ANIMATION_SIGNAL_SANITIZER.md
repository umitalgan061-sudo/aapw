# Player Animation Signal Sanitizer

The signal sanitizer is the final presentation boundary between deterministic animation policy output and optional effect consumers.

It accepts only the existing descriptive signal vocabulary and returns bounded plain objects.

## Why this layer exists

Presentation callbacks can be supplied by browser, HUD, audio, VFX or debug consumers.

Those consumers should not need to trust every field passed by a caller.

The sanitizer provides a single fail-soft boundary without creating another event system.

## Guarantees

Unknown signal types become `presentation-warning` signals.

Sequence numbers and timestamps are normalized to finite non-negative values.

Footstep intensity is clamped to `[0, 1]`.

Footstep phase is normalized to `[0, 1)`.

Text-like fields are length bounded.

Signal batches are capped at eight by default.

Expired signals can be filtered using a bounded lifetime.

Packets expose counts as well as the sanitized list for cheap diagnostics.

## Non-goals

The sanitizer does not play audio.

It does not create particles.

It does not spawn decals.

It does not instantiate Three.js objects.

It does not dispatch through a global bus.

It does not write to player state.

It does not select animation assets.

## Consumer rule

Consumers should treat the packet as read-only presentation data.

They must not use it as a source of truth for gameplay state.

For example, a footstep signal can drive an optional sound effect, but the signal must never decide whether the player is actually grounded.

## Validation

The dedicated Node regression exercises malformed types, malformed numbers, text bounds, batch bounds, lifetime filtering, packet counts, classification helpers and deterministic repeated serialization.
