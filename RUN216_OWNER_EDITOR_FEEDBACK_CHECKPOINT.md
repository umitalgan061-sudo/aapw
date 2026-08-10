# Run216 Owner Editor Feedback Checkpoint

Status: **NOT DONE** — source-level additive implementation is published on `agent/run216-owner-editor-usability-fixes`, but hosted browser/console/PWA/perf proof is still required before promotion.

Base candidate: `agent/run216-latest-editor-candidate` at `1079f12fc51435ff4c6eb464d277f3dbaca16066`.

Owner feedback addressed in this stacked branch:

1. Keep TransformControls arrows while removing the moving blue/grid ground base in the live editor.
2. Make oversized assets such as the black dragon shrinkable below the legacy `0.01` Inspector floor, down to the existing `0.001` safety minimum.
3. Expose `assets/models/fbx_dosyaları` through a lazy FBX library instead of requiring every file to be hard-coded in `editorAssetLibrary.js`; when HTTP directory listing is unavailable, allow explicit browser folder binding without reading the entire multi-gigabyte folder into memory.
4. In the live editor, render the existing water material only over terrain sampled below sea level, instead of showing the global water plane through/under dry land. This is intentionally editor-scoped until the separate full-runtime hydrology/road integration DoD is satisfied.

Published commits:

- `3a1199f7c6d9f0fe0fea213087ed8e23bea0ea74` — moving grid base hidden and independent capture-phase `0.001` scale override wired (`+42/-0`).
- `dd2f2ceb603b8590557d6e6be4ead1757595f7c7` — HTTP/folder-picker FBX indexing and double-click lazy loading (`+213/-0`).
- `ea4a51d3ff0ceaac3cd0c9f4d57d8b09ee6ef29d` — deterministic 256x256 ground-height water mask applied to the editor water shader (`+46/-0`).
- `69538a4d177ec0e39e655346a4e2238ab78985a1` — static source/regression contract (`+40/-0`).

Validation completed in the current tool environment:

- New inline grid/scale module: `node --check` PASS.
- New inline lazy-FBX module: `node --check` PASS.
- New inline terrain-water-mask module: `node --check` PASS.
- `scripts/checkRun216OwnerEditorFeedbackContract.js`: `node --check` PASS.
- Existing `EditorTransformControls.js` inspected: scale snap is explicitly disabled after synchronization (`setScaleSnap(null)`), so the owner-visible scale block is not a TransformControls 0.1 snap floor.
- Concurrency recheck: `main` remained `4aa0d2a04ed23502ec3250ecec1ba4a07eb4dc7f`; PR #96 remained `ea8b2b8889b7fe24a4aee78d3a921574d6b80bd1`; latest editor candidate remained `1079f12fc51435ff4c6eb464d277f3dbaca16066` while these fixes were authored.

Performance / memory bounds introduced by this branch:

- Water mask generation performs 65,536 deterministic ground-height samples once at editor initialization and stores a 65,536-byte single-channel mask texture before GPU/driver overhead.
- Local FBX folder binding retains browser `File` references and indexes names/relative paths; model bytes are read only for the FBX the owner opens. Asset list rendering is capped to 500 visible filtered entries and project directory crawling is capped at 10,000 FBX files / depth 8.

Known debt / remaining gates:

- No claim of browser DoD yet: real Chromium desktop/mobile visual proof, zero-console-error proof, and interaction proof are pending.
- No claim of performance DoD yet: actual frame-time/GPU measurements on the full editor world are pending.
- Run216 service-worker materializer knows the editor scale/TransformControls modules, while committed `service-worker.js` is intentionally still unmaterialized; fresh-install offline proof must follow the established materialization pipeline before PWA DONE.
- Browser-selected local FBX files are session-local capabilities. Scene persistence across a fresh browser restart needs a reconnect/rehydration contract before local-picked FBX placements can be considered fully portable.
- The water mask is deliberately editor-only. Gameplay/full-reference water adoption remains a separate high-impact integration and must preserve the already-approved medieval bridge road/water policy.

Additional owner-visible black-dragon fallback proof:

- `d773668470b3e7e9e730781cb4a2b89e2c6a2a44` adds a standalone `×0.1 Küçült` toolbar action without changing existing TransformControls lines (`+27/-0`). It scales the selected non-instanced object relatively by 0.1 on all axes and keeps the `0.001` safety floor.
- Quick-shrink delta `node --check`: PASS. Mock DOM/API behavior harness: PASS for `1.0 -> 0.1`, sub-0.01 values, `0.001` floor, Inspector refresh and transform selection synchronization.
- Existing `scripts/checkRun216ScaleInputBehaviorNode20.cjs` executed against the branch controller: PASS for `0.0002 -> 0.001` clamp, `0.007` precision, blank-input safety and cleanup.
- `scripts/materializeRun216ServiceWorkerCache.js --self-test`: PASS for prepend-only/idempotent cache materialization; this does not replace the still-pending fresh-install browser PWA proof.
- GitHub-hosted PR checks remain infrastructure-blocked before job steps: sampled Authoring Contract, Live World and Editor Usability Contract jobs all reported `steps=null`; therefore the branch remains **NOT DONE** rather than treating those workflow failures as source-test failures.
