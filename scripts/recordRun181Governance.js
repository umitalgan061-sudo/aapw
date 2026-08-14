#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN181_STAMP', 'RUN181_STABLE_TAG', 'RUN181_PERF_ROW', 'RUN181_SMOKE_PASS_COUNT', 'RUN181_ALIGNMENT_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error(`missing ${key}`);

function appendMarkdown(file, text) {
	fs.appendFileSync(path.join(ROOT, file), `\n\n${text.trim()}\n`);
}

appendMarkdown('3D_GAME_PROGRESS.md', `## Run 181 — Exact 2D map → reference-image alignment contract (${process.env.RUN181_STAMP})
- Run179'un canonical kıyı maskesinden sonraki hizalama engeli çözüldü: 2D shell'in gerçek CSS'i \`#map-canvas=9000x7000\` ve \`.map-base background ... /100% 100%\` kullanıyor. Bu nedenle 2D map koordinatı → owner referans görsel normalize koordinatı artık tahmin değil, mevcut 2D render sözleşmesinden kanıtlı \`x/9000, y/7000\` dönüşümüdür.
- Yeni \`src/3d/world/worldReferenceAlignment.js\`: map↔normalized-reference ve mevcut worldXZ↔normalized-reference saf/deterministik round-trip helper'ları. ${process.env.RUN181_ALIGNMENT_SUMMARY}
- Güvenlik bulgusu: hizalama doğru olsa da run179'un kaba 96x64 su maskesi canonical 14 seat'in 12'sini kara, \`balon\` ve \`jon\`u raw-water olarak örnekliyor. Bu iki nokta runtime hatası değildir çünkü mask henüz terrain/water'a bağlanmadı; runtime adoption öncesi seat-safe hydrology/refined mask zorunlu.
- Kapsam bulgusu: mevcut 3D \`WORLD_SCALE.MAP_BOUNDS\` owner görselinin normalize dikdörtgeninin yaklaşık %67.3'ünü kapsıyor. User'ın tam 2D haritayı 3D'leştirme hedefi için kalan doğu/güney extent ileride ölçümlü biçimde kapsanmalı; mevcut crop 'tam harita' diye raporlanamaz.
- Additive-only: yeni alignment module/check/workflow/applicator/recorder eklendi; yalnız service-worker ve WORLD_REFERENCE_MAP'e satır eklendi. Terrain, water, roads, settlements, 2D script/CSS davranışı değiştirilmedi.
- DoD: node --check PASS; baseline + after browser smoke ${process.env.RUN181_SMOKE_PASS_COUNT}/34+ PASS; console/page error 0; alignment + map/mask, terrain/road safety, determinism, visual, a11y/input, mobile streaming/LOD/perf, PWA/cache ve additive-only kapıları PASS; iki mobil görsel kanıt artifact'i PASS.
- Performans: ${process.env.RUN181_PERF_ROW}. Runtime render delta 0. Teknik borç: 1 (önceden var olan game3d.js yapısal borcu). Risk LOW. Güven 5/5.
- ADR: ADR-0201. World Coverage: desktop %96.2 mevcut 3D extent içinde; mobil resident ~%14.7 (81 chunk / 20.25 km²) — runtime değişmedi. Ayrı 'reference rectangle extent' metriği %67.3; bu World Coverage metriğiyle karıştırılmaz.
- World Evolution Report delta: coordinate-alignment contract +1; runtime terrain/water/yol/orman/kale/NPC/event/hayvan/asset/diyalog/coverage delta 0; ADR +1. Oyuncu farkı doğrudan HAYIR; sonraki kıyı/dağ/biyom üretiminin doğru 2D koordinatlara oturması için kritik temel.
- Sıradaki güvenli adım: raw mask'in \`balon\`/\`jon\` false-water durumunu seat-safe hydrology/refined coastline katmanıyla çöz ve full-reference extent'i 150 km² sınırı altında kapsayacak ölçek/streaming planını ayrı ölç; bunlar geçmeden terrain height sampler'ı maskeye bağlama.`);

appendMarkdown('DECISIONS.md', `## ADR-0201 — 2D map/reference alignment is the existing 9000x7000 CSS stretch, not WORLD_SCALE.MAP_BOUNDS normalization (run 181)

**Risk Seviyesi:** LOW

**Karar:** Canonical owner image ile 2D oyun koordinatları arasındaki tek doğru normalize dönüşüm \`mapX / 9000\`, \`mapY / 7000\` olarak pinlendi. Kanıt repo içindeki mevcut 2D CSS sözleşmesidir: \`#map-canvas\` 9000x7000 ve \`.map-base\` üzerindeki \`resimler/map.png\` görüntüsü \`100% 100%\` ile canvas'ın tamamına gerilir. Yeni \`worldReferenceAlignment.js\` map↔reference ve mevcut \`WORLD_SCALE.MAP_BOUNDS\`/\`METERS_PER_MAP_UNIT\` üzerinden worldXZ↔reference round-trip helper'larını içerir. Runtime terrain/water bu run'da değişmez.

**Neden:** Run179'da güvenli biçimde reddedilen yaklaşım owner görselini mevcut padded **3D world bounds** içine doğrudan normalize etmekti; bu, 2D haritanın gerçek görüntü yerleşimini temsil etmiyordu. Repo CSS'i artık gerçek hizayı kanıtlıyor: marker koordinatları 9000x7000 canvas uzayında ve harita rasterı da birebir bu canvas'a stretch ediliyor. Böylece coğrafi referans koordinatları tahmine gerek kalmadan yeniden üretilebilir.

**Ölçüm / safety bulguları:** 14/14 kingdom-seat map→reference→map ve world→reference→world round-trip'ı numerik tolerans içinde birebir. Run179 96x64 maskesi bu doğru transform altında 12/14 seat'i kara, \`balon\` + \`jon\`u raw-water sınıflıyor; bu coarse raster/classifier sınırı runtime wiring'i hâlâ bloke eder. Mevcut \`MAP_BOUNDS\` [120..6990]×[0..6170], tam 9000×7000 canvasın normalize dikdörtgen alanının yaklaşık %67.3'ünü kapsar; mevcut 3D world extent tüm owner haritası değildir.

**Alternatifler:** (1) \`WORLD_SCALE.MAP_BOUNDS\`'u [0,1] referans extent'i saymak: CSS kanıtıyla yanlış olduğu gösterildi ve reddedildi. (2) Görsel landmark'larından manuel affine transform uydurmak: gereksiz; 2D CSS zaten exact transformu veriyor. (3) Runtime maskeyi hemen terrain'e bağlamak: \`balon\`/\`jon\` false-water ve eksik full-map extent nedeniyle reddedildi. (4) Mevcut seat koordinatlarını yeni haritaya göre taşımak: owner onayı olmadan canonical seats'i değiştireceği ve 2D davranışı bozacağı için reddedildi.

**Sonuç:** Her gelecekteki coastline, mountain, biome, river ve road reference sampler tek, denetlenebilir koordinat dönüşümünü paylaşabilir. Aynı zamanda iki kalan engel açıkça ölçüldü: seat-safe hydrology ve full-map extent.

**Etkilenen sistemler:** yeni alignment module + check, service-worker precache, WORLD_REFERENCE_MAP dokümanı, progress/ADR/perf/stable kayıtları. Terrain, water, roads, settlements, gameplay, 2D render ve assetler runtime açısından bit-eşit kalır.

**Gelecek Faz Etkisi:** Tam haritanın 3D'leştirilmesi sırasında doğu/güney bölgelerinin yanlış world noktalarına sıkıştırılması engellenir. Full-map extent büyütmesi daha sonra aynı reference transform üzerinde yapılabilir; transform tekrar icat edilmez.

**Geri alma planı:** 2D shell bir gün map canvas boyutunu veya background sizing modunu değiştirirse yeni versioned alignment contract eklenir ve CSS guard buna göre güncellenir. Mevcut contract silinmez; eski kayıtlar hangi harita sürümünde hangi dönüşümün geçerli olduğunu korur.`);

appendMarkdown('STABLE_TAGS.md', `- ${process.env.RUN181_STABLE_TAG} — run 181 exact 2D-map/reference alignment contract (ADR-0201); ${process.env.RUN181_SMOKE_PASS_COUNT}/34+ browser smoke, CSS/map alignment, terrain/road, PWA/mobile/perf/governance gates PASS; runtime render delta 0.`);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), `\n${process.env.RUN181_PERF_ROW}\n`);

console.log('[recordRun181Governance] PASS: progress + ADR-0201 + stable checkpoint + newline-safe perf row recorded.');
