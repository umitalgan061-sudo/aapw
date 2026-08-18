/**
 * Guard combat adapter for the established NPC controller. It deliberately does not own health,
 * hit detection, player state, or a second AI state machine: it observes the existing NPC
 * perception telemetry and emits the already-shipped EventBus damage contract after a bounded,
 * deterministic windup/cooldown. Hearing/assist/investigation/chase can never damage directly.
 * @module gameplay/npcCombatAdapter
 */

export const NPC_GUARD_ATTACK_DEFAULTS = Object.freeze({
	damage: 8,
	windupSeconds: 0.35,
	cooldownSeconds: 1.2,
	minimumCombatBlend: 0.55,
});

function finitePositive(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function wrapNpcWithCombatDamage(npc, {
	eventsBus,
	damageEventName,
	damage = NPC_GUARD_ATTACK_DEFAULTS.damage,
	windupSeconds = NPC_GUARD_ATTACK_DEFAULTS.windupSeconds,
	cooldownSeconds = NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds,
	minimumCombatBlend = NPC_GUARD_ATTACK_DEFAULTS.minimumCombatBlend,
} = {}) {
	if (!npc?.object3D || typeof npc.update !== 'function') throw new Error('NPC controller contract required');
	if (!eventsBus?.emit || !damageEventName) return npc;

	const boundedDamage = finitePositive(damage, NPC_GUARD_ATTACK_DEFAULTS.damage);
	const boundedWindup = Math.max(0.1, Math.min(0.8, finitePositive(windupSeconds, NPC_GUARD_ATTACK_DEFAULTS.windupSeconds)));
	const boundedCooldown = Math.max(0.5, Math.min(3, finitePositive(cooldownSeconds, NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds)));
	const requiredBlend = Math.max(0, Math.min(1, Number.isFinite(minimumCombatBlend) ? minimumCombatBlend : NPC_GUARD_ATTACK_DEFAULTS.minimumCombatBlend));
	let windupRemaining = 0;
	let cooldownRemaining = 0;
	let attacksEmitted = 0;
	let phase = 'idle';

	function publishTelemetry() {
		npc.object3D.userData.npcAttack = Object.freeze({
			phase,
			windupRemaining: Number(windupRemaining.toFixed(3)),
			cooldownRemaining: Number(cooldownRemaining.toFixed(3)),
			attacksEmitted,
			damage: boundedDamage,
		});
	}
	publishTelemetry();

	return {
		object3D: npc.object3D,
		displayName: npc.displayName ?? null,
		update(delta, playerPosition) {
			npc.update(delta, playerPosition);
			const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.25));
			cooldownRemaining = Math.max(0, cooldownRemaining - dt);
			const perception = npc.object3D.userData.npcPerception;
			const inCombat = perception?.intent === 'combat'
				&& perception?.lineOfSight === true
				&& npc.object3D.userData.combatStanceBlend >= requiredBlend;

			if (!inCombat) {
				windupRemaining = 0;
				phase = cooldownRemaining > 0 ? 'recover' : 'idle';
				publishTelemetry();
				return;
			}

			if (windupRemaining > 0) {
				windupRemaining = Math.max(0, windupRemaining - dt);
				phase = 'windup';
				if (windupRemaining === 0) {
					eventsBus.emit(damageEventName, { amount: boundedDamage, sourceId: npc.object3D.name || 'guard' });
					attacksEmitted += 1;
					cooldownRemaining = boundedCooldown;
					phase = 'recover';
				}
			} else if (cooldownRemaining === 0) {
				windupRemaining = boundedWindup;
				phase = 'windup';
			} else {
				phase = 'recover';
			}
			publishTelemetry();
		},
		dispose() { npc.dispose?.(); },
	};
}
