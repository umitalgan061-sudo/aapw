import fs from 'node:fs';

const stamp = process.env.RUN163_STAMP;
const stableTag = process.env.RUN163_STABLE_TAG;
const perfRow = process.env.RUN163_PERF_ROW;
const smokeCount = process.env.RUN163_SMOKE_PASS_COUNT;

if (!stamp || !stableTag || !perfRow || !smokeCount) {
	throw new Error('Run163 governance environment is incomplete.');
}

const progress = `\n\n## Run 163 — EventBus contract regression guard (${stamp})\n- Alt görev: 3D mimarinin sistemler arası iletişim omurgası olan EventBus için kalıcı düşük-seviye regresyon kontratı eklendi; runtime kaynak satırı değiştirilmedi.\n- Additive-only: yalnız yeni test/CI/governance dosyaları ve append-only kayıtlar eklendi; mevcut kaynak satırı silinmedi/değiştirilmedi.\n- DoD: node --check PASS; EventBus contract guard PASS; keyboard/touch input, checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, assets/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.\n- Görsel doğrulama: runtime/CSS/render üretimi değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel yolu doğruladı.\n- Performans: ${perfRow}\n- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material eklenmedi; guard unsubscribe/once/clear davranışını ve listener hata izolasyonunu doğrular.\n- Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.\n- ADR: ADR-0185. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.\n- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; core EventBus regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; sistemler arası olay iletiminin abonelik/once/hata izolasyonu/temizlik davranışı artık kalıcı testle korunuyor.\n- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız gameplay/UI/test-kalite işi; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.\n`;

const adr = `\n\n## ADR-0185 — EventBus contract regression guard (run 163)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Mevcut \`EventBus\` runtime kodunu değiştirmeden; \`on/off\`, aynı handler'ın Set ile tekilleştirilmesi, \`once\`, emit sırasında handler listesinin snapshot olarak gezilmesi, listener exception izolasyonu ve \`clear()\` temizliğini deterministik Node regresyon testiyle sabitle.\n\n**Neden:** EventBus; player, NPC, dünya olayları, UI ve diğer 3D alt sistemlerinin gevşek bağlı iletişim omurgasıdır. Bir listener hatasının diğer sistemleri durdurmaması ve teardown sırasında aboneliklerin temizlenebilmesi GOVERNANCE hata-sınırı/memory-leak kurallarıyla doğrudan ilişkilidir. Bu sözleşme browser smoke içinde dolaylı olarak çalışsa da bugüne kadar izole, açıklayıcı bir kontrat testi yoktu.\n\n**Alternatifler:** (1) Runtime EventBus refactor etmek — ihtiyaç yok ve additive-only altında gereksiz risk. (2) Yalnız full browser smoke'a güvenmek — once, duplicate suppression ve hata izolasyonunu izole biçimde kanıtlamaz. (3) Alt sistem başına ayrı entegrasyon testi — daha pahalı ve aynı temel bus sözleşmesini tekrar eder.\n\n**Sonuç:** Oyuncu davranışı, render, PWA cache, seed/determinism ve 2D oyun değişmez; EventBus sözleşmesindeki regresyonlar daha erken ve daha açıklayıcı yakalanır. Listener exception izolasyonu, bir bozuk abonenin diğer dünya sistemlerini durdurmaması beklentisini doğrudan korur.\n\n**Etkilenen sistemler:** yeni \`scripts/checkEventBusContract.js\`, run163 CI/governance kayıtları. Runtime kaynak kodu etkilenmez.\n\n**Geri alma planı:** İleride EventBus sözleşmesi bilinçli olarak değişirse yeni davranış için yeni additive test/ADR eklenir; mevcut guard tarihsel kontrat olarak tutulabilir veya owner onaylı test istisnası değerlendirilebilir.\n`;

const stable = `\n- ${stableTag} — run 163 EventBus contract regression guard (ADR-0185); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y/input gates PASS.\n`;

fs.appendFileSync('3D_GAME_PROGRESS.md', progress);
fs.appendFileSync('DECISIONS.md', adr);
fs.appendFileSync('STABLE_TAGS.md', stable);
fs.appendFileSync('perf_log.csv', `\n${perfRow}\n`);

console.log(`Run163 governance records appended for ${stableTag}.`);
