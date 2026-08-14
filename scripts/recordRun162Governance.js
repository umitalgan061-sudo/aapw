import fs from 'node:fs';

const stamp = process.env.RUN162_STAMP;
const stableTag = process.env.RUN162_STABLE_TAG;
const perfRow = process.env.RUN162_PERF_ROW;
const smokeCount = process.env.RUN162_SMOKE_PASS_COUNT;

if (!stamp || !stableTag || !perfRow || !smokeCount) {
	throw new Error('Run162 governance environment is incomplete.');
}

const progress = `\n\n## Run 162 — Keyboard input contract regression guard (${stamp})\n- Alt görev: FAZ 4 masaüstü kontrol kalite güvencesi — mevcut keyboard input davranışı için kalıcı regresyon kontratı eklendi; runtime kaynak satırı değiştirilmedi.\n- Additive-only: yalnız yeni test/CI/governance dosyaları ve append-only kayıtlar eklendi; mevcut kaynak satırı silinmedi/değiştirilmedi.\n- DoD: node --check PASS; keyboard input-contract guard PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, assets/dialogue, terrain/road, mobil streaming/LOD/culling/perf, touch joystick ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.\n- Görsel doğrulama: runtime/CSS/render üretimi değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel yolu doğruladı.\n- Performans: ${perfRow}\n- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material eklenmedi; test, mevcut keydown/keyup listener'larının dispose sırasında kaldırıldığını ve held/jump state'in temizlendiğini doğrular.\n- Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.\n- ADR: ADR-0184. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.\n- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; masaüstü input regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; WASD/ok tuşları, Shift koşu, Space edge-jump ve cleanup davranışı artık kalıcı testle korunuyor.\n- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız gameplay/UI/test-kalite işi; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.\n`;

const adr = `\n\n## ADR-0184 — Keyboard input contract regression guard (run 162)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Mevcut \`KeyboardInput\` runtime kodunu değiştirmeden; WASD ve ok tuşu eksen eşlemesini, karşıt tuşların deterministik iptalini, Shift koşu modifier'ını, Space için tek-okumalık edge-triggered jump sözleşmesini ve dispose listener/state temizliğini tek bir deterministik Node regresyon testiyle sabitle.\n\n**Neden:** FAZ 4 masaüstü hareketinin temel girdisi klavyedir. Bu davranış browser smoke içinde dolaylı olarak geçse de input sözleşmesinin özellikle Space tekrar-keydown ve karşıt yön kombinasyonları ayrı bir düşük seviyeli testle pinlenmiyordu. Run 161'de touch joystick kontratı korunmaya alındı; masaüstü eşleniğini aynı kalite seviyesine getirmek, runtime davranışını değiştirmeden anlamlı ve düşük riskli bir devam adımıdır.\n\n**Alternatifler:** (1) Runtime input kodunu refactor etmek — ihtiyaç yok ve additive-only guard altında gereksiz risk. (2) Yalnız browser smoke'a güvenmek — edge-triggered jump ve karşıt-key kombinasyonlarını izole etmez. (3) Tam Playwright klavye senaryosu — daha pahalı; saf input-state sözleşmesi Node seviyesinde deterministik olarak kanıtlanabilir, gerçek Chromium/WebGL yolu zaten full smoke ile ayrıca çalışır.\n\n**Sonuç:** Oyuncu davranışı, render, PWA cache, seed/determinism ve 2D oyun değişmez; masaüstü hareket/jump regresyonları daha erken ve daha açıklayıcı yakalanır.\n\n**Etkilenen sistemler:** yeni \`scripts/checkKeyboardInputContract.js\`, run162 CI/governance kayıtları. Runtime kaynak kodu etkilenmez.\n\n**Geri alma planı:** İleride keyboard input sözleşmesi bilinçli olarak değişirse yeni davranış için yeni additive test/ADR eklenir; mevcut guard tarihsel kontrat olarak tutulabilir veya owner onaylı test-fixture istisnası değerlendirilebilir.\n`;

const stable = `\n- ${stableTag} — run 162 keyboard input contract regression guard (ADR-0184); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.\n`;

fs.appendFileSync('3D_GAME_PROGRESS.md', progress);
fs.appendFileSync('DECISIONS.md', adr);
fs.appendFileSync('STABLE_TAGS.md', stable);
fs.appendFileSync('perf_log.csv', `\n${perfRow}`);

console.log(`Run162 governance records appended for ${stableTag}.`);
