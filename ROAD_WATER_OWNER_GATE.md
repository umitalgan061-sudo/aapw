# Run 187 Road/Water Owner Gate

Run 187's canonical full-reference shadow integration found that the existing deterministic MST/pathfinder, when evaluated against the canonical hydrology-shaped terrain, places 399 of 1020 sampled route points in canonical water across 6 of 13 edges and reaches a measured maximum route grade of 37.0 degrees.

Affected diagnostic edges:
- robin -> berkalp: 32 / 104 sampled route points in water
- cersei -> stannis: 2 / 36
- umit -> doran: 198 / 228
- twin -> balon: 16 / 48
- umit -> Xaro: 84 / 228
- jon -> Night King: 67 / 76

No live runtime source imports the Run 187 shadow chunk module. The current live road network remains unchanged and continues to pass its existing <=20 degree safety contract.

## Owner decision required before full-reference runtime road adoption

The repository must not silently choose among these materially different world/gameplay policies:

1. Bridges for selected canonical water crossings.
2. Ferry/boat links for selected crossings.
3. Hydrology-aware dry-land rerouting that treats canonical water as impassable for cart roads.
4. A deliberately mixed policy, with the exact edge-to-policy mapping explicitly approved.

Temporary default: none of these policies is selected. Full-reference default runtime terrain/road adoption remains blocked. Shadow-only terrain/chunk/collider work may continue where it does not assume a road-water policy.


## Run 188 measured shadow policy comparison

No policy is selected by this measurement. The same six Run187 water-crossing MST edges are compared under three measurable shadow interpretations; a mixed policy remains an owner-selected per-edge mapping rather than an automatically optimized answer.

| Edge | Existing canonical-water exposure | Bridge diagnostic: crossings; total/max chord | Ferry diagnostic: crossings; total/max water-route | Dry-cart diagnostic (40m full-world grid, water impassable, <=20°) |
| --- | ---: | ---: | ---: | --- |
| robin->berkalp | 32/104; 0.49 km | 1; 0.48 km / 0.48 km | 1; 0.49 km / 0.49 km | 1.85 km, 1.07x, max 4.8° |
| cersei->stannis | 2/36; 0.04 km | 2; 0.02 km / 0.02 km | 2; 0.04 km / 0.03 km | 0.74 km, 1.06x, max 2.9° |
| umit->doran | 198/228; 3.32 km | 1; 3.11 km / 3.11 km | 1; 3.32 km / 3.32 km | NO (no-dry-cart-path) |
| twin->balon | 16/48; 0.27 km | 1; 0.25 km / 0.25 km | 1; 0.27 km / 0.27 km | NO (no-dry-cart-path) |
| umit->Xaro | 84/228; 1.30 km | 1; 1.27 km / 1.27 km | 1; 1.30 km / 1.30 km | NO (no-dry-cart-path) |
| jon->Night King | 67/76; 1.09 km | 1; 1.03 km / 1.03 km | 1; 1.09 km / 1.09 km | 1.87 km, 1.50x, max 5.1° |

Aggregate: bridge chord total 6.16 km, longest 3.11 km; ferry water-route total 6.51 km, longest 3.32 km; dry-cart route feasible 3/6. Comparison checksum: `c47d6ecbacff41a6ffc4e18623642905c1865c46f37f3f82fbd69a9eecd57214`.

Interpretation boundary: bridge/ferry span limits, boat gameplay, bridge art/physics and the exact mixed edge mapping are product decisions and are not inferred from these numbers. Dry-cart feasibility is a deterministic diagnostic route, not a live road implementation. Full-reference default runtime road adoption remains blocked until the owner chooses a policy.


## Owner resolution — run 191 / ADR-0211

Owner, 2026-08-08: roads crossing streams/lakes/canonical water use **medieval stone arch bridges**. Run188 temporary default NONE is superseded by BRIDGE. Ferry, water-through-road and automatic dry-reroute are not the selected default policy.

Run191 shadow qualification recomputed the same canonical MST/hydrology inputs and produced 6 affected edges / 7 distinct bridge structures / 177 total masonry arches. Water chord aggregate 6.17 km; longest structural bridge 3.12 km. Long crossings are multi-arch viaducts rather than one giant arch. Deterministic checksum: `13fadc3dbc3d3554c583215883614a56b5e9ee406ae74d66e335fd56fe4cf7f4`.

Boundary: Run191 proves owner-policy resolution, placement, original procedural medieval masonry material, batched geometry cost and visual evidence. It does not silently switch the live default terrain/road graph in the same commit; live adoption remains a separately tested integration step.
