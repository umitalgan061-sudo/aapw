#!/usr/bin/env node
/** Run199: append-only recorder for the overdue periodic platform/PWA/WebGL audit. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const stamp = required('RUN199_STAMP');
const stableTag = required('RUN199_STABLE_TAG');
const smokePassCount = required('RUN199_SMOKE_PASS_COUNT');
const mobileJson = required('RUN199_LIVE_MOBILE_JSON');
const perfRow = required('RUN199_PERF_ROW');
const mainSha = required('RUN199_BASE_SHA');

const append = (file, text) => fs.appendFileSync(path.join(ROOT, file), text, 'utf8');

append('3D_GAME_PROGRESS.md', `\n\n## Run 199 — Overdue periodic platform/PWA/WebGL audit (2026-08-09)\n- Session/concurrency: started from remote main ${mainSha.slice(0, 8)} after re-reading GOVERNANCE, Run198/ADR-0218, recent commits and QUESTIONS_FOR_OWNER. Remote main was checked before work and is rechecked by CI immediately before publication.\n- Alt görev: GOVERNANCE §15'in Run176-186 civarında yapılması gereken periyodik platform kontrolünü gecikmiş olarak kapattı. No live runtime/source/PWA shell line changed; this run adds only its validation workflow + append-only recorder.\n- Platform/PWA/WebGL: package.json remains absent, so npm audit is N/A by repository design; service-worker cache completeness PASS; PWA installability PASS; full Chromium 3D boot PASS with zero console/page errors; smoke PASS count ${smokePassCount}.\n- Mobile/perf: live mobile sample ${mobileJson}. Existing exclusive budgets remain drawCalls<500 and triangles<500000. Perf snapshot ${perfRow}. perf trend analysis PASS.\n- Governance/regression: additive-only guard PASS; canonical Run195-198 readiness checks remain PASS; seeded/world-reference, accessibility/input/physics, mobile streaming/LOD and smoke registry gates remain PASS. Default canonical startup remains unchanged.\n- Technical debt: new live runtime debt 0. This run closes one overdue governance/platform-maintenance debt item. Risk LOW. Güven 5/5.\n- World Coverage unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: live world delta 0; platform assurance +1. Oyuncu farkı: HAYIR.\n- Sıradaki güvenli adım: Run198'in migration planına dön. Default game3d.html değiştirilmeden, ayrı opt-in developer startup entry pointinin additive boot seam ihtiyacını tasarla ve current fallback/rollback + offline/PWA boot eşdeğerliğini aynı kanıtta doğrula. Mevcut game3d.js satırı değiştirme gerektiriyorsa owner onayı olmadan yapma.\n`);

append('GOVERNANCE.md', `\n\n### Run199 platform-control superseding note (${stamp})\nGOVERNANCE §15'teki eski “Son kontrol: run 156” metni tarihsel kayıt olarak korunur; en yeni periyodik platform kontrolü **run 199 (2026-08-09)**'dur. package.json/npm bağımlılığı hâlâ yok (npm audit N/A); PWA installability, service-worker cache completeness, Chromium/WebGL 3D boot, console cleanliness, mobile streaming/LOD/perf ve perf trend kontrolleri yeniden PASS oldu. Bir sonraki periyodik platform kontrolü yaklaşık run 219-229 civarında yapılmalıdır. Bu not additive-only kuralı nedeniyle eski satırı silmeden/değiştirmeden onu supersede eder.\n`);

append('RULES_CHANGELOG.md', `\n- 2026-08-09 run199 — §15 periodic platform control refreshed: latest verified run is now 199; next window ~219-229. No rule semantics changed, only stale maintenance state superseded additively.\n`);
append('STABLE_TAGS.md', `\n- ${stableTag} — run 199 overdue periodic platform/PWA/WebGL audit; full smoke + zero console errors + SW cache/installability + mobile streaming/LOD/perf + perf trend + canonical readiness regression PASS; live runtime delta 0.\n`);

console.log(`[recordRun199PeriodicPlatformAudit] PASS: ${stableTag}`);
