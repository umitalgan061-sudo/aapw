/** Kızıl Ufuk — deterministic bridge to caller-owned ground/collider/water/slope APIs. */
export const PLAYER_WORLD_COVERAGE_VERSION = 1;
export const PLAYER_WORLD_COVERAGE_PORTS = Object.freeze(['ground', 'collider', 'water', 'slope']);
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min, max) => Math.max(min, Math.min(max, finite(v, min)));
const point = (v = {}) => ({ x: finite(v.x), y: finite(v.y), z: finite(v.z) });
const stable = (v) => v === null || v === undefined ? 'null' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '0') : typeof v === 'boolean' ? String(v) : typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest = (v) => {
	let h = 2166136261; const s = stable(v);
	for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
	return (h >>> 0).toString(16).padStart(8, '0');
};
function resolvePort(port) {
	if (typeof port === 'function') return port;
	if (!port || typeof port !== 'object') return null;
	for (const method of ['sample', 'resolve', 'query', 'project']) if (typeof port[method] === 'function') return port[method].bind(port);
	return null;
}
function callPort(port, context) {
	const fn = resolvePort(port);
	if (!fn) return { available: false, value: null, error: 'missing-port' };
	try { return { available: true, value: fn(context), error: null }; }
	catch (error) { return { available: false, value: null, error: error instanceof Error ? error.message : String(error) }; }
}
function groundOf(raw, input) {
	const v = raw.value ?? raw ?? {};
	const supportY = finite(v.supportY ?? v.groundY ?? v.y, input.position.y);
	return { supportY, grounded: Boolean(v.grounded ?? (raw.available && Math.abs(input.position.y - supportY) <= input.groundSnapMeters)), normal: point(v.normal ?? { x: 0, y: 1, z: 0 }) };
}
function colliderOf(raw) {
	const v = raw.value ?? raw ?? {};
	return { blocked: Boolean(v.blocked ?? v.colliding), clearanceMeters: clamp(v.clearanceMeters ?? v.clearance, 0, 1000) };
}
function waterOf(raw, input) {
	const v = raw.value ?? raw ?? {};
	const surfaceY = finite(v.surfaceY ?? v.waterY, input.position.y - 1000);
	return { surfaceY, depthMeters: Math.max(0, surfaceY - input.position.y), submerged: Boolean(v.submerged ?? surfaceY > input.position.y + input.heightMeters * 0.5) };
}
function slopeOf(raw) {
	const v = raw.value ?? raw ?? {};
	return { angleRadians: clamp(v.angleRadians ?? v.slopeRadians, 0, Math.PI / 2), blocked: Boolean(v.blocked), normal: point(v.normal ?? { x: 0, y: 1, z: 0 }) };
}
export function createPlayerCombatWorldCoverage(options = {}) {
	const ports = Object.freeze({ ground: options.groundResolver ?? options.ground, collider: options.colliderResolver ?? options.collider, water: options.waterResolver ?? options.water, slope: options.slopeResolver ?? options.slope });
	const groundSnapMeters = clamp(options.groundSnapMeters ?? 0.08, 0.01, 0.5);
	function sample(context = {}) {
		const input = { position: point(context.position), radius: clamp(context.radius ?? 0.35, 0.05, 2), heightMeters: clamp(context.heightMeters ?? 1.8, 0.2, 4), groundSnapMeters, deltaSeconds: clamp(context.deltaSeconds ?? 0, 0, 0.25), nowSeconds: Math.max(0, finite(context.nowSeconds)) };
		const groundPort = callPort(ports.ground, input); const colliderPort = callPort(ports.collider, input); const waterPort = callPort(ports.water, input); const slopePort = callPort(ports.slope, input);
		const ground = groundOf(groundPort, input); const collider = colliderOf(colliderPort); const water = waterOf(waterPort, input); const slope = slopeOf(slopePort);
		const visualColliderDelta = Math.abs(input.position.y - ground.supportY);
		const allPortsAvailable = [groundPort, colliderPort, waterPort, slopePort].every((p) => p.available);
		const combatSafe = allPortsAvailable && visualColliderDelta <= groundSnapMeters && !collider.blocked && !slope.blocked;
		const value = { version: PLAYER_WORLD_COVERAGE_VERSION, order: PLAYER_WORLD_COVERAGE_PORTS, position: input.position, ground, collider, water, slope, allPortsAvailable, visualColliderDelta, combatSafe, readiness: { grounded: groundPort.available && ground.grounded, supportAvailable: groundPort.available, worldPortsReady: allPortsAvailable } };
		return Object.freeze({ ...value, digest: digest(value) });
	}
	function applyGrounding(transform, coverageSample) {
		const y = coverageSample?.ground?.supportY;
		if (!transform?.position || !coverageSample?.readiness?.grounded || !Number.isFinite(Number(y))) return false;
		if (Math.abs(transform.position.y - y) > groundSnapMeters) return false;
		transform.position.y = y; return true;
	}
	return Object.freeze({ version: PLAYER_WORLD_COVERAGE_VERSION, ports: PLAYER_WORLD_COVERAGE_PORTS, sample, applyGrounding, groundSnapMeters });
}
export const __testing = Object.freeze({ finite, point, resolvePort, stable, digest, groundOf, colliderOf, waterOf, slopeOf });
