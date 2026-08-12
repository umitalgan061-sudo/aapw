# CREDITS.md — Üçüncü Taraf Asset Atıfları

Bu proje ÖZEL (private) bir repo olsa da, kullanılan üçüncü taraf asset'lerin lisans
şartları (özellikle CC-BY ailesi) atıf yükümlülüğünü private/public repo ayrımından
bağımsız olarak taşır. Bu dosya `assets_manifest.json`'daki her asset'in kaynağını,
lisansını ve (biliniyorsa) yazarını tek yerde toplar. Kaynak: `GOVERNANCE.md` §10.

Bu dosya, projeye şu ana kadar eklenmiş TÜM Meshy AI / Mixamo / Free3D / Hitem3d
asset'lerinin geriye dönük taramasıyla oluşturuldu (2026-07-31). Yeni asset eklendiğinde bu
dosyaya da bir satır eklenmelidir (bkz. Definition of Done, `GOVERNANCE.md` §8.1 ve §10).

---

## Adobe Mixamo

Kaynak: https://www.mixamo.com — Adobe Mixamo Lisansı (kişisel/ticari projelerde kullanım
serbest, ham asset'in yeniden dağıtımı yasak — bu proje sadece motor içinde tüketir,
yeniden dağıtmaz).

| Asset ID | Tür | Eklendi |
|---|---|---|
| `peasant_girl` | Karakter modeli (T-pose) | 2026-07-30 |
| `anim_idle` | Animasyon klibi | 2026-07-30 |
| `anim_walking` | Animasyon klibi | 2026-07-30 |
| `anim_running` | Animasyon klibi | 2026-07-30 |
| `paladin_j_nordstrom` | Karakter modeli | 2026-07-30 |
| `paladin_wprop_j_nordstrom` | Karakter modeli (prop ile) | 2026-07-30 |
| `dreyar` | Karakter modeli | 2026-07-30 |
| `erika_archer` | Karakter modeli | 2026-07-30 |
| `uriel_a_plotexia` | Karakter modeli | 2026-07-30 |
| `arissa` | Karakter modeli | 2026-07-30 |

## Free3D (yazar: 3dhaupt / Dennis Haupt)

Kaynak: https://free3d.com — Personal Use License (ticari olmayan, kişisel/özel, editöryel
kullanım). **Yazar atıfı:** Dennis Haupt (3dhaupt).

| Asset ID | Tür | Kaynak URL | Eklendi |
|---|---|---|---|
| `wolf` | Rigged kurt modeli | https://free3d.com/3d-model/wolf-rigged-and-game-ready-42808.html | 2026-07-30 |
| `black_dragon` | Rigged ejderha modeli | https://free3d.com/3d-model/black-dragon-rigged-and-game-ready-92023.html | 2026-07-30 |

## Meshy AI

Kaynak: https://www.meshy.ai — Meshy AI üretim lisansı. Free plan çıktıları CC BY 4.0
altında (ticari kullanımda Meshy'ye atıf gerekir); Paid plan tam özel mülkiyet verir. Bu
repo private olduğundan pratik risk yok, ama hangi plan altında üretildiği doğrulanmadan
herhangi bir public/ticari kullanım yapılmamalı (bkz. `assets_manifest.json`'daki
`elven_warrior` notu).

| Asset ID | Tür | Eklendi |
|---|---|---|
| `elven_warrior` | Karakter modeli (text/image-to-3D) | 2026-07-30 |
| `dragon_auric` | Ejderha modeli | 2026-07-30 |
| `dragon_frostscale` | Ejderha modeli | 2026-07-30 |
| `dragon_verdant_wyrm` | Ejderha modeli | 2026-07-30 |
| `dragon_spiked_serpent` | Ejderha modeli | 2026-07-30 |
| `castle_brickstone_citadel` (+ `_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `castle_on_a_rock` (+ `_decimated` olarak `castle_castle_on_a_rock_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `castle_emerald_citadel` (+ `_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `castle_fortress_of_the_crown` (+ `_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `castle_greystone_castle` (+ `_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `castle_icebound_citadel` (+ `_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `castle_walled_city_fortress` (+ `_decimated`) | Kale modeli | 2026-07-30 / 2026-07-31 |
| `animal_ivory_stallion` | Hayvan modeli (at) | 2026-07-30 |
| `character_verdant_knight` | Karakter modeli | 2026-07-30 |
| `character_wooden_legion` | Karakter modeli | 2026-07-30 |
| `character_ionic_grace` | Karakter modeli | 2026-07-30 |
| `character_casual_confidence` | Karakter modeli | 2026-07-30 |

Not: 7 kale modelinin `_decimated` sürümleri (ADR-0074, run 54) `gltf-transform` ile
üretilmiş türevlerdir — orijinal Meshy AI lisansı aynen geçerlidir, ayrı bir lisans
oluşturmaz.

## Hitem3d

Kaynak: https://hitem3d.ai — Hitem3d üretim lisansı (image-to-3D). Hesabın plan şartları
herhangi bir public/ticari kullanımdan önce doğrulanmalı; bu private repo için pratik risk
yok.

| Asset ID | Tür | Eklendi |
|---|---|---|
| `dragon_reference_v1` | Yanlış etiketlenmiş — gerçek içeriği bir kale/kapı yapısı (ADR-0086) | 2026-07-30 |
| `dragon_reference_v2` | Ejderha referans modeli | 2026-07-30 |
| `dragon_reference_v2_decimated` | `dragon_reference_v2`'den türetilmiş (gltf-transform 4.4.2, ADR-0070) | 2026-07-31 |
| `dragon_reference_v3` | Ejderha referans modeli | 2026-07-30 |
| `castle_reference_gatehouse_decimated` | `dragon_reference_v1`'den türetilmiş, `twin` kale koltuğuna atandı (gltf-transform 4.4.2, ADR-0086) | 2026-08-05 |

## Terrain3D (Godot eklentisi — kod/araç, asset değil)

Godot 4 için yüksek performanslı arazi sistemi. Bu repoda `godot/terrain3d-authoring/addons/terrain_3d/`
altında vendor edilmiştir ve **yalnızca Godot authoring çalışma alanında** kullanılır — shipped
Three.js/PWA oyununa dahil edilmez (bir C++ GDExtension'dır, tarayıcıda çalışmaz).

| | |
|---|---|
| Proje | Terrain3D |
| Yazarlar | Cory Petkovsek & Roope Palmroos ve katkıda bulunanlar |
| Kaynak | https://github.com/TokisanGames/Terrain3D |
| Sürüm | v1.0.2-stable (`Terrain3D_v1.0.2-stable.zip` resmi release paketi) |
| Lisans | MIT (tam metin: `godot/terrain3d-authoring/addons/terrain_3d/LICENSE.txt`) |
| Eklendi | 2026-08-12 (ADR-0265) |
| Godot gereksinimi | 4.4+ (bu proje 4.6.3 kullanıyor) |

MIT lisansı telif/lisans bildiriminin korunmasını şart koşar; eklentinin kendi `LICENSE.txt` dosyası
vendor edilen ağaç içinde olduğu gibi bırakılmıştır. Vendor edilen ikili dosyalar yalnızca
linux/windows x86_64 (debug+release) ile sınırlandırılmıştır; android/ios/macos/web ikilileri
kullanılmadığı için alınmamıştır.

## Terrain3D (Godot eklentisi — kod/araç, asset değil)

Godot 4 için yüksek performanslı arazi sistemi. **Repoya vendor edilmez**: `terrain3d.lock.json`
içinde SHA256 ile pinlenmiş resmi release, `godot/terrain-authoring/tools/install_terrain3d.py`
tarafından indirilip `addons/terrain_3d/` altına kurulur (o dizin `.gitignore`'dadır). Yalnızca Godot
authoring çalışma alanında kullanılır — shipped Three.js/PWA oyununa dahil edilmez (bir C++
GDExtension'dır, tarayıcıda çalışmaz).

| | |
|---|---|
| Proje | Terrain3D |
| Yazarlar | Cory Petkovsek & Roope Palmroos ve katkıda bulunanlar |
| Kaynak | https://github.com/TokisanGames/Terrain3D |
| Sürüm | v1.0.2-stable (`Terrain3D_v1.0.2-stable.zip`, SHA256 `a071850250ec5e596aa54da61c01d75768774eb379ee997584d426a45f4884a2`) |
| Lisans | MIT (kurulan ağaçtaki `addons/terrain_3d/LICENSE.txt`) |
| Eklendi | 2026-08-12 (ADR-0266) |
| Godot gereksinimi | 4.4+ (bu proje 4.6.3 kullanıyor) |

MIT lisansı telif/lisans bildiriminin korunmasını şart koşar; installer eklentinin kendi
`LICENSE.txt` dosyasını olduğu gibi kurar ve CI bunun varlığını doğrular.

## Prosedürel Dokular (özgün üretim — indirilen asset değil)

`src/3d/materials/` altındaki 91 renk paleti ve tüm dokular bu projede kod ile sıfırdan üretilir
(seeded noise + canvas çizimi). Hiçbir görsel dosya indirilmez, hiçbir üçüncü taraf asset kullanılmaz,
dolayısıyla dış lisans yükümlülüğü doğurmaz.

| | |
|---|---|
| Kapsam | 91 palet / 8 aile (İnsan, Ejderha, Hayvan, Doğa, Su, Gök, Yapı, Yol) |
| Üretim | Çalışma zamanında prosedürel (`textureCore.js` seeded FBM + canvas) |
| Determinizm | `paletteId\|variant` seed'i; `Math.random()` yok |
| Lisans | Bu projeye ait özgün üretim |
| Eklendi | 2026-08-12 (ADR-0267) |

Gerçek HBO Game of Thrones görsel materyali kullanılmamıştır; tüm desenler ilk ilkelerden
üretilmiştir.

---

## Özet

| Kaynak | Asset sayısı |
|---|---|
| Adobe Mixamo | 10 |
| Free3D (Dennis Haupt / 3dhaupt) | 2 |
| Meshy AI (orijinal + decimated türevler dahil) | 24 |
| Hitem3d (orijinal + 2 decimated türev dahil) | 5 |
| **Toplam** | **41** |

Ayrıca kod/araç bağımlılığı olarak Terrain3D v1.0.2-stable (MIT) kullanılır — yukarıdaki bölüme bakın (asset sayısına dahil değildir).

Ayrıca kod/araç bağımlılığı olarak Terrain3D v1.0.2-stable (MIT) vendor edilmiştir — yukarıdaki bölüme bakın (asset sayısına dahil değildir).

Gerçek HBO Game of Thrones görsel/ses materyali bu projede kullanılmamıştır ve
kullanılmayacaktır (bkz. `GOVERNANCE.md` — TEK KISIT).
