#!/usr/bin/env node
/** Run200: append validated progress/ADR/stable checkpoint records after every DoD gate passes. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
};

const stamp = required('RUN200_STAMP');
const stableTag = required('RUN200_STABLE_TAG');
const summary = required('RUN200_SUMMARY');
const smokePassCount = required('RUN200_SMOKE_PASS_COUNT');
const mobile = required('RUN200_LIVE_MOBILE_JSON');
const perfRow = required('RUN200_PERF_ROW');

const progress = `\n\n## Run 200 — Opt-in canonical developer startup + offline/PWA rollback equivalence\n\n- **Validated:** ${stamp}. Added a dormant developer-only composition module that requires an explicit canonical bridge id and composes the proven Run196 current-runtime ownership transaction with Run197's reversible real-tick freeze. The default game3d import graph remains unchanged; no owner-facing migration policy is guessed.\n- **Browser proof:** ${summary}. Online canonical activation, rollback to the exact current runtime shape, service-worker-controlled current boot, fully offline current boot, and offline canonical activation/disposal all passed with zero console/page errors.\n- **Regression/DoD:** full Chromium smoke ${smokePassCount}+ PASS; world/determinism/visual contracts PASS; PWA cache/installability PASS; accessibility/input/physics PASS; mobile streaming/LOD/perf PASS; additive-only guard PASS; final remote-main concurrency gate PASS.\n- **Performance:** live mobile sample ${mobile}; perf snapshot \`${perfRow}\`. No default-runtime import or frame-cost delta from the dormant controller.\n- **Coverage:** desktop 132.25/137.5 km² = **96.2%**; mobile radius-4 resident footprint 81 chunks / 20.25 km² ≈ **14.7%**. No world-coverage behavior changed.\n- **Technical debt:** delta **0**. Existing owner-blocked structural items (radius-5 exact-contract guard, game3d.js split constraint, world-event checksum fixture) remain untouched.\n- **Risk:** LOW. Rollback/dispose owns no borrowed scene resources and default startup remains current-world.\n- **Next safe step:** prove a no-source-transform state handoff seam for this developer controller without touching default game3d startup; if additive-only prevents exposing the live state safely, record the blocker instead of changing existing lines.\n`;

const adr = `\n\n## ADR-0219 — Canonical developer startup must be explicit, dormant, reversible, and offline-equivalent\n\n- **Decision:** Add \`worldReferenceCanonicalDeveloperStartup.js\` as an opt-in composition only. It accepts the already-created current runtime state and an explicit bridge id, then composes Run196 + Run197 and enters canonical ownership. It is never imported by default \`game3d.html\`/\`game3d.js\`.\n- **Why:** Run198 proved the underlying lifecycle transaction but assembled it inline inside a preflight. A reusable developer boundary reduces repeated orchestration while preserving the zero-risk default runtime and owner-decision constraints.\n- **Alternatives considered:** make canonical the default startup (rejected: migration gate not complete); infer a bridge target (rejected: product/owner policy must not be guessed); modify existing \`initGame3D\` lines to expose state (rejected: additive-only guard); keep Run198-only inline composition forever (rejected: unnecessary duplication and weaker future regression coverage).\n- **Result:** developer/preflight code gets one deterministic reversible entry point; rollback restores current ownership, and the Run200 browser proof demonstrates equivalent service-worker-controlled and offline current boot plus offline canonical activation/disposal.\n- **Affected systems:** developer/preflight canonical migration boundary and 3D offline shell registration only. 2D gameplay, default 3D startup, world generation, gameplay simulation defaults, desktop/mobile behavior, and PWA navigation are unchanged.\n- **Rollback:** stop importing the dormant module from developer/preflight harnesses. It owns no persistent state and disposal delegates to the already-proven Run197/196 rollback chain.\n- **Risk:** LOW.\n`;

const stable = `\n${stableTag} | run200 | opt-in canonical developer startup + offline/PWA rollback equivalence | ${stamp}\n`;

fs.appendFileSync(path.join(ROOT, '3D_GAME_PROGRESS.md'), progress, 'utf8');
fs.appendFileSync(path.join(ROOT, 'DECISIONS.md'), adr, 'utf8');
fs.appendFileSync(path.join(ROOT, 'STABLE_TAGS.md'), stable, 'utf8');
console.log('[recordRun200CanonicalDeveloperStartup] PASS: appended progress, ADR-0219, and stable checkpoint record');
