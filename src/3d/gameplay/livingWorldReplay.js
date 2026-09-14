/**
 * Şafak Kartalı — deterministic living-world replay/fingerprint ledger.
 *
 * This is a bounded evidence utility, not persistent WorldEventSystem storage. It records compact
 * inputs/outputs supplied by the director, canonicalizes key order and verifies replay equality.
 */
const freeze = (v) => Object.freeze(v);
const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const s = (v, f = '') => v == null ? f : String(v);
const MAX = 32;
export const REPLAY_POLICY = freeze({ id: 'safak-kartali-replay-2026-09-14-v1', deterministic: true, maxFrames: MAX, maxEventsPerFrame: 12 });
function hash(value) { let h = 2166136261; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; return h >>> 0; }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])); return value; }
export function canonicalize(value) { return stable(value ?? null); }
export function fingerprint(value, seed = 0) { return hash(`${seed}|${JSON.stringify(canonicalize(value))}`).toString(16).padStart(8, '0'); }
export function canonicalFrame(frame = {}) { return freeze({ tick: Math.max(0, Math.floor(n(frame.tick))), timeSeconds: Math.max(0, n(frame.timeSeconds)), director: canonicalize(frame.director), population: canonicalize(frame.population), threats: canonicalize(frame.threats), crime: canonicalize(frame.crime), events: Array.isArray(frame.events) ? frame.events.slice(0, REPLAY_POLICY.maxEventsPerFrame).map(canonicalize) : [] }); }
export function createReplayLedger(seed = 0) { const frames = []; return { append(frame) { if (frames.length >= MAX) frames.shift(); const canonical = canonicalFrame(frame); const entry = freeze({ ...canonical, fingerprint: fingerprint(canonical, seed) }); frames.push(entry); return entry; }, read() { return freeze([...frames]); }, digest() { return fingerprint(frames, seed); }, clear() { frames.length = 0; return true; }, get size() { return frames.length; } }; }
export function compareFrames(a, b) { const aa = canonicalFrame(a); const bb = canonicalFrame(b); return freeze({ equal: JSON.stringify(aa) === JSON.stringify(bb), left: fingerprint(aa), right: fingerprint(bb) }); }
export function compareLedgers(left = [], right = []) { const a = Array.isArray(left) ? left : []; const b = Array.isArray(right) ? right : []; const max = Math.max(a.length, b.length); const differences = []; for (let i = 0; i < max; i += 1) { const result = compareFrames(a[i], b[i]); if (!result.equal) differences.push({ index: i, ...result }); } return freeze({ equal: differences.length === 0, frameCount: max, differences: freeze(differences.slice(0, MAX)) }); }
export function buildReplaySeed({ worldSeed = 0, actorSeed = 0, eventSeed = 0 } = {}) { return hash(`${worldSeed}|${actorSeed}|${eventSeed}`) >>> 0; }
export function deterministicEventKey(event = {}, seed = 0) { return fingerprint({ type: s(event.type), actorId: s(event.actorId), targetId: s(event.targetId), tick: n(event.tick), locationId: s(event.locationId) }, seed); }
export function sortEvents(events = []) { return freeze((Array.isArray(events) ? events : []).slice(0, REPLAY_POLICY.maxEventsPerFrame).map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))); }
export function summarizeLedger(ledger = []) { const frames = Array.isArray(ledger) ? ledger : []; const ticks = frames.map((f) => n(f.tick)); return freeze({ frames: frames.length, firstTick: ticks.length ? Math.min(...ticks) : null, lastTick: ticks.length ? Math.max(...ticks) : null, fingerprints: freeze(frames.map((f) => s(f.fingerprint)).slice(-8)), digest: fingerprint(frames) }); }
export function auditReplay(ledger = []) { const errors = []; if (!Array.isArray(ledger)) errors.push('ledger-not-array'); if (ledger.length > MAX) errors.push('ledger-overflow'); const ticks = new Set(); for (const frame of ledger ?? []) { const canonical = canonicalFrame(frame); if (ticks.has(canonical.tick)) errors.push('duplicate-tick'); ticks.add(canonical.tick); if (canonical.events.length > REPLAY_POLICY.maxEventsPerFrame) errors.push('event-overflow'); } return freeze({ ok: !errors.length, errors: freeze([...new Set(errors)]), digest: fingerprint(ledger) }); }
export function pruneReplay(ledger = [], keep = 16) { const cap = Math.max(1, Math.min(MAX, Math.floor(n(keep, 16)))); return freeze((Array.isArray(ledger) ? ledger : []).slice(-cap)); }
export function replayInvariant(result = {}) { return freeze({ accepted: result?.accepted === true, deterministic: Boolean(result?.deterministic), hasFingerprint: typeof result?.fingerprint === 'string' && result.fingerprint.length > 0, frameCount: Array.isArray(result?.frames) ? result.frames.length : 0 }); }
export function buildDeterminismEvidence(left, right) { const comparison = compareLedgers(left, right); return freeze({ ...comparison, verdict: comparison.equal ? 'stable' : 'diverged', proof: fingerprint({ comparison } ) }); }
