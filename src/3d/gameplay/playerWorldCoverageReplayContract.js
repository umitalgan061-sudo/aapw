/**
 * Deterministic replay/record contract for Player World Coverage.
 *
 * The replay layer records caller-owned observations and player/equipment/combat inputs. It never
 * creates world geometry, mutates terrain, polls devices, loads assets, owns NPC AI, or applies
 * material placement. Its purpose is to make full-world coverage regressions reproducible.
 *
 * @module gameplay/playerWorldCoverageReplayContract
 */

import {
  PLAYER_WORLD_COVERAGE_VERSION,
  derivePlayerWorldContext,
  stableStringify,
} from './playerWorldCoverageDirector.js';

const DEFAULT_MAX_FRAMES = 240;
const MAX_OBSERVATIONS_PER_FRAME = 128;
const MAX_STRING_LENGTH = 160;
const MAX_REPLAY_BYTES = 900000;
const DEFAULT_DT = 1 / 60;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function stringValue(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean ? clean.slice(0, MAX_STRING_LENGTH) : fallback;
}

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function normalizeObservation(observation = {}) {
  return {
    id: stringValue(observation.id, 'observation'),
    position: {
      x: finite(observation.position?.x),
      y: finite(observation.position?.y),
      z: finite(observation.position?.z),
    },
    surface: stringValue(observation.surface, 'unknown'),
    biome: stringValue(observation.biome, 'unknown'),
    groundY: Number.isFinite(Number(observation.groundY)) ? finite(observation.groundY) : null,
    colliderY: Number.isFinite(Number(observation.colliderY)) ? finite(observation.colliderY) : null,
    canonicalY: Number.isFinite(Number(observation.canonicalY)) ? finite(observation.canonicalY) : null,
    slopeDegrees: clamp(observation.slopeDegrees, 0, 89.9),
    elevationMeters: finite(observation.elevationMeters),
    moisture: clamp(observation.moisture, 0, 1),
    snow: clamp(observation.snow, 0, 1),
    waterDepthMeters: Math.max(0, finite(observation.waterDepthMeters)),
    waterCoverage: clamp(observation.waterCoverage, 0, 1),
    roadDistanceMeters: observation.roadDistanceMeters === null ? null : Math.max(0, finite(observation.roadDistanceMeters)),
    settlementDistanceMeters: observation.settlementDistanceMeters === null ? null : Math.max(0, finite(observation.settlementDistanceMeters)),
    coastlineDistanceMeters: observation.coastlineDistanceMeters === null ? null : Math.max(0, finite(observation.coastlineDistanceMeters)),
    cliffDistanceMeters: observation.cliffDistanceMeters === null ? null : Math.max(0, finite(observation.cliffDistanceMeters)),
    assetReady: observation.assetReady !== false,
    visible: observation.visible !== false,
    confidence: clamp(observation.confidence, 0, 1),
    verified: observation.verified === true,
    observed: observation.observed === true,
    tags: Array.isArray(observation.tags) ? observation.tags.map((tag) => stringValue(tag)).filter(Boolean).slice(0, 24).sort() : [],
  };
}

function normalizeFrame(frame = {}, index = 0) {
  const observations = Array.isArray(frame.samples) ? frame.samples.slice(0, MAX_OBSERVATIONS_PER_FRAME).map(normalizeObservation) : [];
  return {
    index,
    dtSeconds: clamp(frame.dtSeconds, 0, 0.1) || DEFAULT_DT,
    nowSeconds: Math.max(0, finite(frame.nowSeconds, index * DEFAULT_DT)),
    player: clone(frame.player ?? {}),
    movement: clone(frame.movement ?? {}),
    combat: clone(frame.combat ?? {}),
    equipment: clone(frame.equipment ?? {}),
    interaction: clone(frame.interaction ?? {}),
    samples: observations,
  };
}

export function createReplayFrame(frame, index = 0) {
  return freeze(normalizeFrame(frame, index));
}

export function createReplayRecording({
  seed = 'player-world-coverage',
  maxFrames = DEFAULT_MAX_FRAMES,
} = {}) {
  const safeMaxFrames = Math.max(1, Math.min(2048, Math.floor(finite(maxFrames, DEFAULT_MAX_FRAMES))));
  const frames = [];
  let sealed = false;

  function assertOpen() {
    if (sealed) throw new Error('replay-recording-sealed');
  }

  function push(frame) {
    assertOpen();
    if (frames.length >= safeMaxFrames) throw new Error('replay-frame-limit');
    frames.push(createReplayFrame(frame, frames.length));
    return frames.length;
  }

  function seal() {
    assertOpen();
    const payload = { version: PLAYER_WORLD_COVERAGE_VERSION, seed: stringValue(seed, 'player-world-coverage'), frames };
    const serialized = stableStringify(payload);
    if (serialized.length > MAX_REPLAY_BYTES) throw new Error('replay-size-limit');
    sealed = true;
    return freeze({ ...payload, frameCount: frames.length, bytes: serialized.length, digest: hash(serialized) });
  }

  function size() {
    return stableStringify(frames).length;
  }

  return Object.freeze({
    push,
    seal,
    size,
    get frameCount() { return frames.length; },
    get isSealed() { return sealed; },
  });
}

export function replayRecording(recording, {
  config,
  fromFrame = 0,
  toFrame = null,
} = {}) {
  if (!recording || recording.version !== PLAYER_WORLD_COVERAGE_VERSION || !Array.isArray(recording.frames)) {
    throw new Error('invalid-replay-recording');
  }
  const start = Math.max(0, Math.floor(finite(fromFrame, 0)));
  const end = Math.min(recording.frames.length, toFrame === null ? recording.frames.length : Math.max(start, Math.floor(finite(toFrame))));
  const snapshots = [];
  for (let i = start; i < end; i += 1) {
    const frame = recording.frames[i];
    snapshots.push(derivePlayerWorldContext({
      player: frame.player,
      samples: frame.samples,
      equipment: frame.equipment,
      combat: frame.combat,
      movement: frame.movement,
      interaction: frame.interaction,
      nowSeconds: frame.nowSeconds,
      config,
    }));
  }
  return freeze({
    version: PLAYER_WORLD_COVERAGE_VERSION,
    frameCount: snapshots.length,
    start,
    end,
    snapshots,
    digest: hash(stableStringify(snapshots.map((snapshot) => snapshot.fingerprint))),
  });
}

export function compareReplayRuns(left, right) {
  const leftFrames = Array.isArray(left?.snapshots) ? left.snapshots : [];
  const rightFrames = Array.isArray(right?.snapshots) ? right.snapshots : [];
  const count = Math.min(leftFrames.length, rightFrames.length);
  const mismatches = [];
  for (let index = 0; index < count; index += 1) {
    if (leftFrames[index]?.fingerprint !== rightFrames[index]?.fingerprint) {
      mismatches.push({
        index,
        left: leftFrames[index]?.fingerprint ?? null,
        right: rightFrames[index]?.fingerprint ?? null,
      });
    }
  }
  if (leftFrames.length !== rightFrames.length) {
    mismatches.push({ index: count, left: leftFrames.length, right: rightFrames.length, reason: 'frame-count' });
  }
  return freeze({
    equal: mismatches.length === 0,
    comparedFrames: count,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 64),
  });
}

export function buildReplayFixture({ frames = 0, sampleFactory = null } = {}) {
  const recording = createReplayRecording({ maxFrames: Math.max(1, frames || 1) });
  const frameCount = Math.max(0, Math.min(256, Math.floor(finite(frames))));
  for (let index = 0; index < frameCount; index += 1) {
    const sample = typeof sampleFactory === 'function' ? sampleFactory(index) : {
      id: `fixture-${index}`,
      position: { x: index * 2, y: 0, z: index * -1.5 },
      surface: index % 3 === 0 ? 'grass' : index % 3 === 1 ? 'rock' : 'snow',
      biome: index % 2 ? 'forest' : 'alpine',
      groundY: 0,
      colliderY: 0,
      canonicalY: 0,
      slopeDegrees: index % 5,
      elevationMeters: 300 + index,
      moisture: 0.25,
      snow: index % 3 === 2 ? 0.6 : 0,
      waterDepthMeters: 0,
      waterCoverage: 0,
      assetReady: true,
      visible: true,
      confidence: 1,
      observed: true,
    };
    recording.push({
      dtSeconds: DEFAULT_DT,
      nowSeconds: index * DEFAULT_DT,
      player: { position: sample.position, isGrounded: true, speedMps: index % 4 },
      movement: { speedMps: index % 4, locomotion: index % 4 ? 'run' : 'idle' },
      combat: { isGrounded: true },
      equipment: { socketReady: true, assetReady: true, weaponReachMeters: 1.7 },
      samples: [sample],
    });
  }
  return recording.seal();
}

export function validateReplayRecording(recording) {
  const errors = [];
  const warnings = [];
  if (!recording || typeof recording !== 'object') errors.push('missing-recording');
  if (recording?.version !== PLAYER_WORLD_COVERAGE_VERSION) errors.push('version-mismatch');
  if (!Array.isArray(recording?.frames)) errors.push('missing-frames');
  if (Array.isArray(recording?.frames) && recording.frames.length > DEFAULT_MAX_FRAMES) warnings.push('large-recording');
  const serialized = recording ? stableStringify(recording) : '';
  if (serialized.length > MAX_REPLAY_BYTES) errors.push('recording-too-large');
  for (const [index, frame] of (recording?.frames ?? []).entries()) {
    if (frame.index !== index) errors.push(`frame-index-${index}`);
    if (frame.samples.length > MAX_OBSERVATIONS_PER_FRAME) errors.push(`frame-observation-limit-${index}`);
    if (frame.dtSeconds <= 0 || frame.dtSeconds > 0.1) warnings.push(`frame-dt-${index}`);
  }
  return freeze({ ok: errors.length === 0, errors, warnings, frameCount: recording?.frames?.length ?? 0, bytes: serialized.length });
}

export function buildReplayAcceptanceManifest(recording, replay) {
  const recordingValidation = validateReplayRecording(recording);
  const frameFingerprints = Array.isArray(replay?.snapshots) ? replay.snapshots.map((snapshot) => snapshot.fingerprint) : [];
  return freeze({
    contract: PLAYER_WORLD_COVERAGE_VERSION,
    accepted: recordingValidation.ok && Boolean(replay?.digest),
    recording: {
      frameCount: recordingValidation.frameCount,
      bytes: recordingValidation.bytes,
      digest: recording?.digest ?? null,
      errors: recordingValidation.errors,
      warnings: recordingValidation.warnings,
    },
    replay: {
      frameCount: frameFingerprints.length,
      digest: replay?.digest ?? null,
      firstFingerprint: frameFingerprints[0] ?? null,
      lastFingerprint: frameFingerprints.at(-1) ?? null,
    },
    deterministic: true,
    threeImported: false,
    editorImported: false,
  });
}
