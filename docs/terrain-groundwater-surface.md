# Terrain groundwater surface

This round introduces a deterministic, render-only groundwater response layer.

## Scope

The layer estimates a shallow water-table signal, recharge, capillary rise, seepage, spring emergence and wet-surface response from existing terrain samples.

It does not alter terrain height, hydrology topology, coastline, colliders or vegetation placement.

## Inputs

World-space coordinates are used only to derive stable micro-variation.

Elevation controls lowland and highland water-table tendencies.

Slope controls infiltration retention and the transition from retained recharge to surface runoff.

Moisture and rainfall drive seasonal recharge.

Soil depth controls the amount of rainfall that can be retained before runoff dominates.

Vegetation cover contributes a small interception term rather than creating new water sources.

Substrate controls storage, permeability, capillary response, fracture preference and moisture retention.

Water distance is treated as an existing contextual signal and is never used to author new water geometry.

Confidence is propagated to spring-source confidence for downstream consumers.

## Substrate interpretation

Granite is storage-limited with moderate fracture response.

Limestone has stronger permeability and fracture-driven spring potential.

Sandstone provides high infiltration with moderate storage.

Shale retains moisture and supports perched-water behavior while limiting rapid vertical permeability.

Schist favors fractured seepage without assuming a new channel.

Clay stores water but strongly suppresses permeability.

Silt provides moderate permeability with high capillary behavior.

Sand favors rapid infiltration and a lower capillary band.

Gravel has the highest permeability and weakest capillary response.

Peat retains moisture strongly and sustains high capillary rise.

Alluvium balances storage, permeability and retention.

Colluvium provides mixed slope-foot behavior.

Tuff uses moderate fracture and lower permeability.

Mudstone behaves as a high-retention low-permeability substrate.

Marl provides intermediate permeability and capillary response.

Chalk favors permeable fractured pathways.

## Water-table model

The water table is expressed as a depth below the sampled terrain surface.

The default depth range is 2 to 84 metres.

Higher recharge and higher storage move the table upward.

Steeper terrain reduces retained recharge and increases surface runoff pressure.

Lowland elevation contributes a bounded shallow-water bias.

Distance from existing water weakens the contextual wetness term but does not erase groundwater entirely.

## Seepage

Seepage combines capillary rise, substrate fractures and perched-water retention.

Fractured substrates can expose a seepage response without requiring a new river or spring mesh.

The seepage signal is clamped to [0,1] before material composition.

The path-bias signal is intentionally weak so it can guide shading without becoming a topology generator.

## Springs

Spring emergence requires a combination of seepage, fracture response, gentle terrain and lowland bias.

Spring flow is a presentation signal.

It must not be treated as a source of canonical hydrology edits by consumers.

## Material response

Wetness reduces roughness.

Sheen increases the blue-green contribution only subtly.

Mud response increases where low-permeability wet substrates retain water near the surface.

Seepage increases a bounded waterline blend.

Normal energy remains low so the layer cannot produce visible terrain displacement.

## Determinism

The coordinate noise uses integer hashing and smooth interpolation.

No time, random device state, locale or mutable singleton is required.

The same input object produces the same signature.

## Integration boundary

`terrainGroundwaterSurfaceHook.js` exposes a thin adapter for runtime consumers.

Telemetry is written to user-data objects only when explicitly requested.

The hook exposes both the legacy experimental installer and the validated v2 installer, while naming v2 as the active policy.

## QA contract

Every groundwater state must expose recharge, water table, capillary, seepage, spring and surface sections.

All normalized response fields remain bounded.

Canonical terrain boundaries remain true.

Determinism checks compare signatures generated from equivalent input objects.

Slope regressions verify that steep terrain retains less water than flat terrain under identical rainfall.

Substrate regressions verify that different permeability profiles produce materially different water-table behavior.

## Future consumers

Vegetation can use the wetness blend as a shading hint without changing placement authority.

Ground decals can use waterlineBlend for existing water-adjacent areas.

Audio can use spring emergence and seepage as presentation intensity only.

Seasonal climate can feed rainfall and moisture without creating a second climate authority.

## Non-goals

This module does not solve full groundwater PDE simulation.

It does not create new rivers.

It does not rewrite navigation.

It does not deform terrain.

It does not move settlement or vegetation anchors.
