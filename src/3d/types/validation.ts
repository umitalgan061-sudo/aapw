import type { AssetDescriptor, Backend, DeviceCapabilities, FramePlan, GameplaySnapshot, QualityTier, RuntimeBudgets, RuntimeState, SaveEnvelope, Vec3 } from './platform.js';
import { BACKENDS, QUALITY_TIERS } from './platform.js';

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const issue = (path: string, code: string, message: string, severity: ValidationIssue['severity'] = 'error'): ValidationIssue => ({ path, code, message, severity });

export function validateFiniteNumber(value: unknown, path: string, min?: number, max?: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(issue(path, 'NOT_FINITE', 'value must be a finite number'));
  else {
    if (min !== undefined && value < min) issues.push(issue(path, 'BELOW_MIN', `value must be >= ${min}`));
    if (max !== undefined && value > max) issues.push(issue(path, 'ABOVE_MAX', `value must be <= ${max}`));
  }
  return issues;
}

export function validateVec3(value: unknown, path = 'vector'): ValidationIssue[] {
  if (!value || typeof value !== 'object') return [issue(path, 'INVALID_VECTOR', 'vector must be an object')];
  const vector = value as Record<string, unknown>;
  return [
    ...validateFiniteNumber(vector.x, `${path}.x`),
    ...validateFiniteNumber(vector.y, `${path}.y`),
    ...validateFiniteNumber(vector.z, `${path}.z`),
  ];
}

export function validateBackend(value: unknown, path = 'backend'): ValidationIssue[] {
  return (BACKENDS as readonly unknown[]).includes(value) ? [] : [issue(path, 'INVALID_BACKEND', 'backend must be webgpu or webgl2')];
}

export function validateQuality(value: unknown, path = 'quality'): ValidationIssue[] {
  return (QUALITY_TIERS as readonly unknown[]).includes(value) ? [] : [issue(path, 'INVALID_QUALITY', 'quality tier is invalid')];
}

export function validateBudgets(budgets: RuntimeBudgets, path = 'budgets'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  issues.push(...validateFiniteNumber(budgets.frameMs, `${path}.frameMs`, 1, 100));
  issues.push(...validateFiniteNumber(budgets.simulationMs, `${path}.simulationMs`, 0, budgets.frameMs));
  issues.push(...validateFiniteNumber(budgets.renderMs, `${path}.renderMs`, 0, budgets.frameMs));
  issues.push(...validateFiniteNumber(budgets.uploadMs, `${path}.uploadMs`, 0, budgets.frameMs));
  issues.push(...validateFiniteNumber(budgets.streamingMs, `${path}.streamingMs`, 0, budgets.frameMs));
  issues.push(...validateFiniteNumber(budgets.maxVisibleObjects, `${path}.maxVisibleObjects`, 1));
  issues.push(...validateFiniteNumber(budgets.maxAnimatedObjects, `${path}.maxAnimatedObjects`, 1));
  issues.push(...validateFiniteNumber(budgets.maxShadowCasters, `${path}.maxShadowCasters`, 1));
  return issues;
}

export function validateCapabilities(capabilities: DeviceCapabilities, path = 'capabilities'): ValidationIssue[] {
  const issues = validateBackend(capabilities.backend, `${path}.backend`);
  issues.push(...validateFiniteNumber(capabilities.maxTextureDimension2D, `${path}.maxTextureDimension2D`, 256));
  issues.push(...validateFiniteNumber(capabilities.maxBindGroups, `${path}.maxBindGroups`, 1));
  issues.push(...validateFiniteNumber(capabilities.maxUniformBufferBindingSize, `${path}.maxUniformBufferBindingSize`, 256));
  for (const key of ['supportsTimestampQueries','supportsStorageTextures','supportsFloat16','supportsMultiview','deviceLost'] as const) {
    if (typeof capabilities[key] !== 'boolean') issues.push(issue(`${path}.${key}`, 'INVALID_BOOLEAN', 'capability must be boolean'));
  }
  return issues;
}

export function validateRuntime(state: RuntimeState): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!state.worldId || !String(state.worldId).trim()) issues.push(issue('worldId', 'EMPTY_ID', 'world id must not be empty'));
  if (!Number.isSafeInteger(state.tick) || Number(state.tick) < 0) issues.push(issue('tick', 'INVALID_TICK', 'tick must be a non-negative safe integer'));
  issues.push(...validateBackend(state.backend));
  issues.push(...validateQuality(state.quality));
  issues.push(...validateBudgets(state.budgets));
  issues.push(...validateCapabilities(state.capabilities));
  return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function validateAsset(asset: AssetDescriptor): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!asset.id || !String(asset.id).trim()) issues.push(issue('id', 'EMPTY_ID', 'asset id must not be empty'));
  if (!asset.uri || !String(asset.uri).trim()) issues.push(issue('uri', 'EMPTY_URI', 'asset uri must not be empty'));
  issues.push(...validateFiniteNumber(asset.bytes, 'bytes', 0));
  issues.push(...validateFiniteNumber(asset.compressedBytes, 'compressedBytes', 0));
  issues.push(...validateFiniteNumber(asset.importance, 'importance', 0, 1));
  issues.push(...validateQuality(asset.minQuality, 'minQuality'));
  if (asset.bounds) issues.push(...validateFiniteNumber(asset.bounds.radius, 'bounds.radius', 0), ...validateVec3(asset.bounds.min, 'bounds.min'), ...validateVec3(asset.bounds.max, 'bounds.max'));
  if (asset.worldPosition) issues.push(...validateVec3(asset.worldPosition, 'worldPosition'));
  return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function validateFramePlan(frame: FramePlan): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!Number.isSafeInteger(frame.frameId) || frame.frameId < 0) issues.push(issue('frameId', 'INVALID_FRAME_ID', 'frame id must be a non-negative safe integer'));
  if (!Number.isSafeInteger(frame.resolution.width) || frame.resolution.width < 1) issues.push(issue('resolution.width', 'INVALID_WIDTH', 'width must be positive'));
  if (!Number.isSafeInteger(frame.resolution.height) || frame.resolution.height < 1) issues.push(issue('resolution.height', 'INVALID_HEIGHT', 'height must be positive'));
  issues.push(...validateFiniteNumber(frame.resolution.scale, 'resolution.scale', 0.25, 1));
  issues.push(...validateFiniteNumber(frame.estimatedGpuMs, 'estimatedGpuMs', 0));
  issues.push(...validateFiniteNumber(frame.cpuUploadMs, 'cpuUploadMs', 0));
  const uniqueVisible = new Set(frame.visibleObjectIds);
  if (uniqueVisible.size !== frame.visibleObjectIds.length) issues.push(issue('visibleObjectIds', 'DUPLICATE_IDS', 'visible object ids must be unique'));
  for (const id of frame.shadowObjectIds) if (!uniqueVisible.has(id)) issues.push(issue('shadowObjectIds', 'SHADOW_NOT_VISIBLE', `shadow caster ${id} is not visible`, 'warning'));
  for (const id of frame.animatedObjectIds) if (!uniqueVisible.has(id)) issues.push(issue('animatedObjectIds', 'ANIMATION_NOT_VISIBLE', `animated object ${id} is not visible`, 'warning'));
  return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function validateSaveEnvelope(envelope: SaveEnvelope): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (envelope.header.format !== 'aapw-save') issues.push(issue('header.format', 'INVALID_FORMAT', 'unsupported save format'));
  if (!/^\d+\.\d+\.\d+$/.test(envelope.header.version)) issues.push(issue('header.version', 'INVALID_VERSION', 'save version must be semantic'));
  if (!envelope.header.schemaHash || envelope.header.schemaHash.length < 8) issues.push(issue('header.schemaHash', 'INVALID_SCHEMA_HASH', 'schema hash is missing or too short'));
  if (!Number.isFinite(envelope.header.createdAt) || envelope.header.createdAt <= 0) issues.push(issue('header.createdAt', 'INVALID_TIMESTAMP', 'createdAt must be a positive timestamp'));
  if (!Number.isFinite(envelope.header.updatedAt) || envelope.header.updatedAt <= 0) issues.push(issue('header.updatedAt', 'INVALID_TIMESTAMP', 'updatedAt must be a positive timestamp'));
  if (!Number.isSafeInteger(envelope.header.tick) || Number(envelope.header.tick) < 0) issues.push(issue('header.tick', 'INVALID_TICK', 'save tick is invalid'));
  if (!Number.isFinite(envelope.header.playTimeSeconds) || envelope.header.playTimeSeconds < 0) issues.push(issue('header.playTimeSeconds', 'INVALID_PLAYTIME', 'play time is invalid'));
  if (!envelope.payload) issues.push(issue('payload', 'EMPTY_PAYLOAD', 'save payload is empty'));
  if (!/^[0-9a-f]{8,}$/i.test(envelope.checksum)) issues.push(issue('checksum', 'INVALID_CHECKSUM', 'checksum must be hexadecimal'));
  return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function validateGameplaySnapshot(snapshot: GameplaySnapshot): ValidationReport {
  const issues: ValidationIssue[] = [];
  issues.push(...validateSaveEnvelope({ header: snapshot.header, compression: 'none', checksum: '00000000', payload: 'snapshot' }).issues.filter((entry) => entry.path !== 'checksum'));
  issues.push(...validateFiniteNumber(snapshot.player.health, 'player.health', 0));
  issues.push(...validateFiniteNumber(snapshot.player.stamina, 'player.stamina', 0));
  if (!Array.isArray(snapshot.player.inventory)) issues.push(issue('player.inventory', 'INVALID_INVENTORY', 'inventory must be an array'));
  else for (const [index, item] of snapshot.player.inventory.entries()) {
    if (!item.id || !String(item.id).trim()) issues.push(issue(`player.inventory.${index}.id`, 'EMPTY_ITEM_ID', 'item id is empty'));
    issues.push(...validateFiniteNumber(item.quantity, `player.inventory.${index}.quantity`, 1));
  }
  if (!Number.isFinite(snapshot.world.seed)) issues.push(issue('world.seed', 'INVALID_SEED', 'world seed must be finite'));
  if (!Array.isArray(snapshot.rngState)) issues.push(issue('rngState', 'INVALID_RNG', 'rng state must be an array'));
  return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function sanitizeString(value: unknown, maxLength = 256): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function sanitizeUrl(value: unknown): string {
  const input = sanitizeString(value, 2048);
  if (!input) return '';
  try {
    const url = new URL(input, 'https://aapw.invalid');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return input;
  } catch { return ''; }
}

export function sanitizeTags(values: readonly unknown[], max = 32): readonly string[] {
  const tags = values.map((value) => sanitizeString(value, 64)).filter(Boolean);
  return [...new Set(tags)].slice(0, Math.max(0, max));
}

export function finiteOr(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function integerOr(value: unknown, fallback: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  return Math.trunc(finiteOr(value, fallback, min, max));
}

export function normalizeDevicePixelRatio(value: unknown): number {
  return finiteOr(value, 1, 0.5, 3);
}

export function normalizeRenderScale(value: unknown): number {
  return finiteOr(value, 1, 0.25, 1);
}

export function normalizeQualityTier(value: unknown, fallback: QualityTier = 'safe'): QualityTier {
  return (QUALITY_TIERS as readonly unknown[]).includes(value) ? value as QualityTier : fallback;
}

export function normalizeBackendMode(value: unknown, fallback: Backend = 'webgl2'): Backend {
  return (BACKENDS as readonly unknown[]).includes(value) ? value as Backend : fallback;
}

export function vectorDistance(a: Vec3, b: Vec3): number {
  const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z;
  return Math.sqrt(x * x + y * y + z * z);
}

export function vectorLength(value: Vec3): number {
  return Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

export function normalizeVector(value: Vec3): Vec3 {
  const length = vectorLength(value);
  if (!Number.isFinite(length) || length === 0) return { x: 0, y: 0, z: 0 };
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}
