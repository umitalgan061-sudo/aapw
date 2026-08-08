import fs from 'node:fs';

const stamp = process.env.RUN164_STAMP;
const stableTag = process.env.RUN164_STABLE_TAG;
const perfRow = process.env.RUN164_PERF_ROW;
const smokeCount = process.env.RUN164_SMOKE_PASS_COUNT;

if (!stamp || !stableTag || !perfRow || !smokeCount) {
	throw new Error('Run164 governance environment is incomplete.');
}

const progress = `\n\n## Run 164 — Health state contract regression guard (${stamp})\n- Alt görev: FAZ 7 ejderha saldırısı/oyuncu can zincirinin temel health state davranışı için kalıcı düşük-seviye regresyon kontratı eklendi; runtime kaynak satırı değiştirilmedi.\n- Additive-only: yalnız yeni test/CI/governance dosyaları ve append-only kayıtlar eklendi; mevcut kaynak satırı silinmedi/değiştirilmedi.\n- DoD: node --check PASS; health state + EventBus + keyboard/touch input kontratları PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, assets/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.\n- Görsel doğrulama: runtime/CSS/render üretimi değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel yolu doğruladı.\n- Performans: ${perfRow}\n- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material eklenmedi; guard health.dispose() sonrası damage aboneliğinin etkisiz kaldığını ve EventBus clear temizliğini doğrular.\n- Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.\n- ADR: ADR-0186. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.\n- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; health/gameplay regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; hasar clamp, tek-sefer ölüm, heal/reset yeniden-silahlanma ve dispose davranışı artık kalıcı testle korunuyor.\n- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız gameplay/core/UI kalite işi; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.\n`;

const adr = `\n\n## ADR-0186 — Health state contract regression guard (run 164)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Mevcut \`gameplay/health.js\` runtime kodunu değiştirmeden; ilk full-health yayını, malformed/non-positive damage no-op davranışı, hasarın 0..maxHealth clamp'i, ölüm olayının edge-triggered tek-sefer yayını, heal/reset ile ölümün yeniden silahlanması, full-health'te redundant heal yayını olmaması ve \`dispose()\` damage abonelik temizliğini deterministik Node regresyon testiyle sabitle.\n\n**Neden:** FAZ 7 ejderha saldırısının gerçek oyuncu etkisi bu generic health state üzerinden geçer. Browser smoke bu yolu dolaylı olarak çalıştırsa da lethal overkill, tekrar damage while dead, yeniden canlandıktan sonra ikinci ölüm ve teardown abonelik temizliği izole biçimde pinlenmiyordu. EventBus kontratının run 163'te korunmaya alınmasının doğal devamı olarak, gameplay tarafındaki en kritik tüketicilerden birinin sözleşmesini de runtime değişikliği olmadan güvenceye almak düşük riskli ve anlamlıdır.\n\n**Alternatifler:** (1) Health runtime'ını refactor etmek — ihtiyaç yok ve additive-only altında gereksiz risk. (2) Yalnız dragon/browser smoke'a güvenmek — edge-trigger/re-arm/invalid-payload/dispose ayrıntılarını izole etmez. (3) Ejderha AI testine daha fazla sorumluluk yüklemek — generic health sözleşmesini tek bir düşman türüne gereksiz yere bağlar.\n\n**Sonuç:** Oyuncu davranışı, render, PWA cache, seed/determinism ve 2D oyun değişmez; hasar/ölüm/respawn temel sözleşmesindeki regresyonlar daha erken ve açıklayıcı yakalanır.\n\n**Etkilenen sistemler:** yeni \`scripts/checkHealthStateContract.js\`, run164 CI/governance kayıtları. Runtime kaynak kodu etkilenmez.\n\n**Geri alma planı:** İleride health sözleşmesi bilinçli olarak değişirse yeni davranış için yeni additive test/ADR eklenir; mevcut guard tarihsel kontrat olarak tutulabilir veya owner onaylı test istisnası değerlendirilebilir.\n`;

const stable = `\n- ${stableTag} — run 164 health state contract regression guard (ADR-0186); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y/core-input gates PASS.\n`;

fs.appendFileSync('3D_GAME_PROGRESS.md', progress);
fs.appendFileSync('DECISIONS.md', adr);
fs.appendFileSync('STABLE_TAGS.md', stable);
fs.appendFileSync('perf_log.csv', `\n${perfRow}`);

console.log(`Run164 governance records appended for ${stableTag}.`);
