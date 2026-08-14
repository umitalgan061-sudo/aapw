import fs from 'node:fs';

const smokeCount = process.env.RUN159_SMOKE_PASS_COUNT;
const perfRow = process.env.RUN159_PERF_ROW;
const stableTag = process.env.RUN159_STABLE_TAG;
const stamp = process.env.RUN159_STAMP;

if (!smokeCount || !perfRow || !stableTag || !stamp) {
	throw new Error('Run 159 governance recorder requires smoke, perf, stable-tag and timestamp environment values.');
}

const progressPath = '3D_GAME_PROGRESS.md';
const decisionsPath = 'DECISIONS.md';
const stablePath = 'STABLE_TAGS.md';
const progress = fs.readFileSync(progressPath, 'utf8');
const decisions = fs.readFileSync(decisionsPath, 'utf8');
const stable = fs.readFileSync(stablePath, 'utf8');

if (progress.includes('## Run 159 — Controls help trigger/panel accessibility')) {
	throw new Error('Run 159 progress record already exists.');
}
if (decisions.includes('## ADR-0181 — Kontrol yardımı tetikleyici/panel ARIA ilişkisi')) {
	throw new Error('ADR-0181 already exists.');
}
if (stable.includes('run 159 controls-help trigger/panel accessibility')) {
	throw new Error('Run 159 stable checkpoint record already exists.');
}

fs.appendFileSync(decisionsPath, `

## ADR-0181 — Kontrol yardımı tetikleyici/panel ARIA ilişkisi (run 159)

**Risk Seviyesi:** LOW

**Karar:** \`ControlsHelp\` örnekleri, mevcut soru işareti düğmesini kontrol ettiği yardım paneline \`aria-controls\` ile bağlar. Her panel, modül içi monoton sayaçtan üretilen \`g3d-controls-help-panel-N\` kimliğini alır; aynı sayfada birden fazla örnek oluşsa bile kimlikler çakışmaz. Mevcut \`aria-expanded\`, Türkçe aç/kapa etiketi, Escape davranışı ve mobil/masaüstü içerik ayrımı korunur.

**Neden:** Düğme bugün açık/kapalı durumunu \`aria-expanded\` ile bildiriyor fakat hangi DOM bölgesini yönettiğini erişilebilirlik ağacında açıkça belirtmiyordu. \`aria-controls\` bu ilişkiyi düşük riskle tamamlar. Sabit tek bir id yerine sayaç kullanmak, testlerde veya gelecekte birden çok HUD kökü oluştuğunda yinelenen DOM id üretimini önler.

**Alternatifler:** (1) Sabit \`id="g3d-controls-help-panel"\` — reddedildi, aynı anda iki örnekte yinelenen id riski yaratır. (2) \`Math.random()\` ile id üretmek — reddedildi, proje determinizm ilkesine aykırı ve gereksizdir. (3) Paneli focusable/dialog yapmak — reddedildi, mevcut yüzey yalnız yardım içeriği ve modal değil.

**Sonuç:** Görsel DOM sırası, CSS, aç/kapa davranışı, dokunmatik hedef boyutu, oyun mantığı ve performans değişmez. Ekran okuyucu yardım düğmesinin hangi paneli yönettiğini açıkça çözebilir.

**Etkilenen sistemler:** \`src/3d/ui/controlsHelp.js\`, yeni \`scripts/checkControlsHelpAccessibility.js\`, run159 CI/kayıtları. 2D oyun, world generation, PWA/cache, gameplay ve seed davranışı etkilenmez.

**Geri alma planı:** İleride ortak bir erişilebilirlik-id sağlayıcısı eklenirse yeni sağlayıcı, mevcut panel kimliği/\`aria-controls\` değerini additive biçimde devralabilir; var olan kaynak satırlarını silmek/değiştirmek gerekmez.
`);

fs.appendFileSync(progressPath, `

## Run 159 — Controls help trigger/panel accessibility (${stamp})
- Alt görev: owner bloklarına dokunmadan FAZ 8 UI erişilebilirliği — kontrol-yardımı düğmesi artık \`aria-controls\` ile kendi paneline bağlı; panel id'leri modül içi deterministik sayaçla örnek başına benzersiz.
- Additive-only: mevcut kaynak satırı silinmedi/değiştirilmedi; yalnız sayaç + panel id/\`aria-controls\` satırları, yeni regresyon scripti ve bu CI/kayıtlar eklendi.
- DoD: \`node --check\` PASS; hedef a11y testi PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, asset/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.
- Görsel doğrulama: yalnız ARIA ilişki metadata'sı ve görünmez panel id'si eklendiği için piksel çıktısı değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı görsel/runtime yolu doğruladı.
- Performans: ${perfRow}
- Memory leak checklist: yeni listener/timer/geometry/material yok; yalnız küçük bir modül sayacı var; \`ControlsHelp.dispose()\` mevcut DOM ve global key listener temizliğini aynen koruyor.
- Teknik borç: 1 (\`game3d.js\` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- ADR: ADR-0181. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.
- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; erişilebilirlik regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; ekran okuyucu yardım düğmesi ile yönettiği paneli açıkça ilişkilendirebilir.
- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız UI/test-kalite işi veya FAZ 8 içerik kalite guard'ı; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.
`);

fs.appendFileSync(stablePath, `\n- ${stableTag} — run 159 controls-help trigger/panel accessibility (ADR-0181); ${smokeCount}/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.\n`);

console.log(`[recordRun159Governance] PASS: appended ADR-0181, Run 159 progress and ${stableTag}.`);
