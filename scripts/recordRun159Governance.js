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

if (progress.includes('## Run 159 — Controls help accessibility relation')) {
	throw new Error('Run 159 progress record already exists.');
}
if (decisions.includes('## ADR-0181 — Kontrol yardım düğmesini açtığı panele programatik olarak bağla')) {
	throw new Error('ADR-0181 already exists.');
}
if (stable.includes('run 159 controls help accessibility relation')) {
	throw new Error('Run 159 stable checkpoint record already exists.');
}

fs.appendFileSync(decisionsPath, `

## ADR-0181 — Kontrol yardım düğmesini açtığı panele programatik olarak bağla (run 159)

**Risk Seviyesi:** LOW

**Karar:** \`ControlsHelp\` içindeki mevcut yardım paneline sabit \`id="g3d-controls-help-panel"\` eklenir ve mevcut \`?\` düğmesi \`aria-controls\` ile bu kimliğe bağlanır. Mevcut \`aria-expanded\`, Türkçe aç/gizle etiketi, click/Escape davranışı ve görünürlük mekanizması aynen korunur.

**Neden:** Düğme zaten erişilebilir ada ve açık/kapalı durumuna sahipti, panel de etiketliydi; fakat yardımcı teknoloji açısından "bu düğme hangi bölgeyi açıyor?" ilişkisi programatik olarak belirtilmiyordu. \`aria-controls\` bu bağı mevcut DOM/görsel davranışa dokunmadan açıklar.

**Alternatifler:** (1) Paneli focusable yapıp açılışta odağı taşımak — reddedildi; mevcut klavye akışını değiştirir ve owner kararı gerektirecek etkileşim tasarımı yaratır. (2) \`aria-describedby\` kullanmak — reddedildi; açıklama ilişkisi aç/kapa kontrolü ilişkisini doğru ifade etmez. (3) Hiç değiştirmemek — reddedildi; mevcut erişilebilirlik zincirinde küçük ama gerçek bir semantik boşluk bırakır.

**Sonuç:** Piksel çıktısı, panel içeriği, masaüstü/mobil kontrol metinleri, click/Escape davranışı, 2D oyun, PWA/cache ve deterministik gameplay değişmez. Ekran okuyucu düğmenin kontrol ettiği paneli doğrudan çözebilir.

**Etkilenen sistemler:** \`src/3d/ui/controlsHelp.js\`, yeni \`scripts/checkControlsHelpAccessibility.js\`, Run 159 CI/kayıtları. Gameplay/world/terrain/renderer etkilenmez.

**Geri alma planı:** İleride ortak bir erişilebilirlik/ID üretim katmanı eklenirse yeni kimlik ve ilişki additive bir üst katmanla gölgelenebilir; mevcut runtime satırlarını silmek/değiştirmek gerekmez.
`);

fs.appendFileSync(progressPath, `

## Run 159 — Controls help accessibility relation (${stamp})
- Alt görev: owner bloklarına dokunmadan FAZ 8 UI erişilebilirliği — kontrol yardımındaki mevcut \`?\` düğmesi, açtığı panelin sabit kimliğine \`aria-controls\` ile programatik olarak bağlandı.
- Additive-only: ilk deneme newline farkı nedeniyle +3/-1 görünerek guard öncesi reddedildi; temiz Run 158 tabanından V2 yeniden kuruldu ve gerçek net diff +2/-0 oldu. Mevcut kaynak satırı silinmedi/değiştirilmedi.
- DoD: \`node --check\` PASS; hedef ControlsHelp a11y guard PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, asset/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.
- Görsel doğrulama: yalnız DOM erişilebilirlik metadata'sı eklendi; piksel/CSS çıktısı değişmedi. Baseline ve post-change gerçek Chromium/WebGL smoke mevcut görünür davranışı doğruladı.
- Performans: ${perfRow}
- Memory leak checklist: yeni listener/timer/DOM node/geometry/material yok; mevcut click+keydown listener yaşam döngüsü ve \`dispose()\` temizliği aynen korunuyor.
- Teknik borç: 1 (\`game3d.js\` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- ADR: ADR-0181. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.
- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; erişilebilirlik regresyon kapsamı +1. Oyuncu farkı: görsel olarak hayır; ekran okuyucu yardım düğmesinin hangi paneli yönettiğini artık programatik olarak çözebilir.
- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız test-kalite/dokümantasyon veya yeni, küçük ve deterministik gameplay/UI iyileştirmesi; yeni owner kararı gerektiren kalibrasyon yapılmayacak.
`);

fs.appendFileSync(stablePath, `\n- ${stableTag} — run 159 controls help accessibility relation (ADR-0181); ${smokeCount}/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.\n`);

console.log(`[recordRun159Governance] PASS: appended ADR-0181, Run 159 progress and ${stableTag}.`);
