#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function appendOnce(filePath, marker, block) {
	const absolute = path.join(ROOT, filePath);
	const source = fs.readFileSync(absolute, 'utf8');
	if (source.includes(marker)) return;
	fs.writeFileSync(absolute, `${source.trimEnd()}\n\n${block.trim()}\n`);
}

function insertServiceWorkerPrecache() {
	const filePath = path.join(ROOT, 'service-worker.js');
	const source = fs.readFileSync(filePath, 'utf8');
	const entry = "    './src/3d/world/worldReferenceWaterMask.js'";
	if (source.includes(entry)) return;
	const anchor = "    './src/3d/world/worldReferenceMap.js'\n];";
	if (!source.includes(anchor)) throw new Error('worldReferenceMap.js service-worker anchor not found');
	fs.writeFileSync(filePath, source.replace(anchor, `    './src/3d/world/worldReferenceMap.js'\n    ,\n${entry}\n];`));
}

insertServiceWorkerPrecache();

appendOnce('GOVERNANCE.md', '## 31. Canonical 2D → 3D Harita Referansı', `## 31. Canonical 2D → 3D Harita Referansı — Owner Direktifi (run 179, 2026-08-08)

Proje sahibinin 2026-08-08'de paylaştığı 1536x1024 dünya haritası, 3D dünyanın **canonical makro-coğrafya referansıdır**. Bundan sonraki fiziksel dünya çalışmaları rastgele Westeros-benzeri bir arazi üretmek yerine bu haritanın kara/deniz dağılımını, ana kıyı karakterini, dağ zincirlerini, kar-soğuk bölgeleri, bataklıkları, bozkırları, orman/jungle alanlarını, çölleri ve büyük yol yönelimlerini kademeli olarak 3D dünyaya taşır.

1. Harita yönü normalize görüntü uzayında x=batı→doğu, y=kuzey→güney olarak sabittir; kalıcı kontrol noktaları \`worldReferenceMap.js\` ve ondan türetilen versioned veri modüllerinde tutulur.
2. Mevcut canonical kingdom-seat koordinatları sessizce taşınamaz. Harita-görseli ile mevcut 2D marker/world koordinat sistemi arasında runtime dönüşümü uygulanmadan önce hizalama doğrulanmalı; doğrudan [0,1] world-extent eşlemesi varsayılmamalıdır.
3. Arazi yüksekliği/kıyı runtime'ına geçen her adım §8.4 terrain-seat safety + road safety + deterministic snapshot + browser smoke + console + mobile perf + PWA/cache kapılarını geçer. Bir koltuğu su altına sokan veya mevcut yol erişilebilirliğini bozan makro-coğrafya değişikliği yayınlanmaz.
4. Canonical haritanın kendisi runtime'da OCR/renk sınıflandırmasına tabi tutulmaz. Görselden çıkarılan maskeler/anchor'lar repoda deterministik, checksum'lı, gözden geçirilebilir veri olarak saklanır.
5. Uygulama katmanları ayrı yayımlanır: referans sözleşmesi → kıyı/su maskesi → koordinat hizalama → makro relief/dağ → biyom materyalleri → nehir/yol uyarlaması → yerel fiziksel detay. Tek dev terrain rewrite yasaktır.
`);

appendOnce('WORLD_REFERENCE_MAP.md', '## Coastline / water mask — run 179', `## Coastline / water mask — run 179

\`src/3d/world/worldReferenceWaterMask.js\` adds the first deterministic raster-derived macro layer: a 96x64 one-bit coastline/water mask (4052 water / 2092 land cells), persisted as compact hex rows with SHA-256 \`2ca2bed8d8a137ba532a56e10b079fa845b0f7214e24f955388c8dd0a4517f27\`. The mask is data-only in run 179: it does not yet alter terrain height or the water plane. Runtime adoption is intentionally deferred until the existing 2D kingdom-marker/world coordinate system is proven to align with this normalized image space; a naive direct full-extent mapping is not an acceptable substitute because terrain-seat and road safety remain hard constraints.`);

console.log('[applyRun179Additions] PASS: service-worker precache + GOVERNANCE §31 + map documentation applied additively.');
