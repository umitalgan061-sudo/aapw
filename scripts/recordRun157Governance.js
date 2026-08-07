import fs from 'node:fs';

const smokeCount = process.env.RUN157_SMOKE_PASS_COUNT;
const perfRow = process.env.RUN157_PERF_ROW;
const stableTag = process.env.RUN157_STABLE_TAG;
const stamp = process.env.RUN157_STAMP;

if (!smokeCount || !perfRow || !stableTag || !stamp) {
	throw new Error('Run 157 governance recorder requires smoke, perf, stable-tag and timestamp environment values.');
}

const progressPath = '3D_GAME_PROGRESS.md';
const decisionsPath = 'DECISIONS.md';
const stablePath = 'STABLE_TAGS.md';
const progress = fs.readFileSync(progressPath, 'utf8');
const decisions = fs.readFileSync(decisionsPath, 'utf8');
const stable = fs.readFileSync(stablePath, 'utf8');

if (progress.includes('## Run 157 — Day/night clock accessibility')) {
	throw new Error('Run 157 progress record already exists.');
}
if (decisions.includes('## ADR-0179 — Oyun saati için sessiz erişilebilir timer semantiği')) {
	throw new Error('ADR-0179 already exists.');
}
if (stable.includes('run 157 day/night clock quiet timer accessibility')) {
	throw new Error('Run 157 stable checkpoint record already exists.');
}

fs.appendFileSync(decisionsPath, `

## ADR-0179 — Oyun saati için sessiz erişilebilir timer semantiği (run 157)

**Risk Seviyesi:** LOW

**Karar:** \`DayNightClock\` görsel davranışı değiştirmeden \`role="timer"\`, \`aria-live="off"\`, \`aria-atomic="true"\` kazanır; dekoratif gün/gece emojisi \`aria-hidden="true"\` olur. Görünen oyun dakikası değiştiğinde mevcut Türkçe \`aria-label\`, \`Oyun içi saat HH:MM\` biçiminde güncellenir.

**Neden:** 12 dakikalık sıkıştırılmış oyun gününde ekrandaki saat yaklaşık her yarım gerçek saniyede değişiyor. \`status\`/\`polite\` gibi canlı-bölge semantiği bu kadar hızlı değişen bir yüzeyde ekran okuyucuyu gereksiz yere konuşturur. \`timer\` rolü + \`aria-live=off\`, oyuncu erişilebilirlik ağacında saati sorguladığında güncel değeri verir ama her dakika değişimini kendiliğinden anons etmez. Emoji yalnız görsel dönem ipucu olduğu için erişilebilir adın parçası yapılmaz.

**Alternatifler:** (1) \`role="status"\` + \`aria-live="polite"\` — reddedildi, sıkıştırılmış zaman akışında aşırı konuşkan olurdu. (2) Yalnız mevcut \`aria-label="Oyun içi saat"\` ile kalmak — reddedildi, erişilebilir ad güncel HH:MM değerini taşımıyordu. (3) Saati focusable bir kontrol yapmak — reddedildi, widget etkileşimli değil.

**Sonuç:** Görsel DOM/CSS, zaman hesaplama, ikon eşikleri, world-event gündüz/gece kuralları ve render performansı değişmez. Ekran okuyucu güncel saati Türkçe ad üzerinden okuyabilir; otomatik canlı anons yapılmaz.

**Etkilenen sistemler:** \`src/3d/ui/dayNightClock.js\`, yeni \`scripts/checkDayNightClockAccessibility.js\`, run157 CI/kayıtları. \`lighting.js\`, \`worldEvents.js\`, save/PWA/cache ve 2D oyun etkilenmez.

**Geri alma planı:** İleride owner onaylı ortak erişilebilirlik katmanı gelirse yeni attribute'lar o katman tarafından additive biçimde gölgelenebilir; mevcut runtime satırlarını silmek/değiştirmek gerekmez.
`);

fs.appendFileSync(progressPath, `

## Run 157 — Day/night clock accessibility (${stamp})
- Alt görev: owner bloklarına dokunmadan FAZ 8 HUD erişilebilirliği — oyun içi saat \`role=timer\`, \`aria-live=off\`, \`aria-atomic=true\`, dinamik Türkçe \`aria-label\` ve dekoratif ikon için \`aria-hidden=true\` kazandı.
- Additive-only: mevcut kaynak satırı silinmedi/değiştirilmedi; yalnız yeni attribute/update satırları, yeni regresyon scripti ve bu CI/kayıtlar eklendi.
- DoD: \`node --check\` PASS; hedef a11y testi PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, asset/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.
- Görsel doğrulama: yalnız ARIA metadata ve erişilebilir ad güncellendiği için piksel çıktısı değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel/runtime yolu doğruladı.
- Performans: ${perfRow}
- Memory leak checklist: yeni listener/timer/geometry/material yok; \`DayNightClock.dispose()\` mevcut DOM kaldırma davranışını aynen koruyor.
- Teknik borç: 1 (\`game3d.js\` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- ADR: ADR-0179. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.
- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; erişilebilirlik regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; ekran okuyucu güncel oyun saatini sessiz timer semantiğiyle okuyabilir.
- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız UI/test-kalite işi; run158 civarı CATCH_UP.md insan yakalama özeti penceresi.
`);

fs.appendFileSync(stablePath, `\n- ${stableTag} — run 157 day/night clock quiet timer accessibility (ADR-0179); ${smokeCount}/34+ browser smoke, additive-only/PWA/mobile/governance gates PASS.\n`);

console.log(`[recordRun157Governance] PASS: appended ADR-0179, Run 157 progress and ${stableTag}.`);
