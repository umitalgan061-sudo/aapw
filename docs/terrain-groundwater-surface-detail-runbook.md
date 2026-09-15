# Terrain Groundwater Surface Detail Operations Runbook

## 1. Purpose

This runbook describes how to review, test, tune and merge the groundwater-driven surface detail stage.
The stage exists to improve small-scale terrain material realism without changing the canonical world.
The stage is deterministic and render-only.
The stage is additive to the existing terrain stack.
The stage does not become a new water simulation.
The stage does not create geometry.
The stage does not move geometry.
The stage does not edit colliders.
The stage does not edit vegetation placement.
The stage does not edit navigation.

## 2. Start-of-turn check

Read the current `main` ref before changing code.
Record the exact main commit SHA.
Create a fresh branch from that SHA.
Do not reuse a stale terrain branch.
Do not merge against an older merge-base.
Record the focused surface-detail scope.
Record the expected meaningful-change target.
Keep production code, QA code and documentation separated by purpose.
Do not add artificial repeated text solely to satisfy a turn target.
Prefer reusable code over one-off test fixtures.
Prefer concrete QA cases over vague TODO statements.

## 3. Source-of-truth map

`terrainGroundwaterRegime.js` owns groundwater state.
`terrainGroundwaterSurfaceAdapter.js` owns its existing surface-material adapter.
`terrainGroundwaterMaterialStack.js` owns the existing groundwater material stack.
`terrainGroundwaterSurfaceDetail.js` owns detail channels.
`terrainGroundwaterSurfaceDetailShader.js` owns fragment shader hooks.
`terrainGroundwaterSurfaceDetailStack.js` owns detail-stage composition.
`terrainGroundwaterSurfaceDetailCalibration.js` owns authored response factors.
`terrainGroundwaterSurfaceDetailPresets.js` owns environment presets.
`terrainGroundwaterSurfaceDetailDiagnostics.js` owns diagnostic aggregation.
Fixture modules remain test-only.
Scenario catalogs remain test-oriented.
Documentation does not execute in production.

## 4. Required invariants

The detail policy must report `renderOnly: true`.
The detail policy must report `deterministic: true`.
Canonical height must remain unchanged.
Canonical hydrology must remain unchanged.
Canonical coastline must remain unchanged.
Canonical collider must remain unchanged.
Canonical vegetation placement must remain unchanged.
New geography must remain false.
The shader must remain fragment-only.
The shader must not write vertex position.
The shader must not write terrain height.
The shader must not write hydrology topology.
The material response must remain bounded.
The event response must remain bounded.

## 5. Normal execution path

Resolve the groundwater state.
Resolve the detail channels.
Resolve the material response.
Optionally apply a detail event.
Optionally compose through the detail stack.
Generate telemetry.
Generate diagnostic report when needed.
Run focused tests.
Review the diff.
Check current-main ancestry.
Only then open or update the pull request.

## 6. Detail channel debugging

Start with `surfaceConfidence`.
If confidence is unexpectedly low, inspect the sample fields.
Inspect `waterTableProximity` before interpreting the wet rim.
Inspect `capillaryRise` before interpreting capillary dampness.
Inspect `seepageFace` before interpreting seepage darkening.
Inspect `puddlePersistence` before interpreting puddle core.
Inspect `mineralMobilization.saltRing` before interpreting mineral crust.
Inspect `mineralMobilization.fineTransport` before interpreting fine sediment film.
Inspect `saturationMemory` before interpreting recovery halo.
Inspect freeze stress before interpreting freeze-wet edge.
Inspect marsh edge state before interpreting marsh transition.
Inspect drying resistance before interpreting drying contrast.
Inspect final field channels only after checking source state.

## 7. Wet-rim troubleshooting

A missing wet rim is not automatically a missing water body.
Check surface-film strength.
Check groundwater proximity.
Check puddle persistence.
Check local field contribution.
Check the final rim transfer function.
Check whether the sample is already in the saturated core range.
Check the material weight.
Check whether the shader stage is installed.
Check the material cache key.
Do not fix a visual issue by moving terrain vertices.
Do not fix a visual issue by adding new water geometry inside the detail module.

## 8. Capillary troubleshooting

Check permeability normalization.
Check capillary-rise output from groundwater.
Check drying resistance.
Check current moisture.
Check slope suppression.
Check calibration factors when a preset is applied.
Do not use capillary dampness as a biome switch.
Do not persist capillary state inside the detail object.
Recompute from authored input.
Confirm identical inputs produce identical output.

## 9. Seepage troubleshooting

Check seepage-face strength.
Check the slope band.
Check current surface saturation.
Check the local field.
Check whether the material is too dark globally.
Check whether the visual band is being mistaken for a stream.
Keep the seepage response material-only.
Do not write flow connectivity.
Do not write runoff topology.
Do not spawn a stream object.

## 10. Puddle troubleshooting

Check slope first.
Check film second.
Check persistence third.
Check drainage fourth.
Check water-table proximity fifth.
Check local contrast.
Check puddle core versus puddle edge.
The center should not become opaque water by default.
The edge should remain a material boundary.
The stage does not define a water-volume field.
The stage does not own standing-water simulation.

## 11. Drying troubleshooting

Check drying resistance.
Check evaporation front.
Check temperature.
Check wind exposure in the groundwater source sample.
Check dry history.
Check recovery halo.
Check mineral salt ring.
A dry appearance does not imply soil mass loss.
A dry appearance does not imply terrain deformation.
A dry appearance does not imply biome reassignment.
Keep the effect bounded.

## 12. Mineral crust troubleshooting

Check salt-ring state.
Check seepage state.
Check drying demand.
Check surface slope.
Check calibration profile.
Check coastal preset where relevant.
Crust should read as a material residue.
Crust should not look like raised geometry.
Crust should not become a new texture atlas dependency.
Crust should remain subtle.

## 13. Fine sediment troubleshooting

Check fine transport in groundwater state.
Check surface film.
Check runoff.
Compare with the existing terrain sediment layer.
The groundwater detail layer must remain subordinate.
Do not duplicate sediment authority.
Do not create a second sediment mass inventory.
Do not write sediment into terrain geometry.
Use the channel for material presentation.

## 14. Recovery troubleshooting

Check saturation memory.
Check drying resistance.
Check film.
Compare before and after a dry event.
Recovery should be gradual.
Recovery should not jump from zero to full wetness.
Recovery should remain deterministic.
Recovery should not create hidden mutable state.
Recovery can be blended across tile boundaries.
Recovery can be represented in diagnostics.

## 15. Freeze-wet edge troubleshooting

Check freeze stress.
Check surface saturation.
Check current temperature.
Inspect the event delta.
Confirm the normal response remains below the policy budget.
Confirm roughness stays in range.
Do not create ice meshes here.
Do not alter terrain geometry here.
Keep frozen appearance subordinate to authored materials.

## 16. Marsh-transition troubleshooting

Check marsh-edge factor from groundwater state.
Check surface saturation.
Check height.
Check biome context.
The detail layer may soften a material boundary.
It must not overwrite biome taxonomy.
It must not move vegetation.
It must not add wetland geometry.
It must remain render-only.

## 17. Confidence troubleshooting

Complete samples should produce a stable confidence value.
Sparse samples should remain finite.
Malformed samples should remain finite.
Unknown fields must not produce NaN.
Confidence is diagnostics, not a physics quality score.
Confidence can control render tier.
Confidence cannot authorize geometry mutation.
Confidence cannot bypass the canonical ownership gate.

## 18. Calibration workflow

Resolve a profile using biome and substrate.
Prefer exact matches.
Use biome fallback only when exact substrate is not present.
Use the safe temperate fallback for unknown combinations.
Audit calibration factors before large batches.
Keep factors inside the policy range.
Use calibration signatures for deterministic regression.
Do not use calibration to modify terrain topology.
Do not use calibration as a second weather solver.
Document new profile IDs.

## 19. Preset workflow

Pick a preset by explicit ID when a visual test requires repeatability.
Use environment lookup for broad integration tests.
Use the returned calibration profile.
Pass `detailWeight` deliberately.
Pass `localContrast` deliberately.
Keep event bias metadata available for callers.
Do not hide preset selection in random branches.
Keep preset objects immutable.
Audit duplicate IDs.
Audit numeric bounds.

## 20. Shader install workflow

Start with a material instance.
Call the detail shader installer once.
Confirm the userData marker.
Confirm the custom program cache key changes.
Confirm `needsUpdate` is true.
Compile through the existing terrain material path when browser testing.
Use the source-level shader invariant report first.
Confirm the common include receives helpers.
Confirm color receives the detail hook.
Confirm roughness receives the detail hook.
Confirm normal receives the detail hook.
Never add a vertex-position hook for this feature.

## 21. Shader failure triage

If color changes are missing, inspect the color include replacement.
If roughness changes are missing, inspect the roughness-map include replacement.
If normal changes are missing, inspect the normal-map include replacement.
If a shader compile fails, inspect helper names for collisions.
If output is too noisy, reduce detail weighting rather than increasing octave counts.
If output is too dark, inspect wet and crust accumulation.
If output is too flat, inspect normal budget.
If shader cost increases unexpectedly, keep the fixed octave count.
Do not add dynamic loops based on world data.

## 22. Stack workflow

Resolve the groundwater stack frame first.
Resolve the detail frame second.
Blend detail into the material response.
Preserve the final material budget.
Keep stack order explicit.
Keep stack policy IDs explicit.
Run stack audit.
Run stack health.
Run stack statistics for batches.
Use event facade for transient presentation.
Do not make the detail stack a new source of world topology.

## 23. Diagnostic workflow

Run a quick check while developing.
Run full diagnostic reports before PR review.
Inspect channel report.
Inspect canonical report.
Inspect climate report.
Inspect hydro report.
Inspect classification report.
Inspect render report.
Inspect signature report.
Inspect identity report.
Inspect shader report.
Inspect calibration report.
Inspect preset report.
Inspect stack report.
Inspect determinism report.

## 24. Fixture workflow

Use lowland fixtures for shallow-table cases.
Use upland fixtures for deep-table cases.
Use transition fixtures for event boundaries.
Use scenario catalog for broad environment diversity.
Keep fixtures immutable.
Keep fixture IDs unique.
Keep fixtures out of production imports.
Add a fixture when a real regression is discovered.
Do not duplicate identical fixtures.
Use fixture names that expose the environmental intent.

## 25. Focused test order

Run the ownership guard first.
Run the base acceptance suite second.
Run metamorphic checks third.
Run stack integration fourth.
Run calibration and preset audits fifth.
Run diagnostic checks sixth.
Run static shader checks seventh.
Run `git diff --check` last.
Record the exact outputs.
Separate focused failures from repo-global infrastructure failures.

## 26. Browser validation

The focused Node suite validates pure functions and shader source contracts.
A browser smoke test remains necessary for actual WebGL compilation.
The browser path should confirm the 3D mode still loads.
The browser path should confirm the terrain material still compiles.
The browser path should confirm no asset manifest regression.
The browser path should confirm PWA shell remains available.
If a browser environment is blocked by an existing infrastructure issue, record the blocker explicitly.
Do not claim browser green without a real run.
Do not use headless-only evidence as proof of physical-device performance.

## 27. Diff review

Check additions by file.
Check deletions by file.
Check that no canonical geometry file changed unexpectedly.
Check that no hydrology owner changed unexpectedly.
Check that no vegetation placement owner changed unexpectedly.
Check that workflow paths are targeted.
Check that test-only fixtures stay out of runtime imports.
Check policy IDs.
Check module export names.
Check unused imports.
Check accidental duplicate files.

## 28. Merge gate

The branch must be based on current main.
The branch must not be behind main.
The focused suite must pass.
The shader report must pass.
The ownership guard must pass.
The stack audit must pass.
The diff must have at least 4,000 meaningful additions/changes for this autonomous turn.
Meaningful means real production behavior, tests, integration, diagnostics or documentation supporting the feature.
Artificial padding is not an acceptable substitute.
The PR must accurately describe any unresolved global infrastructure failures.
Only after these checks may the PR be merged.

## 29. Post-merge verification

Read the PR metadata.
Confirm `merged: true`.
Record the merge commit SHA.
Fetch the merge commit.
Check the commit diff summary.
Check workflow runs associated with the merge commit.
Check combined status.
Confirm the merged branch no longer contains stale ancestry.
Confirm the main ref advanced to the merge commit or a subsequent fast-forward commit.

## 30. Troubleshooting stale ancestry

If main advances while the branch is under development, stop before merging.
Create a fresh branch from the new main SHA.
Copy only validated feature blobs.
Create one commit on the fresh branch.
Re-run focused tests.
Re-run diff measurement.
Re-check the 4,000 meaningful-line threshold against the new base.
Do not merge a branch that is behind main merely because its own CI is green.

## 31. Troubleshooting failing tests

Start from the narrowest failing test.
Confirm whether the failure is API mismatch, bounds failure, determinism failure, or ownership failure.
Fix the production or test contract rather than hiding the failure.
Rerun the narrow test.
Rerun the relevant suite.
Only then continue expanding scope.
Keep old failure explanations in PR notes when useful.
Do not replace a failing gate with a weaker gate without documenting why.

## 32. Troubleshooting schema drift

Compare current exported names with the call site.
Fetch the current source file instead of assuming an older signature.
Use exact function names from current main.
Verify object shape before composing derived data.
Prefer thin compatibility wrappers when external callers need stability.
Do not silently alias incompatible policies.
Keep sourcePolicyId explicit.
Keep policy IDs versioned.

## 33. Performance review

Prefer pure arithmetic in CPU helpers.
Keep detail grids capped.
Keep batch helpers linear.
Keep shader octave count fixed.
Avoid per-frame material creation.
Install shader hooks idempotently.
Use material cache keys for policy invalidation.
Keep diagnostics out of the hot render path.
Keep fixture imports test-only.
Avoid expensive reflection in fragment shaders.

## 34. Visual review checklist

Wet patches should have readable edges.
Wet centers should remain material-like unless the existing stack explicitly supplies water.
Seepage should read as damp mineral surface.
Crust should read as residue.
Fine sediment should remain subordinate.
Drying should not erase biome color.
Freeze edges should not look like geometry cracks.
Marsh transitions should remain soft.
Normal detail should remain subtle.
The whole layer should look like a surface response, not a new terrain system.

## 35. Documentation review

Every new policy ID should be documented.
Every new channel should be documented.
Every new public export should have a clear purpose.
Every shader boundary should be documented.
Every canonical invariant should be documented.
Every new regression script should be listed in the workflow.
Every new fixture corpus should explain its environmental coverage.
Every calibration family should have a known purpose.
Every merge gate should be reproducible.

## 36. Release notes content

Describe the visual feature.
Describe the render-only boundary.
Describe the deterministic guarantee.
Describe the focused tests.
Describe the shader contract.
Describe the stack integration.
Describe any infrastructure limitations separately.
Record the merge commit.
Record the policy IDs.
Avoid claiming physical simulation where only presentation exists.

## 37. Incident response

If terrain height changes unexpectedly, treat as a canonical ownership incident.
If hydrology topology changes unexpectedly, treat as a canonical ownership incident.
If collider output changes unexpectedly, treat as a canonical ownership incident.
If vegetation placement changes unexpectedly, treat as a canonical ownership incident.
If shader compilation fails, treat as a shader integration incident.
If channels exceed bounds, treat as a numerical safety incident.
If signatures differ for identical inputs, treat as a determinism incident.
If the branch becomes stale, treat as an ancestry incident.
If global CI fails for unrelated infrastructure reasons, record but do not mislabel as a detail regression.

## 38. Operational commands

`node scripts/checkTerrainGroundwaterSurfaceDetailAcceptanceV2.mjs`

`node scripts/checkTerrainGroundwaterSurfaceDetailMetamorphic.mjs`

`node scripts/checkTerrainGroundwaterSurfaceDetailNoMutation.mjs`

`node scripts/checkTerrainGroundwaterSurfaceDetailIntegration.mjs`

`git diff --check`

Use the repository's existing browser smoke command only when the environment is available.
Use the repository's existing mobile/performance gates when the feature affects their scope.

## 39. Ownership questions

Which file owns the authoritative height?
Which file owns hydrology topology?
Which file owns groundwater state?
Which file owns surface detail?
Which file owns shader installation?
Which file owns material stacking?
Which file owns calibration?
Which file owns diagnostics?
Which files are test-only?
Which workflows enforce focused regression?

## 40. Turn-completion rule

A development turn is incomplete below 4,000 meaningful additions/changes.
When below the threshold, continue investigating and implementing high-priority work in the current feature area.
Do not manufacture padding.
Add production features where they improve the terrain system.
Add tests where they increase regression confidence.
Add diagnostics where they improve failure localization.
Add integration where it reduces ownership ambiguity.
Add documentation where it makes future maintenance safer.
After crossing the threshold, stop adding unrelated scope.
Perform the full review.
Re-check current main.
Open the PR.
Verify focused checks.
Merge only when all merge gates are satisfied.
