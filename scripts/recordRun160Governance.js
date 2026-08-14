import fs from 'node:fs';

const smokeCount = process.env.RUN160_SMOKE_PASS_COUNT;
const perfRow = process.env.RUN160_PERF_ROW;
const stableTag = process.env.RUN160_STABLE_TAG;
const stamp = process.env.RUN160_STAMP;

if (!smokeCount || !perfRow || !stableTag || !stamp) {
	throw new Error('Run 160 governance recorder requires smoke, perf, stable-tag and timestamp values.');
}

const progressPath = '3D_GAME_PROGRESS.md';
const decisionsPath = 'DECISIONS.md';
const stablePath = 'STABLE_TAGS.md';
const progress = fs.readFileSync(progressPath, 'utf8');
const decisions = fs.readFileSync(decisionsPath, 'utf8');
const stable = fs.readFileSync(stablePath, 'utf8');

if (progress.includes('## Run 160 — Interaction prompt keyboard accessibility')) throw new Error('Run 160 progress already exists.');
if (decisions.includes('## ADR-0182 — Etkileşim isteminde klavye erişilebilirliği')) throw new Error('ADR-0182 already exists.');
if (stable.includes('run 160 interaction-prompt keyboard accessibility')) throw new Error('Run 160 stable record already exists.');

fs.appendFileSync(decisionsPath, `\n\n## ADR-0182 — Etkileşim isteminde klavye erişilebilirliği (run 160)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** \`InteractionPrompt\`, gerçek bir activation handler bağlıyken mevcut pointer davranışına ek olarak Enter/Space klavye aktivasyonunu kabul eder; aynı anda \`role=button\`, \`tabindex=0\` ve Türkçe \`aria-label=Selamla\` kullanır. Handler kaldırıldığında run156'nın salt durum bildirimi semantiğine geri döner.\n\n**Neden:** Mobil/PWA için tıklanabilir hale gelen aynı DOM yüzeyi klavye ile odaklanabilir/çalıştırılabilir değildi. Bu, mouse/touch ile klavye arasında işlev eşitsizliği yaratıyordu.\n\n**Alternatifler:** (1) Etkileşim promptunu gerçek \`button\` elementine dönüştürmek — additive-only kuralı nedeniyle mevcut DOM oluşturma satırını değiştirmek gerekir, reddedildi. (2) Yalnız \`tabindex\` eklemek — semantik ve Enter/Space davranışı eksik kalır. (3) Global yeni klavye listener — mevcut öğe yerelken gereksiz ve cleanup riski daha yüksek.\n\n**Sonuç:** Görsel düzen, E tuşu akışı, pointer davranışı ve gameplay değişmez; sadece mevcut prompt DOM'u handler varken klavye ile eşdeğer erişilebilir olur. Dispose iki yerel listener'ı açıkça temizler.\n\n**Etkilenen sistemler:** \`src/3d/ui/interactionPrompt.js\`, \`scripts/checkInteractionPromptAccessibility.js\`, run160 CI/kayıtları. 2D oyun, world generation, seed, PWA cache ve render bütçesi etkilenmez.\n\n**Geri alma planı:** İleride prompt gerçek bir native button bileşenine additive bir sarmalayıcıyla taşınırsa yeni katman bu semantiği devralabilir; mevcut satırların silinmesi/değiştirilmesi gerekmez.\n`);

fs.appendFileSync(progressPath, `\n\n## Run 160 — Interaction prompt keyboard accessibility (${stamp})\n- Alt görev: FAZ 5/8 HUD kalite erişilebilirliği — touch/click ile çalışabilen etkileşim promptu artık handler varken focusable button semantiği ve Enter/Space aktivasyonu sunuyor.\n- Additive-only: mevcut kaynak/test satırları silinmedi/değiştirilmedi; yalnız keyboard listener, semantik metadata, cleanup, regresyon ve CI/kayıt satırları eklendi.\n- DoD: node --check PASS; interaction-prompt a11y regresyonu PASS; checkpoint/uniqueness, world-event determinism/catalog/diversity, PWA/cache, assets/dialogue, terrain/road, mobil streaming/LOD/culling/perf ve mevcut a11y regresyonları PASS; browser smoke ${smokeCount}/34+ PASS; 3D console/page error 0; additive-only PASS.\n- Görsel doğrulama: CSS/layout/piksel üretimi değişmedi; baseline ve post-change gerçek Chromium/WebGL smoke aynı yolu doğruladı.\n- Performans: ${perfRow}\n- Memory leak checklist: yeni keydown listener dispose sırasında, mevcut pointer listener ile birlikte explicit kaldırılıyor; timer/geometry/material yok.\n- Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.\n- ADR: ADR-0182. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.\n- World Evolution Report delta: yol/orman/kale/NPC/event/hayvan 0; asset/diyalog 0; ADR +1; erişilebilirlik regresyon kapsamı güçlendirildi. Oyuncu farkı: görsel olarak hayır; klavye/switch kullanıcıları promptu Enter/Space ile çalıştırabilir.\n- Sıradaki güvenli adım: owner bloklarını zorlamadan bağımsız UI/test-kalite veya FAZ 8 içerik kalite işi; başlamadan remote main ve paralel ajan branch'leri yeniden kontrol edilmeli.\n`);

fs.appendFileSync(stablePath, `\n- ${stableTag} — run 160 interaction-prompt keyboard accessibility (ADR-0182); ${smokeCount}/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.\n`);
console.log(`[recordRun160Governance] PASS: appended ADR-0182, Run 160 progress and ${stableTag}.`);
