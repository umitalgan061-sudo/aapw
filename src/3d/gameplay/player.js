/**
 * Playable third-person character controller.
 * Reuses the shipped peasant_girl idle/walk/run family, real ground/collider contracts and the
 * existing stamina/dodge/guard controller. Poise, guard-break and melee combo share one state machine.
 * @module gameplay/player
 */

import * as THREE from 'three';
import { PLAYER_CONFIG } from './gameplayConfig.js';
import { AssetLoader } from '../assetLoader.js';
import { integrateJumpArc } from '../physics.js';
import { gameEvents } from '../eventBus.js';
import { EVENTS } from '../config.js';
import { readDamageResolution, stageDamageResolution } from './health.js';

const PLAYER_ACTION_CONFIG = Object.freeze({
	MAX_STAMINA: 100,
	MAX_POISE: 100,
	SPRINT_SPEED_MPS: 8.2,
	SPRINT_DRAIN_PER_SECOND: 24,
	SPRINT_RESTART_STAMINA: 20,
	STAMINA_REGEN_PER_SECOND: 19,
	STAMINA_REGEN_DELAY_SECONDS: 0.65,
	DODGE_DOUBLE_TAP_WINDOW_SECONDS: 0.6,
	DODGE_COST: 28,
	DODGE_DURATION_SECONDS: 0.38,
	DODGE_SPEED_MPS: 10.5,
	DODGE_COOLDOWN_SECONDS: 0.22,
	DODGE_RUN_ANIMATION_TIMESCALE: 1.45,
	DODGE_IFRAME_START_SECONDS: 0.06,
	DODGE_IFRAME_END_SECONDS: 0.28,
	GUARD_DRAIN_PER_SECOND: 11,
	GUARD_MOVE_SPEED_MULTIPLIER: 0.5,
	GUARD_DAMAGE_MULTIPLIER: 0.4,
	GUARD_STAMINA_DAMAGE_RATIO: 0.35,
	GUARD_POISE_DAMAGE_RATIO: 1.25,
	PARRY_WINDOW_SECONDS: 0.16,
	PARRY_STAMINA_COST: 8,
	PARRY_FEEDBACK_SECONDS: 0.18,
	POISE_REGEN_PER_SECOND: 28,
	POISE_REGEN_DELAY_SECONDS: 0.9,
	HIT_POISE_DAMAGE_RATIO: 1,
	HIT_STAGGER_SECONDS: 0.32,
	HIT_STAGGER_POISE_RECOVERY: 35,
	GUARD_BREAK_SECONDS: 0.75,
	GUARD_BREAK_STAMINA_PENALTY: 12,
	LIGHT_ATTACK_STAMINA_COST: 12,
	HEAVY_ATTACK_STAMINA_COST: 24,
	LIGHT_ATTACK_SECONDS: 0.44,
	HEAVY_ATTACK_SECONDS: 0.72,
	LIGHT_ATTACK_ACTIVE_START_SECONDS: 0.14,
	LIGHT_ATTACK_ACTIVE_END_SECONDS: 0.26,
	HEAVY_ATTACK_ACTIVE_START_SECONDS: 0.28,
	HEAVY_ATTACK_ACTIVE_END_SECONDS: 0.46,
	ATTACK_COMBO_BUFFER_SECONDS: 0.28,
	ATTACK_COMBO_MAX_STEPS: 3,
	ATTACK_COMBO_COMMIT_BONUS_PER_STEP: 0.08,
	ATTACK_WINDUP_TURN_MULTIPLIER: 0.68,
	LIGHT_ATTACK_REACH_METERS: 1.65,
	HEAVY_ATTACK_REACH_METERS: 2.05,
	LIGHT_ATTACK_COMMIT_METERS: 0.58,
	HEAVY_ATTACK_COMMIT_METERS: 0.9,
	LIGHT_ATTACK_DAMAGE_SCALE: 1,
	HEAVY_ATTACK_DAMAGE_SCALE: 1.65,
	MAX_COLLISION_STEP_METERS: 0.45,
	MAX_FRAME_DELTA_SECONDS: 0.1,
});

const COMBAT_INPUT_EVENT = 'aapw:player-combat-input';
const ATTACK_WINDOW_EVENT = 'aapw:player-attack-window';
const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function attackCommitBudget(baseMeters, comboStep, comboBonusPerStep = PLAYER_ACTION_CONFIG.ATTACK_COMBO_COMMIT_BONUS_PER_STEP) {
	const base = Math.max(0, Number(baseMeters) || 0), step = Math.max(1, Math.floor(Number(comboStep) || 1)), bonus = Math.max(0, Number(comboBonusPerStep) || 0);
	return base * (1 + (step - 1) * bonus);
}
function computeAttackCommitStep(previousElapsedSeconds, nextElapsedSeconds, activeEndSeconds, totalCommitMeters, remainingCommitMeters) {
	const previous = Math.max(0, Number(previousElapsedSeconds) || 0), next = Math.max(previous, Number(nextElapsedSeconds) || 0), activeEnd = Math.max(0, Number(activeEndSeconds) || 0), total = Math.max(0, Number(totalCommitMeters) || 0), remaining = clamp(Number(remainingCommitMeters) || 0, 0, total);
	if (!(activeEnd > 0) || !(total > 0) || !(remaining > 0) || next <= previous) return 0;
	const committedTime = Math.max(0, Math.min(next, activeEnd) - Math.min(previous, activeEnd));
	return committedTime > 0 ? Math.min(remaining, total * (committedTime / activeEnd)) : 0;
}

export async function createPlayer({ assetLoader, groundCollider, playerCollider = null, spawn = { x: 0, z: 0 } }) {
	const model = await assetLoader.loadFBXModel(PLAYER_CONFIG.MODEL_URL, { fallbackColor: 0x4a90d9, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	const mixer = new THREE.AnimationMixer(model);
	const actions = {};
	for (const [name, url] of Object.entries(PLAYER_CONFIG.ANIMATION_URLS)) {
		const animationObject = await assetLoader.loadFBXModel(url);
		const clip = animationObject.animations[0];
		if (clip) actions[name] = mixer.clipAction(clip);
	}
	const groundY = groundCollider.getGroundHeight(spawn.x, spawn.z);
	model.position.set(spawn.x, groundY, spawn.z);
	let heightAboveGround = 0, velocityY = 0, isGrounded = true;
	let stamina = PLAYER_ACTION_CONFIG.MAX_STAMINA, sprintExhausted = false, regenDelayRemaining = 0;
	let poise = PLAYER_ACTION_CONFIG.MAX_POISE, poiseRegenDelayRemaining = 0, guardBreakRemaining = 0, hitStaggerRemaining = 0;
	let dodgeRemaining = 0, dodgeElapsed = 0, dodgeCooldownRemaining = 0, lastRunPressAge = Infinity, wasRunHeld = false;
	let runIntent = false, hasMovementInput = false, planarSpeedMps = 0, dodgeDirectionX = 0, dodgeDirectionZ = 1;
	let guarding = false, wasGuardHeld = false, parryWindowRemaining = 0, parryFeedbackRemaining = 0;
	let attackKind = 'none', attackRemaining = 0, attackElapsed = 0, attackActive = false, attackComboStep = 0, attackSerial = 0, attackCommitRemaining = 0;
	let bufferedAttackKind = 'none', attackBufferRemaining = 0;
	let lastDefenseResult = 'none', combatFeedbackSerial = 0, defeatResetQueued = false;
	let movementState = 'idle', currentActionName = null, lastTelemetryState = '', lastTelemetryStamina = -1, lastTelemetryPoise = -1;

	function playAction(name, timeScale = 1) {
		const next = actions[name]; if (!next) return; next.setEffectiveTimeScale(timeScale); if (currentActionName === name) return;
		next.reset().fadeIn(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS).play();
		if (currentActionName && actions[currentActionName]) actions[currentActionName].fadeOut(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS);
		currentActionName = name;
	}
	playAction('idle');

	function moveBy(directionX, directionZ, speed, delta) {
		const startX = model.position.x, startZ = model.position.z;
		const travelMeters = Math.hypot(directionX, directionZ) * speed * delta;
		const steps = playerCollider ? Math.max(1, Math.ceil(travelMeters / PLAYER_ACTION_CONFIG.MAX_COLLISION_STEP_METERS)) : 1;
		const stepDelta = steps > 0 ? delta / steps : 0;
		for (let step = 0; step < steps; step += 1) {
			let nextX = model.position.x + directionX * speed * stepDelta, nextZ = model.position.z + directionZ * speed * stepDelta;
			if (playerCollider) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
			model.position.x = nextX; model.position.z = nextZ;
		}
		return Math.hypot(model.position.x - startX, model.position.z - startZ);
	}
	function turnToward(directionX, directionZ, delta) {
		const targetYaw = Math.atan2(directionX, directionZ);
		const shortestTarget = model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
		model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, shortestTarget, Math.min(1, PLAYER_CONFIG.TURN_RATE_RADIANS_PER_SECOND * delta));
	}
	function spendStamina(amount) {
		stamina = clamp(stamina - amount, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA);
		regenDelayRemaining = PLAYER_ACTION_CONFIG.STAMINA_REGEN_DELAY_SECONDS;
		if (stamina <= 0) sprintExhausted = true;
	}
	function spendPoise(amount) {
		poise = clamp(poise - amount, 0, PLAYER_ACTION_CONFIG.MAX_POISE);
		poiseRegenDelayRemaining = PLAYER_ACTION_CONFIG.POISE_REGEN_DELAY_SECONDS;
	}
	function triggerGuardBreak() {
		guarding = false; parryWindowRemaining = 0; guardBreakRemaining = PLAYER_ACTION_CONFIG.GUARD_BREAK_SECONDS;
		spendStamina(PLAYER_ACTION_CONFIG.GUARD_BREAK_STAMINA_PENALTY); movementState = 'guard-break'; lastDefenseResult = 'guard-break'; playAction('idle', 1);
	}
	function attackTuning(kind) {
		return kind === 'heavy'
			? { cost: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_STAMINA_COST, duration: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_SECONDS, activeStart: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_ACTIVE_START_SECONDS, activeEnd: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_ACTIVE_END_SECONDS, reach: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_REACH_METERS, commitMeters: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_COMMIT_METERS, damageScale: PLAYER_ACTION_CONFIG.HEAVY_ATTACK_DAMAGE_SCALE }
			: { cost: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_STAMINA_COST, duration: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_SECONDS, activeStart: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_ACTIVE_START_SECONDS, activeEnd: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_ACTIVE_END_SECONDS, reach: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_REACH_METERS, commitMeters: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_COMMIT_METERS, damageScale: PLAYER_ACTION_CONFIG.LIGHT_ATTACK_DAMAGE_SCALE };
	}
	function publishAttackWindow(phase) {
		if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
		const tuning = attackTuning(attackKind);
		globalThis.dispatchEvent(new globalThis.CustomEvent(ATTACK_WINDOW_EVENT, { detail: Object.freeze({ serial: attackSerial, kind: attackKind, comboStep: attackComboStep, phase, active: attackActive, stamina: Number(stamina.toFixed(2)), reachMeters: tuning.reach, damageScale: tuning.damageScale, commitRemainingMeters: Number(attackCommitRemaining.toFixed(3)), position: Object.freeze({ x: Number(model.position.x.toFixed(3)), y: Number(model.position.y.toFixed(3)), z: Number(model.position.z.toFixed(3)) }), facing: Object.freeze({ x: Number(Math.sin(model.rotation.y).toFixed(4)), z: Number(Math.cos(model.rotation.y).toFixed(4)) }) }) }));
	}
	function captureCombatFeedbackContext() {
		return Object.freeze({
			stamina: Number(stamina.toFixed(2)),
			poise: Number(poise.toFixed(2)),
			state: movementState,
			position: Object.freeze({ x: Number(model.position.x.toFixed(3)), y: Number(model.position.y.toFixed(3)), z: Number(model.position.z.toFixed(3)) }),
		});
	}
	function publishCombatFeedback(outcome, rawAmount, appliedAmount, blockedAmount, context = null) {
		if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
		const snapshot = context ?? captureCombatFeedbackContext();
		combatFeedbackSerial += 1;
		globalThis.dispatchEvent(new globalThis.CustomEvent(COMBAT_FEEDBACK_EVENT, { detail: Object.freeze({
			serial: combatFeedbackSerial,
			outcome,
			rawAmount: Number(rawAmount.toFixed(4)),
			appliedAmount: Number(appliedAmount.toFixed(4)),
			blockedAmount: Number(blockedAmount.toFixed(4)),
			stamina: snapshot.stamina,
			poise: snapshot.poise,
			state: snapshot.state,
			position: snapshot.position,
		}) }));
	}
	function publishCombatFeedbackAfterHealth(outcome, payload, rawAmount, blockedAmount) {
		const context = captureCombatFeedbackContext();
		queueMicrotask(() => {
			const staged = readDamageResolution(payload);
			const appliedAmount = Number.isFinite(staged?.appliedAmount)
				? staged.appliedAmount
				: (Number.isFinite(payload?.appliedAmount) ? payload.appliedAmount : Math.max(0, Number(staged?.amount ?? payload?.amount) || 0));
			publishCombatFeedback(outcome, rawAmount, appliedAmount, blockedAmount, context);
		});
	}
	function interruptAttackForHit() {
		if (attackRemaining <= 0) return;
		if (attackActive) { attackActive = false; publishAttackWindow('active-end'); }
		publishAttackWindow('interrupted');
		attackKind = 'none'; attackRemaining = 0; attackElapsed = 0; attackComboStep = 0; attackCommitRemaining = 0; bufferedAttackKind = 'none'; attackBufferRemaining = 0;
	}
	function triggerHitStagger() {
		interruptAttackForHit(); guarding = false; parryWindowRemaining = 0; hitStaggerRemaining = PLAYER_ACTION_CONFIG.HIT_STAGGER_SECONDS;
		poise = PLAYER_ACTION_CONFIG.HIT_STAGGER_POISE_RECOVERY; poiseRegenDelayRemaining = PLAYER_ACTION_CONFIG.POISE_REGEN_DELAY_SECONDS;
		movementState = 'hit-stagger'; lastDefenseResult = 'hit-stagger'; playAction('idle', 1);
	}
	function canStartAttack(kind) {
		const tuning = attackTuning(kind);
		return (kind === 'light' || kind === 'heavy') && attackRemaining <= 0 && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && dodgeRemaining <= 0 && parryFeedbackRemaining <= 0 && !guarding && isGrounded && stamina >= tuning.cost;
	}
	function startAttack(kind, chained = false) {
		if (!canStartAttack(kind)) return false;
		const tuning = attackTuning(kind), previousComboStep = attackComboStep;
		spendStamina(tuning.cost); attackKind = kind; attackRemaining = tuning.duration; attackElapsed = 0; attackActive = false; attackSerial += 1;
		attackComboStep = chained ? Math.min(PLAYER_ACTION_CONFIG.ATTACK_COMBO_MAX_STEPS, previousComboStep + 1) : 1;
		attackCommitRemaining = attackCommitBudget(tuning.commitMeters, attackComboStep);
		bufferedAttackKind = 'none'; attackBufferRemaining = 0; guarding = false; parryWindowRemaining = 0; movementState = `attack-${kind}`; playAction('idle', 1); publishAttackWindow('start'); return true;
	}
	function updateAttack(dt, moveDirectionXZ) {
		if (attackRemaining <= 0) return;
		const tuning = attackTuning(attackKind), previousElapsed = attackElapsed;
		attackElapsed += dt; attackRemaining = Math.max(0, attackRemaining - dt);
		if (previousElapsed < tuning.activeStart && hasMovementInput) turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt * PLAYER_ACTION_CONFIG.ATTACK_WINDUP_TURN_MULTIPLIER);
		const commitStep = computeAttackCommitStep(previousElapsed, attackElapsed, tuning.activeEnd, attackCommitBudget(tuning.commitMeters, attackComboStep), attackCommitRemaining);
		if (commitStep > 0 && dt > 0) { const committedMeters = moveBy(Math.sin(model.rotation.y), Math.cos(model.rotation.y), commitStep / dt, dt); attackCommitRemaining = Math.max(0, attackCommitRemaining - committedMeters); }
		const activeNow = attackElapsed >= tuning.activeStart && attackElapsed < tuning.activeEnd;
		if (activeNow && !attackActive) { attackActive = true; publishAttackWindow('active-start'); }
		else if (!activeNow && attackActive) { attackActive = false; publishAttackWindow('active-end'); }
		movementState = `attack-${attackKind}`; playAction('idle', 1);
		if (attackRemaining > 0) return;
		if (attackActive) { attackActive = false; publishAttackWindow('active-end'); }
		publishAttackWindow('finish');
		const chainedKind = attackBufferRemaining > 0 ? bufferedAttackKind : 'none'; attackKind = 'none'; attackElapsed = 0; attackCommitRemaining = 0;
		if (chainedKind !== 'none' && startAttack(chainedKind, true)) return;
		attackComboStep = 0; bufferedAttackKind = 'none'; attackBufferRemaining = 0;
	}
	function onCombatInput(event) { const kind = event?.detail?.kind; if (kind !== 'light' && kind !== 'heavy') return; bufferedAttackKind = kind; attackBufferRemaining = PLAYER_ACTION_CONFIG.ATTACK_COMBO_BUFFER_SECONDS; }
	globalThis.addEventListener?.(COMBAT_INPUT_EVENT, onCombatInput);

	function canStartDodge() { return attackRemaining <= 0 && !guarding && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && hasMovementInput && isGrounded && dodgeRemaining <= 0 && dodgeCooldownRemaining <= 0 && stamina >= PLAYER_ACTION_CONFIG.DODGE_COST; }
	function startDodge(moveDirectionXZ) { const length = Math.hypot(moveDirectionXZ.x, moveDirectionXZ.z) || 1; dodgeDirectionX = moveDirectionXZ.x / length; dodgeDirectionZ = moveDirectionXZ.z / length; dodgeElapsed = 0; dodgeRemaining = PLAYER_ACTION_CONFIG.DODGE_DURATION_SECONDS; dodgeCooldownRemaining = PLAYER_ACTION_CONFIG.DODGE_COOLDOWN_SECONDS + dodgeRemaining; spendStamina(PLAYER_ACTION_CONFIG.DODGE_COST); lastRunPressAge = Infinity; }
	function isDodgeInvulnerable() { return dodgeRemaining > 0 && dodgeElapsed >= PLAYER_ACTION_CONFIG.DODGE_IFRAME_START_SECONDS && dodgeElapsed < PLAYER_ACTION_CONFIG.DODGE_IFRAME_END_SECONDS; }
	function attackPhase() { if (attackRemaining <= 0) return 'none'; const tuning = attackTuning(attackKind); if (attackElapsed < tuning.activeStart) return 'windup'; if (attackElapsed < tuning.activeEnd) return 'active'; return 'recovery'; }
	function motionSnapshot() {
		return Object.freeze({ state: movementState, stamina: Number(stamina.toFixed(2)), maxStamina: PLAYER_ACTION_CONFIG.MAX_STAMINA, staminaRatio: Number((stamina / PLAYER_ACTION_CONFIG.MAX_STAMINA).toFixed(4)), sprintExhausted, runIntent, poise: Number(poise.toFixed(2)), maxPoise: PLAYER_ACTION_CONFIG.MAX_POISE, poiseRatio: Number((poise / PLAYER_ACTION_CONFIG.MAX_POISE).toFixed(4)), guardBreakRemaining: Number(guardBreakRemaining.toFixed(3)), hitStaggerRemaining: Number(hitStaggerRemaining.toFixed(3)), guarding, parryWindowRemaining: Number(parryWindowRemaining.toFixed(3)), defenseResult: lastDefenseResult, attackKind, attackPhase: attackPhase(), attackComboStep, attackActive, attackRemaining: Number(attackRemaining.toFixed(3)), attackCommitRemaining: Number(attackCommitRemaining.toFixed(3)), isGrounded, canDodge: attackRemaining <= 0 && !guarding && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && isGrounded && dodgeRemaining <= 0 && dodgeCooldownRemaining <= 0 && stamina >= PLAYER_ACTION_CONFIG.DODGE_COST, isDodgeInvulnerable: isDodgeInvulnerable(), dodgeElapsed: Number(dodgeElapsed.toFixed(3)), speedMps: Number(planarSpeedMps.toFixed(3)), dodgeRemaining: Number(dodgeRemaining.toFixed(3)), dodgeCooldownRemaining: Number(dodgeCooldownRemaining.toFixed(3)), regenDelayRemaining: Number(regenDelayRemaining.toFixed(3)), position: Object.freeze({ x: Number(model.position.x.toFixed(3)), y: Number(model.position.y.toFixed(3)), z: Number(model.position.z.toFixed(3)) }) });
	}
	function publishMotionTelemetry(force = false) { const staminaBucket = Math.floor(stamina * 10), poiseBucket = Math.floor(poise * 10), transient = movementState === 'dodge' || movementState === 'parry' || movementState === 'guard-break' || movementState === 'hit-stagger' || movementState.startsWith('attack-'); if (!force && !transient && movementState === lastTelemetryState && staminaBucket === lastTelemetryStamina && poiseBucket === lastTelemetryPoise) return; lastTelemetryState = movementState; lastTelemetryStamina = staminaBucket; lastTelemetryPoise = poiseBucket; model.userData.playerMotion = motionSnapshot(); if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent(new globalThis.CustomEvent('aapw:player-motion', { detail: model.userData.playerMotion })); }
	function resetAfterDefeat() {
		heightAboveGround = 0; velocityY = 0; isGrounded = true;
		stamina = PLAYER_ACTION_CONFIG.MAX_STAMINA; sprintExhausted = false; regenDelayRemaining = 0;
		poise = PLAYER_ACTION_CONFIG.MAX_POISE; poiseRegenDelayRemaining = 0; guardBreakRemaining = 0; hitStaggerRemaining = 0;
		dodgeRemaining = 0; dodgeElapsed = 0; dodgeCooldownRemaining = 0; lastRunPressAge = Infinity; wasRunHeld = false;
		runIntent = false; hasMovementInput = false; planarSpeedMps = 0; dodgeDirectionX = 0; dodgeDirectionZ = 1;
		guarding = false; wasGuardHeld = false; parryWindowRemaining = 0; parryFeedbackRemaining = 0;
		attackKind = 'none'; attackRemaining = 0; attackElapsed = 0; attackActive = false; attackComboStep = 0; attackCommitRemaining = 0; bufferedAttackKind = 'none'; attackBufferRemaining = 0;
		lastDefenseResult = 'none'; movementState = 'idle'; playAction('idle', 1); publishMotionTelemetry(true);
	}
	function onPlayerDied() {
		if (defeatResetQueued) return;
		interruptAttackForHit();
		defeatResetQueued = true;
		queueMicrotask(() => {
			if (!defeatResetQueued) return;
			defeatResetQueued = false;
			resetAfterDefeat();
		});
	}

	function onIncomingDamage(payload) {
		const rawAmount = payload?.amount; if (!Number.isFinite(rawAmount) || !(rawAmount > 0)) return;
		stageDamageResolution(payload, { amount: rawAmount });
		if (!isGrounded || guardBreakRemaining > 0) { lastDefenseResult = guardBreakRemaining > 0 ? 'guard-break' : 'hit'; publishCombatFeedbackAfterHealth(lastDefenseResult, payload, rawAmount, 0); return; }
		if (isDodgeInvulnerable()) { lastDefenseResult = 'dodge'; stageDamageResolution(payload, { rawAmount, blockedAmount: rawAmount, amount: 0, mitigation: 'dodge' }); publishCombatFeedback('dodge', rawAmount, 0, rawAmount); publishMotionTelemetry(true); return; }
		if (parryWindowRemaining > 0 && stamina >= PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST) { spendStamina(PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST); parryWindowRemaining = 0; parryFeedbackRemaining = PLAYER_ACTION_CONFIG.PARRY_FEEDBACK_SECONDS; movementState = 'parry'; lastDefenseResult = 'parry'; stageDamageResolution(payload, { rawAmount, blockedAmount: rawAmount, amount: 0, mitigation: 'parry' }); publishCombatFeedback('parry', rawAmount, 0, rawAmount); publishMotionTelemetry(true); return; }
		if (!guarding || stamina <= 0) { spendPoise(rawAmount * PLAYER_ACTION_CONFIG.HIT_POISE_DAMAGE_RATIO); lastDefenseResult = 'hit'; if (poise <= 0) triggerHitStagger(); publishCombatFeedbackAfterHealth(lastDefenseResult, payload, rawAmount, 0); publishMotionTelemetry(true); return; }
		const reducedAmount = Number((rawAmount * PLAYER_ACTION_CONFIG.GUARD_DAMAGE_MULTIPLIER).toFixed(4)), blockedAmount = rawAmount - reducedAmount;
		spendStamina(blockedAmount * PLAYER_ACTION_CONFIG.GUARD_STAMINA_DAMAGE_RATIO); spendPoise(blockedAmount * PLAYER_ACTION_CONFIG.GUARD_POISE_DAMAGE_RATIO); lastDefenseResult = 'guard'; stageDamageResolution(payload, { rawAmount, blockedAmount, amount: reducedAmount, mitigation: 'guard' }); if (poise <= 0) triggerGuardBreak(); publishCombatFeedbackAfterHealth(lastDefenseResult, payload, rawAmount, blockedAmount); publishMotionTelemetry(true);
	}
	gameEvents.on(EVENTS.PLAYER_DAMAGED, onIncomingDamage);
	gameEvents.on(EVENTS.PLAYER_DIED, onPlayerDied);

	publishMotionTelemetry(); lastTelemetryState = ''; lastTelemetryStamina = -1; lastTelemetryPoise = -1;
	return {
		object3D: model,
		get stamina() { return stamina; }, get maxStamina() { return PLAYER_ACTION_CONFIG.MAX_STAMINA; }, get poise() { return poise; }, get maxPoise() { return PLAYER_ACTION_CONFIG.MAX_POISE; }, get movementState() { return movementState; }, get sprintExhausted() { return sprintExhausted; }, get isDodging() { return dodgeRemaining > 0; }, get isGuarding() { return guarding; }, get isGuardBroken() { return guardBreakRemaining > 0; }, get isAttacking() { return attackRemaining > 0; }, getMotionState: motionSnapshot,
		update(delta, moveDirectionXZ, isRunning, jumpRequested = false) {
			const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, PLAYER_ACTION_CONFIG.MAX_FRAME_DELTA_SECONDS), frameStartX = model.position.x, frameStartZ = model.position.z;
			hasMovementInput = moveDirectionXZ.x !== 0 || moveDirectionXZ.z !== 0; runIntent = Boolean(isRunning); lastRunPressAge += dt; dodgeCooldownRemaining = Math.max(0, dodgeCooldownRemaining - dt); regenDelayRemaining = Math.max(0, regenDelayRemaining - dt); poiseRegenDelayRemaining = Math.max(0, poiseRegenDelayRemaining - dt); guardBreakRemaining = Math.max(0, guardBreakRemaining - dt); hitStaggerRemaining = Math.max(0, hitStaggerRemaining - dt); parryWindowRemaining = Math.max(0, parryWindowRemaining - dt); parryFeedbackRemaining = Math.max(0, parryFeedbackRemaining - dt); attackBufferRemaining = Math.max(0, attackBufferRemaining - dt);
			if (attackBufferRemaining <= 0 && attackRemaining <= 0) bufferedAttackKind = 'none'; if (sprintExhausted && stamina >= PLAYER_ACTION_CONFIG.SPRINT_RESTART_STAMINA) sprintExhausted = false;
			const guardIntent = Boolean(moveDirectionXZ.guarding), guardPressed = guardIntent && !wasGuardHeld; guarding = guardIntent && attackRemaining <= 0 && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && isGrounded && dodgeRemaining <= 0 && stamina > 0; if (guardPressed && guarding && stamina >= PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST) parryWindowRemaining = PLAYER_ACTION_CONFIG.PARRY_WINDOW_SECONDS; wasGuardHeld = guardIntent;
			const runPressed = runIntent && !wasRunHeld, runJumpDodgeRequested = Boolean(jumpRequested) && runIntent; if (canStartDodge() && (runJumpDodgeRequested || (runPressed && lastRunPressAge <= PLAYER_ACTION_CONFIG.DODGE_DOUBLE_TAP_WINDOW_SECONDS))) startDodge(moveDirectionXZ); else if (runPressed) lastRunPressAge = 0; wasRunHeld = runIntent; if (attackRemaining <= 0 && hitStaggerRemaining <= 0 && attackBufferRemaining > 0 && bufferedAttackKind !== 'none') startAttack(bufferedAttackKind, false);
			if (guardBreakRemaining > 0) { guarding = false; movementState = 'guard-break'; playAction('idle', 1); }
			else if (hitStaggerRemaining > 0) { guarding = false; movementState = 'hit-stagger'; playAction('idle', 1); }
			else if (dodgeRemaining > 0) { dodgeElapsed += dt; dodgeRemaining = Math.max(0, dodgeRemaining - dt); moveBy(dodgeDirectionX, dodgeDirectionZ, PLAYER_ACTION_CONFIG.DODGE_SPEED_MPS, dt); turnToward(dodgeDirectionX, dodgeDirectionZ, dt); movementState = 'dodge'; playAction('running', PLAYER_ACTION_CONFIG.DODGE_RUN_ANIMATION_TIMESCALE); }
			else if (parryFeedbackRemaining > 0) { movementState = 'parry'; playAction('idle', 1); }
			else if (attackRemaining > 0) { guarding = false; updateAttack(dt, moveDirectionXZ); }
			else if (guarding) { spendStamina(PLAYER_ACTION_CONFIG.GUARD_DRAIN_PER_SECOND * dt); if (hasMovementInput) { moveBy(moveDirectionXZ.x, moveDirectionXZ.z, PLAYER_CONFIG.WALK_SPEED_MPS * PLAYER_ACTION_CONFIG.GUARD_MOVE_SPEED_MULTIPLIER, dt); turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt); playAction('walking', 0.65); } else playAction('idle', 1); movementState = 'guard'; }
			else if (hasMovementInput) { const sprinting = runIntent && isGrounded && !sprintExhausted && stamina > 0, speed = sprinting ? PLAYER_ACTION_CONFIG.SPRINT_SPEED_MPS : PLAYER_CONFIG.WALK_SPEED_MPS; moveBy(moveDirectionXZ.x, moveDirectionXZ.z, speed, dt); turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt); if (sprinting) { spendStamina(PLAYER_ACTION_CONFIG.SPRINT_DRAIN_PER_SECOND * dt); movementState = 'sprint'; playAction('running', 1); } else { movementState = isGrounded && runIntent && sprintExhausted ? 'exhausted' : (isGrounded ? 'walk' : 'airborne'); playAction('walking', 1); } }
			else { movementState = isGrounded ? 'idle' : 'airborne'; playAction('idle', 1); }
			if (attackRemaining <= 0 && dodgeRemaining <= 0 && !guarding && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && jumpRequested && isGrounded) { velocityY = PLAYER_CONFIG.JUMP_SPEED_MPS; isGrounded = false; }
			({ heightAboveGroundMeters: heightAboveGround, velocityYMps: velocityY, isGrounded } = integrateJumpArc(heightAboveGround, velocityY, dt, PLAYER_CONFIG.GRAVITY_MPS2)); model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z) + heightAboveGround;
			if (attackRemaining <= 0 && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && dodgeRemaining <= 0 && parryFeedbackRemaining <= 0) { if (!isGrounded) { guarding = false; movementState = 'airborne'; } else if (movementState === 'airborne' || movementState === 'guard-break' || movementState === 'hit-stagger' || movementState.startsWith('attack-')) movementState = hasMovementInput ? (runIntent && sprintExhausted ? 'exhausted' : 'walk') : 'idle'; }
			if (regenDelayRemaining <= 0 && attackRemaining <= 0 && dodgeRemaining <= 0 && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && !guarding && !(runIntent && hasMovementInput)) stamina = clamp(stamina + PLAYER_ACTION_CONFIG.STAMINA_REGEN_PER_SECOND * dt, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA); if (poiseRegenDelayRemaining <= 0 && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && !guarding) poise = clamp(poise + PLAYER_ACTION_CONFIG.POISE_REGEN_PER_SECOND * dt, 0, PLAYER_ACTION_CONFIG.MAX_POISE); planarSpeedMps = dt > 0 ? Math.hypot(model.position.x - frameStartX, model.position.z - frameStartZ) / dt : 0; mixer.update(dt); publishMotionTelemetry();
		},
		dispose() { defeatResetQueued = false; globalThis.removeEventListener?.(COMBAT_INPUT_EVENT, onCombatInput); gameEvents.off(EVENTS.PLAYER_DAMAGED, onIncomingDamage); gameEvents.off(EVENTS.PLAYER_DIED, onPlayerDied); mixer.stopAllAction(); AssetLoader.disposeObject3D(model); },
	};
}
