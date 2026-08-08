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
