/**
 * Şafak Kartalı — bounded group coordination over the existing living-world agents.
 * This is an adapter, not a second NPC/fauna framework: it only selects a leader,
 * shares a threat/target snapshot, and applies bounded alert propagation.
 */

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance2D = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));

export function createLivingWorldGroup({
  id,
  members = [],
  alertRadiusMeters = 24,
  maxPropagationPerTick = 4,
  cohesionRadiusMeters = 18,
  onGroupEvent = () => {},
} = {}) {
  if (!id) throw new Error('living-world group id is required');
  const roster = members.filter(Boolean);
  let leaderId = roster[0]?.agent?.id ?? null;
  let alertLevel = 0;
  let lastTarget = null;
  let elapsed = 0;

  const pickLeader = () => {
    const candidate = roster
      .filter((entry) => entry.agent && typeof entry.agent.observe === 'function')
      .sort((a, b) => String(a.agent.id).localeCompare(String(b.agent.id)))[0];
    leaderId = candidate?.agent?.id ?? null;
    return leaderId;
  };

  const leader = () => roster.find((entry) => entry.agent?.id === leaderId) ?? null;

  return {
    id,
    get leaderId() { return leaderId; },
    get alertLevel() { return alertLevel; },
    get memberCount() { return roster.length; },
    tick(delta = 0, { targetPosition = null, threat = false, nowHour = 12 } = {}) {
      const dt = clamp(finite(delta), 0, 0.25);
      elapsed += dt;
      if (!leader()) pickLeader();
      const leaderEntry = leader();
      const leaderPosition = leaderEntry?.controller?.object3D?.position ?? leaderEntry?.position ?? null;
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
      if (leaderThreatened && lastTarget) {
        for (const entry of roster) {
          if (propagated.length >= maxPropagationPerTick) break;
          if (!entry.agent || entry.agent.id === leaderId) continue;
          const position = entry.controller?.object3D?.position ?? entry.position ?? null;
          if (position && leaderPosition && distance2D(position, leaderPosition) > cohesionRadiusMeters) continue;
          const result = entry.agent.observe({
            delta: dt,
            targetPosition: lastTarget,
            threat: Boolean(entry.kind === 'creature'),
            lineOfSight: true,
            nowHour,
            noise: 0,
          });
          propagated.push({ id: entry.agent.id, state: result?.state ?? entry.agent.state });
        }
        onGroupEvent({ type: 'alert-propagated', groupId: id, leaderId, target: lastTarget, propagated });
      } else if (!leaderThreatened && propagated.length === 0 && alertLevel === 0) {
        onGroupEvent({ type: 'alert-cleared', groupId: id, leaderId });
      }

      return {
        id,
        leaderId,
        alertLevel: Number(alertLevel.toFixed(3)),
        target: lastTarget ? { ...lastTarget } : null,
        propagated,
        elapsedSeconds: Number(elapsed.toFixed(3)),
      };
    },
    snapshot() {
      return { id, leaderId, alertLevel: Number(alertLevel.toFixed(3)), target: lastTarget ? { ...lastTarget } : null, memberIds: roster.map((entry) => entry.agent?.id).filter(Boolean) };
    },
  };
}

export function attachLivingWorldGroups({ state, maxGroupSize = 6, onGroupEvent } = {}) {
  const director = state?.livingWorldDirector;
  if (!director || !Array.isArray(director.agents)) throw new Error('living-world director must be attached before groups');
  const agents = director.agents;
  const byFaction = new Map();
  for (const entry of agents) {
    const key = entry.controller?.object3D?.userData?.factionId || entry.agent?.factionId || entry.kind || 'neutral';
    if (!byFaction.has(key)) byFaction.set(key, []);
    byFaction.get(key).push(entry);
  }
  const groups = [...byFaction.entries()].flatMap(([factionId, entries]) => {
    const chunks = [];
    for (let i = 0; i < entries.length; i += maxGroupSize) chunks.push(entries.slice(i, i + maxGroupSize));
    return chunks.map((members, index) => createLivingWorldGroup({ id: `group:${factionId}:${index}`, members, onGroupEvent }));
  });
  director.groups = groups;
  return groups;
}

export function tickLivingWorldGroups(state, delta, playerPosition, options = {}) {
  const groups = state?.livingWorldDirector?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => group.tick(delta, { targetPosition: playerPosition, ...options }));
}
