#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN179_STAMP', 'RUN179_STABLE_TAG', 'RUN179_PERF_ROW', 'RUN179_SMOKE_PASS_COUNT', 'RUN179_MASK_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error(`missing ${key}`);

function append(file, text) {
	fs.appendFileSync(path.join(ROOT, file), `\n\n${text.trim()}\n`);
}

append('3D_GAME_PROGRESS.md', `## Run 179 — Canonical map coastline/water mask contract (${process.env.RUN179_STAMP})
- Owner'ın 1536x1024 2D dünya haritası GOVERNANCE §31 ile canonical makro-coğrafya kaynağı olarak kalıcılaştırıldı. Runtime dünya artık rastgele kıyı/dağ/biyom icat etmek yerine versioned map-reference katmanları üzerinden ilerleyecek.
- Yeni \`src/3d/world/worldReferenceWaterMask.js\`: 96x64 deterministik 1-bit mask; ${process.env.RUN179_MASK_SUMMARY}. Veriler 24-hex-character satırlar halinde tutulur; production runtime görsel OCR/renk analizi yapmaz.
- Güvenlik kararı: bu run maskeyi **runtime terrain'e bağlamaz**. Mevcut 2D kingdom-seat koordinat sisteminin referans görselin normalize uzayıyla hizası henüz kanıtlanmadığı için doğrudan world-extent→image-extent eşleme yapılmadı; koltukları su altına sokabilecek tahmine dayalı dönüşüm §8.4/§14'e aykırı olurdu.
- Additive-only: yeni module/check/workflow/applicator/recorder dosyaları eklendi; service-worker, GOVERNANCE ve WORLD_REFERENCE_MAP yalnız satır eklemeleri aldı. Mevcut 2D/3D runtime kaynak satırı silinmedi/değiştirilmedi.
- DoD: node --check PASS; baseline + after browser smoke ${process.env.RUN179_SMOKE_PASS_COUNT}/34+ PASS; console/page error 0; canonical-map + new water-mask contract, terrain/road safety, determinism, assets, a11y, input/physics, mobile streaming/LOD/perf, visual contracts, PWA installability/cache ve additive-only kapıları PASS. İki mobil görsel kanıt artifact üretildi.
- Performans: ${process.env.RUN179_PERF_ROW}. Runtime render delta 0; yeni mask module henüz scene import graph'ında tüketilmiyor.
- Memory leak checklist: listener/timer/DOM/geometry/material/texture/mesh eklenmedi; data-only frozen constants + pure sampler helpers. Teknik borç: 1 (önceden var olan game3d.js yapısal borcu). Risk LOW. Güven 5/5.
- ADR: ADR-0200. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.
- World Evolution Report delta: canonical coastline data +1; terrain runtime 0, yol 0 km, orman 0 km², kale/NPC/event/hayvan/asset/diyalog 0, coverage 0, ADR +1. Oyuncu farkı: doğrudan HAYIR; bundan sonraki kıyı/deniz/dağ dönüşümünün güvenli veri temeli oluştu.
- Sıradaki güvenli adım: mevcut 2D marker koordinatları ile owner görselinin normalize uzayı arasında doğrulanabilir hizalama/anchor dönüşümü oluştur; **hizalama + 14/14 seat land-safety kanıtı çıkmadan** height sampler veya water runtime'ını maskeye bağlama.`);

append('DECISIONS.md', `## ADR-0200 — Canonical coastline mask is immutable data; runtime terrain adoption waits for coordinate alignment (run 179)

**Risk Seviyesi:** LOW

**Karar:** Owner'ın canonical 2D dünya haritasından türetilen ilk raster katman \`worldReferenceWaterMask.js\` içinde 96x64 tek-bit land/water maskesi olarak saklanır. 6144 hücrenin 4052'si su, 2092'si kara; binary satırların SHA-256 özeti \`2ca2bed8d8a137ba532a56e10b079fa845b0f7214e24f955388c8dd0a4517f27\`. Runtime görsel dosyayı analiz etmez; sampler sadece versioned repo verisini okur. Run 179 bu veriyi terrain/water yüksekliğine **henüz uygulamaz**.

**Neden:** Harita artık ürünün makro-coğrafya gerçeği, dolayısıyla kıyı şekli prosedürel noise'a bırakılamaz. Fakat mevcut kingdom-seat/world koordinatları 9000x7000 2D oyun uzayından türetilmiştir; owner görseli 1536x1024 normalize uzaydadır. Bu iki uzayın doğrudan aynı extent'e sahip olduğunu varsaymak teknik olarak kanıtlanmamıştır. Seat/water/road güvenliğini kaybetme riski varken bir dönüşüm tahmin etmek GOVERNANCE §8.4 ve §14'e aykırıdır. Önce immutable kıyı verisini pinlemek, sonra ayrı bir hizalama alt göreviyle doğru transformu kanıtlamak daha güvenlidir.

**Alternatifler:** (1) Referans JPG'yi runtime texture/height-mask olarak yüklemek: offline cache + decode maliyeti ve görsel-raster bağımlılığı getirir; deterministik denetim zorlaşır. (2) 1536x1024 tam çözünürlükte bitmap saklamak: mevcut makro aşama için gereksiz veri; 96x64 kıyı topolojisini yeterince korur ve daha sonra versioned daha yüksek çözünürlük katmanı eklenebilir. (3) Dünya extent'ini doğrudan [0,1] görüntü extent'ine maplemek: hızlı ama mevcut seat koordinatlarıyla hizası kanıtlanmadığı için reddedildi. (4) Su maskesini sadece birkaç elipsle temsil etmek: önceki \`REFERENCE_WATER_ZONES\` gibi makro kontrol sağlar fakat gerçek kıyı siluetini taşımaz.

**Sonuç:** Canonical kıyı şekli checksum'lı, küçük, offline-safe bir veri sözleşmesine dönüştü; mevcut oyun davranışı/perf/coverage değişmedi. Sonraki runtime terrain değişikliği artık bu veriyi kullanabilir fakat yalnız koordinat hizalama ve 14/14 seat safety kanıtından sonra.

**Etkilenen sistemler:** yeni \`src/3d/world/worldReferenceWaterMask.js\`, \`scripts/checkWorldReferenceWaterMask.js\`, service-worker precache, GOVERNANCE §31, WORLD_REFERENCE_MAP dokümanı ve run179 CI/governance kayıtları. 2D oyun, terrain height sampler, water plane, roads, settlements, vegetation, gameplay ve asset seti değişmez.

**Gelecek Faz Etkisi:** macro-relief/dağ, biyom, nehir ve yol uyarlamaları aynı normalize reference space'i paylaşabilecek. Hizalama dönüşümü tek kaynaktan çözülürse bütün bu katmanlar birbirinden kopuk koordinat sistemleri üretmez.

**Geri alma planı:** Mask sınıflandırmasının belirli kıyı bölgelerinde hatalı olduğu kanıtlanırsa eski veri silinmez; yeni versioned mask module + checksum + ADR eklenir ve consumer yeni sürüme opt-in edilir. Runtime davranışı bu ADR'de değişmediği için geri alma gameplay rollback gerektirmez.`);

append('STABLE_TAGS.md', `- ${process.env.RUN179_STABLE_TAG} — run 179 canonical-map coastline/water-mask contract (ADR-0200); ${process.env.RUN179_SMOKE_PASS_COUNT}/34+ browser smoke, map/mask checksum, terrain/road, PWA/mobile/perf/governance gates PASS; runtime render delta 0.`);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), `\n${process.env.RUN179_PERF_ROW}\n`);

console.log('[recordRun179GovernanceV2] PASS: progress + ADR-0200 + parseable stable checkpoint + newline-safe perf row recorded.');
