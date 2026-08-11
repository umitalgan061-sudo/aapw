/**
 * The playable character (FAZ 4): loads the base Mixamo mesh + its idle/walking/running clips,
 * handles camera-relative WASD movement with ground-height snapping, and crossfades animation
 * state off real movement speed. See `src/3d/gameplay/README.md` for the module's conventions.
 * @module gameplay/player
 */

import * as THREE from 'three';
import { PLAYER_CONFIG } from './gameplayConfig.js';
import { AssetLoader } from '../assetLoader.js';
import { integrateJumpArc } from '../physics.js';
import { gameEvents } from '../eventBus.js';
import { EVENTS } from '../config.js';

/**
 * Loads the character and its animation clips, and returns a small controller object.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider `physics.js`'s collider.
 * @param {{resolveXZ: (x: number, z: number) => {x: number, z: number}}} [options.settlementCollider]
 *   `physics.js`'s `createSettlementCollider` (FAZ 3's "Basit ... collider") — optional so this
 *   module still works in any future context with no settlements (e.g. a unit test) without a
 *   caller needing to fabricate one; movement simply isn't blocked by castles when omitted.
 * @param {{x: number, z: number}} [options.spawn] World-space spawn point. `game3d.js` always
 *   passes this explicitly (converted from `PLAYER_CONFIG.SPAWN_MAP_X`/`SPAWN_MAP_Y` via
 *   `mapToWorldXZ`); the world-origin default below only covers a hypothetical future caller
 *   (e.g. a unit test) that omits it.
 * @returns {Promise<{
 *   object3D: THREE.Object3D,
 *   update: (delta: number, moveDirectionXZ: {x: number, z: number}, isRunning: boolean, jumpRequested?: boolean) => void,
 *   dispose: () => void,
 * }>}
 */
export async function createPlayer({
	assetLoader,
	groundCollider,
	settlementCollider = null,
	spawn = { x: 0, z: 0 },
}) {
	const model = await assetLoader.loadFBXModel(PLAYER_CONFIG.MODEL_URL, {
		fallbackColor: 0x4a90d9,
		fallbackSize: 1.8,
	});

	// Mixamo FBX exports store geometry in centimeters; correct it here rather than guessing a
	// hardcoded 0.01, so a differently-scaled future character asset still comes out right. Shared
	// with gameplay/npc.js via AssetLoader.correctMixamoFbxScale (added run 20) — see its doc comment.
	AssetLoader.correctMixamoFbxScale(model);

	const mixer = new THREE.AnimationMixer(model);
	/** @type {Record<string, THREE.AnimationAction>} */
	const actions = {};
	for (const [name, url] of Object.entries(PLAYER_CONFIG.ANIMATION_URLS)) {
		const animationObject = await assetLoader.loadFBXModel(url);
		const clip = animationObject.animations[0];
		if (clip) actions[name] = mixer.clipAction(clip);
	}

	const groundY = groundCollider.getGroundHeight(spawn.x, spawn.z);
	model.position.set(spawn.x, groundY, spawn.z);

	// Jump/gravity state (`physics.js`'s `integrateJumpArc`) — height is tracked *above* whatever
	// `groundCollider` reports at the player's current XZ each frame, so ordinary ground-following
	// (slopes, steps) is untouched: it's 0 except during an actual jump.
	let heightAboveGround = 0;
	let velocityY = 0;
	let isGrounded = true;

	let currentActionName = null;
	/** Crossfades to `name`'s action; a no-op if it's already the current one or was never loaded. */
	function playAction(name) {
		if (currentActionName === name || !actions[name]) return;
		const next = actions[name];
		next.reset().fadeIn(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS).play();
		if (currentActionName && actions[currentActionName]) {
			actions[currentActionName].fadeOut(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS);
		}
		currentActionName = name;
	}
	playAction('idle');

	return {
		object3D: model,

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, z: number}} moveDirectionXZ Normalized (or zero) world-space direction
		 *   — already camera-relative, computed by the caller (see this module's doc comment).
		 * @param {boolean} isRunning
		 * @param {boolean} [jumpRequested] Edge-triggered — true for at most one `update()` call per
		 *   jump key press (see `input.js`'s `KeyboardInput.getAxes`). Ignored while airborne.
		 */
		update(delta, moveDirectionXZ, isRunning, jumpRequested = false) {
			const hasInput = moveDirectionXZ.x !== 0 || moveDirectionXZ.z !== 0;

			if (hasInput) {
				const speed = isRunning ? PLAYER_CONFIG.RUN_SPEED_MPS : PLAYER_CONFIG.WALK_SPEED_MPS;
				let nextX = model.position.x + moveDirectionXZ.x * speed * delta;
				let nextZ = model.position.z + moveDirectionXZ.z * speed * delta;
				if (settlementCollider) {
					({ x: nextX, z: nextZ } = settlementCollider.resolveXZ(nextX, nextZ));
				}
				model.position.x = nextX;
				model.position.z = nextZ;

				const targetYaw = Math.atan2(moveDirectionXZ.x, moveDirectionXZ.z);
				const turnStep = PLAYER_CONFIG.TURN_RATE_RADIANS_PER_SECOND * delta;
				model.rotation.y = THREE.MathUtils.lerp(
					model.rotation.y,
					// Shortest-path angle lerp: avoids spinning the long way around at the -PI/PI seam.
					model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
					Math.min(1, turnStep),
				);
				playAction(isRunning ? 'running' : 'walking');
			} else {
				playAction('idle');
			}

			if (jumpRequested && isGrounded) {
				velocityY = PLAYER_CONFIG.JUMP_SPEED_MPS;
				isGrounded = false;
			}
			({ heightAboveGroundMeters: heightAboveGround, velocityYMps: velocityY, isGrounded } = integrateJumpArc(
				heightAboveGround,
				velocityY,
				delta,
				PLAYER_CONFIG.GRAVITY_MPS2,
			));
			// Always ground-height + jump-arc offset — 0 offset (the common case) reproduces the old
			// direct-snap-to-ground behavior exactly, so slope/step-following is unaffected by this change.
			model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z) + heightAboveGround;

			mixer.update(delta);
		},

		/** Stops all animation actions and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}

/** Run257 sandbox-combat event contract. This is intentionally not a quest/progression/save layer. */
export const SANDBOX_COMBAT_EVENTS_RUN257 = Object.freeze({
	PLAYER_ATTACK: 'sandboxCombat:playerAttack',
	PLAYER_BLOCK_STATE: 'sandboxCombat:playerBlockState',
	PLAYER_DODGE_STATE: 'sandboxCombat:playerDodgeState',
	TARGET_STATE: 'sandboxCombat:targetState',
	GUARD_IMPACT: 'sandboxCombat:guardImpact',
});

/** Run257 player-side combat tuning. No XP, rewards, objectives, save slots or completion state. */
export const SANDBOX_PLAYER_COMBAT_CONFIG_RUN257 = Object.freeze({
	MAX_STAMINA: 100,
	ATTACK_STAMINA_COST: 14,
	ATTACK_DAMAGE: 25,
	ATTACK_RANGE_METERS: 3.2,
	ATTACK_HALF_ANGLE_RADIANS: Math.PI / 3,
	ATTACK_COOLDOWN_SECONDS: 0.48,
	ATTACK_VISUAL_SECONDS: 0.32,
	DODGE_STAMINA_COST: 28,
	DODGE_DURATION_SECONDS: 0.28,
	DODGE_SPEED_MPS: 9.5,
	BLOCK_STAMINA_PER_SECOND: 13,
	STAMINA_REGEN_PER_SECOND: 22,
	TARGET_HUD_SECONDS: 3,
});

/** Pure arc helper retained as a stable browser-test seam for melee hit geometry. */
export function isSandboxCombatTargetInArcRun257(origin, forward, target, rangeMeters, halfAngleRadians) {
	const dx = target.x - origin.x;
	const dz = target.z - origin.z;
	const distance = Math.hypot(dx, dz);
	if (distance > rangeMeters) return false;
	if (distance === 0) return true;
	const dot = (dx / distance) * forward.x + (dz / distance) * forward.z;
	return dot >= Math.cos(halfAngleRadians);
}

function createSandboxCombatHudRun257() {
	if (typeof document === 'undefined') return null;
	if (!document.getElementById('g3d-sandbox-combat-style-run257')) {
		const style = document.createElement('style');
		style.id = 'g3d-sandbox-combat-style-run257';
		style.textContent = `
		.g3d-sandbox-combat{position:fixed;right:max(12px,env(safe-area-inset-right,0px));top:max(84px,calc(env(safe-area-inset-top,0px) + 84px));z-index:23;width:min(220px,calc(100vw - 24px));padding:9px 11px;border:1px solid rgba(200,150,10,.48);border-radius:9px;background:rgba(10,6,2,.72);color:#e8d4a0;font:12px/1.3 Georgia,serif;backdrop-filter:blur(6px);pointer-events:none}
		.g3d-sandbox-combat-row{display:flex;justify-content:space-between;gap:8px;align-items:center}.g3d-sandbox-combat-track{height:7px;margin-top:5px;border-radius:5px;background:rgba(0,0,0,.45);overflow:hidden}.g3d-sandbox-combat-fill{height:100%;width:100%;background:linear-gradient(90deg,#8c6714,#e8c458);transition:width .12s linear}.g3d-sandbox-combat-target{margin-top:7px;padding-top:6px;border-top:1px solid rgba(232,212,160,.16)}.g3d-sandbox-combat-target[hidden]{display:none}.g3d-sandbox-combat-target-fill{height:5px;margin-top:4px;border-radius:4px;background:#b9362a;transform-origin:left center}.g3d-sandbox-combat-status{margin-top:5px;min-height:15px;opacity:.82}.g3d-sandbox-combat-actions{display:none;pointer-events:auto}
		@media (pointer:coarse){.g3d-sandbox-combat{top:auto;bottom:max(28px,calc(env(safe-area-inset-bottom,0px) + 28px));right:max(18px,env(safe-area-inset-right,0px));width:174px}.g3d-sandbox-combat-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.g3d-sandbox-combat-actions button{min-width:0;min-height:44px;padding:5px 3px;border:1px solid rgba(200,150,10,.55);border-radius:9px;background:rgba(32,20,5,.86);color:#f0d9a0;font:700 11px Georgia,serif;touch-action:manipulation}.g3d-controls-help{bottom:max(188px,calc(env(safe-area-inset-bottom,0px) + 188px))}}
		`;
		document.head.appendChild(style);
	}
	const root = document.createElement('aside');
	root.className = 'g3d-sandbox-combat';
	root.setAttribute('aria-label', 'Yakın dövüş durumu');
	root.dataset.stamina = '100';
	root.dataset.blocking = 'false';
	root.dataset.dodging = 'false';
	root.innerHTML = '<div class="g3d-sandbox-combat-row"><strong>Dayanıklılık</strong><span data-role="value">100</span></div><div class="g3d-sandbox-combat-track"><div class="g3d-sandbox-combat-fill" data-role="fill"></div></div><div class="g3d-sandbox-combat-target" data-role="target" hidden><div class="g3d-sandbox-combat-row"><strong data-role="target-name">Muhafız</strong><span data-role="target-value">100/100</span></div><div class="g3d-sandbox-combat-target-fill" data-role="target-fill"></div></div><div class="g3d-sandbox-combat-status" data-role="status" aria-live="polite">F: saldır · C: blok · Q: kaçın</div><div class="g3d-sandbox-combat-actions"><button type="button" data-action="attack" aria-label="Saldır">⚔<br>Saldır</button><button type="button" data-action="block" aria-label="Blok">🛡<br>Blok</button><button type="button" data-action="dodge" aria-label="Kaçın">↝<br>Kaçın</button></div>';
	document.body.appendChild(root);
	return {
		root,
		value: root.querySelector('[data-role="value"]'),
		fill: root.querySelector('[data-role="fill"]'),
		target: root.querySelector('[data-role="target"]'),
		targetName: root.querySelector('[data-role="target-name"]'),
		targetValue: root.querySelector('[data-role="target-value"]'),
		targetFill: root.querySelector('[data-role="target-fill"]'),
		status: root.querySelector('[data-role="status"]'),
		attackButton: root.querySelector('[data-action="attack"]'),
		blockButton: root.querySelector('[data-action="block"]'),
		dodgeButton: root.querySelector('[data-action="dodge"]'),
	};
}

function createSandboxSwordRun257() {
	const group = new THREE.Group();
	group.name = 'run257-player-sword';
	const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0xd5d7dc, metalness: 0.72, roughness: 0.28 });
	const hiltMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3519, metalness: 0.15, roughness: 0.75 });
	const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.12, 0.035), bladeMaterial);
	blade.position.y = 0.62;
	blade.castShadow = true;
	const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.055, 0.07), hiltMaterial);
	guard.position.y = 0.06;
	const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.07), hiltMaterial);
	grip.position.y = -0.1;
	group.add(blade, guard, grip);
	group.userData.run257OwnedMaterials = [bladeMaterial, hiltMaterial];
	return group;
}

// Run257 additive wrapper: the existing locomotion/jump implementation above stays byte-for-byte intact.
const createPlayerBeforeSandboxCombatRun257 = createPlayer;
createPlayer = async function createPlayerWithSandboxCombatRun257(options) {
	const controller = await createPlayerBeforeSandboxCombatRun257(options);
	const model = controller.object3D;
	const baseUpdate = controller.update.bind(controller);
	const baseDispose = controller.dispose.bind(controller);
	const config = SANDBOX_PLAYER_COMBAT_CONFIG_RUN257;
	const hud = createSandboxCombatHudRun257();
	let stamina = config.MAX_STAMINA;
	let attackQueued = false;
	let dodgeQueued = false;
	let blocking = false;
	let attackCooldown = 0;
	let attackVisualRemaining = 0;
	let dodgeRemaining = 0;
	let targetHudRemaining = 0;
	let swordRig = null;
	let dodgeStateEmitted = false;

	const showStatus = (text) => { if (hud?.status) hud.status.textContent = text; };
	const publishBlockState = () => gameEvents.emit(SANDBOX_COMBAT_EVENTS_RUN257.PLAYER_BLOCK_STATE, { active: blocking });
	const publishDodgeState = (active) => gameEvents.emit(SANDBOX_COMBAT_EVENTS_RUN257.PLAYER_DODGE_STATE, { active });
	const requestAttack = () => { attackQueued = true; };
	const requestDodge = () => { dodgeQueued = true; };
	const paintStaminaImmediatelyRun257 = () => {
		if (!hud) return;
		hud.root.dataset.stamina = stamina.toFixed(1);
		hud.value.textContent = Math.round(stamina).toString();
		hud.fill.style.width = `${stamina}%`;
	};
	const performAttackImmediatelyRun257 = () => {
		if (blocking || dodgeRemaining > 0 || attackCooldown > 0 || stamina < config.ATTACK_STAMINA_COST) return false;
		attackQueued = false;
		stamina -= config.ATTACK_STAMINA_COST;
		attackCooldown = config.ATTACK_COOLDOWN_SECONDS;
		attackVisualRemaining = config.ATTACK_VISUAL_SECONDS;
		const forward = { x: Math.sin(model.rotation.y), z: Math.cos(model.rotation.y) };
		gameEvents.emit(SANDBOX_COMBAT_EVENTS_RUN257.PLAYER_ATTACK, {
			origin: { x: model.position.x, z: model.position.z },
			forward,
			rangeMeters: config.ATTACK_RANGE_METERS,
			halfAngleRadians: config.ATTACK_HALF_ANGLE_RADIANS,
			damage: config.ATTACK_DAMAGE,
		});
		paintStaminaImmediatelyRun257();
		showStatus('Kılıç savruldu.');
		return true;
	};
	const performDodgeImmediatelyRun257 = () => {
		if (blocking || dodgeRemaining > 0 || stamina < config.DODGE_STAMINA_COST) return false;
		dodgeQueued = false;
		stamina -= config.DODGE_STAMINA_COST;
		dodgeRemaining = config.DODGE_DURATION_SECONDS;
		publishDodgeState(true);
		dodgeStateEmitted = true;
		if (hud) hud.root.dataset.dodging = 'true';
		paintStaminaImmediatelyRun257();
		showStatus('Kaçınma adımı');
		return true;
	};
	const setBlocking = (next) => {
		const resolved = Boolean(next && stamina > 0 && dodgeRemaining <= 0);
		if (resolved === blocking) return;
		blocking = resolved;
		publishBlockState();
	};
	const onKeyDown = (event) => {
		if (event.repeat) return;
		if (event.code === 'KeyF') requestAttack();
		if (event.code === 'KeyQ') requestDodge();
		if (event.code === 'KeyC') setBlocking(true);
	};
	const onKeyUp = (event) => { if (event.code === 'KeyC') setBlocking(false); };
	const onImmediateCombatKeyDownRun257 = (event) => {
		if (event.repeat) return;
		if (event.code === 'KeyF') performAttackImmediatelyRun257();
		if (event.code === 'KeyQ') performDodgeImmediatelyRun257();
	};
	if (typeof window !== 'undefined') {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('keydown', onImmediateCombatKeyDownRun257, true);
	}
	const onAttackPointer = (event) => { event.preventDefault(); requestAttack(); };
	const onDodgePointer = (event) => { event.preventDefault(); requestDodge(); };
	const onBlockDown = (event) => { event.preventDefault(); setBlocking(true); };
	const onBlockUp = (event) => { event.preventDefault(); setBlocking(false); };
	const onImmediateAttackPointerRun257 = (event) => { event.preventDefault(); performAttackImmediatelyRun257(); };
	const onImmediateDodgePointerRun257 = (event) => { event.preventDefault(); performDodgeImmediatelyRun257(); };
	hud?.attackButton?.addEventListener('pointerdown', onAttackPointer);
	hud?.dodgeButton?.addEventListener('pointerdown', onDodgePointer);
	hud?.blockButton?.addEventListener('pointerdown', onBlockDown);
	hud?.blockButton?.addEventListener('pointerup', onBlockUp);
	hud?.blockButton?.addEventListener('pointercancel', onBlockUp);
	hud?.attackButton?.addEventListener('pointerdown', onImmediateAttackPointerRun257);
	hud?.dodgeButton?.addEventListener('pointerdown', onImmediateDodgePointerRun257);

	const unsubscribeTarget = gameEvents.on(SANDBOX_COMBAT_EVENTS_RUN257.TARGET_STATE, (payload) => {
		if (!hud || !payload) return;
		targetHudRemaining = config.TARGET_HUD_SECONDS;
		hud.target.hidden = false;
		hud.targetName.textContent = payload.name ?? 'Muhafız';
		hud.targetValue.textContent = `${Math.max(0, payload.current ?? 0)}/${payload.max ?? 100}`;
		hud.targetFill.style.transform = `scaleX(${Math.max(0, Math.min(1, (payload.current ?? 0) / Math.max(1, payload.max ?? 100)))})`;
		showStatus(payload.defeated ? `${payload.name ?? 'Muhafız'} yere düştü; birazdan yeniden ayağa kalkacak.` : 'Muhafız karşılık veriyor.');
	});
	const unsubscribeImpact = gameEvents.on(SANDBOX_COMBAT_EVENTS_RUN257.GUARD_IMPACT, ({ blocked, dodged } = {}) => {
		showStatus(dodged ? 'Saldırıdan kaçındın.' : blocked ? 'Darbeyi blokladın.' : 'Muhafız sana vurdu.');
	});

	controller.update = (delta, moveDirectionXZ, isRunning, jumpRequested = false) => {
		baseUpdate(delta, moveDirectionXZ, isRunning && !blocking, jumpRequested);
		attackCooldown = Math.max(0, attackCooldown - delta);
		attackVisualRemaining = Math.max(0, attackVisualRemaining - delta);
		if (targetHudRemaining > 0) {
			targetHudRemaining = Math.max(0, targetHudRemaining - delta);
			if (targetHudRemaining === 0 && hud) hud.target.hidden = true;
		}
		if (blocking) {
			stamina = Math.max(0, stamina - config.BLOCK_STAMINA_PER_SECOND * delta);
			if (stamina === 0) {
				setBlocking(false);
				showStatus('Dayanıklılığın tükendi.');
			}
		} else if (dodgeRemaining <= 0 && attackVisualRemaining <= 0) {
			stamina = Math.min(config.MAX_STAMINA, stamina + config.STAMINA_REGEN_PER_SECOND * delta);
		}

		if (dodgeQueued) {
			dodgeQueued = false;
			if (!blocking && dodgeRemaining <= 0 && stamina >= config.DODGE_STAMINA_COST) {
				stamina -= config.DODGE_STAMINA_COST;
				dodgeRemaining = config.DODGE_DURATION_SECONDS;
				publishDodgeState(true);
				dodgeStateEmitted = true;
				showStatus('Kaçınma adımı');
			}
		}
		if (dodgeRemaining > 0) {
			dodgeRemaining = Math.max(0, dodgeRemaining - delta);
			const forwardX = Math.sin(model.rotation.y);
			const forwardZ = Math.cos(model.rotation.y);
			let nextX = model.position.x + forwardX * config.DODGE_SPEED_MPS * delta;
			let nextZ = model.position.z + forwardZ * config.DODGE_SPEED_MPS * delta;
			if (options.settlementCollider) ({ x: nextX, z: nextZ } = options.settlementCollider.resolveXZ(nextX, nextZ));
			model.position.x = nextX;
			model.position.z = nextZ;
			const ground = options.groundCollider.getGroundHeight(nextX, nextZ);
			if (model.position.y < ground) model.position.y = ground;
			if (dodgeRemaining === 0 && dodgeStateEmitted) {
				publishDodgeState(false);
				dodgeStateEmitted = false;
			}
		}

		if (attackQueued) {
			attackQueued = false;
			if (!blocking && dodgeRemaining <= 0 && attackCooldown <= 0 && stamina >= config.ATTACK_STAMINA_COST) {
				stamina -= config.ATTACK_STAMINA_COST;
				attackCooldown = config.ATTACK_COOLDOWN_SECONDS;
				attackVisualRemaining = config.ATTACK_VISUAL_SECONDS;
				const forward = { x: Math.sin(model.rotation.y), z: Math.cos(model.rotation.y) };
				gameEvents.emit(SANDBOX_COMBAT_EVENTS_RUN257.PLAYER_ATTACK, {
					origin: { x: model.position.x, z: model.position.z },
					forward,
					rangeMeters: config.ATTACK_RANGE_METERS,
					halfAngleRadians: config.ATTACK_HALF_ANGLE_RADIANS,
					damage: config.ATTACK_DAMAGE,
				});
				showStatus('Kılıç savruldu.');
			}
		}

		if (!swordRig && model.parent) {
			swordRig = createSandboxSwordRun257();
			model.parent.add(swordRig);
		}
		if (swordRig) {
			const forwardX = Math.sin(model.rotation.y);
			const forwardZ = Math.cos(model.rotation.y);
			const rightX = Math.cos(model.rotation.y);
			const rightZ = -Math.sin(model.rotation.y);
			swordRig.position.set(model.position.x + rightX * 0.42 + forwardX * 0.08, model.position.y + 0.93, model.position.z + rightZ * 0.42 + forwardZ * 0.08);
			const attackPhase = attackVisualRemaining > 0 ? 1 - attackVisualRemaining / config.ATTACK_VISUAL_SECONDS : 0;
			const swing = attackVisualRemaining > 0 ? Math.sin(attackPhase * Math.PI) : 0;
			swordRig.rotation.set(0.12, model.rotation.y, -0.52 + swing * 1.72);
		}
		if (hud) {
			hud.root.dataset.stamina = stamina.toFixed(1);
			hud.root.dataset.blocking = String(blocking);
			hud.root.dataset.dodging = String(dodgeRemaining > 0);
			hud.value.textContent = Math.round(stamina).toString();
			hud.fill.style.width = `${stamina}%`;
		}
	};

	controller.dispose = () => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('keydown', onImmediateCombatKeyDownRun257, true);
		}
		hud?.attackButton?.removeEventListener('pointerdown', onAttackPointer);
		hud?.dodgeButton?.removeEventListener('pointerdown', onDodgePointer);
		hud?.blockButton?.removeEventListener('pointerdown', onBlockDown);
		hud?.blockButton?.removeEventListener('pointerup', onBlockUp);
		hud?.blockButton?.removeEventListener('pointercancel', onBlockUp);
		hud?.attackButton?.removeEventListener('pointerdown', onImmediateAttackPointerRun257);
		hud?.dodgeButton?.removeEventListener('pointerdown', onImmediateDodgePointerRun257);
		unsubscribeTarget();
		unsubscribeImpact();
		if (dodgeStateEmitted) publishDodgeState(false);
		if (blocking) {
			blocking = false;
			publishBlockState();
		}
		if (swordRig) {
			swordRig.parent?.remove(swordRig);
			swordRig.traverse((child) => child.geometry?.dispose?.());
			for (const material of swordRig.userData.run257OwnedMaterials ?? []) material.dispose();
		}
		hud?.root.remove();
		baseDispose();
	};

	model.userData.sandboxCombatRun257 = true;
	return controller;
};