/**
 * Canonical gameplay-to-audio cue map.
 *
 * Keeps event names and sound categories in one auditable place. It intentionally stores no EventBus
 * references and installs no listeners; `game3d.js` or a future gameplay owner can translate its existing
 * event payloads through this map. This makes new world events acoustically consistent without requiring
 * every producer to know the audio implementation.
 */

const CUES = Object.freeze({
	player_step: Object.freeze({ cue: 'footstep', class: 'player', group: 'player', priority: 72, gain: 0.24, cooldownId: 'player-step' }),
	player_attack: Object.freeze({ cue: 'combat', class: 'player', group: 'combat', priority: 94, gain: 0.4, cooldownId: 'player-attack' }),
	player_damaged: Object.freeze({ cue: 'combat', class: 'player', group: 'combat', priority: 98, gain: 0.48, cooldownId: 'player-damaged' }),
	player_died: Object.freeze({ cue: 'combat', class: 'player', group: 'dialogue', priority: 100, gain: 0.55, cooldownId: 'player-died' }),
	dragon_roar: Object.freeze({ cue: 'dragon', class: 'dragon', group: 'combat', priority: 100, gain: 0.6, cooldownId: 'dragon-roar' }),
	dragon_attack: Object.freeze({ cue: 'dragon', class: 'dragon', group: 'combat', priority: 100, gain: 0.5, cooldownId: 'dragon-attack' }),
	combat_hit: Object.freeze({ cue: 'combat', class: 'combat', group: 'combat', priority: 96, gain: 0.42, cooldownId: 'combat-hit' }),
	world_storm: Object.freeze({ cue: 'storm', class: 'rain', group: 'weather', priority: 65, gain: 0.32, cooldownId: 'world-storm' }),
	settlement_discovered: Object.freeze({ cue: 'ambience', class: 'ui', group: 'ui', priority: 85, gain: 0.2, cooldownId: 'settlement-discovery' }),
	ui_click: Object.freeze({ cue: 'ui', class: 'ui', group: 'ui', priority: 90, gain: 0.18, cooldownId: 'ui-click' }),
});

const EVENT_ALIASES = Object.freeze({
	PLAYER_DAMAGED: 'player_damaged',
	PLAYER_DIED: 'player_died',
	WORLD_EVENT_TRIGGERED: 'world_storm',
	SETTLEMENT_DISCOVERED: 'settlement_discovered',
});

const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export function resolveAudioCue(keyOrEvent) {
	const key = typeof keyOrEvent === 'string' ? keyOrEvent : keyOrEvent?.cue ?? keyOrEvent?.type ?? keyOrEvent?.event;
	const resolved = CUES[key] ?? CUES[EVENT_ALIASES[key]];
	if (!resolved) return null;
	return freeze({ ...resolved });
}

export function buildAudioCueRequest(keyOrEvent, payload = {}) {
	const cue = resolveAudioCue(keyOrEvent);
	if (!cue) return null;
	const gain = Number.isFinite(payload.gain) ? Math.min(1, Math.max(0, payload.gain)) : cue.gain;
	return freeze({ id: payload.id ?? cue.cooldownId, kind: cue.cue, class: cue.class, group: cue.group, priority: cue.priority, gain, positional: payload.positional !== false, distance: Number.isFinite(payload.distance) ? Math.max(0, payload.distance) : 0, sourceId: payload.sourceId ?? null });
}

export function listAudioCueKeys() { return Object.keys(CUES); }
export function audioCueMapConstants() { return freeze({ cues: CUES, aliases: EVENT_ALIASES }); }
