# Groundwater QA Catalog

This catalog defines the deterministic acceptance surface for the groundwater render layer.

## Input dimensions

The suite samples every environmental dimension that can influence presentation:

- world X/Z coordinates
- elevation
- slope
- base moisture
- rainfall
- runoff
- soil depth
- permeability
- water distance
- groundwater depth
- wet-day memory
- dry-day memory
- day of year
- temperature
- drainage
- wind exposure
- substrate
- biome

## Output dimensions

The acceptance tests monitor:

- recharge potential
- water-table proximity
- capillary rise
- seepage face
- surface saturation
- saturation memory
- drying resistance
- surface film
- mineral fine transport
- mineral salt ring
- puddle persistence
- marsh-edge factor
- wet-freeze stress
- drought stress
- combined stress
- material color
- roughness
- normal strength
- wetness

## Determinism gates

A deterministic render surface must satisfy the following properties:

1. identical input yields identical state;
2. identical input yields identical compact signature;
3. coordinate wrap does not create NaN;
4. seasonal wrap is stable at day 0/360;
5. negative days normalize into the same cycle;
6. object outputs remain immutable where the API promises frozen payloads.

## Boundedness gates

Every continuous presentation value must remain in `[0,1]`. Environmental source values may have physical units, but once converted to presentation channels they are normalized.

Boundary tests deliberately include values outside authored ranges so a caller cannot accidentally introduce an unbounded channel.

## Monotonicity expectations

The suite treats these as directional sanity checks rather than strict physical laws:

| Transformation | Expected direction |
| --- | --- |
| shallower groundwater | proximity should not fall |
| farther groundwater | proximity should not rise from depth alone |
| nearby surface water | proximity should not fall |
| stronger rainfall | recharge should not fall |
| stronger runoff | saturation should not fall |
| flatter slope | puddle persistence should not fall |
| stronger dry history | retention should generally recover downward |

These are deliberately weak inequalities with tolerance, because the final signal also contains deterministic spatial texture and other environmental terms.

## Material gates

The material response is accepted only when:

- red, green and blue remain finite;
- roughness remains in `[0,1]`;
- normal strength does not exceed policy maximum;
- wetness remains in `[0,1]`;
- blend endpoints are identity values;
- event responses remain finite;
- applying a guard does not create geometry changes.

## Shader gates

The shader acceptance layer checks that groundwater code provides:

- a common include payload;
- a color hook;
- a roughness hook;
- a normal hook;
- no vertex position write;
- no explicit `position +=` geometry mutation.

The code is intentionally small in the vertex domain: groundwater belongs to surface presentation, not geometry synthesis.

## Canonical world gates

The layer is rejected conceptually when it attempts to become authoritative for:

- heightfield generation;
- hydrology topology;
- coastline placement;
- collider generation;
- vegetation placement;
- new persistent geography.

These constraints are carried in policy objects, adapter payloads and diagnostic reports so they are visible to automated checks.

## Fixture strategy

Two fixture families are maintained:

### Lowland

Lowland cases concentrate on:

- flat surfaces;
- gentle slopes;
- shallow groundwater;
- near water;
- puddle-prone conditions;
- marsh-like edges;
- wet/dry seasonal transitions.

### Upland

Upland cases concentrate on:

- elevated surfaces;
- moderate and steep slopes;
- deeper groundwater;
- greater runoff demand;
- stronger drying exposure;
- sparse moisture retention.

Fixtures are inputs, not baked terrain.

## Preset strategy

The 24 preset catalog deliberately crosses biome and substrate classes. A preset is accepted when it produces a valid deterministic state and keeps all channels bounded.

Interpolation is tested at 0, .25, .5, .75 and 1. This protects the continuous transition path from accidentally changing into a hard switch.

## Event strategy

Storm, drought, freeze-thaw, snowmelt, recovery and neutral events are rendered as deltas. Event intensity is clamped. Events must not write persistent world state.

Each event receives multiple intensity samples because edge behavior is often where material equations become unstable.

## Neighborhood strategy

Neighborhood aggregation is used for visual edge contrast only. The aggregation returns means and a bounded min/max contrast. Empty neighborhoods are legal and return zero-valued statistics.

This protects streaming and LOD code from treating missing neighbors as a fatal condition.

## Diagnostic strategy

Diagnostics expose a compact health view:

```text
valid state
valid metrics
confidence
presentation tier
severity
signature
canonical invariants
```

Confidence is a presentation confidence, not a scientific confidence interval.

## Guard strategy

The quality-guard layer acts as a last line of defense. It can sanitize channels and materials, reject explicit canonical mutation flags and produce a safe fallback material.

The guard is not intended to hide upstream bugs silently in development. Test mode can request rejection when sanitization would have occurred.

## Performance strategy

Pure deterministic noise is used rather than runtime random sampling. The CPU layer is suitable for tile-level or material-level evaluation. The shader layer is fragment-only.

When a runtime caller needs many samples, it should cache the returned render frame for the current tile or material lifetime rather than repeatedly resolving the same state in a single frame.

## Regression commands

The dedicated scripts are intentionally plain Node entry points so they can run without a package manager dependency:

```bash
node scripts/checkTerrainGroundwaterBoundaries.mjs
node scripts/checkTerrainGroundwaterRegime.mjs
node scripts/checkTerrainGroundwaterSeasonality.mjs
node scripts/checkTerrainGroundwaterMaterials.mjs
node scripts/checkTerrainGroundwaterIntegration.mjs
node scripts/checkTerrainGroundwaterMetamorphic.mjs
node scripts/checkTerrainGroundwaterQualityGuards.mjs
node scripts/checkTerrainGroundwaterPresets.mjs
node scripts/checkTerrainGroundwaterFixtureCoverage.mjs
node scripts/checkTerrainGroundwaterAcceptance.mjs
```

When the full repository test environment is available, these focused checks should run before the broader smoke suites.

## Review checklist

### Production code

- [ ] state resolver is pure;
- [ ] adapter remains render-only;
- [ ] shader remains fragment-only;
- [ ] material budget is enforced;
- [ ] policy IDs are stable;
- [ ] output objects are immutable where promised.

### Tests

- [ ] boundaries are covered;
- [ ] seasonal wrap is covered;
- [ ] substrate diversity is covered;
- [ ] biome diversity is covered;
- [ ] interpolation endpoints are covered;
- [ ] neighborhood aggregation is covered;
- [ ] shader installation is covered;
- [ ] deterministic signatures are covered;
- [ ] fixture corpus is covered.

### Repository integration

- [ ] latest main is known;
- [ ] branch is based on latest main;
- [ ] diff is meaningful;
- [ ] no unrelated deletion is introduced;
- [ ] focused checks are passing;
- [ ] `git diff --check` is clean;
- [ ] required global checks are reviewed for infrastructure failures;
- [ ] 4.000+ meaningful-line rule is satisfied before merge.

## Interpretation of failures

A failed boundedness check is a code defect, not a fixture defect. A failed deterministic signature is a render regression candidate. A failed canonical check is a scope violation. A failed shader replacement check is an integration defect.

A global CI failure caused by existing repository infrastructure should be reported separately from a groundwater-focused failure. The focused suite remains the primary signal for this layer.

## Versioning

Policy IDs carry the date and semantic revision. Changing a formula without changing a policy ID is discouraged when it changes rendered output in a material way.

A signature change is not automatically a failure. It is a signal requiring an explicit review of the intended surface change.

## Scope boundary

This layer does not attempt to model:

- aquifer recharge as a physical groundwater simulation;
- Darcy flow;
- pore-pressure mechanics;
- subsurface mass transport;
- geological stratigraphy creation;
- new rivers;
- new lakes;
- wetland geometry generation;
- collision changes caused by water;
- vegetation population simulation.

Those systems, where present, remain separate authorities.

## Acceptance conclusion

The groundwater layer is considered ready only when its focused suites establish that the feature is:

1. deterministic;
2. bounded;
3. render-only;
4. integration-safe;
5. materially useful;
6. regression-tested;
7. consistent with existing terrain authority boundaries.
