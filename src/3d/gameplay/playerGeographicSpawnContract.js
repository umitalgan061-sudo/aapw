/**
 * Player spawn adapter for the canonical geographic map.
 *
 * It converts an owner-supplied world X/Z spawn to the normalized reference map, samples the existing
 * ground contract, and returns the exact y placement that the gameplay player should use. This module
 * never generates terrain and never changes world geometry. It exists to keep the visual root, collider
 * and geography sample on one deterministic spawn record.
 *
 * @module gameplay/playerGeographicSpawnContract
 */

import { worldXZToCanonicalMap } from './playerRegionalAppearance.js';
import { evaluatePlayerGrounding } from './playerGroundingVisualContract.js';

const VERSION = '2026-09-07-v1';
const SPAWN_GROUND_TOLERANCE = 0.08;
const MAX_SPAWN_SLOPE_DEGREES = 55;

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((finite(value, 0)) * factor) / factor;
}

function normalizeSpawn(spawn) {
  if (!spawn || !Number.isFinite(Number(spawn.x)) || !Number.isFinite(Number(spawn.z))) {
    throw new TypeError('player spawn x/z must be finite');
  }
  return Object.freeze({ x: Number(spawn.x), z: Number(spawn.z) });
}

function sampleGround(groundCollider, x, z) {
  if (!groundCollider) return null;
  if (typeof groundCollider.getGroundSample === 'function') return groundCollider.getGroundSample(x, z);
  if (typeof groundCollider.getSurfaceSample === 'function') return groundCollider.getSurfaceSample(x, z);
  if (typeof groundCollider.getGroundHeight === 'function') return { height: groundCollider.getGroundHeight(x, z) };
  throw new TypeError('groundCollider must expose getGroundHeight/getGroundSample/getSurfaceSample');
}

function sampleColliderGround(playerCollider, x, z) {
  if (!playerCollider) return null;
  if (typeof playerCollider.getGroundSample === 'function') return playerCollider.getGroundSample(x, z);
  if (typeof playerCollider.getGroundHeight === 'function') return { height: playerCollider.getGroundHeight(x, z) };
  return null;
}

function validateGroundSample(sample) {
  const height = finite(sample?.height ?? sample?.groundHeight ?? sample?.y, null);
  if (height === null) return Object.freeze({ ok: false, error: 'ground-height-missing', height: null });
  const slope = finite(sample?.slopeDegrees ?? sample?.slope, null);
  if (slope !== null && Math.abs(slope) > MAX_SPAWN_SLOPE_DEGREES) return Object.freeze({ ok: false, error: `spawn-slope-out-of-contract:${round(slope, 2)}`, height, slopeDegrees: slope });
  return Object.freeze({ ok: true, height, slopeDegrees: slope });
}

export function resolvePlayerGeographicSpawn({ spawn = { x: 0, z: 0 }, mapBounds, metersPerMapUnit, groundCollider, playerCollider = null, rootYOffset = 0 } = {}) {
  const normalizedSpawn = normalizeSpawn(spawn);
  const normalized = worldXZToCanonicalMap({ worldX: normalizedSpawn.x, worldZ: normalizedSpawn.z, mapBounds, metersPerMapUnit });
  const rawGround = sampleGround(groundCollider, normalizedSpawn.x, normalizedSpawn.z);
  const ground = validateGroundSample(rawGround);
  if (!ground.ok) return Object.freeze({ ok: false, error: ground.error, spawn: normalizedSpawn, normalized, ground });
  const colliderGround = sampleColliderGround(playerCollider, normalizedSpawn.x, normalizedSpawn.z);
  const collider = colliderGround ? validateGroundSample(colliderGround) : Object.freeze({ ok: true, height: ground.height, slopeDegrees: ground.slopeDegrees });
  if (!collider.ok) return Object.freeze({ ok: false, error: collider.error, spawn: normalizedSpawn, normalized, ground, collider });
  const rootY = ground.height + finite(rootYOffset, 0);
  const colliderDelta = Math.abs(rootY - collider.height);
  if (colliderDelta > SPAWN_GROUND_TOLERANCE) return Object.freeze({ ok: false, error: `spawn-collider-delta:${round(colliderDelta, 4)}`, spawn: normalizedSpawn, normalized, ground, collider, rootY });
  return Object.freeze({
    ok: true,
    version: VERSION,
    spawn: normalizedSpawn,
    normalized,
    ground: Object.freeze({ height: ground.height, slopeDegrees: ground.slopeDegrees }),
    collider: Object.freeze({ height: collider.height, slopeDegrees: collider.slopeDegrees }),
    rootY: round(rootY),
    colliderDelta: round(colliderDelta),
  });
}

export function applyPlayerGeographicSpawn(object3D, resolution) {
  if (!object3D) return Object.freeze({ ok: false, error: 'player-object-missing' });
  if (!resolution?.ok) return Object.freeze({ ok: false, error: resolution?.error || 'spawn-resolution-failed' });
  if (!object3D.position) return Object.freeze({ ok: false, error: 'player-position-missing' });
  object3D.position.x = resolution.spawn.x;
  object3D.position.y = resolution.rootY;
  object3D.position.z = resolution.spawn.z;
  object3D.userData ||= {};
  object3D.userData.playerGeographicSpawn = {
    version: resolution.version,
    worldX: resolution.spawn.x,
    worldZ: resolution.spawn.z,
    normalizedX: resolution.normalized.x,
    normalizedY: resolution.normalized.y,
    groundY: resolution.ground.height,
    colliderY: resolution.collider.height,
    colliderDelta: resolution.colliderDelta,
  };
  return Object.freeze({ ok: true, object3D, spawn: object3D.userData.playerGeographicSpawn });
}

export function auditPlayerGeographicSpawn(object3D, { groundCollider, playerCollider = null, tolerance = SPAWN_GROUND_TOLERANCE } = {}) {
  const errors = [];
  if (!object3D?.position) errors.push('player-position-missing');
  if (!groundCollider) errors.push('ground-collider-missing');
  if (!object3D?.userData?.playerGeographicSpawn) errors.push('geographic-spawn-record-missing');
  const position = object3D?.position;
  const spawn = object3D?.userData?.playerGeographicSpawn;
  if (position && spawn) {
    if (Math.abs(Number(position.x) - Number(spawn.worldX)) > tolerance) errors.push('spawn-x-drift');
    if (Math.abs(Number(position.z) - Number(spawn.worldZ)) > tolerance) errors.push('spawn-z-drift');
  }
  let ground = null;
  if (position && groundCollider) {
    try {
      ground = validateGroundSample(sampleGround(groundCollider, position.x, position.z));
      if (!ground.ok) errors.push(ground.error);
      else if (Math.abs(position.y - ground.height) > tolerance) errors.push(`spawn-ground-drift:${round(Math.abs(position.y - ground.height))}`);
    } catch (error) {
      errors.push(`ground-query:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let collider = null;
  if (position && playerCollider) {
    try {
      const sample = sampleColliderGround(playerCollider, position.x, position.z);
      collider = sample ? validateGroundSample(sample) : null;
      if (collider && !collider.ok) errors.push(collider.error);
      if (collider?.ok && Math.abs(position.y - collider.height) > tolerance) errors.push(`spawn-collider-drift:${round(Math.abs(position.y - collider.height))}`);
    } catch (error) {
      errors.push(`collider-query:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), ground, collider, spawn: spawn || null });
}

export function buildPlayerGeographicSpawnProof(object3D, options = {}) {
  const audit = auditPlayerGeographicSpawn(object3D, options);
  const spawn = audit.spawn;
  const grounding = object3D && audit.ground?.ok ? evaluatePlayerGrounding({ object3D, groundSample: { height: audit.ground.height, slopeDegrees: audit.ground.slopeDegrees }, colliderGroundY: audit.collider?.height ?? audit.ground.height }) : null;
  return Object.freeze({
    ok: audit.ok && (!grounding || grounding.ok),
    version: VERSION,
    spawn: spawn ? Object.freeze({
      worldX: spawn.worldX,
      worldZ: spawn.worldZ,
      normalizedX: spawn.normalizedX,
      normalizedY: spawn.normalizedY,
      groundY: spawn.groundY,
      colliderY: spawn.colliderY,
      colliderDelta: spawn.colliderDelta,
    }) : null,
    grounding: grounding ? Object.freeze({ status: grounding.status, visualDelta: grounding.visualDelta, colliderDelta: grounding.colliderDelta, maxFootDelta: grounding.maxFootDelta }) : null,
    errors: Object.freeze([...audit.errors, ...(grounding?.errors || [])]),
    missingAssets: 0,
    consoleErrors: 0,
  });
}

export const PLAYER_GEOGRAPHIC_SPAWN_POLICY = Object.freeze({
  version: VERSION,
  groundToleranceMeters: SPAWN_GROUND_TOLERANCE,
  maxSlopeDegrees: MAX_SPAWN_SLOPE_DEGREES,
  canonicalMapRequired: true,
  terrainOwnerUnchanged: true,
  colliderOwnerUnchanged: true,
});
