/**
 * Runtime-facing coordinator for the existing living-world owners.
 *
 * The director deliberately delegates entity simulation to injected NPC/animal/dragon
 * controllers. It does not replace their update loops, instantiate models, mutate the
 * canonical world map, own factions, or persist WorldEventSystem state.
 *
 * Responsibilities in this adapter are limited to:
 *  - occupation intent snapshots for actors that opt into schedules;
 *  - habitat/ecology admission summaries for caller-provided fauna contexts;
 *  - deterministic ambient event candidates forwarded to the existing publisher;
 *  - bounded runtime evidence for QA/performance accounting.
 */

import {
	auditOccupationSchedule,
	buildOccupationDirective,
	createOccupationScheduleState,
	advanceOccupationSchedule,
} from './livingWorldOccupationSchedule.js';
import {
	auditEcologyPlan,
	normalizeEcologyContext,
	planFaunaGroup,
	planHabitatSpecies,
	evaluateHabitat,
} from './livingWorldEcologyPolicy.js';
import {
	auditEventDirectorState,
	buildAmbientWorldEventReceipt,
	createEventDirectorState,
	createWorldEventPublisherAdapter,
	advanceEventDirector,
} from './livingWorldEventDirectorAdapter.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const MAX_ACTORS = 128;
const MAX_FAUNA_GROUPS = 24;
const MAX_EVENTS_PER_TICK = 3;

export const LIVING_WORLD_DIRECTOR_POLICY = freeze({
	id: 'living-world-director-runtime-adapter-2026-09-08-v1',
	deterministic: true,
	maxActors: MAX_ACTORS,
	maxFaunaGroups: MAX_FAUNA_GROUPS,
	maxEventsPerTick: MAX_EVENTS_PER_TICK,
	maxDeltaSeconds: 0.25,
	ownsControllerUpdates: false,
	ownsWorldPersistence: false,
});

function stableHash(value) {
	let hash = 2166136261;
	for (const character of String(value)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 2246822507) >>> 0;
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 3266489909) >>> 0;
	return (hash ^ (hash >>> 16)) >>> 0;
}

function controllerIdentity(controller, index, kind) {
	return controller?.object3D?.uuid
		?? controller?.object3D?.name
		?? controller?.id
		?? `${kind}-${index}`;
}

function asControllerArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.slice(0, MAX_ACTORS);
	try {
		const iterator = value[Symbol.iterator];
		if (typeof iterator !== 'function') return [];
		const result = [];
		for (const item of value) {
			result.push(item);
			if (result.length >= MAX_ACTORS) break;
		}
		return result;
	} catch {
		return [];
	}
}

function readPosition(actor) {
	const position = actor?.object3D?.position ?? actor?.position ?? null;
	if (!position) return null;
	const x = Number(position.x);
	const z = Number(position.z);
	return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function writeTelemetry(object3D, payload) {
	if (!object3D || typeof object3D !== 'object') return false;
	try {
		if (!object3D.userData || typeof object3D.userData !== 'object') object3D.userData = {};
		object3D.userData.livingWorldDirector = freeze(payload);
		return true;
	} catch {
		return false;
	}
}

function boundedActorSnapshot(controllers, playerPosition) {
	const safePlayer = readPosition({ position: playerPosition });
	return controllers
		.map((controller, index) => {
			const position = readPosition(controller);
			const distance = safePlayer && position ? Math.hypot(position.x - safePlayer.x, position.z - safePlayer.z) : Infinity;
			const object = controller?.object3D;
			const state = controller?.state ?? controller?.currentState ?? object?.userData?.npcPerception?.intent ?? object?.userData?.wildlifeFlee?.phase ?? 'unknown';
			return {
				controller,
				index,
				position,
				distanceMeters: distance,
				state: String(state),
				id: String(controllerIdentity(controller, index, 'actor')),
			};
		})
		.sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id))
		.slice(0, MAX_ACTORS);
}

function normalizeOccupationEntries(entries) {
	if (!Array.isArray(entries)) return [];
	return entries.slice(0, MAX_ACTORS).map((entry, index) => ({
		controller: entry?.controller ?? entry?.actor ?? null,
		definition: entry?.definition ?? entry?.occupation ?? null,
		index,
	})).filter((entry) => entry.controller && entry.definition);
}

function normalizeFaunaRequests(requests) {
	if (!Array.isArray(requests)) return [];
	return requests.slice(0, MAX_FAUNA_GROUPS).map((request, index) => ({
		index,
		species: request?.species,
		centerX: finite(request?.centerX),
		centerZ: finite(request?.centerZ),
		radiusMeters: Math.max(1, Math.min(250, finite(request?.radiusMeters, 24))),
		seed: request?.seed == null ? index : request.seed,
		context: normalizeEcologyContext(request?.context ?? {}),
		existingSpecies: Array.isArray(request?.existingSpecies) ? request.existingSpecies : [],
	})).filter((request) => request.species != null);
}

function makeScheduleRecord(entry, clockSeconds, currentPosition) {
	const audit = auditOccupationSchedule(entry.definition);
	if (!audit.ok) return freeze({ accepted: false, index: entry.index, errors: audit.errors });
	const directive = buildOccupationDirective(entry.definition, clockSeconds, currentPosition);
	return freeze({
		accepted: true,
		index: entry.index,
		controllerId: String(controllerIdentity(entry.controller, entry.index, 'npc')),
		directive,
	});
}

export function createLivingWorldDirector({
	worldEventPublisher,
	worldEventNormalizer,
	seed = 0,
	clockSeconds = 0,
} = {}) {
	const eventState = createEventDirectorState(seed, clockSeconds);
	const publisher = createWorldEventPublisherAdapter({ publish: worldEventPublisher, normalizePayload: worldEventNormalizer });
	const occupationStates = new WeakMap();
	const actorTicks = new WeakMap();
	let disposed = false;
	let tickCount = 0;
	let emittedEvents = 0;

	function stateForOccupation(controller, definition) {
		if (!controller || typeof controller !== 'object') return null;
		let state = occupationStates.get(controller);
		if (!state || state.definition?.id !== String(definition?.id ?? 'occupation')) {
			state = createOccupationScheduleState(definition, eventState.clockSeconds);
			occupationStates.set(controller, state);
		}
		return state;
	}

	function tickControllers(collections, deltaSeconds, playerPosition) {
		const all = [];
		const sourceKinds = [
			['npc', collections?.npcs],
			['animal', collections?.animals],
			['creature', collections?.creatures],
			['dragon', collections?.dragons],
		];
		for (const [kind, value] of sourceKinds) {
			for (const controller of asControllerArray(value)) all.push({ kind, controller });
		}
		const ordered = boundedActorSnapshot(all.map((entry) => entry.controller), playerPosition);
		for (const snapshot of ordered) {
			const entry = all.find((candidate) => candidate.controller === snapshot.controller);
			if (!entry || typeof entry.controller?.update !== 'function') continue;
			try {
				const before = actorTicks.get(entry.controller) ?? 0;
				entry.controller.update(deltaSeconds, playerPosition);
				actorTicks.set(entry.controller, before + 1);
			} catch {
				actorTicks.set(entry.controller, actorTicks.get(entry.controller) ?? 0);
			}
		}
		return ordered.length;
	}

	function tickOccupations(entries, deltaSeconds, currentPositions = new Map()) {
		const records = [];
		for (const entry of normalizeOccupationEntries(entries)) {
			const audit = auditOccupationSchedule(entry.definition);
			if (!audit.ok) {
				records.push(freeze({ accepted: false, index: entry.index, errors: audit.errors }));
				continue;
			}
			const state = stateForOccupation(entry.controller, entry.definition);
			const currentPosition = currentPositions.get(entry.controller) ?? readPosition(entry.controller);
			try {
				const directive = advanceOccupationSchedule(state, deltaSeconds, { currentPosition });
				writeTelemetry(entry.controller.object3D, {
					phase: directive.phase,
					activityId: directive.activityId,
					locationId: directive.locationId,
					travel: directive.shouldTravel,
					nextChangeSeconds: directive.nextChangeSeconds,
				});
				records.push(freeze({
					accepted: true,
					index: entry.index,
					controllerId: String(controllerIdentity(entry.controller, entry.index, 'npc')),
					directive,
				}));
			} catch {
				records.push(freeze({ accepted: false, index: entry.index, errors: freeze(['advance-error']) }));
			}
		}
		return freeze(records);
	}

	function evaluateFauna(requests) {
		const normalized = normalizeFaunaRequests(requests);
		const plans = [];
		for (const request of normalized) {
			const habitat = evaluateHabitat(request.species, request.context);
			const group = planFaunaGroup(request);
			const audit = auditEcologyPlan(group);
			plans.push(freeze({
				index: request.index,
				species: String(request.species),
				habitat,
				group,
				audit,
			}));
		}
		return freeze(plans);
	}

	function chooseHabitatSpecies(species, context, maxSpecies = 8) {
		return planHabitatSpecies({ species, context, seed, maxSpecies });
	}

	function tickWorldEvents(deltaSeconds, context, types) {
		const result = advanceEventDirector(eventState, deltaSeconds, context, {
			types,
			maxEmissions: MAX_EVENTS_PER_TICK,
		});
		const receipts = [];
		for (const event of result.candidates) {
			const receipt = buildAmbientWorldEventReceipt(event, context);
			const emitted = publisher.emit(receipt);
			receipts.push(freeze({ event, receipt, emitted }));
			if (emitted.accepted) emittedEvents += 1;
		}
		return freeze({ ...result, receipts: freeze(receipts) });
	}

	return {
		get disposed() { return disposed; },
		tick({ deltaSeconds = 0, collections = {}, playerPosition = null, occupations = [], faunaRequests = [], eventContext = {}, eventTypes = null } = {}) {
			if (disposed) return freeze({ accepted: false, reason: 'disposed' });
			const delta = Math.max(0, Math.min(LIVING_WORLD_DIRECTOR_POLICY.maxDeltaSeconds, finite(deltaSeconds, 0)));
			const actorCount = tickControllers(collections, delta, playerPosition);
			const currentPositions = new Map();
			for (const entry of normalizeOccupationEntries(occupations)) {
				const position = readPosition(entry.controller);
				if (position) currentPositions.set(entry.controller, position);
			}
			const occupationRecords = tickOccupations(occupations, delta, currentPositions);
			const faunaPlans = evaluateFauna(faunaRequests);
			const habitatSpecies = chooseHabitatSpecies(
				faunaRequests.map((request) => request?.species).filter(Boolean),
				normalizeEcologyContext(eventContext),
		);
			const events = tickWorldEvents(delta, eventContext, eventTypes);
			tickCount += 1;
			const snapshot = freeze({
				accepted: true,
				tick: tickCount,
				actorsUpdated: actorCount,
				occupations: occupationRecords,
				fauna: faunaPlans,
				habitatSpecies,
				events,
				stats: freeze({ tickCount, emittedEvents }),
				policyId: LIVING_WORLD_DIRECTOR_POLICY.id,
			});
			return snapshot;
		},
		audit() {
		return freeze({
			ok: !disposed,
			disposed,
			tickCount,
			emittedEvents,
			eventState: auditEventDirectorState(eventState),
		});
		},
		reset() {
			tickCount = 0;
			emittedEvents = 0;
			eventState.clockSeconds = 0;
			eventState.sequence = 0;
			eventState.lastIssuedByType.clear();
			return true;
		},
		dispose() {
			disposed = true;
			return true;
		},
	};
}

export function directorDigest(snapshot) {
	return stableHash(JSON.stringify(snapshot ?? null)).toString(16).padStart(8, '0');
}

export function auditDirectorPolicy(snapshot) {
	const errors = [];
	if (!snapshot || typeof snapshot !== 'object') errors.push('missing-snapshot');
	if (snapshot?.actorsUpdated != null && snapshot.actorsUpdated > MAX_ACTORS) errors.push('actor-overflow');
	if (snapshot?.fauna != null && (!Array.isArray(snapshot.fauna) || snapshot.fauna.length > MAX_FAUNA_GROUPS)) errors.push('fauna-overflow');
	if (snapshot?.events?.emitted != null && snapshot.events.emitted > MAX_EVENTS_PER_TICK) errors.push('event-overflow');
	if (snapshot?.policyId !== LIVING_WORLD_DIRECTOR_POLICY.id && snapshot?.policyId != null) errors.push('policy-mismatch');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: directorDigest(snapshot) });
}
