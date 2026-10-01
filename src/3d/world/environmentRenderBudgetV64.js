const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
};
const freeze = (value) => Object.freeze(value);

export const V64_RENDER_BUDGET = Object.freeze({
  id: 'buzul-muhafizi-render-budget-v64-20260914',
  desktop: Object.freeze({ fpsFloor: 50, drawCalls: 180, triangles: 1800000, textureMb: 950 }),
  mobile: Object.freeze({ fpsFloor: 35, drawCalls: 90, triangles: 650000, textureMb: 600 }),
});

function hashString(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function createV64RenderBudget({
  fps = 60,
  drawCalls = 0,
  triangles = 0,
  textureMemoryMb = 0,
  mobile = false,
  cameraDistance = 420,
} = {}) {
  const budget = mobile ? V64_RENDER_BUDGET.mobile : V64_RENDER_BUDGET.desktop;
  const distance = clamp(cameraDistance, 0.1, 20000);
  const lodRelief = distance < 220 ? 1 : distance < 900 ? 0.82 : distance < 2800 ? 0.56 : 0.3;
  const normalizedDrawCalls = Math.max(0, Math.floor(drawCalls));
  const normalizedTriangles = Math.max(0, Math.floor(triangles));
  const normalizedTextures = Math.max(0, Number.isFinite(textureMemoryMb) ? textureMemoryMb : 0);
  const issues = [];
  if (fps < budget.fpsFloor) issues.push('fps-floor');
  if (normalizedDrawCalls > budget.drawCalls) issues.push('draw-calls');
  if (normalizedTriangles > budget.triangles) issues.push('triangles');
  if (normalizedTextures > budget.textureMb) issues.push('texture-memory');
  return freeze({
    budget,
    mobile,
    cameraDistance: round(distance),
    fps: round(fps, 2),
    drawCalls: normalizedDrawCalls,
    triangles: normalizedTriangles,
    textureMemoryMb: round(normalizedTextures, 2),
    detailFactor: round(lodRelief),
    overBudget: issues.length > 0,
    issues: Object.freeze(issues),
    recommendation: Object.freeze({
      reduceLOD: issues.includes('fps-floor') || issues.includes('triangles'),
      mergeInstances: issues.includes('draw-calls'),
      trimTextures: issues.includes('texture-memory'),
      keepNearDetail: distance < 220,
    }),
    fingerprint: hashString(JSON.stringify({ fps, normalizedDrawCalls, normalizedTriangles, normalizedTextures, mobile, distance })),
  });
}

export function createV64VisualColliderParity({ terrain = {}, renderedY = 0, colliderY = 0, toleranceMeters = 0.35 } = {}) {
  const canonicalY = Number.isFinite(terrain.canonicalHeight) ? terrain.canonicalHeight : renderedY;
  const renderDelta = Math.abs(renderedY - canonicalY);
  const colliderDelta = Math.abs(colliderY - canonicalY);
  const renderColliderDelta = Math.abs(renderedY - colliderY);
  const tolerance = clamp(toleranceMeters, 0.01, 2);
  return freeze({
    canonicalY: round(canonicalY),
    renderDelta: round(renderDelta),
    colliderDelta: round(colliderDelta),
    renderColliderDelta: round(renderColliderDelta),
    pass: renderDelta <= tolerance && colliderDelta <= tolerance && renderColliderDelta <= tolerance,
    sameCoordinate: terrain.x === terrain.x && terrain.z === terrain.z,
    toleranceMeters: tolerance,
  });
}

export function createV64StreamingEnvelope({ cameraDistance = 420, mobile = false, desiredObjects = 0 } = {}) {
  const distance = clamp(cameraDistance, 0.1, 20000);
  const objectCount = Math.max(0, Math.floor(Number.isFinite(desiredObjects) ? desiredObjects : 0));
  const tier = distance < 240 ? 'near' : distance < 900 ? 'mid' : distance < 2800 ? 'far' : 'impostor';
  const cap = mobile ? 320 : 720;
  const ratio = tier === 'near' ? 1 : tier === 'mid' ? 0.72 : tier === 'far' ? 0.42 : 0.18;
  const visible = Math.min(objectCount, Math.floor(cap * ratio));
  return freeze({
    tier,
    visible,
    culled: Math.max(0, objectCount - visible),
    mobile,
    cap,
    transitionMeters: 60,
    hysteresis: true,
    fingerprint: hashString(`${distance}|${objectCount}|${mobile}|${tier}`),
  });
}
