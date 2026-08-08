#!/usr/bin/env node
/** Append-only recorder for the manually-reviewed Run191 medieval-art V2 correction. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'artifacts', 'run191-stone-bridge-art-v2', 'proof.json');
for (const key of ['RUN191_ART_V2_STAMP', 'RUN191_ART_V2_STABLE_TAG', 'RUN191_ART_V2_SUMMARY']) {
	if (!process.env[key]) throw new Error(`missing ${key}`);
}
if (!fs.existsSync(REPORT)) throw new Error('missing medieval-art V2 report');
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}
append('3D_GAME_PROGRESS.md', [
	'### Run 191 medieval-art V2 corrective proof — ' + process.env.RUN191_ART_V2_STAMP,
	'- Manual senior review rejected both earlier bridge evidence sets as final art proof because the arch facade rendered too dark and the stone/mortar treatment was not clearly readable. Automated PASS alone was intentionally not accepted.',
	'- New versioned `worldReferenceStoneBridgeMedievalArtV2.js` leaves the owner-approved crossing plan and core checksum unchanged, but adds readable 512x512 warm ashlar masonry, high-contrast mortar, subtle deterministic weather/moss, dedicated textured arch-facade instances and warmer structural stone.',
	'- ' + process.env.RUN191_ART_V2_SUMMARY,
	`- Core topology remains pinned: checksum \`${report.coreChecksum}\`; 6/13 affected edges, 7 bridge structures, 177 arches. No owner decision or canonical crossing moved.`,
	`- Readability gates: detail average luminance ${report.detail.readability.averageLuminance}, dark-pixel ratio ${report.detail.readability.darkPixelRatio}; long perspective average luminance ${report.long.readability.averageLuminance}, dark-pixel ratio ${report.long.readability.darkPixelRatio}; texture luminance range ${report.detail.readability.textureRange.range}.`,
	'- Art V2 still shadow-only. Live `game3d`, sceneManager, terrain, roads, rivers, water, vegetation, physics and 2D runtime remain untouched. PWA receives one additional additive precache line for the versioned art module.',
	'- Full determinism/cache/mobile-budget/browser-smoke regression after Art V2: PASS. New runtime technical debt 0; risk LOW.'
]);
append('DECISIONS.md', [
	'### ADR-0211 implementation correction — prefer readable medieval-art V2 for future bridge integration',
	'',
	'Manual visual review found the first Run191 bridge renderer structurally correct but too dark to prove the requested medieval masonry treatment. The deterministic crossing/structural plan is therefore retained unchanged, while future integration should consume the versioned `worldReferenceStoneBridgeMedievalArtV2.js` renderer. It adds textured arch facades and higher-contrast original procedural ashlar/mortar treatment. This is an implementation correction under ADR-0211, not a new product decision and not a change to bridge locations.',
	'',
	`Core deterministic bridge checksum remains \`${report.coreChecksum}\`. Art V2 visual/readability proof and regression gates PASS; live runtime adoption remains a separate stage.`
]);
append('STABLE_TAGS.md', [
	'- ' + process.env.RUN191_ART_V2_STABLE_TAG + ' — run 191 medieval stone-bridge Art V2 readable-evidence checkpoint; owner bridge topology unchanged, 512px ashlar/mortar facade treatment + manual-review-oriented render gates + full regression PASS.'
]);
console.log('[recordRun191MedievalArtV2] PASS: progress/ADR-0211 correction/stable checkpoint appended.');
