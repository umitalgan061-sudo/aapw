/**
 * Kızıl Ufuk — player combat world-coverage adapter.
 *
 * The module does not own terrain, water, slope, collider or material systems. It only normalizes
 * caller-owned ports into one deterministic grounding/combat-safety sample for the existing player
 * and camera/combat runtime. This keeps world ownership with Buzul Muhafızı and avoids a second framework.
 * @module gameplay/playerCombatWorldCoverage
 */

export const PLAYER_WORLD_COVERAGE_VERSION = 1;
export const PLAYER_WORLD_COVERAGE_PORTS = Object.freeze(['ground', 'collider', 'water', 'slope']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value) => Boolean(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const point = (value) => ({ x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) });
const stable = (value) => {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
	let hash = 2166136261;
	const source = stable(value);
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
};

function resolvePort(port) {
	if (typeof port === 'function') return port;
	if (!port || typeof port !== 'object') return null;
	for (const method of ['sample', 'resolve', 'query', 'project']) {
		if (typeof port[method] === 'function') return port[method].bind(port);
	}
	return null;
}

function callPort(port, context) {
	const fn = resolvePort(port);
	if (!fn) return Object.freeze({ available: false, value: null, error: 'missing-port' });
	try {
		return Object.freeze({ available: true, value: fn(context), error: null });
	} catch (error) {
		return Object.freeze({ available: true, value: null, error: error instanceof Error ? error.message : String(error) });
	}
}

function normalizeGround(raw, input) {
	const value = raw?.value ?? raw ?? {};
	const supportY = finite(value.supportY ?? value.groundY ?? value.y, input.position.y);
	const grounded = bool(value.grounded ?? Math.abs(input.position.y - supportY) <= input.groundSnapMeters);
	return Object.freeze({ supportY, grounded, normal: point(value.normal ?? { x: 0, y: 1, z: 0 }) });
}

function normalizeCollider(raw) {
	const value = raw?.value ?? raw ?? {};
	return Object.freeze({ blocked: bool(value.blocked ?? value.colliding), clearanceMeters: clamp(value.clearanceMeters ?? value.clearance, 0, 1000) });
}

function normalizeWater(raw, input) {
	const value = raw?.value ?? raw ?? {};
	const surfaceY = finite(value.surfaceY ?? value.waterY, input.position.y - 1000);
	return Object.freeze({ surfaceY, depthMeters: Math.max(0, surfaceY - input.position.y), submerged: bool(value.submerged ?? surfaceY > input.position.y + input.heightMeters * 0.5) });
}

function normalizeSlope(raw) {
	const value = raw?.value ?? raw ?? {};
	const angleRadians = clamp(value.angleRadians ?? value.slopeRadians, 0, Math.PI / 2);
	return Object.freeze({ angleRadians, blocked: bool(value.blocked), normal: point(value.normal ?? { x: 0, y: 1, z: 0 }) });
}

export function createPlayerCombatWorldCoverage(options = {}) {
	const ports = Object.freeze({
		ground: options.groundResolver ?? options.ground,
		collider: options.colliderResolver ?? options.collider,
		water: options.waterResolver ?? options.water,
		slope: options.slopeResolver ?? options.slope,
	});
	const groundSnapMeters = clamp(options.groundSnapMeters ?? 0.08, 0.01, 0.5);

	function sample(context = {}) {
		const input = Object.freeze({
			position: point(context.position),
			radius: clamp(context.radius ?? 0.35, 0.05, 2),
			heightMeters: clamp(context.heightMeters ?? 1.8, 0.2, 4),
			groundSnapMeters,
			deltaSeconds: clamp(context.deltaSeconds ?? 0, 0, 0.25),
			nowSeconds: Math.max(0, finite(context.nowSeconds)),
		});
		const groundPort = callPort(ports.ground, input);
		const colliderPort = callPort(ports.collider, input);
		const waterPort = callPort(ports.water, input);
		const slopePort = callPort(ports.slope, input);
		const ground = normalizeGround(groundPort, input);
		const collider = normalizeCollider(colliderPort);
		const water = normalizeWater(waterPort, input);
		const slope = normalizeSlope(slopePort);
		const visualColliderDelta = Math.abs(input.position.y - ground.supportY);
		const allPortsAvailable = PLAYER_WORLD_COVERAGE_PORTS.every((key) => ({ ground: groundPort, collider: colliderPort, water: waterPort, slope: slopePort }[key]).available);
		const combatSafe = allPortsAvailable && visualColliderDelta <= groundSnapMeters && !collider.blocked && !slope.blocked;
		const sampleValue = {
			version: PLAYER_WORLD_COVERAGE_VERSION,
			order: PLAYER_WORLD_COVERAGE_PORTS,
			ground, collider, water, slope,
			allPortsAvailable, visualColliderDelta, combatSafe,
			position: input.position,
			readiness: Object.freeze({ grounded: ground.grounded, supportAvailable: groundPort.available, worldPortsReady: allPortsAvailable }),
		};
		return Object.freeze({ ...sampleValue, digest: digest(sampleValue) });
	}

	function applyGrounding(transform, coverageSample) {
		if (!transform?.position || !coverageSample?.readiness?.grounded) return false;
		if (!Number.isFinite(Number(coverageSample.ground.supportY))) return false;
		if (Math.abs(transform.position.y - coverageSample.ground.supportY) > groundSnapMeters) return false;
		transform.position.y = coverageSample.ground.supportY;
		return true;
	}

	return Object.freeze({ version: PLAYER_WORLD_COVERAGE_VERSION, ports: PLAYER_WORLD_COVERAGE_PORTS, sample, applyGrounding, groundSnapMeters });
}

export const __testing = Object.freeze({ finite, point, resolvePort, stable, digest, normalizeGround, normalizeCollider, normalizeWater, normalizeSlope });
