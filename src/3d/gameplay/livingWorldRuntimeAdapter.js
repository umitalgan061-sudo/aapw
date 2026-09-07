/**
 * Şafak Kartalı runtime adapter.
 * Bridges the existing shipped NPC/creature state arrays to the deterministic director
 * without creating a second spawn, faction, combat or world-event framework.
 */
import { createLivingWorldAgent, createDeterministicWorldEventDirector } from './livingWorldDirector.js';
import { resolveLivingWorldGeography, resolveLivingWorldAssetProfile, livingWorldGeographyDigest } from './livingWorldGeographyAdapter.js';
import { buildLivingWorldVisualEvidence, mergeVisualContextIntoActorMetadata } from './livingWorldAssetVisualAdapter.js';
import { classifyLivingWorldGeographicContext, proposeLivingWorldScenarios } from './livingWorldGeographicScenarioDirector.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const distance2D = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));

function toPosition(object3D) {
  return object3D?.position ? { x: object3D.position.x, z: object3D.position.z } : null;
}

function speciesIdFor(controller) {
  return controller?.object3D?.userData?.speciesId || controller?.speciesId || null;
}

function sampleWorldContext(state, position) {
  const surface = state?.worldSurface || state?.worldContext || {};
  let groundHeight = null;
  if (typeof surface.sampleHeightMeters === 'function') groundHeight = surface.sampleHeightMeters(position.x, position.z);
  else if (typeof state?.groundCollider?.getGroundHeight === 'function') groundHeight = state.groundCollider.getGroundHeight(position.x, position.z);
  let slopeDegrees = 0;
  if (typeof surface.sampleSlopeDegrees === 'function') slopeDegrees = surface.sampleSlopeDegrees(position.x, position.z);
  let waterDepth = 0;
  if (typeof surface.sampleWaterDepth === 'function') waterDepth = surface.sampleWaterDepth(position.x, position.z);
  return {
    groundHeight: Number.isFinite(groundHeight) ? groundHeight : null,
    slopeDegrees: finite(slopeDegrees),
    waterDepth: Math.max(0, finite(waterDepth)),
    moisture: finite(typeof surface.sampleMoisture === 'function' ? surface.sampleMoisture(position.x, position.z) : surface.moisture),
    settlementSeats: surface.settlementSeats || state?.settlementSeats || [],
    roadEdges: surface.roadEdges || state?.roadEdges || [],
  };
}

function nearestSettlementDistance(position, seats) {
  let nearest = Infinity;
  for (const seat of seats || []) {
    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
    nearest = Math.min(nearest, distance2D(position, seat));
  }
  return nearest;
}

function nearestRoadDistance(position, edges) {
  let nearest = Infinity;
  for (const edge of edges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]; const b = points[i];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      const dx = b.x - a.x; const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / len2));
      nearest = Math.min(nearest, Math.hypot(position.x - (a.x + dx * t), position.z - (a.z + dz * t)));
    }
  }
  return nearest;
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
  const makeAgent = (controller, kind, index) => {
    const home = toPosition(controller.object3D) ?? { x: 0, z: 0 };
    const speciesId = speciesIdFor(controller);
    const role = kind === 'creature' ? 'wildlife' : (controller.object3D?.userData?.occupation || 'guard');
    const agent = createLivingWorldAgent({
      id: controller.object3D?.name || `${kind}:${index}`,
      role,
      factionId: controller.object3D?.userData?.factionId || (kind === 'creature' ? 'wildlife' : 'neutral'),
      home,
      simulationLod: {
        step(delta, distanceToPlayer, urgent) {
          if (urgent || distanceToPlayer < 80) return Math.min(0.1, Math.max(0, finite(delta)));
          if (distanceToPlayer < 220) return Math.min(kind === 'creature' ? 0.5 : 0.25, Math.max(0, finite(delta)));
          return 0;
        },
      },
      onAttack({ targetPosition, delta }) {
        if (typeof controller.update === 'function') controller.update(delta, targetPosition);
      },
      onStateChange: (change) => { controller.object3D.userData.livingWorldState = change; },
    });
    return { controller, agent, kind, speciesId };
  };

  for (let index = 0; index < state.npcs.length; index += 1) agents.push(makeAgent(state.npcs[index], 'npc', index));
  for (let index = 0; index < state.creatures.length; index += 1) agents.push(makeAgent(state.creatures[index], 'creature', index));

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
        const object3D = entry.controller.object3D;
        const position = toPosition(object3D) ?? { x: 0, z: 0 };
        const distanceToPlayer = playerPosition ? distance2D(position, playerPosition) : Infinity;
        const surface = sampleWorldContext(state, position);
        const settlementDistance = nearestSettlementDistance(position, surface.settlementSeats);
        const roadDistance = nearestRoadDistance(position, surface.roadEdges);
        const geography = resolveLivingWorldGeography({
          worldX: position.x, worldZ: position.z, speciesId: entry.speciesId,
          role: entry.kind === 'creature' ? 'wildlife' : entry.agent.role,
          groundHeight: surface.groundHeight, slopeDegrees: surface.slopeDegrees,
          waterDepth: surface.waterDepth, settlementDistance, roadDistance,
          seed: worldSeed,
        });
        const geoContext = classifyLivingWorldGeographicContext({
          worldX: position.x, worldZ: position.z, speciesId: entry.speciesId,
          role: entry.kind === 'creature' ? 'wildlife' : entry.agent.role,
          groundHeight: surface.groundHeight, slopeDegrees: surface.slopeDegrees,
          waterDepth: surface.waterDepth, settlementDistance, roadDistance,
          moisture: surface.moisture, seed: worldSeed,
        });
        const scenario = proposeLivingWorldScenarios({ context: geoContext, maxScenarios: 3 });
        const result = entry.agent.observe({
          delta: dt,
          targetPosition: playerPosition,
          selfPosition: position,
          distanceToPlayer,
          lineOfSight: true,
          threat: entry.kind === 'creature' && distanceToPlayer < 18,
          noise: 0,
          stealth: finite(object3D.userData?.stealth, 0),
          lighting: finite(object3D.userData?.ambientLight, 1),
          cover: finite(object3D.userData?.cover, 0),
        });
        const assetProfile = resolveLivingWorldAssetProfile({ worldX: position.x, worldZ: position.z, speciesId: entry.speciesId, role: entry.kind === 'creature' ? 'wildlife' : entry.agent.role });
        mergeVisualContextIntoActorMetadata(object3D, {
          worldX: position.x, worldZ: position.z, role: entry.kind === 'creature' ? 'wildlife' : entry.agent.role,
          speciesId: entry.speciesId, groundHeight: surface.groundHeight, slopeDegrees: surface.slopeDegrees,
          waterDepth: surface.waterDepth, settlementDistance, roadDistance, seed: worldSeed,
          assetId: object3D.userData?.assetId, assetPath: object3D.userData?.assetSrc,
        });
        let visualEvidence = null;
        if (object3D?.traverse) {
          visualEvidence = buildLivingWorldVisualEvidence(object3D, {
            worldX: position.x, worldZ: position.z, role: entry.kind === 'creature' ? 'wildlife' : entry.agent.role,
            speciesId: entry.speciesId, slopeDegrees: surface.slopeDegrees, waterDepth: surface.waterDepth,
            settlementDistance, roadDistance, moisture: surface.moisture, seed: worldSeed,
            assetId: object3D.userData?.assetId, sourcePath: object3D.userData?.assetSrc,
          });
        }
        object3D.userData.livingWorldGeography = {
          region: geography.region,
          profileId: geography.profileId,
          habitatValid: geography.ok,
          habitatReason: geography.reason,
          normalizedReference: geography.normalizedReference,
          slopeDegrees: geography.slopeDegrees,
          waterDepth: geography.waterDepth,
          settlementDistance,
          roadDistance,
          assetProfile,
          scenarioDigest: scenario.context?.seed ?? null,
          digest: livingWorldGeographyDigest(geography),
        };
        object3D.userData.livingWorldVisualEvidence = visualEvidence?.visual ? {
          ok: visualEvidence.visual.ok,
          region: visualEvidence.visual.region,
          semanticCoverage: visualEvidence.visual.semanticCoverage,
          texturedMaterialRatio: visualEvidence.visual.texturedMaterialRatio,
          normalMappedMaterialRatio: visualEvidence.visual.normalMappedMaterialRatio,
          missingRoles: visualEvidence.visual.missingRoles,
          fallbackReason: visualEvidence.visual.fallbackReason,
        } : null;
        object3D.userData.livingWorldScenarios = scenario.scenarios;
        object3D.userData.livingWorldDirector = {
          kind: entry.kind,
          distanceToPlayer: Number(distanceToPlayer.toFixed(3)),
          result,
        };
        snapshots.push({
          ...result,
          geography: geography.region,
          habitatValid: geography.ok,
          visual: visualEvidence?.visual || null,
          scenarios: scenario.scenarios,
        });
      }
      this.lastTick = { dt, events, snapshots };
      if (eventsBus?.emit) eventsBus.emit('living-world-tick', this.lastTick);
      return this.lastTick;
    },
    dispose() {
      for (const entry of this.agents) {
        delete entry.controller.object3D.userData.livingWorldDirector;
        delete entry.controller.object3D.userData.livingWorldGeography;
        delete entry.controller.object3D.userData.livingWorldVisualEvidence;
        delete entry.controller.object3D.userData.livingWorldScenarios;
      }
      this.agents.length = 0;
    },
  };
  return state.livingWorldDirector;
}

export function tickLivingWorldDirector(state, delta, playerPosition) {
  return state?.livingWorldDirector?.tick(delta, playerPosition) ?? null;
}
