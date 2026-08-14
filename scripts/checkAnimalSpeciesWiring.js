#!/usr/bin/env node
/**
 * checkAnimalSpeciesWiring.js — static regression guard for `gameplay/animalConfig.js`'s per-species
 * model/animation-clip table (`ANIMAL_SPECIES`) and the spawn entries that reference it.
 *
 * **Why this exists (GOVERNANCE.md §2 Root Cause Analysis).** Wiring the 10 manually-downloaded
 * rigged animal models into the live world required moving animation-clip names from three global
 * constants to a per-species table. The clip names were first copied from each asset's recorded
 * `animationClips` array in `assets_manifest.json` — and two of them were **wrong**: the zebra and
 * sheep GLBs prefix every clip with `Armature|`, which the manifest had recorded unprefixed. Nothing
 * would have thrown: `THREE.AnimationClip.findByName` returns `null` for a miss and
 * `gameplay/animals.js` null-guards every action, so both animals would have rendered silently
 * frozen — a visual-only regression, invisible to `node --check`, invisible to a console-error scan,
 * and only catchable by looking at those two specific animals in a running scene.
 *
 * Root cause: `assets_manifest.json` is hand-maintained prose metadata, not a build artifact derived
 * from the binaries, so it can drift from the files it describes. Prevention: stop trusting it for
 * anything load-bearing — read the clip names out of the real GLB container instead, and make that a
 * machine check. This script parses each GLB's embedded JSON chunk directly (no Three.js, no loader,
 * no browser) and asserts every configured clip name really exists in the asset it names.
 *
 * It also guards the wiring around the table, where a typo is equally silent:
 *   1. every `ANIMAL_SPECIES` entry's `modelUrl` resolves to a file that exists on disk;
 *   2. every clip name in every species' `clips` exists in that species' actual model file;
 *   3. every `SPAWNS` entry's `speciesId` names a species that exists in the table;
 *   4. a species with no `walk` clip has no spawn that expects to patrol, and a species with no
 *      `flee` clip has no spawn expecting to flee — the sliding-model artifact ADR-0047 avoided.
 *
 * Dev-only tooling, same as its sibling `check*.js` scripts — never loaded by a browser, not
 * referenced from `index.html`/`game3d.html`. Needs no Playwright: pure `fs` + static parsing, so it
 * runs anywhere Node does, including where the full smoke suite cannot.
 *
 * Usage: `node scripts/checkAnimalSpeciesWiring.js`
 * Exit codes: 0 = OK. 1 = a violation was found.
 * @module scripts/checkAnimalSpeciesWiring
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'src', '3d', 'gameplay', 'animalConfig.js');

/** glTF binary container magic (`glTF` little-endian) and JSON chunk type (`JSON`). */
const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_JSON = 0x4e4f534a;

const failures = [];
const notes = [];

/**
 * Reads the animation-clip names out of a `.glb` file by parsing its embedded JSON chunk directly.
 * Deliberately not via Three.js/GLTFLoader: this must run in plain Node with no browser, no DOM and
 * no vendored-module import, exactly like the other `check*.js` guards.
 * @param {string} absPath
 * @returns {string[] | null} Clip names, or `null` if the file is not a parseable GLB (e.g. an FBX —
 *   the caller reports that as a skip, not a failure, since FBX clip names cannot be read this way).
 */
function readGlbAnimationNames(absPath) {
	const buf = fs.readFileSync(absPath);
	if (buf.length < 12 || buf.readUInt32LE(0) !== GLB_MAGIC) return null;
	let offset = 12;
	while (offset + 8 <= buf.length) {
		const chunkLength = buf.readUInt32LE(offset);
		const chunkType = buf.readUInt32LE(offset + 4);
		if (chunkType === GLB_CHUNK_JSON) {
			const json = JSON.parse(buf.slice(offset + 8, offset + 8 + chunkLength).toString('utf8'));
			return (json.animations || []).map((a) => a.name);
		}
		offset += 8 + chunkLength;
	}
	return null;
}

/**
 * Extracts the `ANIMAL_SPECIES` entries by static source parsing rather than importing the module.
 * `animalConfig.js` is an ES module and this script is CommonJS (matching every sibling guard), so a
 * plain `require` is not available; a static read also means a syntax error in the config surfaces
 * here as a parse miss instead of crashing the guard.
 * @param {string} source
 * @returns {{name: string, modelUrl: string, clips: {role: string, clip: string}[]}[]}
 */
function parseSpecies(source) {
	const speciesBlock = source.match(/export const ANIMAL_SPECIES = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
	if (!speciesBlock) return [];
	const entryPattern = /(\w+):\s*Object\.freeze\(\{\s*modelUrl:\s*'([^']+)',\s*clips:\s*Object\.freeze\(\{([^}]+)\}\)/g;
	const out = [];
	let match;
	while ((match = entryPattern.exec(speciesBlock[1])) !== null) {
		const [, name, modelUrl, clipsRaw] = match;
		const clips = [...clipsRaw.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => ({ role: m[1], clip: m[2] }));
		out.push({ name, modelUrl, clips });
	}
	return out;
}

/**
 * Extracts each `SPAWNS` entry's id/speciesId and whether it declares a patrol line or opts out of
 * fleeing — enough to cross-check spawn intent against what its species can actually animate.
 * @param {string} source
 * @returns {{id: string, speciesId: string | null, hasPatrol: boolean, canFleeFalse: boolean}[]}
 */
function parseSpawns(source) {
	const spawnsBlock = source.match(/SPAWNS: Object\.freeze\(\[([\s\S]*)\]\),/);
	if (!spawnsBlock) return [];
	const out = [];
	for (const raw of spawnsBlock[1].split(/Object\.freeze\(\{\s*id:/).slice(1)) {
		const idMatch = raw.match(/^\s*'([^']+)'/);
		if (!idMatch) continue;
		out.push({
			id: idMatch[1],
			speciesId: (raw.match(/speciesId:\s*'([^']+)'/) || [null, null])[1],
			hasPatrol: /\bpatrol:\s*Object\.freeze/.test(raw),
			canFleeFalse: /canFlee:\s*false/.test(raw),
		});
	}
	return out;
}

const source = fs.readFileSync(CONFIG_PATH, 'utf8');
const species = parseSpecies(source);
const spawns = parseSpawns(source);

if (species.length === 0) {
	failures.push('Could not parse any ANIMAL_SPECIES entries — has the table been renamed or reshaped? This guard would otherwise pass vacuously.');
}
if (spawns.length === 0) {
	failures.push('Could not parse any SPAWNS entries — has the spawn shape changed? This guard would otherwise pass vacuously.');
}

const speciesByName = new Map(species.map((s) => [s.name, s]));
let verifiedClips = 0;

for (const entry of species) {
	const absPath = path.join(ROOT, entry.modelUrl);
	if (!fs.existsSync(absPath)) {
		failures.push(`Species "${entry.name}": modelUrl does not exist on disk — ${entry.modelUrl}`);
		continue;
	}
	const realNames = readGlbAnimationNames(absPath);
	if (realNames === null) {
		notes.push(`Species "${entry.name}": ${path.basename(entry.modelUrl)} is not a parseable GLB (FBX clip names cannot be read statically) — clip names NOT verified for this species.`);
		continue;
	}
	if (entry.clips.length === 0) {
		failures.push(`Species "${entry.name}": declares no clips at all — at minimum an "idle" clip is required.`);
	}
	if (!entry.clips.some((c) => c.role === 'idle')) {
		failures.push(`Species "${entry.name}": has no "idle" clip. Every animal falls back to idle when not walking or fleeing.`);
	}
	for (const { role, clip } of entry.clips) {
		if (realNames.includes(clip)) {
			verifiedClips += 1;
		} else {
			failures.push(
				`Species "${entry.name}": clip "${clip}" (role "${role}") does not exist in ${path.basename(entry.modelUrl)}. ` +
					`Real clips: ${realNames.length ? realNames.join(', ') : '(none — this model has no animations)'}`,
			);
		}
	}
}

for (const spawn of spawns) {
	if (!spawn.speciesId) continue; // Legacy wolf-global spawn — intentionally supported, see spawnConfiguredAnimals.
	const entry = speciesByName.get(spawn.speciesId);
	if (!entry) {
		failures.push(`Spawn "${spawn.id}": references unknown species "${spawn.speciesId}".`);
		continue;
	}
	const roles = new Set(entry.clips.map((c) => c.role));
	if (spawn.hasPatrol && !roles.has('walk')) {
		failures.push(
			`Spawn "${spawn.id}": declares a patrol line but its species "${spawn.speciesId}" has no "walk" clip, ` +
				`so it would slide across the terrain with no walk cycle (the artifact ADR-0047 avoided). Remove the patrol or source a walkable model.`,
		);
	}
	if (!spawn.canFleeFalse && !roles.has('flee')) {
		notes.push(
			`Spawn "${spawn.id}": species "${spawn.speciesId}" has no "flee" clip, so spawnConfiguredAnimals disables its flee branch at runtime. ` +
				`Declaring canFlee: false makes that intent explicit at the config site.`,
		);
	}
}

const speciesCount = species.length;
const wiredSpawns = spawns.filter((s) => s.speciesId).length;
const legacySpawns = spawns.length - wiredSpawns;

console.log(`[checkAnimalSpeciesWiring] ${speciesCount} species, ${verifiedClips} clip names verified against real GLB binaries.`);
console.log(`[checkAnimalSpeciesWiring] ${spawns.length} spawns (${wiredSpawns} species-wired, ${legacySpawns} legacy wolf-global).`);
for (const note of notes) console.log(`[checkAnimalSpeciesWiring] NOTE: ${note}`);

if (failures.length > 0) {
	console.error(`\n[checkAnimalSpeciesWiring] FAIL — ${failures.length} violation(s):`);
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}

console.log('[checkAnimalSpeciesWiring] PASS');
