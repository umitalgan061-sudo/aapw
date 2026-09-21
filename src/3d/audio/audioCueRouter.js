/**
 * Audio cue routing layer.
 *
 * Maps semantic cue requests to canonical design records, scheduler entries and spatial registration
 * metadata. The router is intentionally transport-free: it returns decisions and does not play audio,
 * touch EventBus, or create browser nodes.
 */

import { buildAudioCueRequest } from './audioEventCueMap.js';
import { getAudioDesign, audioDesignMaxInstances, audioDesignIsCritical } from './audioDesignCatalog.js';

const ROUTES = Object.freeze({ UI: 'ui', WORLD: 'world', PLAYER: 'player', COMBAT: 'combat', WEATHER: 'weather', AMBIENCE: 'ambience', MUSIC: 'music' });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function routeFor(cue) {
	if (cue?.group === 'ui') return ROUTES.UI;
	if (cue?.group === 'combat') return ROUTES.COMBAT;
	if (cue?.group === 'player') return ROUTES.PLAYER;
	if (cue?.group === 'weather') return ROUTES.WEATHER;
	if (cue?.group === 'music') return ROUTES.MUSIC;
	if (cue?.group === 'ambience' || cue?.group === 'water') return ROUTES.AMBIENCE;
	return ROUTES.WORLD;
}

export function routeAudioCue(keyOrEvent, payload = {}, state = {}) {
	const cue = buildAudioCueRequest(keyOrEvent, payload);
	if (!cue) return null;
	const design = getAudioDesign(cue.id) ?? getAudioDesign(String(keyOrEvent));
	const designKey = design ? (getAudioDesign(cue.id) ? cue.id : String(keyOrEvent)) : null;
	const designMax = designKey ? audioDesignMaxInstances(designKey) : 2;
	const activeInstances = Math.max(0, Math.round(finiteOr(state.activeInstances, 0)));
	const critical = designKey ? audioDesignIsCritical(designKey) : cue.priority >= 95;
	const route = routeFor(cue);
	const admitted = critical || activeInstances < designMax;
	return freeze({ version: 1, admitted, route, critical, priority: cue.priority, cue, design: design ? freeze({ ...design }) : null, reason: admitted ? 'admitted' : 'instance-budget', instanceBudget: { active: activeInstances, max: designMax } });
}

export function buildSpatialRegistration(keyOrEvent, payload = {}) {
	const route = routeAudioCue(keyOrEvent, payload);
	if (!route || !route.admitted) return null;
	const design = route.design;
	if (!design?.spatial) return freeze({ version: 1, spatial: false, request: route.cue });
	return freeze({
		version: 1,
		spatial: true,
		request: { id: route.cue.id, class: route.cue.class, priority: route.cue.priority, gain: route.cue.gain, positional: true, position: payload.position ?? { x: 0, y: 0, z: 0 }, maxDistance: clamp(finiteOr(payload.maxDistance, 120), 4, 500), voiceCost: route.cue.class === 'dragon' ? 2 : 1 },
	});
}

export function routingConstants() { return freeze({ routes: ROUTES }); }
