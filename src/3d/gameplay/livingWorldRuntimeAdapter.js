/**
 * Şafak Kartalı runtime adapter.
 * Bridges the existing shipped NPC/creature state arrays to the deterministic director
 * without creating a second spawn, faction, combat or world-event framework.
 */
import { createLivingWorldAgent, createDeterministicWorldEventDirector } from './livingWorldDirector.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const distance2D = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));

function toPosition(object3D) {
  return object3D?.position ? { x: object3D.position.x, z: object3D.position.z } : null;
}

/**
 * Installs adapter metadata on the existing `state` object. The adapter deliberately does not
 * replace existing controllers; it observes the same objects and forwards bounded transitions to
 * their existing update/attack paths through callbacks.
 */
export function attachLivingWorldDirector({ state, eventsBus, worldSeed = 0x51afac } = {}) {
  if (!state || !Array.isArray(state.npcs) || !Array.isArray(state.creatures)) {
    throw new Error('living-world runtime state is incomplete');
  }
  const agents = [];
  for (const npc of state.npcs) {
    const home = toPosition(npc.object3D) ?? { x: 0, z: 0 };
    const agent = createLivingWorldAgent({
      id: npc.object3D?.name || `npc:${agents.length}`,
      role: 'guard',
      factionId: npc.object3D?.userData?.factionId || 'neutral',
      home,
      simulationLod: {
        step(delta, distanceToPlayer, urgent) {
          if (urgent || distanceToPlayer < 80) return Math.min(0.1, Math.max(0, finite(delta)));
          if (distanceToPlayer < 220) return Math.min(0.25, Math.max(0, finite(delta)));
          return 0;
        },
      },
      onAttack({ targetPosition, delta }) {
        if (typeof npc.update === 'function') npc.update(delta, targetPosition);
      },
      onStateChange: (change) => {
        npc.object3D.userData.livingWorldState = change;
      },
    });
    agents.push({ controller: npc, agent, kind: 'npc' });
  }
  for (const creature of state.creatures) {
    const home = toPosition(creature.object3D) ?? { x: 0, z: 0 };
    const agent = createLivingWorldAgent({
      id: creature.object3D?.name || `creature:${agents.length}`,
      role: 'wildlife',
      factionId: creature.object3D?.userData?.speciesId || 'wildlife',
      home,
      simulationLod: {
        step(delta, distanceToPlayer, urgent) {
          if (urgent || distanceToPlayer < 70) return Math.min(0.15, Math.max(0, finite(delta)));
          if (distanceToPlayer < 180) return Math.min(0.5, Math.max(0, finite(delta)));
          return 0;
        },
      },
      onStateChange: (change) => {
        creature.object3D.userData.livingWorldState = change;
      },
    });
    agents.push({ controller: creature, agent, kind: 'creature' });
  }
  state.livingWorldDirector = {
    worldSeed,
    agents,
    events: createDeterministicWorldEventDirector({ seed: worldSeed, cooldownSeconds: 30, maxEventsPerTick: 2 }),
    elapsedSeconds: 0,
    lastTick: null,
    tick(delta, playerPosition = null) {
      const dt = Math.min(0.25, Math.max(0, finite(delta)));
      this.elapsedSeconds += dt;
      const events = this.events.tick(dt, state.settlementSeats ?? []);
      const snapshots = [];
      for (const entry of this.agents) {
        const position = toPosition(entry.controller.object3D) ?? { x: 0, z: 0 };
        const distanceToPlayer = playerPosition ? distance2D(position, playerPosition) : Infinity;
        const result = entry.agent.observe({
          delta: dt,
          targetPosition: playerPosition,
          distanceToPlayer,
          lineOfSight: true,
          threat: entry.kind === 'creature' && distanceToPlayer < 18,
          noise: 0,
        });
        entry.controller.object3D.userData.livingWorldDirector = {
          kind: entry.kind,
          distanceToPlayer: Number(distanceToPlayer.toFixed(3)),
          result,
        };
        snapshots.push(result);
      }
      this.lastTick = { dt, events, snapshots };
      return this.lastTick;
    },
    dispose() {
      for (const entry of this.agents) delete entry.controller.object3D.userData.livingWorldDirector;
      this.agents.length = 0;
    },
  };
  return state.livingWorldDirector;
}

export function tickLivingWorldDirector(state, delta, playerPosition) {
  return state?.livingWorldDirector?.tick(delta, playerPosition) ?? null;
}
