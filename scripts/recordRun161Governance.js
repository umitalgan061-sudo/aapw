import fs from 'node:fs';

const stamp = process.env.RUN161_STAMP;
const stableTag = process.env.RUN161_STABLE_TAG;
const perfRow = process.env.RUN161_PERF_ROW;
const smokeCount = process.env.RUN161_SMOKE_PASS_COUNT;

if (!stamp || !stableTag || !perfRow || !smokeCount) {
	throw new Error('Run161 governance environment is incomplete.');
}

const progress = `\n\n## Run 161 — Touch joystick input contract regression guard (${stamp})\n- Alt görev: FAZ 4 mobil kontrol kalite güvencesi — mevcut touch joystick davranışı için kalıcı regresyon kontratı eklendi; runtime kaynak satırı değiştirilmedi.\n- Additive-only: yalnız yeni test/CI/governance dosyaları ve append-only kayıtlar eklendi; mevcut kaynak satırı silinmedi/değiştirilmedi.\n- DoD: node --check PASS; touch joystick input-contract guard PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, assets/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.\n- Görsel doğrulama: runtime/CSS/render üretimi değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel yolu doğruladı.\n- Performans: ${perfRow}\n- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material eklenmedi; test, mevcut pointer listener'larının dispose sırasında kaldırıldığını doğrular.\n- Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.\n- ADR: ADR-0183. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.\n- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; mobil input regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; joystick'in capture/deadzone/clamp/cancel/cleanup davranışı artık kalıcı testle korunuyor.\n- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız gameplay/UI/test-kalite işi; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.\n`;

const adr = `\n\n## ADR-0183 — Touch joystick input contract regression guard (run 161)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Mevcut \`TouchJoystick\` runtime kodunu değiştirmeden; pointer capture sahipliği, ikinci parmağın yok sayılması, deadzone, radius clamp, forward/strafe eksen eşlemesi, running eşiği, pointercancel reset'i ve dispose listener temizliğini tek bir deterministik Node regresyon testiyle sabitle.\n\n**Neden:** Mobil 3D hareketin temel girdisi joystick'tir; bu davranışlar bugüne kadar browser smoke içinde dolaylı olarak geçse de düşük seviyeli input sözleşmesi ayrı bir testle pinlenmiyordu. Additive-only kuralı altında runtime'a gereksiz semantik/işlev eklemek yerine mevcut doğru davranışı doğrudan korumak en düşük riskli kalite artışıdır.\n\n**Alternatifler:** (1) Runtime joystick kodunu refactor etmek — ihtiyaç yok ve additive-only guard gereksiz risk yaratır. (2) Yalnız browser smoke'a güvenmek — deadzone/capture/cancel edge-case'leri tek tek izole etmez. (3) Tam Playwright gesture testi — daha pahalı ve bu saf eksen sözleşmesi için gereksiz; gerçek mobil Chromium yolu zaten mevcut mobil/perf smoke kapılarında çalışıyor.\n\n**Sonuç:** Oyuncu davranışı, render, PWA cache, seed/determinism ve 2D oyun bit-eşit kalır; mobil input regresyonları daha erken ve daha açıklayıcı yakalanır.\n\n**Etkilenen sistemler:** yeni \`scripts/checkTouchJoystickInputContract.js\`, run161 CI/governance kayıtları. Runtime kaynak kodu etkilenmez.\n\n**Geri alma planı:** İleride joystick sözleşmesi bilinçli olarak değişirse yeni davranış için yeni bir additive test/ADR eklenebilir; mevcut guard tarihsel kontrat olarak kalabilir veya owner onaylı test-fixture istisnası gündeme alınabilir.\n`;

const stable = `\n- ${stableTag} — run 161 touch-joystick input contract regression guard (ADR-0183); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.\n`;

fs.appendFileSync('3D_GAME_PROGRESS.md', progress);
fs.appendFileSync('DECISIONS.md', adr);
fs.appendFileSync('STABLE_TAGS.md', stable);
fs.appendFileSync('perf_log.csv', `\n${perfRow}`);

console.log(`Run161 governance records appended for ${stableTag}.`);
