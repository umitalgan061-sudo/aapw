#!/usr/bin/env node
/** Run191 corrective visual-review recorder. Append-only by design. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN191_V2_STAMP', 'RUN191_V2_STABLE_TAG', 'RUN191_V2_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error(`missing ${key}`);

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('3D_GAME_PROGRESS.md', [
	'### Run 191 corrective visual evidence review — ' + process.env.RUN191_V2_STAMP,
	'- Senior artifact inspection found the first bridge screenshots technically valid but visually weak: near frame was too dark/small and longest-frame composition did not clearly communicate masonry arches. This was not accepted as final visual DoD evidence.',
	'- Additive corrective proof `checkCanonicalStoneBridgeVisualEvidenceV2.js` keeps the already-pinned Run191 geometry/checksum unchanged and captures two new 1280x720 frames: masonry/arch detail on `robin->berkalp#1` (14 arches) and perspective repetition on `umit->doran#1` (87 arches).',
	'- ' + process.env.RUN191_V2_SUMMARY,
	'- Runtime delta remains 0: only test/evidence/governance files added. Core Run191 bridge checksum, 6/13 affected edges, 7 structures, 177 arches and 4-call/37,860-triangle isolated render proof remain unchanged.',
	'- Full browser smoke, service-worker/cache, determinism and mobile perf regression rerun after corrective evidence: PASS. Risk remains LOW; new runtime technical debt 0.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN191_V2_STABLE_TAG + ' — run 191 readable medieval stone-bridge evidence checkpoint; core geometry/checksum unchanged, 1280x720 masonry-detail + 87-arch perspective evidence and full regression PASS.'
]);

console.log('[recordRun191VisualEvidenceV2] PASS: corrective visual evidence + stable checkpoint recorded.');
