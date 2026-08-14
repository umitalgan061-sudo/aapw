import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWorldEventSystem } from '../src/3d/gameplay/worldEvents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'world-events-seed-148.json');
const FIXED_SEED = 1482026;
const DIFFERENT_SEED = 1482027;
const STEP_SECONDS = 95;
const NIGHT_PATTERN = Object.freeze([0, 1, 0.5, null, 0, 1, null, 0.5]);
const STEPS = 24;

function assert(condition, message) {
	if (!condition) throw new Error(`[checkWorldEventDeterminism] ${message}`);
}

function validateTimeGate(event, nightFactor, index) {
	if (nightFactor === null || event.timeOfDay === undefined) return;
	if (event.timeOfDay === 'day') {
		assert(nightFactor <= 0.15, `step ${index}: day event ${event.id} emitted at nightFactor=${nightFactor}`);
	}
	if (event.timeOfDay === 'night') {
		assert(nightFactor >= 0.6, `step ${index}: night event ${event.id} emitted at nightFactor=${nightFactor}`);
	}
}

function collectSequence(seed) {
	const emitted = [];
	const eventsBus = {
		emit(eventName, payload) {
			emitted.push({ eventName, payload });
		},
	};
	const system = createWorldEventSystem({ eventsBus, seed, eventName: 'world:event' });
	for (let index = 0; index < STEPS; index += 1) {
		const before = emitted.length;
		const nightFactor = NIGHT_PATTERN[index % NIGHT_PATTERN.length];
		system.update(STEP_SECONDS, nightFactor === null ? undefined : nightFactor);
		assert(emitted.length === before + 1, `step ${index}: expected exactly one event, received ${emitted.length - before}`);
		const latest = emitted[emitted.length - 1];
		assert(latest.eventName === 'world:event', `step ${index}: unexpected event name ${latest.eventName}`);
		validateTimeGate(latest.payload, nightFactor, index);
	}
	const countBeforeDispose = emitted.length;
	system.dispose();
	system.update(STEP_SECONDS * 2, 0);
	assert(emitted.length === countBeforeDispose, 'dispose() must stop future emissions');
	return emitted.map(({ payload }, index) => ({
		step: index,
		nightFactor: NIGHT_PATTERN[index % NIGHT_PATTERN.length],
		id: payload.id,
		timeOfDay: payload.timeOfDay ?? null,
	}));
}

function checksum(value) {
	return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const first = collectSequence(FIXED_SEED);
const second = collectSequence(FIXED_SEED);
const different = collectSequence(DIFFERENT_SEED);
assert(JSON.stringify(first) === JSON.stringify(second), 'same seed produced different event sequences');
assert(JSON.stringify(first) !== JSON.stringify(different), 'different seed unexpectedly produced the same event sequence');

const snapshot = {
	schema: 1,
	seed: FIXED_SEED,
	stepSeconds: STEP_SECONDS,
	steps: STEPS,
	nightPattern: NIGHT_PATTERN,
	sequence: first,
};
const snapshotWithChecksum = { ...snapshot, checksum: checksum(snapshot) };

if (process.argv.includes('--write-fixture')) {
	fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
	fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(snapshotWithChecksum, null, 2)}\n`, 'utf8');
	console.log(`[checkWorldEventDeterminism] fixture written: ${path.relative(process.cwd(), FIXTURE_PATH)}`);
} else {
	assert(fs.existsSync(FIXTURE_PATH), `fixture missing: ${path.relative(process.cwd(), FIXTURE_PATH)}`);
	const expected = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
	assert(expected.checksum === checksum({
		schema: expected.schema,
		seed: expected.seed,
		stepSeconds: expected.stepSeconds,
		steps: expected.steps,
		nightPattern: expected.nightPattern,
		sequence: expected.sequence,
	}), 'fixture checksum is invalid');
	assert(JSON.stringify(snapshotWithChecksum) === JSON.stringify(expected), 'fixed-seed world-event snapshot changed unexpectedly');
	console.log(`[checkWorldEventDeterminism] PASS: ${STEPS} fixed-seed emissions match checksum ${expected.checksum.slice(0, 12)}…`);
}
