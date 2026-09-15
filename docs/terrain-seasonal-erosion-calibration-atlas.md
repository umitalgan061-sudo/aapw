# Seasonal erosion calibration atlas

This atlas is the human-readable companion to the seasonal erosion profile, runtime and diagnostic contracts. It records the intended visual behavior for the primary climate families so tuning changes can be reviewed without reading implementation code.

## Reading the atlas

Each climate is reviewed through spring, summer, autumn and winter. Every seasonal note addresses five dimensions: moisture state, dominant forcing, likely micro-relief cue, expected material direction and the canonical-world boundary.

The notes are intentionally qualitative. Numeric calibration remains in the source profile tables. The atlas exists to prevent a numeric tuning change from quietly reversing the visual intent of a climate family.

## Global acceptance rules

1. Seasonal erosion is render-only.
2. World-space coordinates remain the source of deterministic micro-patterning.
3. Day-of-year is normalized into the authored 360-day cycle.
4. Climate determines the baseline profile family.
5. Substrate modifies erosion and freeze-thaw response without creating new geology.
6. Moisture history changes material response gradually.
7. Snowmelt can increase runoff pulse but cannot create water geometry.
8. Freeze-thaw can increase roughness and normal strength but cannot move vertices.
9. Wind exposure can increase drying and dust retention but cannot move vegetation.
10. Dry crust is a material cue, not a physical terrain layer.
11. Event ranking is diagnostic and deterministic.
12. Cache keys must change when material-relevant seasonal inputs change.
13. Repeated identical inputs must return identical scalar and material results.
14. Consecutive seasonal samples should remain visually continuous.
15. Focused regression failures block the feature merge even when unrelated repository checks are red.

## Subarctic

### Spring

Moisture is high because frozen ground begins to thaw while snowmelt remains active. The dominant visual event should normally be snowmelt or freeze-thaw rather than summer-style drying.

Schist and shale should retain stronger frost wear than granite and basalt. The visual difference should come from roughness and normal modulation, not changed silhouette.

Snowmelt should brighten low-slope wet pockets and create a modest darkened wet-fine cue in basins. The runoff pulse is an input to material blending only.

The seasonal age should remain moderate. A spring sample should not look like an entire year's accumulated erosion after a single day.

### Summer

Summer remains cool relative to temperate climates. Moisture can decline, but strong drying is reserved for unusually exposed or rain-shadowed cells.

Fine sediment can remain visible in shallow catchments. Wetness should decay slowly through the moisture memory instead of snapping to a dry state.

Wind exposure should sharpen dry ridge material slightly while sheltered terrain keeps higher moisture and moss-retention response.

### Autumn

Autumn restores rainfall pressure while the temperature signal begins to fall. The material should move from drying toward wetting without a hard boundary at the seasonal day transition.

Frost wear should increase near the end of autumn where humidity is high and temperature approaches freezing.

### Winter

Winter can be dominated by freeze-thaw and snowpack. The coldest cells should show higher frost response while wind-exposed ridges can suppress surface moisture.

The intended appearance is roughened and cold, not geometry deformation. The base terrain remains authoritative.

## Cold-oceanic

### Spring

Persistent maritime moisture keeps wetness high even when temperatures rise above freezing. Rain should usually outrank drying.

Exposed coastal cells should retain salt-wetness and wind cues. These cues are material-only and should not be confused with new shoreline geometry.

### Summer

Summer remains humid. Drainage and slope determine whether the visual response is wet film or rill concentration.

Steeper slopes should show stronger wash normals while sheltered pockets preserve damp roughness response.

### Autumn

Rainfall remains strong and the surface should rarely become fully dry. Saturation and rain events are expected to dominate the planner.

### Winter

Winter may oscillate between rain and freeze-thaw depending on the temperature sample. The profile should not force snow everywhere simply because the climate is cold-oceanic.

## Temperate

### Spring

Spring is the reference transition season for the runtime. Wetness increases smoothly, runoff wakes up, and frost response fades as temperature rises.

Schist and shale remain more erosion-sensitive than granite and basalt. All response remains micro-scale.

### Summer

Temperate summer balances rain and drying. Low moisture with high wind should expose crust; moderate moisture should preserve a softer soil response.

Rill response should increase with slope. Low-slope basins should be darker and smoother instead of showing artificial channels.

### Autumn

Autumn should move back toward wetter material, particularly on loam, peat, alluvium and floodplain-like substrate profiles.

A single hot autumn sample should not erase the longer-term moisture memory.

### Winter

Temperate winter shows freeze-thaw only where temperatures and moisture overlap. Warm maritime-like winter samples can remain wet without a strong frost cue.

## Mild-oceanic

### Spring

Moisture should dominate over drying. Wind may shape surface roughness but not push the state toward desert-like crust.

### Summer

Mild-oceanic summer remains humid enough for a persistent film response on protected ground. Exposed slopes can still show erosion through runoff concentration.

### Autumn

Autumn is a strong saturation season. Material roughness should decrease slightly where wet film increases, with normal strength retained.

### Winter

Winter is wet rather than uniformly frozen. Snow should be present only where the supplied snow weight and temperature justify it.

## Wet-temperate

### Spring

Waterlogged profiles begin near saturation. The dominant event should be saturation or deposition rather than drying.

Peat and clay should retain moisture longer than gravel. This distinction is a visual memory cue.

### Summer

Summer is still wet relative to dry climates. High canopy should further reduce wind drying and preserve wetness.

### Autumn

Autumn maintains very high moisture. Deposited fine material should appear on low-slope cells without changing canonical hydrology.

### Winter

Winter remains saturated if the supplied moisture state is high. Freeze-thaw can appear in exposed highland variants but should be modest in sheltered wetland cells.

## Dry-temperate

### Spring

Spring should recover from winter drying gradually. Crust should decline rather than vanish immediately after rain.

### Summer

Summer is the strongest drying season. High wind, low humidity and long dry-memory should produce the highest crust values.

Sandstone, granite and limestone should show cleaner dry coloration than mudstone and clay.

### Autumn

Autumn rain should lower crust slowly through the moisture-memory function. Fine material can become muddy before the entire surface loses the dry-season signature.

### Winter

Winter can be cooler but remains relatively dry in the profile family. Crust can persist on exposed ridges while sheltered ground recovers moisture.

## Mediterranean

### Spring

Spring is a shoulder season. Rain should be visible, but the profile retains a relatively strong annual dry bias.

### Summer

Summer is the canonical seasonal-dry case. Dry crust, high wind exposure and low moisture should combine into a clear but restrained material change.

The feature must avoid turning the terrain into a binary orange/brown map. Base material color remains dominant.

### Autumn

Autumn storms should create pulses of erosion on slopes and wet films in basins. A storm should not permanently alter the terrain.

### Winter

Winter rainfall should soften crust and restore moisture. The transition from summer-dry to winter-wet is intentionally gradual.

## Highland

### Spring

Highland spring has strong freeze-thaw potential. Near-freezing temperatures combined with high moisture should increase micro-normal response.

### Summer

Slope and wind become important. Rill response increases with steepness, while sheltered valleys retain more moisture.

### Autumn

Cooling temperatures revive frost wear. Brittle substrates should show the strongest response.

### Winter

Winter is strongly freeze-thaw influenced. Snowpack and frost should both contribute to visual roughness.

## Alpine

### Spring

Spring snowmelt is the principal event. The feature should read as changing snowpack and wet rock, not as a different terrain mesh.

### Summer

Summer can remain snowy at high elevations when supplied snow weight is high. Melt runoff should concentrate on steeper slopes.

### Autumn

Autumn begins refreezing. Frost pockets and brittle-substrate response should intensify.

### Winter

Winter should produce the strongest frost-wear values in the atlas. Talus remains visually coarse, while granite and gneiss remain coherent rock surfaces.

## Volcanic

### Spring

Volcanic surfaces respond primarily through rain, pores, ash and runoff. The profile does not imply active volcanism unless another system explicitly provides that signal.

### Summer

Dry exposed volcanic rock should increase roughness and drying response. Scoria and ash retain more fine material than dense basalt.

### Autumn

Rain and sediment deposition become more visible, especially on ash and tuff.

### Winter

Cold wet volcanic surfaces can show frost response but should remain visually distinct from alpine rock.

## Substrate rules

### Granite

Granite is the baseline coherent rock response. It should show moderate erosion and lower frost amplification than brittle foliated rocks.

### Gneiss

Gneiss remains coherent but can show slightly stronger directional micro-relief than granite.

### Schist

Schist is intentionally brittle. Freeze-thaw and erosion normal strength may be amplified.

### Shale

Shale combines brittle response with weak bedding. It should receive high rill sensitivity when runoff is concentrated.

### Sandstone

Sandstone is permeable and should generally retain less mud than clay-rich substrates. Wind-blown fines can still accumulate in sheltered micro-pockets.

### Mudstone

Mudstone can hold moisture and produce strong rill response. It should not become a new terrain type; only material response changes.

### Limestone

Limestone is moderately jointed and can show both wetness and frost cues. The profile remains more carbonate-like than generic rock.

### Basalt

Basalt is dense and visually stable. Frost and rain still change roughness slightly, but the surface should not look loose.

### Colluvium

Colluvium is already implied by authored world content. The seasonal layer can make its fine accumulation and slope wash more apparent.

### Till

Till is mixed grain material and should keep more persistent moisture than clean gravel while still showing slope wash.

### Loam

Loam is a balanced soil response with organic retention and moderate erosion.

### Alluvium

Alluvium responds strongly to deposition and moisture while retaining fine-grain material cues.

### Peat

Peat is the strongest water-retaining substrate in the atlas. It should be among the least wind-dried responses when canopy and wind inputs are sheltered.

### Marl

Marl is an intermediate carbonate-rich fine substrate. It may form dry crust in hot climates but should not mimic pure clay.

### Clay

Clay responds strongly to saturation and drought history. The visual target is subtle shrink/swell-like roughness and crust rather than geometry deformation.

### Gravel

Gravel drains quickly, so moisture film should be short-lived. Deposition can still add fine material in sheltered pockets.

### Cobble

Cobble is coarse and resistant. Seasonal response should be mostly tonal, with small normal variation.

### Volcanic ash

Volcanic ash is fine and readily receives transported dust. Wetness increases its darker material response.

### Tuff

Tuff is porous and relatively soft. Rain and freeze-thaw may create stronger visual roughness than dense volcanic rock.

### Scoria

Scoria has open pores and can retain dust while remaining dry on exposed surfaces.

### Andesite

Andesite is intermediate between dense basalt and softer tuff. Seasonal response should remain moderate.

### Rhyolite

Rhyolite should behave as coherent volcanic rock with slightly higher roughness variability than basalt.

### Obsidian

Obsidian is intentionally resistant and dark. Seasonal changes are restrained to avoid destroying its material identity.

### Lahar

Lahar is fine, mixed volcanic sediment. Saturation and runoff should both remain visible.

### Talus

Talus is the coarsest alpine response. It should show deposition and frost without smoothing away its coarse character.

## Event review matrix

### Snowmelt

Expected climates: subarctic, highland, alpine, with cold-oceanic as a secondary case. Strength increases with snowpack, thaw and slope.

Material response: slightly wetter/darker low points, small roughness change, restrained normal boost.

Boundary: no new rivers, no changed collision and no vertex motion.

### Freeze-thaw

Expected climates: subarctic, highland, alpine, temperate shoulder seasons. Strength increases near freezing and on brittle substrates.

Material response: roughness and normal strength increase, with cold tone remaining subtle.

### Storm-runoff

Expected climates: oceanic, mediterranean autumn, wet-temperate and steep temperate slopes.

Material response: localized erosion tone and stronger channel micro-normal.

### Saturation

Expected climates: wet-temperate, oceanic, marsh and river-margin inputs.

Material response: lower roughness and muted albedo in wet films.

### Drying

Expected climates: dry-temperate and mediterranean summer.

Material response: higher roughness and dry-crust tone, with moisture memory preventing a one-frame flip.

### Dust-deposition

Expected climates: dry and exposed families, plus volcanic ash/tuff profiles.

Material response: restrained albedo shift and roughness increase.

### Crust-formation

Expected climates: dry-temperate, mediterranean and exposed highland shoulders.

Material response: slight roughness increase and dry mineral tint.

### Channel-wash

Expected cases: steep slopes with rain or snowmelt pulses.

Material response: normal modulation and small wash tint.

### Surface-recovery

Expected cases: transition from dry or frost-dominant conditions into moderate moisture.

Material response: decay toward base material through memory rather than sudden reset.

### Salt-wetness

Expected climates: coastal/oceanic families. The cue is subtle and should not imply a new shoreline.

### Thermal-spall

Expected cases: highland, alpine and exposed volcanic material around repeated freeze-thaw transitions.

### Fines-settlement

Expected cases: basins, low-drainage surfaces, peat/alluvium/ash and sheltered wind conditions.

## Spatial continuity review

Broad-scale differences should be visible from a normal camera distance. Meso-scale variation should distinguish neighboring valleys and shoulders. Rill-scale variation should be visible in medium-range slope views. Frost pockets should remain local enough that they do not create a checkerboard appearance.

World coordinates must be sampled directly from canonical terrain space. Chunk recentering must not change the resulting scalar field for the same world coordinate.

## Camera-distance review

At far distance, only the strongest climate/season cues should remain apparent. At medium distance, sediment and erosion variation should become visible. At close distance, pores, rills, frost and dry-crust cues can contribute through roughness and normals.

No distance should reveal a geometric seam caused solely by the seasonal layer.

## Performance review

The CPU resolver should be pure and allocation-light enough for batched samples. The stress harness uses 512 material evaluations as a conservative guard.

The shader keeps a fixed five-octave FBM loop. This avoids dynamic loops tied to world data and provides predictable GPU cost.

Cache keys should be stable for identical world positions and seasonal inputs. Quantization is acceptable where the visual contract explicitly allows it; raw canonical coordinates should remain available to the resolver itself.

## Determinism review

The feature must not call `Math.random`, wall-clock APIs, mutable global state, network resources or frame-order dependent seeds.

Hash seeds are fixed constants. FBM transforms are fixed. Climate and substrate selectors are normalized strings. Day-of-year is normalized into the 360-day cycle.

## Canonical boundary review

The seasonal layer can read canonical terrain height and slope for response weighting. It may not write height or slope.

The seasonal layer can consume hydrology-derived context supplied by existing systems. It may not rewrite channel graphs, water bodies or coastline boundaries.

The seasonal layer can report visual intent relevant to vegetation. It may not relocate, add or remove canonical vegetation instances.

The seasonal layer can modify a material. It may not replace collision meshes.

## Tuning workflow

Start from temperate granite because it is the reference baseline. Change one scalar at a time.

Check dry-temperate summer next because it tests the upper drying envelope.

Check alpine spring and winter next because they test snowmelt and frost coupling.

Check wet-temperate summer because it tests saturation against wind drying.

Check volcanic ash and scoria because they test fine retention on porous material.

Finally run the full deterministic stress matrix and shader contract.

## Release checklist

- Profile data validated.
- Climate coverage validated.
- Substrate coverage validated.
- Day normalization validated.
- Forcing bounds validated.
- Snowpack bounds validated.
- Freeze-thaw bounds validated.
- Runoff bounds validated.
- Wind-drying bounds validated.
- World-space determinism validated.
- Material bounds validated.
- Canonical boundary validated.
- Runtime cache keys validated.
- Shader function contract validated.
- Stress performance guard validated.
- PR diff reviewed for substantive feature content.
