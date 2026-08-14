#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const key of ['RUN182_STAMP','RUN182_STABLE_TAG','RUN182_PERF_ROW','RUN182_SMOKE_PASS_COUNT','RUN182_SUMMARY']) if (!process.env[key]) throw new Error(`missing ${key}`);
const append = (file, text) => fs.appendFileSync(path.join(ROOT, file), `\n\n${text.trim()}\n`);

append('3D_GAME_PROGRESS.md', `## Run 182 — Seat-safe hydrology + full canonical-map extent plan (${process.env.RUN182_STAMP})
- Run181'in iki runtime blocker'ı veri/safety sözleşmesine dönüştü: ${process.env.RUN182_SUMMARY}
- Yeni \`worldReferenceHydrology.js\`: immutable run179 maskeyi değiştirmeden protected-land overlay kurar. Test mevcut settlement flatten outer radius'u (75m) repo kaynağından türetir; raw \`balon\`/\`jon\` false-water korunup açıkça raporlanırken composed hydrology 14/14 seat merkezini kara tutar ve açık Summer Sea örneğini su bırakır.
- Yeni \`worldReferenceExtent.js\`: tam 9000x7000 owner map için 137.5 km² hedef altında ölçek planı: 1.4773421007 m/map-unit, ~13.296×10.341 km, 500m chunk ile 27×21=567 chunk. Mevcut crop ~129.8 km² olduğundan tam map alan artışı yalnız ~%5.9; 150 km² hard cap aşılmıyor.
- Runtime terrain/water/WORLD_SCALE bu run'da değişmedi. Full-map re-center/scale migration ve hydrology wiring ayrı yüksek-etkili alt görev olacak; önce pre/post 14-seat + road + determinism + mobile budget görsel kanıtı zorunlu.
- DoD: node --check PASS; baseline+after browser smoke ${process.env.RUN182_SMOKE_PASS_COUNT}/34+ PASS; console/page error 0; reference map/alignment/mask/hydrology/extent, terrain/road safety, determinism, visual, PWA/cache, a11y/input, mobile streaming/LOD/perf ve additive-only kapıları PASS; iki mobil görsel evidence PASS.
- Performans: ${process.env.RUN182_PERF_ROW}. Runtime render delta 0. World Coverage current extent desktop %96.2, mobile resident ~%14.7 değişmedi. Teknik borç 1. Risk LOW. Güven 5/5.
- ADR-0202. World Evolution delta: seat-safe hydrology contract +1, full-map extent plan +1; runtime terrain/water/yol/orman/kale/NPC/event/hayvan/asset/diyalog/coverage 0. Sıradaki güvenli adım: full-map scale/re-center migration için dry-run safety sampler ve road transform proof; bunun ardından canonical hydrology terrain'e opt-in edilebilir.`);

append('DECISIONS.md', `## ADR-0202 — Preserve raw coastline mask; compose settlement protection and target full-map scale at 137.5 km² (run 182)

**Risk Seviyesi:** LOW

**Karar:** Run179'un checksum'lı 96x64 maskesi immutable kalır. Coarse rasterın zorunlu kara noktalarını boğmasını önlemek için yeni hydrology layer caller-supplied protected reference sites üzerinde smooth elliptical land weight uygular; raw data hiçbir zaman sessizce düzeltilmez. Validation protected radius'u mevcut \`SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS=75\` değerinden okur ve doğru run181 coordinate transformuyla 14 seat'e uygular. Tam owner-map 3D extent planı, 9000x7000 canvası mevcut ~137.5 km² hedefe sığdırmak için \`sqrt(137.5e6/(9000*7000)) = 1.4773421007 m/map-unit\` kullanır; 500m chunk grid 27×21 olur. Bu run runtime WORLD_SCALE/terrain/water değiştirmez.

**Neden:** \`balon\` küçük ada ve \`jon\` kuzey kıyı/kar sınırı coarse maskte suya düşüyor; canonical settlement'ı taşımak veya raw mask checksum'ını oynatmak yerine safety overlay daha denetlenebilir. Öte yandan full 9000x7000 map mevcut 1.75 m/unit ile ~192.9 km² olup 150 km² sınırını aşar; 137.5 km² hedef ölçek tam haritayı ~13.296×10.341 km'ye indirir ve mevcut ~129.8 km² crop'tan yalnız ~%5.9 daha büyük alan ister.

**Alternatifler:** raw mask bitlerini elle değiştirmek reddedildi (source truth kaybolur); seats'i taşımak reddedildi (2D/canonical davranış); 1.75 m/unit ile full map reddedildi (>150 km²); yalnız current crop'u sürdürmek reddedildi (owner tam map hedefi karşılanmaz); runtime migration'ı aynı committe yapmak reddedildi (yüksek etki, ayrı pre/post safety gerektirir).

**Sonuç:** Hydrology artık seat-safe biçimde compose edilebilir ve full-map extent'in bütçe içinde matematiksel hedefi nettir; fakat canlı terrain henüz değişmez.

**Etkilenen sistemler:** yeni hydrology/extent modülleri ve check, PWA precache, WORLD_REFERENCE_MAP ve governance ledgers. Runtime scene/terrain/water/road/settlement/gameplay değişmez.

**Gelecek Faz Etkisi:** Mountain/biome/river/road katmanları tam reference extent'e ortak bir ölçekle taşınabilir; seat protection aynı zamanda gelecekte mağara/landmark gibi zorunlu kara anchor'larına genellenebilir.

**Geri alma planı:** Runtime consumer yok; yanlış radius/extent politikası kanıtlanırsa yeni versioned policy/ADR eklenir. Raw run179 mask ve run181 alignment değişmeden kalır.`);
append('STABLE_TAGS.md', `- ${process.env.RUN182_STABLE_TAG} — run 182 seat-safe hydrology + full-map extent plan (ADR-0202); ${process.env.RUN182_SMOKE_PASS_COUNT}/34+ browser smoke and all world/PWA/mobile/perf/governance gates PASS; runtime render delta 0.`);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), `\n${process.env.RUN182_PERF_ROW}\n`);
console.log('[recordRun182Governance] PASS');
