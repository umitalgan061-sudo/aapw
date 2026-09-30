# Immersive Spatial Audio Platform

## What changed

AAPW's original 3D audio layer contained two real WAV-backed UI cues. The new audio platform keeps those
legacy cues intact and adds a production-oriented, bounded soundscape layer built around Web Audio policy.
It is designed for the current world architecture: player, NPCs, animals, procedural creatures, dragons,
water, weather, settlements and day/night already exist as independent authorities.

The audio layer therefore consumes state rather than generating it.

## Runtime graph

```text
Existing game state / EventBus
          |
          v
   audioEventCueMap
          |
          v
   AudioCueScheduler  ----->  audioAccessibilityPolicy
          |                         |
          v                         v
  spatialAudioRegistry       audioMixEngine
          |                         |
          +------------+------------+
                       v
              immersiveAudioPolicy
                       |
          +------------+------------+
          |            |            |
          v            v            v
 spatial panner    occlusion     duck bus
 adapter           policy        policy
          |            |            |
          +------------+------------+
                       v
              ImmersiveAudioDirector
                       |
          +------------+------------+
          |            |            |
          v            v            v
   procedural bank  soundscape   snapshots
          |
          v
 Existing AudioListener / browser Web Audio
```

## Core principles

### Bounded voices

Every quality level has explicit maximum source, positional-source and oscillator budgets. Source
admission is priority-driven and distance-aware. Far or low-priority sources can be virtualized rather
than allocating another node. The registry also keeps a hard upper bound so a content bug cannot create an
unbounded audio graph.

### Spatialization

The spatial policy uses inverse-distance attenuation and HRTF when supported by the adapter. Listener pose
is fed from the existing camera/player state. PannerNode creation is isolated inside `spatialPannerAdapter.js`
so the rest of the audio code remains testable without a browser.

### Geometry-aware occlusion

World/camera code remains responsible for ray queries. It can pass a compact observation such as
"two stone surfaces, roughly four metres total thickness." `audioOcclusionPolicy.js` transforms that into
volume reduction, a low-pass cutoff and reverb-send guidance. The policy can be smoothed over the same
frame delta as the existing tick loop.

### Environmental soundscape

The soundscape accepts an explicit environment enum (`plains`, `forest`, `coast`, `river`, `mountain`,
`settlement`, `castle`, `ice`, `night`, `storm`) and state scalars for night, wind, storm and water
proximity. It then transitions a small set of reusable procedural layers: wind, water, rain, fire and
ambience.

No new binary audio package is required. The procedural bank generates deterministic noise and oscillator
content. This keeps the repository lightweight and avoids introducing new third-party sound licenses.

### Dynamic range

`audioDuckBus.js` gives critical channels explicit precedence. Dialogue, UI and combat can duck weather,
water and general ambience. The bus advances from the existing simulation delta; it does not create timers.
This makes menu/dialogue readability more predictable while keeping the world active underneath.

### Accessibility

`audioAccessibilityPolicy.js` introduces independent hearing controls. Reduced dynamic range can increase
compression, transient softening can reduce abrupt peaks, mono-center can reduce spatial dependence, and a
small speech-band emphasis can improve dialogue intelligibility. These controls are separate from the
project's visual reduced-motion setting.

### Focus behavior

`audioFocusManager.js` describes playing, menu, background, debug and recovery mix states. Existing UI or
lifecycle owners can advance the policy and apply the target gains to their own nodes.

### Offline and failure behavior

The audio facade is fail-closed. When Web Audio is missing, the immersive director becomes an inert
snapshot and the established UI WAV cues still follow their existing error boundary. Procedural nodes are
tracked and disposed. Spatial panner creation returns an inert result instead of throwing when an older or
restricted browser lacks an expected API.

## Procedural sound design

The sound bank uses a deterministic xorshift-style recurrence for noise buffers. This is not a crypto
source and is not exposed as a world random source. Because the seed and recurrence are stable, tests can
assert buffer generation parameters without depending on a particular browser oscillator implementation.

The bank exposes broad sound classes rather than individual content assets:

| Class | Role | Typical trigger |
|---|---|---|
| wind | atmospheric bed | environment + weather |
| water | stream/coast bed | environment + water proximity |
| rain | storm layer | weather event |
| fire | settlement/castle layer | environment |
| ambience | low-level environmental bed | general world |
| dragon | iconic creature pulse | dragon event |
| footstep | player locomotion cue | player event |
| combat | high-priority transient | combat event |
| UI | interface accent | pause/interaction |

These classes can later be remapped to authored assets without changing the policy APIs.

## Event model

`audioEventCueMap.js` provides canonical cue identities and priorities. It intentionally does not subscribe
to EventBus. A gameplay owner can call `buildAudioCueRequest()` when it already knows an event occurred,
which keeps event ownership and audio ownership separate.

`audioCueScheduler.js` then provides duplicate suppression and cooldowns. A rapid stream of footsteps,
combat hits or weather events can therefore be admitted in a deterministic order without a timer or a
background scheduler.

## Diagnostics

`audioSnapshot.js` serializes policy state only: quality, listener pose, soundscape values, ducking,
accessibility and a bounded set of source metadata. Web Audio node graphs are not serialized. The digest is
stable, making it useful for acceptance tests and future support tooling.

## Integration boundary

The existing `audioManager.js` remains the single owner of the `AudioListener` and the legacy click/chime
API. The new methods are additive:

- `update(delta, world)` advances the immersive director.
- `setEnvironment(environment, state)` updates the soundscape.
- `registerSpatialSource`, `updateSpatialSource`, `removeSpatialSource` manage abstract world sources.
- `setAudioDuck` and `clearAudioDuck` manage foreground precedence.
- `applyAudioOcclusion` consumes caller-supplied geometry observations.
- `playWorldCue` handles iconic world pulses.
- `getImmersiveSnapshot`, `getAudioSnapshot` and `getAudioSnapshotJson` expose safe diagnostics.

Existing callers of `playClick`, `playDiscoveryChime`, `setMuted`, `isMuted` and `dispose` remain valid.

## Verification gates

The focused suite is `scripts/checkImmersiveAudioPlatform.mjs`.

The generated property matrix is `scripts/checkImmersiveAudioPropertyMatrix.mjs` and sweeps quality tiers,
environments, distances and source classes while checking attenuation, allocation and accessibility
bounds.

`checkImmersiveAudioAdvanced.mjs` exercises the mix engine, focus manager, room reverb, panner adapter,
event cue mapping and snapshot serialization with fake Web Audio nodes.

`checkImmersiveAudioSourceBoundaries.mjs` guards against random sources, wall-clock ownership, timers,
network calls, persistence mutation and scene mutation in the audio package, while enforcing the project's
600-line source-file discipline.

The intended GitHub Actions job uses Node 22, syntax checks, all focused audio suites, boundary checks and
git diff hygiene.

## Future extension path

The architecture intentionally leaves space for authored asset libraries, convolution IRs, voice chat,
localized dialogue, music state machines and adaptive loudness calibration. None of those require changing
the source registry or priority model. They can plug into the same bounded source, mix and snapshot
contracts while preserving the project's existing subsystem ownership boundaries.
