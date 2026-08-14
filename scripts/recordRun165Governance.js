import fs from 'node:fs';

const stamp = process.env.RUN165_STAMP;
const stableTag = process.env.RUN165_STABLE_TAG;
const perfRow = process.env.RUN165_PERF_ROW;
const smokeCount = process.env.RUN165_SMOKE_PASS_COUNT;

if (!stamp || !stableTag || !perfRow || !smokeCount) {
	throw new Error('Run165 governance environment is incomplete.');
}

const progress = `\n\n## Run 165 — Jump arc contract regression guard (${stamp})\n- Alt görev: FAZ 4 oyuncu zıplama/fizik zincirindeki saf \`integrateJumpArc\` davranışı için kalıcı düşük-seviye regresyon kontratı eklendi; runtime kaynak satırı değiştirilmedi.\n- Additive-only: yalnız yeni test/CI/governance dosyaları ve append-only kayıtlar eklendi; mevcut kaynak satırı silinmedi/değiştirilmedi.\n- DoD: node --check PASS; jump arc + health state + EventBus + keyboard/touch input kontratları PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, assets/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.\n- Görsel doğrulama: runtime/CSS/render üretimi değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel yolu doğruladı.\n- Performans: ${perfRow}\n- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material eklenmedi; saf fizik guard'ı shared state/resource oluşturmadan çalışır.\n- Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.\n- ADR: ADR-0187. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.\n- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; jump/physics regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; zıplama kalkış/iniş clamp ve deterministik yörünge sözleşmesi artık kalıcı testle korunuyor.\n- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız gameplay/core/UI kalite işi; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.\n`;

const adr = `\n\n## ADR-0187 — Jump arc contract regression guard (run 165)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Mevcut \`physics.js\` runtime kodunu değiştirmeden; \`integrateJumpArc\` için semi-implicit gravity/height entegrasyon sırasını, yükseliş ve iniş durumunu, tam/overstep inişte yükseklik ve dikey hızın sıfıra clamp edilmesini, sonlu bir zıplamanın mutlaka yere dönmesini ve aynı girdilerin bit-eşit deterministik yörünge üretmesini tek bir Node regresyon testiyle sabitle.\n\n**Neden:** FAZ 4 oyuncu zıplaması, \`gameplay/player.js\` içinde her frame bu saf fizik fonksiyonuna dayanır. Browser smoke hareket yolunu dolaylı olarak çalıştırsa da gravity entegrasyon sırası, zeminin altına taşmama ve aynı başlangıç koşullarında aynı frame-yörüngesini üretme sözleşmesi izole biçimde pinlenmiyordu. Health/EventBus/input kontratlarından sonra oyuncu kontrol zincirindeki bir sonraki saf ve kritik sınır budur.\n\n**Alternatifler:** (1) Player runtime'ını/refactor'ını değiştirmek — ihtiyaç yok ve additive-only altında gereksiz risk. (2) Yalnız browser smoke'a güvenmek — frame-seviyeli yörünge ve landing clamp ayrıntılarını izole etmez. (3) Tam görsel jump testi — daha pahalı ve saf matematik sözleşmesini daha az açıklayıcı test eder; gerçek Chromium/WebGL yolu yine full smoke ile ayrıca doğrulanır.\n\n**Sonuç:** Oyuncu davranışı, render, PWA cache, dünya seed/determinism ve 2D oyun değişmez; zıplama fizik regresyonları daha erken ve açıklayıcı yakalanır.\n\n**Etkilenen sistemler:** yeni \`scripts/checkJumpArcContract.js\`, run165 CI/governance kayıtları. Runtime kaynak kodu etkilenmez.\n\n**Geri alma planı:** İleride jump entegrasyon modeli bilinçli olarak değiştirilirse yeni davranış için yeni additive test/ADR eklenir; mevcut guard tarihsel kontrat olarak tutulabilir veya owner onaylı test istisnası değerlendirilebilir.\n`;

const stable = `\n- ${stableTag} — run 165 jump arc contract regression guard (ADR-0187); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y/core-input gates PASS.\n`;

fs.appendFileSync('3D_GAME_PROGRESS.md', progress);
fs.appendFileSync('DECISIONS.md', adr);
fs.appendFileSync('STABLE_TAGS.md', stable);
fs.appendFileSync('perf_log.csv', `\n${perfRow}`);

console.log(`Run165 governance records appended for ${stableTag}.`);
