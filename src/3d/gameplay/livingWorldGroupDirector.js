/**
 * Şafak Kartalı — bounded group coordination over the existing living-world agents.
 * This is an adapter, not a second NPC/fauna framework: it only selects a leader,
 * shares a threat/target snapshot, applies bounded alert propagation and keeps group
 * members inside the same geographically valid corridor.
 */

import { resolveLivingWorldGeography } from './livingWorldGeographyAdapter.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const distance2D = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));

function stableId(entry) {
  return String(entry?.agent?.id ?? entry?.id ?? '');
}

function hash32(value) {
  let hash = 2166136261;
  for (const char of String(value ?? 'seed')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function positionOf(entry) {
  return entry?.controller?.object3D?.position ?? entry?.position ?? null;
}

export function createLivingWorldGroup({
  id,
  members = [],
  alertRadiusMeters = 24,
  maxPropagationPerTick = 4,
  cohesionRadiusMeters = 18,
  geographyRadiusMeters = 28,
  maxGeographyChecksPerTick = 4,
  onGroupEvent = () => {},
} = {}) {
  if (!id) throw new Error('living-world group id is required');
  const roster = members.filter(Boolean);
  let leaderId = roster.map(stableId).sort((a, b) => a.localeCompare(b))[0] ?? null;
  let alertLevel = 0;
  let lastTarget = null;
  let elapsed = 0;
  let geographyCursor = 0;

  const pickLeader = () => {
    const candidate = roster
      .filter((entry) => entry.agent && typeof entry.agent.observe === 'function')
      .slice()
      .sort((a, b) => stableId(a).localeCompare(stableId(b)))[0];
    leaderId = candidate ? stableId(candidate) : null;
    return leaderId;
  };

  const leader = () => roster.find((entry) => stableId(entry) === leaderId) ?? null;
  const groupCenter = () => {
    const positions = roster.map(positionOf).filter((position) => Number.isFinite(position?.x) && Number.isFinite(position?.z));
    if (!positions.length) return null;
    return {
      x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
      z: positions.reduce((sum, position) => sum + position.z, 0) / positions.length,
    };
  };

  return {
    id,
    get leaderId() { return leaderId; },
    get alertLevel() { return alertLevel; },
    get memberCount() { return roster.length; },
    tick(delta = 0, {
      targetPosition = null,
      threat = false,
      nowHour = 12,
      sampleGeography = null,
      worldSeed = 0x51afac,
    } = {}) {
      const dt = clamp(delta, 0, 0.25);
      elapsed += dt;
      if (!leader()) pickLeader();
      const leaderEntry = leader();
      const leaderPosition = positionOf(leaderEntry);
      const center = groupCenter();
      const targetDistance = targetPosition && leaderPosition ? distance2D(leaderPosition, targetPosition) : Infinity;
      const leaderThreatened = Boolean(threat && targetDistance <= alertRadiusMeters);
      if (leaderThreatened) {
        lastTarget = { x: finite(targetPosition.x), z: finite(targetPosition.z) };
        alertLevel = clamp(alertLevel + dt * 2.5, 0, 1);
      } else {
        alertLevel = clamp(alertLevel - dt * 0.35, 0, 1);
        if (alertLevel === 0) lastTarget = null;
      }

      const propagated = [];
      const rejected = [];
      let geographyChecks = 0;
      if (leaderThreatened && lastTarget) {
        const ordered = roster
          .filter((entry) => stableId(entry) !== leaderId && entry.agent)
          .slice()
          .sort((a, b) => {
            const da = leaderPosition ? distance2D(positionOf(a), leaderPosition) : Infinity;
            const db = leaderPosition ? distance2D(positionOf(b), leaderPosition) : Infinity;
            return da - db || stableId(a).localeCompare(stableId(b));
          });
        for (const entry of ordered) {
          if (propagated.length >= maxPropagationPerTick) break;
          const position = positionOf(entry);
          if (position && leaderPosition && distance2D(position, leaderPosition) > cohesionRadiusMeters) continue;
          if (position && sampleGeography && geographyChecks < maxGeographyChecksPerTick) {
            geographyChecks += 1;
            const sample = sampleGeography(position.x, position.z);
            if (sample && sample.ok === false) {
              rejected.push({ id: stableId(entry), reason: sample.reason || 'geography-invalid' });
              continue;
            }
          }
          const result = entry.agent.observe({
            delta: dt,
            targetPosition: lastTarget,
            selfPosition: position,
            threat: Boolean(entry.kind === 'creature'),
            lineOfSight: true,
            nowHour,
            noise: 0,
          });
          propagated.push({ id: stableId(entry), state: result?.state ?? entry.agent.state });
        }
        onGroupEvent({ type: 'alert-propagated', groupId: id, leaderId, target: lastTarget, propagated, rejected, geographyChecks });
      } else if (!leaderThreatened && propagated.length === 0 && alertLevel === 0) {
        onGroupEvent({ type: 'alert-cleared', groupId: id, leaderId });
      }

      const cohesionViolations = [];
      if (center) {
        for (let index = 0; index < roster.length; index += 1) {
          const position = positionOf(roster[index]);
          if (!position) continue;
          if (distance2D(position, center) > cohesionRadiusMeters * 1.5) cohesionViolations.push(stableId(roster[index]));
        }
      }
      geographyCursor = (geographyCursor + geographyChecks) % Math.max(1, roster.length);

      return {
        id,
        leaderId,
        alertLevel: Number(alertLevel.toFixed(3)),
        target: lastTarget ? { ...lastTarget } : null,
        propagated,
        rejected,
        geographyChecks,
        geographyCursor,
        cohesionViolations,
        elapsedSeconds: Number(elapsed.toFixed(3)),
      };
    },
    snapshot() {
      return {
        id,
        leaderId,
        alertLevel: Number(alertLevel.toFixed(3)),
        target: lastTarget ? { ...lastTarget } : null,
        memberIds: roster.map(stableId).filter(Boolean).sort(),
        center: groupCenter(),
        formationSeed: hash32(id),
      };
    },
  };
}

export function attachLivingWorldGroups({ state, maxGroupSize = 6, onGroupEvent, worldSeed = 0x51afac } = {}) {
  const director = state?.livingWorldDirector;
  if (!director || !Array.isArray(director.agents)) throw new Error('living-world director must be attached before groups');
  const safeSize = Math.max(1, Math.min(12, Math.floor(maxGroupSize)));
  const agents = director.agents;
  const byFaction = new Map();
  for (const entry of agents) {
    const key = entry.controller?.object3D?.userData?.factionId || entry.agent?.factionId || entry.kind || 'neutral';
    if (!byFaction.has(key)) byFaction.set(key, []);
    byFaction.get(key).push(entry);
  }
  const groups = [...byFaction.entries()].flatMap(([factionId, entries]) => {
    const ordered = entries.slice().sort((a, b) => stableId(a).localeCompare(stableId(b)));
    const chunks = [];
    for (let i = 0; i < ordered.length; i += safeSize) chunks.push(ordered.slice(i, i + safeSize));
    return chunks.map((members, index) => createLivingWorldGroup({
      id: `group:${factionId}:${index}`,
      members,
      onGroupEvent,
    }));
  });
  director.groups = groups;
  director.groupWorldSeed = worldSeed;
  return groups;
}

export function tickLivingWorldGroups(state, delta, playerPosition, options = {}) {
  const groups = state?.livingWorldDirector?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => group.tick(delta, {
    targetPosition: playerPosition,
    worldSeed: state?.livingWorldDirector?.groupWorldSeed ?? 0x51afac,
    ...options,
  }));
}

export function sampleGroupMemberGeography(entry, worldState, position, {
  role = null,
  speciesId = null,
  worldSeed = 0x51afac,
} = {}) {
  const surface = worldState?.worldSurface || worldState?.worldContext || {};
  const slopeDegrees = typeof surface.sampleSlopeDegrees === 'function' ? surface.sampleSlopeDegrees(position.x, position.z) : 0;
  const waterDepth = typeof surface.sampleWaterDepth === 'function' ? surface.sampleWaterDepth(position.x, position.z) : 0;
  const groundHeight = typeof surface.sampleHeightMeters === 'function' ? surface.sampleHeightMeters(position.x, position.z) : null;
  return resolveLivingWorldGeography({
    worldX: position.x,
    worldZ: position.z,
    role: role || (entry?.kind === 'creature' ? 'wildlife' : entry?.agent?.role || 'guard'),
    speciesId: speciesId || entry?.speciesId || null,
    groundHeight,
    slopeDegrees: finite(slopeDegrees),
    waterDepth: finite(waterDepth),
    settlementDistance: Infinity,
    roadDistance: Infinity,
    seed: worldSeed,
  });
}
