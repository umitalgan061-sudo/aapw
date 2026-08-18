const NAV_TIMEOUT_MS = 30_000;

/**
 * Real shipped-runtime proof for configured guard perception. Loads the same Mixamo FBX family the
 * game uses and proves visual detect -> chase -> combat -> bounded attack damage, hearing-only
 * investigation, local assist across authored settlement spacing, and return-home behavior.
 */
async function checkNpcGuardPerception(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createNPC } = await import('/src/3d/gameplay/npc.js');
			const { wrapNpcWithCombatDamage } = await import('/src/3d/gameplay/npcCombatAdapter.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { NPC_CONFIG } = await import('/src/3d/gameplay/npcConfig.js');
			const { EVENTS } = await import('/src/3d/config.js');

			const assetLoader = new AssetLoader();
			const spawn = NPC_CONFIG.SPAWNS[0];
			const delta = 1 / 60;
			const groundCollider = { getGroundHeight: () => 0 };
			const passThroughCollider = { resolveXZ: (x, z) => ({ x, z }) };

			function makeGuard(name, {
				modelUrl = spawn.modelUrl,
				worldX = 0,
				worldZ = 0,
				rotationYRadians = 0,
				guardAlertChannel = null,
				guardAlertGroupId = null,
			} = {}) {
				return createNPC({
					assetLoader,
					modelUrl,
					idleAnimationUrl: NPC_CONFIG.IDLE_ANIMATION_URL,
					walkAnimationUrl: NPC_CONFIG.WALK_ANIMATION_URL,
					worldX,
					worldZ,
					groundY: 0,
					rotationYRadians,
					name,
					groundCollider,
					playerCollider: passThroughCollider,
					speedMps: NPC_CONFIG.PATROL_SPEED_MPS,
					turnRateRadiansPerSecond: NPC_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
					combatStanceTriggerRadiusMeters: NPC_CONFIG.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
					combatStanceIdleTimeScale: NPC_CONFIG.COMBAT_STANCE_IDLE_TIME_SCALE,
					combatStanceTransitionSeconds: NPC_CONFIG.COMBAT_STANCE_TRANSITION_SECONDS,
					perceptionEnabled: true,
					guardAlertChannel,
					guardAlertGroupId,
				});
			}

			const visualGuard = await makeGuard('smoke-visual-guard');
			const damageEvents = [];
			const attackGuard = wrapNpcWithCombatDamage(visualGuard, {
				eventsBus: { emit: (name, payload) => damageEvents.push({ name, payload }) },
				damageEventName: EVENTS.PLAYER_DAMAGED,
			});
			const visiblePlayer = { x: 0, z: 8 };
			let sawChase = false;
			let chaseDistanceClosed = false;
			let damageBeforeCombat = false;
			const chaseStartZ = attackGuard.object3D.position.z;
			for (let i = 0; i < 360; i += 1) {
				attackGuard.update(delta, visiblePlayer);
				const state = attackGuard.object3D.userData.npcPerception;
				if (state?.intent === 'chase') {
					sawChase = true;
					if (damageEvents.length > 0) damageBeforeCombat = true;
				}
				if (attackGuard.object3D.position.z > chaseStartZ + 0.5) chaseDistanceClosed = true;
				if (damageEvents.length > 0 && state?.intent === 'combat') break;
			}
			const visualState = attackGuard.object3D.userData.npcPerception;
			const visualAcquiresCombat = visualState?.intent === 'combat' && visualState.heard === false;
			const visualLosBounded = visualState?.lineOfSight === true && visualState.lineOfSightSamples <= 32;
			const combatBlendRaised = attackGuard.object3D.userData.combatStanceBlend > 0.5;
			const stoppedAtEngageRadius = Math.hypot(
				attackGuard.object3D.position.x - visiblePlayer.x,
				attackGuard.object3D.position.z - visiblePlayer.z,
			) <= (visualState?.engageRadiusMeters ?? 0) + 0.1;
			const guardDealsDamage = damageEvents.length === 1
				&& damageEvents[0].name === EVENTS.PLAYER_DAMAGED
				&& damageEvents[0].payload?.amount === 8
				&& damageEvents[0].payload?.sourceId === 'smoke-visual-guard';
			const attackTelemetry = attackGuard.object3D.userData.npcAttack;
			const attackCadenceBounded = attackTelemetry?.attacksEmitted === 1 && attackTelemetry?.phase === 'recover';
			const noDamageBeforeCombat = damageBeforeCombat === false;
			const countAfterAttack = damageEvents.length;
			for (let i = 0; i < 45; i += 1) attackGuard.update(delta, { x: 100, z: 100 });
			const disengageCancelsDamage = damageEvents.length === countAfterAttack
				&& attackGuard.object3D.userData.npcAttack?.phase !== 'windup';
			attackGuard.dispose();

			const assistChannel = { nextRevision: 1, groups: new Map() };
			const leaderSpawn = NPC_CONFIG.SPAWNS.find((entry) => entry.id === 'stannis-guard-1');
			const wingmanSpawn = NPC_CONFIG.SPAWNS.find((entry) => entry.id === 'stannis-guard-2');
			const authoredPairDistance = Math.hypot(
				leaderSpawn.offsetXMeters - wingmanSpawn.offsetXMeters,
				leaderSpawn.offsetZMeters - wingmanSpawn.offsetZMeters,
			);
			const assistPlayer = {
				x: leaderSpawn.offsetXMeters + Math.sin(leaderSpawn.rotationYRadians) * 8,
				z: leaderSpawn.offsetZMeters + Math.cos(leaderSpawn.rotationYRadians) * 8,
			};
			const leader = await makeGuard('smoke-assist-leader', {
				modelUrl: leaderSpawn.modelUrl,
				worldX: leaderSpawn.offsetXMeters,
				worldZ: leaderSpawn.offsetZMeters,
				rotationYRadians: leaderSpawn.rotationYRadians,
				guardAlertChannel: assistChannel,
				guardAlertGroupId: leaderSpawn.seatId,
			});
			const wingman = await makeGuard('smoke-assist-wingman', {
				modelUrl: wingmanSpawn.modelUrl,
				worldX: wingmanSpawn.offsetXMeters,
				worldZ: wingmanSpawn.offsetZMeters,
				rotationYRadians: wingmanSpawn.rotationYRadians,
				guardAlertChannel: assistChannel,
				guardAlertGroupId: wingmanSpawn.seatId,
			});
			for (let i = 0; i < 60 && assistChannel.nextRevision === 1; i += 1) leader.update(delta, assistPlayer);
			const publishedAlert = assistChannel.groups.get(leaderSpawn.seatId);
			const leaderPublished = assistChannel.nextRevision === 2 && publishedAlert?.sourceId === 'smoke-assist-leader';
			const revisionAfterLeader = assistChannel.nextRevision;
			const wingmanDistanceBefore = Math.hypot(
				wingman.object3D.position.x - assistPlayer.x,
				wingman.object3D.position.z - assistPlayer.z,
			);
			wingman.update(delta, assistPlayer);
			const assistState = wingman.object3D.userData.npcPerception;
			const wingmanDistanceAfter = Math.hypot(
				wingman.object3D.position.x - assistPlayer.x,
				wingman.object3D.position.z - assistPlayer.z,
			);
			const authoredPairInsideAssist = authoredPairDistance <= (assistState?.assistRadiusMeters ?? 0);
			const wingmanInvestigatesAssist = assistState?.assisted === true && assistState.reason === 'assist' && assistState.intent === 'investigate';
			const assistDoesNotCombat = wingman.object3D.userData.combatStanceBlend === 0 && assistState?.heard === false;
			const assistMovesTowardAlert = wingmanDistanceAfter < wingmanDistanceBefore;
			const assistDoesNotRebroadcast = assistChannel.nextRevision === revisionAfterLeader;
			leader.dispose();
			wingman.dispose();

			const hearingGuard = await makeGuard('smoke-hearing-guard');
			hearingGuard.update(delta, { x: 0, z: -6 });
			hearingGuard.update(delta, { x: 0, z: -5.8 });
			const hearingState = hearingGuard.object3D.userData.npcPerception;
			const hearingInvestigates = hearingState?.heard === true && hearingState.intent === 'investigate';
			const hearingDoesNotCombat = hearingGuard.object3D.userData.combatStanceBlend === 0;
			const movedTowardNoise = hearingGuard.object3D.position.z < 0;

			const farPlayer = { x: 100, z: 100 };
			for (let i = 0; i < 900; i += 1) hearingGuard.update(delta, farPlayer);
			const homeDistance = Math.hypot(hearingGuard.object3D.position.x, hearingGuard.object3D.position.z);
			const returnedHome = homeDistance <= 0.25;
			const finalState = hearingGuard.object3D.userData.npcPerception;
			const investigationExpired = finalState?.intent === 'patrol' && finalState.investigationRemaining === 0;
			hearingGuard.dispose();

			return {
				sawChase,
				chaseDistanceClosed,
				visualAcquiresCombat,
				visualLosBounded,
				combatBlendRaised,
				stoppedAtEngageRadius,
				guardDealsDamage,
				attackCadenceBounded,
				noDamageBeforeCombat,
				disengageCancelsDamage,
				authoredPairInsideAssist,
				leaderPublished,
				wingmanInvestigatesAssist,
				assistDoesNotCombat,
				assistMovesTowardAlert,
				assistDoesNotRebroadcast,
				hearingInvestigates,
				hearingDoesNotCombat,
				movedTowardNoise,
				returnedHome,
				investigationExpired,
				authoredPairDistance,
				homeDistance,
			};
		});
	} finally {
		await page.close();
	}

	const ok = Object.entries(result)
		.filter(([key]) => !['homeDistance', 'authoredPairDistance'].includes(key))
		.every(([, value]) => value === true);
	const details = ok
		? `real FBX guards detect/chase/combat/attack via canonical damage event; authored Stannis pair ${result.authoredPairDistance.toFixed(1)}m apart shares bounded assist without rebroadcast/combat; hearing investigates; LOS <=32; return home=${result.homeDistance.toFixed(3)}m`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'NPC guard detect/chase/combat/attack/assist/investigation (real createNPC runtime)', ok, details };
}

module.exports = { checkNpcGuardPerception };
