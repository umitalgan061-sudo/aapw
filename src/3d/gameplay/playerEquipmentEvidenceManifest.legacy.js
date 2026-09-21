/**
 * Evidence manifest for the player equipment vertical slice.
 *
 * The shared MaterialAssignmentCore remains the authority for mesh/material validation and
 * material manifests. This module only composes that evidence with the existing equipment profile,
 * socket plan and runtime asset provenance so a shipped-player integration can be audited without
 * parsing DOM/editor state. It does not create materials or place assets itself.
 *
 * @module gameplay/playerEquipmentEvidenceManifest
 */

import { resolvePlayerEquipmentCombatProfile, buildPlayerEquipmentSocketPlan, buildPlayerMaterialAssignmentMetadata } from './playerEquipmentCombatProfile.js';
import { buildPlayerSocketAttachmentPlan, auditPlayerSocketAttachmentPlan } from './playerEquipmentSocketAttachment.js';

const MAX_ITEMS = 32;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => String(value ?? fallback).trim().slice(0, 160);
const freeze = (value) => Object.freeze(value);

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function normalizeAssetEvidence(asset = {}) {
  return freeze({
    id: text(asset.id, 'player'),
    src: text(asset.src, 'assets/models/characters/peasant_girl.fbx'),
    hydrated: asset.hydrated !== false,
    missing: Boolean(asset.missing),
    sourceFormat: text(asset.sourceFormat, 'fbx').toLowerCase(),
    sourceBytes: Math.max(0, Math.floor(finite(asset.sourceBytes, 0))),
    lfs: freeze({
      pointer: Boolean(asset.lfs?.pointer ?? asset.lfsPointer ?? false),
      oid: text(asset.lfs?.oid ?? asset.oid, ''),
      size: Math.max(0, Math.floor(finite(asset.lfs?.size ?? asset.lfsSize, asset.sourceBytes))),
    }),
  });
}

function normalizeSurfaceEvidence(surfaces = []) {
  if (!Array.isArray(surfaces)) return [];
  return surfaces.slice(0, MAX_ITEMS).map((surface, index) => freeze({
    index,
    meshName: text(surface?.meshName ?? surface?.name, `surface-${index}`),
    materialName: text(surface?.materialName ?? surface?.material, 'imported'),
    semantic: text(surface?.semantic ?? surface?.slot, 'surface'),
    textureWidth: Math.max(0, Math.floor(finite(surface?.textureWidth ?? surface?.width, 0))),
    textureHeight: Math.max(0, Math.floor(finite(surface?.textureHeight ?? surface?.height, 0))),
    uv: surface?.uv !== false,
  }));
}

function normalizePlacementEvidence(placement = {}) {
  const position = placement.position || {};
  const rotation = placement.rotation || {};
  const scale = placement.scale || {};
  return freeze({
    position: freeze({ x: finite(position.x), y: finite(position.y), z: finite(position.z) }),
    rotation: freeze({ x: finite(rotation.x), y: finite(rotation.y), z: finite(rotation.z) }),
    scale: freeze({
      x: clamp(finite(scale.x, 1), 0.01, 100),
      y: clamp(finite(scale.y, 1), 0.01, 100),
      z: clamp(finite(scale.z, 1), 0.01, 100),
    }),
    grounded: placement.grounded !== false,
    colliderAligned: placement.colliderAligned !== false,
  });
}

export function buildPlayerEquipmentEvidenceManifest({
  equipment = {},
  object3D = null,
  asset = {},
  surfaces = [],
  materialManifest = null,
  materialValidation = null,
  placement = {},
  runtime = {},
  timestamp = 0,
} = {}) {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  const sockets = buildPlayerEquipmentSocketPlan(object3D, profile);
  const attachments = buildPlayerSocketAttachmentPlan(profile, { rootScale: finite(runtime.rootScale, 1) });
  const socketAudit = auditPlayerSocketAttachmentPlan(attachments);
  const materialMetadata = buildPlayerMaterialAssignmentMetadata({ object: object3D, profile, textureSize: runtime.textureSize });
  const normalizedAsset = normalizeAssetEvidence({ ...asset, src: asset.src || materialMetadata.src });
  const normalizedSurfaces = normalizeSurfaceEvidence(surfaces);
  const placementEvidence = normalizePlacementEvidence(placement);
  const materialOk = materialValidation?.ok !== false && materialManifest?.validation?.ok !== false;
  const missingAssetCount = normalizedAsset.missing || !normalizedAsset.hydrated ? 1 : 0;
  const manifestCore = {
    version: 1,
    timestamp: Math.max(0, finite(timestamp)),
    asset: normalizedAsset,
    equipment: freeze({
      mainHand: profile.sourceIds.mainHand,
      offHand: profile.sourceIds.offHand,
      head: profile.sourceIds.head,
      chest: profile.sourceIds.chest,
      back: profile.sourceIds.back,
      ranged: profile.ranged,
      shield: profile.shieldEquipped,
      twoHanded: profile.twoHanded,
    }),
    sockets,
    attachments,
    socketAudit,
    surfaces: Object.freeze(normalizedSurfaces),
    material: freeze({
      metadata: materialMetadata,
      validationOk: materialOk,
      manifestVersion: materialManifest?.version ?? null,
      importedMaterialsPreferred: true,
      layeredFallbackAllowed: true,
    }),
    placement: placementEvidence,
    runtime: freeze({
      sceneBound: runtime.sceneBound !== false,
      spawnVerified: runtime.spawnVerified !== false,
      eventChainVerified: runtime.eventChainVerified !== false,
      consoleErrors: Math.max(0, Math.floor(finite(runtime.consoleErrors, 0))),
      pageErrors: Math.max(0, Math.floor(finite(runtime.pageErrors, 0))),
    }),
    acceptance: freeze({
      missingAssetCount,
      surfaceCount: normalizedSurfaces.length,
      socketCount: Object.values(attachments.bindings).filter(Boolean).length,
      materialValidationOk: materialOk,
      socketValidationOk: socketAudit.ok,
      grounded: placementEvidence.grounded,
      colliderAligned: placementEvidence.colliderAligned,
      errors: Math.max(0, Math.floor(finite(runtime.consoleErrors, 0))) + Math.max(0, Math.floor(finite(runtime.pageErrors, 0))) + (socketAudit.ok ? 0 : socketAudit.errors.length) + (materialOk ? 0 : 1),
    }),
  };
  const canonical = JSON.stringify(stable(manifestCore));
  return freeze({ ...manifestCore, deterministicKey: hashString(canonical) });
}

export function validatePlayerEquipmentEvidenceManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.version !== 1) errors.push('invalid-version');
  if (!manifest?.asset?.src) errors.push('missing-asset-src');
  if (!manifest?.equipment?.mainHand) errors.push('missing-main-hand-id');
  if (manifest?.acceptance?.missingAssetCount !== 0) errors.push('missing-asset');
  if (manifest?.acceptance?.materialValidationOk !== true) errors.push('material-validation');
  if (manifest?.acceptance?.socketValidationOk !== true) errors.push('socket-validation');
  if (manifest?.acceptance?.grounded !== true) errors.push('not-grounded');
  if (manifest?.acceptance?.colliderAligned !== true) errors.push('collider-misaligned');
  if ((manifest?.runtime?.consoleErrors ?? 0) !== 0) errors.push('console-errors');
  if ((manifest?.runtime?.pageErrors ?? 0) !== 0) errors.push('page-errors');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function comparePlayerEquipmentEvidenceManifests(left, right) {
  const leftKey = left?.deterministicKey || '';
  const rightKey = right?.deterministicKey || '';
  return freeze({
    equal: leftKey === rightKey,
    leftKey,
    rightKey,
    changed: leftKey !== rightKey,
  });
}

export function buildPlayerEquipmentAcceptanceSummary(manifest) {
  const validation = validatePlayerEquipmentEvidenceManifest(manifest);
  return freeze({
    ok: validation.ok,
    deterministicKey: text(manifest?.deterministicKey, ''),
    asset: text(manifest?.asset?.src, ''),
    missingAssetCount: Math.max(0, Math.floor(finite(manifest?.acceptance?.missingAssetCount, 0))),
    surfaceCount: Math.max(0, Math.floor(finite(manifest?.acceptance?.surfaceCount, 0))),
    socketCount: Math.max(0, Math.floor(finite(manifest?.acceptance?.socketCount, 0))),
    materialValidationOk: manifest?.acceptance?.materialValidationOk === true,
    grounded: manifest?.acceptance?.grounded === true,
    colliderAligned: manifest?.acceptance?.colliderAligned === true,
    errors: validation.errors,
  });
}
