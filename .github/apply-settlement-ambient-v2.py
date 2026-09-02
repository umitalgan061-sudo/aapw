from pathlib import Path

path = Path('src/3d/world/settlementAmbientProps.js')
text = path.read_text()
replacements = [
    (
        "id: 'settlement-ambient-props-2026-09-02-v1-canonical-apron-dressing',",
        "id: 'settlement-ambient-props-2026-09-02-v2-route-facing-surface-fabric',",
    ),
    (
        "  maximumAttemptsPerProp: 18,\n  hostedPreflightMinBytes: 512,",
        "  maximumAttemptsPerProp: 18,\n"
        "  logisticsSlotsPerSeat: 3,\n"
        "  routeApproachMinSampleMeters: 28,\n"
        "  routeApproachMaxSampleMeters: 145,\n"
        "  routeShoulderAngleMinRadians: 0.38,\n"
        "  routeShoulderAngleMaxRadians: 1.02,\n"
        "  fallbackFabricTextureSize: 64,\n"
        "  fallbackFabricRepeat: 2.6,\n"
        "  hostedPreflightMinBytes: 512,",
    ),
    (
        "  placementAuthority: 'kingdom-seat + collider-owned terrain + routed roads',",
        "  placementAuthority: 'kingdom-seat + collider-owned terrain + routed roads',\n"
        "  routeFacingDistribution: true,\n"
        "  fallbackSurfaceFabric: true,",
    ),
    (
        "function familyForPlacement(roll, profile, slopeDegrees) {\n"
        "  const snow = profile.snow;\n"
        "  const valyria = profile.valyria;\n"
        "  if (snow > 0.62) return roll < 0.54 ? 'bench' : roll < 0.78 ? 'crate' : 'barrel';\n"
        "  if (valyria > 0.48) return roll < 0.58 ? 'bench' : roll < 0.82 ? 'crate' : 'barrel';\n"
        "  if (slopeDegrees > 9.5) return roll < 0.48 ? 'crate' : roll < 0.78 ? 'barrel' : 'bench';\n"
        "  return roll < 0.42 ? 'barrel' : roll < 0.76 ? 'crate' : 'bench';\n"
        "}",
        "function nearestRoadApproachAngle(seat, roadEdges = []) {\n"
        "  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;\n"
        "  let best = null;\n"
        "  for (const edge of roadEdges) {\n"
        "    for (const point of edge?.points || []) {\n"
        "      const dx = point.x - seat.x;\n"
        "      const dz = point.z - seat.z;\n"
        "      const distance = Math.hypot(dx, dz);\n"
        "      if (distance < policy.routeApproachMinSampleMeters || distance > policy.routeApproachMaxSampleMeters) continue;\n"
        "      const incident = edge.fromId === seat.id || edge.toId === seat.id;\n"
        "      const score = distance + (incident ? -1000 : 0);\n"
        "      if (!best || score < best.score) best = { score, angle: Math.atan2(dz, dx), incident };\n"
        "    }\n"
        "  }\n"
        "  return best ? Object.freeze({ angle: best.angle, incident: best.incident }) : null;\n"
        "}\n\n"
        "function candidateAngleForSlot(rng, slot, approach) {\n"
        "  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;\n"
        "  if (!approach || slot >= policy.logisticsSlotsPerSeat) return { angle: rng() * Math.PI * 2, role: 'social', routeFacing: false };\n"
        "  const side = slot % 2 === 0 ? -1 : 1;\n"
        "  const shoulder = policy.routeShoulderAngleMinRadians\n"
        "    + rng() * (policy.routeShoulderAngleMaxRadians - policy.routeShoulderAngleMinRadians);\n"
        "  return { angle: approach.angle + side * shoulder, role: 'logistics', routeFacing: true };\n"
        "}\n\n"
        "function familyForPlacement(roll, profile, slopeDegrees, role = 'social') {\n"
        "  const snow = profile.snow;\n"
        "  const valyria = profile.valyria;\n"
        "  if (role === 'logistics') {\n"
        "    if (snow > 0.62 || valyria > 0.48) return roll < 0.52 ? 'crate' : roll < 0.88 ? 'barrel' : 'bench';\n"
        "    return roll < 0.54 ? 'barrel' : roll < 0.93 ? 'crate' : 'bench';\n"
        "  }\n"
        "  if (snow > 0.62) return roll < 0.66 ? 'bench' : roll < 0.86 ? 'crate' : 'barrel';\n"
        "  if (valyria > 0.48) return roll < 0.70 ? 'bench' : roll < 0.88 ? 'crate' : 'barrel';\n"
        "  if (slopeDegrees > 9.5) return roll < 0.42 ? 'crate' : roll < 0.66 ? 'barrel' : 'bench';\n"
        "  return roll < 0.18 ? 'barrel' : roll < 0.36 ? 'crate' : 'bench';\n"
        "}",
    ),
    (
        "    placement.roadDistanceMeters.toFixed(3),\n    placement.snow.toFixed(4),",
        "    placement.roadDistanceMeters.toFixed(3),\n"
        "    placement.distributionRole,\n"
        "    placement.routeFacing ? 'route' : 'free',\n"
        "    placement.snow.toFixed(4),",
    ),
    (
        "  for (const seat of seats) {\n    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;\n    let placedForSeat = 0;",
        "  let routeApproachSeatCount = 0;\n"
        "  for (const seat of seats) {\n"
        "    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;\n"
        "    const roadApproach = nearestRoadApproachAngle(seat, roadEdges);\n"
        "    if (roadApproach) routeApproachSeatCount += 1;\n"
        "    let placedForSeat = 0;",
    ),
    (
        "      for (let attempt = 0; attempt < policy.maximumAttemptsPerProp; attempt += 1) {\n        const angle = rng() * Math.PI * 2;\n        const radius = Math.sqrt(rng() * (policy.outerRadiusMeters ** 2 - policy.innerRadiusMeters ** 2) + policy.innerRadiusMeters ** 2);",
        "      const slotDistribution = candidateAngleForSlot(rng, slot, roadApproach);\n"
        "      for (let attempt = 0; attempt < policy.maximumAttemptsPerProp; attempt += 1) {\n"
        "        const sampledDistribution = attempt === 0\n"
        "          ? slotDistribution\n"
        "          : candidateAngleForSlot(rng, slot, roadApproach);\n"
        "        const angle = sampledDistribution.angle;\n"
        "        const radius = Math.sqrt(rng() * (policy.outerRadiusMeters ** 2 - policy.innerRadiusMeters ** 2) + policy.innerRadiusMeters ** 2);",
    ),
    (
        "          anchorDistanceMeters: radius,\n          angle,\n        };",
        "          anchorDistanceMeters: radius,\n"
        "          angle,\n"
        "          distributionRole: sampledDistribution.role,\n"
        "          routeFacing: sampledDistribution.routeFacing,\n"
        "          roadApproachAngle: roadApproach?.angle ?? null,\n"
        "        };",
    ),
    (
        "      const familyId = familyForPlacement(rng(), profile, accepted.frame.slopeDegrees);",
        "      const familyId = familyForPlacement(rng(), profile, accepted.frame.slopeDegrees, accepted.distributionRole);",
    ),
    (
        "        seatDistanceMeters: accepted.anchorDistanceMeters,\n        snow: profile.snow,",
        "        seatDistanceMeters: accepted.anchorDistanceMeters,\n"
        "        distributionRole: accepted.distributionRole,\n"
        "        routeFacing: accepted.routeFacing,\n"
        "        roadApproachAngle: accepted.roadApproachAngle,\n"
        "        snow: profile.snow,",
    ),
    (
        "  const climateCounts = { snow: 0, valyria: 0, temperate: 0 };\n  for (const placement of placements) {",
        "  const climateCounts = { snow: 0, valyria: 0, temperate: 0 };\n"
        "  const roleCounts = { logistics: 0, social: 0 };\n"
        "  for (const placement of placements) {",
    ),
    (
        "    familyCounts[placement.familyId] += 1;\n    if (placement.snow >= 0.25)",
        "    familyCounts[placement.familyId] += 1;\n"
        "    roleCounts[placement.distributionRole] = (roleCounts[placement.distributionRole] || 0) + 1;\n"
        "    if (placement.snow >= 0.25)",
    ),
    (
        "    climateCounts: Object.freeze({ ...climateCounts }),\n    rejectionCounts:",
        "    climateCounts: Object.freeze({ ...climateCounts }),\n"
        "    roleCounts: Object.freeze({ ...roleCounts }),\n"
        "    routeApproachSeatCount,\n"
        "    rejectionCounts:",
    ),
    (
        "function weatheringShaderKey(kind, snow = 0, ash = 0) {",
        "function fallbackFabricHash(x, y, seed) {\n"
        "  let value = Math.imul((x + 1) ^ seed, 0x45d9f3b) ^ Math.imul((y + 7) ^ (seed >>> 1), 0x27d4eb2d);\n"
        "  value ^= value >>> 16;\n"
        "  value = Math.imul(value, 0x45d9f3b);\n"
        "  value ^= value >>> 15;\n"
        "  return (value >>> 0) / 4294967295;\n"
        "}\n\n"
        "export function createAmbientFallbackFabricTextures(familyId) {\n"
        "  const policy = SETTLEMENT_AMBIENT_PROP_POLICY;\n"
        "  const size = policy.fallbackFabricTextureSize;\n"
        "  const colorData = new Uint8Array(size * size * 4);\n"
        "  const roughnessData = new Uint8Array(size * size * 4);\n"
        "  const seed = fnv1a(`ambient-fabric:${familyId}`);\n"
        "  for (let y = 0; y < size; y += 1) {\n"
        "    for (let x = 0; x < size; x += 1) {\n"
        "      const index = (y * size + x) * 4;\n"
        "      const noise = fallbackFabricHash(x, y, seed);\n"
        "      const coarse = fallbackFabricHash(Math.floor(x / 7), Math.floor(y / 7), seed ^ 0xa511e9b3);\n"
        "      const woodGrain = 0.5 + 0.5 * Math.sin((x * 0.43 + y * 0.075) + coarse * 3.2);\n"
        "      const stoneMottle = clamp01(coarse * 0.72 + noise * 0.28);\n"
        "      const fabric = familyId === 'bench' ? stoneMottle : clamp01(woodGrain * 0.58 + noise * 0.42);\n"
        "      const luminance = Math.round(176 + fabric * 72);\n"
        "      colorData[index] = luminance;\n"
        "      colorData[index + 1] = luminance;\n"
        "      colorData[index + 2] = luminance;\n"
        "      colorData[index + 3] = 255;\n"
        "      const roughness = Math.round(180 + (familyId === 'bench' ? stoneMottle : 1 - woodGrain) * 70);\n"
        "      roughnessData[index] = roughness;\n"
        "      roughnessData[index + 1] = roughness;\n"
        "      roughnessData[index + 2] = roughness;\n"
        "      roughnessData[index + 3] = 255;\n"
        "    }\n"
        "  }\n"
        "  const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);\n"
        "  map.colorSpace = THREE.SRGBColorSpace;\n"
        "  const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat);\n"
        "  for (const texture of [map, roughnessMap]) {\n"
        "    texture.wrapS = THREE.RepeatWrapping;\n"
        "    texture.wrapT = THREE.RepeatWrapping;\n"
        "    texture.repeat.set(policy.fallbackFabricRepeat, policy.fallbackFabricRepeat);\n"
        "    texture.needsUpdate = true;\n"
        "    texture.userData.settlementAmbientFallbackFabric = true;\n"
        "  }\n"
        "  return Object.freeze({ map, roughnessMap });\n"
        "}\n\n"
        "function weatheringShaderKey(kind, snow = 0, ash = 0) {",
    ),
    (
        "  const previous = material.onBeforeCompile?.bind(material);\n  material.userData ||= {};",
        "  const previous = material.onBeforeCompile?.bind(material);\n"
        "  const previousCacheKey = material.customProgramCacheKey?.bind(material);\n"
        "  material.userData ||= {};",
    ),
    (
        "  material.customProgramCacheKey = () => weatheringShaderKey(kind, snowAmount, ashAmount);",
        "  material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}|${weatheringShaderKey(kind, snowAmount, ashAmount)}`;",
    ),
    (
        "function createFallbackMaterial(familyId) {\n  const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];\n  const material = new THREE.MeshStandardMaterial({ color: family.fallbackColor, roughness: family.roughnessFloor, metalness: 0, flatShading: familyId !== 'crate' });",
        "function createFallbackMaterial(familyId) {\n"
        "  const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];\n"
        "  const fabric = createAmbientFallbackFabricTextures(familyId);\n"
        "  const material = new THREE.MeshStandardMaterial({\n"
        "    color: family.fallbackColor,\n"
        "    map: fabric.map,\n"
        "    roughnessMap: fabric.roughnessMap,\n"
        "    roughness: family.roughnessFloor,\n"
        "    metalness: 0,\n"
        "    flatShading: familyId !== 'crate',\n"
        "  });\n"
        "  material.userData.settlementAmbientFallbackFabric = true;",
    ),
    (
        "    climateCounts: placementResult.stats.climateCounts,\n    fallbackDrawCalls:",
        "    climateCounts: placementResult.stats.climateCounts,\n"
        "    roleCounts: placementResult.stats.roleCounts,\n"
        "    routeApproachSeatCount: placementResult.stats.routeApproachSeatCount,\n"
        "    fallbackDrawCalls:",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one settlementAmbientProps match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)
path.write_text(text)

qa_path = Path('scripts/checkSettlementAmbientProps.js')
qa = qa_path.read_text()
qa_replacements = [
    (
        "      fail(representedFamilies.size === 3, `ambient prop family diversity ${representedFamilies.size}/3`);",
        "      fail(representedFamilies.size === 3, `ambient prop family diversity ${representedFamilies.size}/3`);\n"
        "      fail(planA.stats.routeApproachSeatCount >= 6, `only ${planA.stats.routeApproachSeatCount} seats resolved a live road approach`);\n"
        "      fail(planA.stats.roleCounts.logistics > 0 && planA.stats.roleCounts.social > 0, `ambient distribution roles collapsed: ${JSON.stringify(planA.stats.roleCounts)}`);\n"
        "      fail(planA.placements.some((placement) => placement.routeFacing === true), 'no route-facing logistics props survived geographic rejection');",
    ),
    (
        "      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientWeathering.roughnessVariation === true), 'fallback lost roughness breakup');",
        "      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientWeathering.roughnessVariation === true), 'fallback lost roughness breakup');\n"
        "      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientFallbackFabric === true), 'fallback family-specific surface fabric missing');\n"
        "      fail(fallbackMaterials.every((material) => material.map?.userData?.settlementAmbientFallbackFabric === true && material.roughnessMap?.userData?.settlementAmbientFallbackFabric === true), 'fallback albedo/roughness texture fabric missing');",
    ),
    (
        "        climateCounts: planA.stats.climateCounts,",
        "        climateCounts: planA.stats.climateCounts,\n"
        "        roleCounts: planA.stats.roleCounts,\n"
        "        routeApproachSeatCount: planA.stats.routeApproachSeatCount,",
    ),
]
for old, new in qa_replacements:
    count = qa.count(old)
    if count != 1:
        raise SystemExit(f'expected one QA match, found {count}: {old[:120]!r}')
    qa = qa.replace(old, new, 1)
qa_path.write_text(qa)
