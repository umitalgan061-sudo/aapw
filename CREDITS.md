# CREDITS.md — Üçüncü Taraf Asset Atıfları

> **Güncelleme 2026-08-13:** repository artık **public** (`umitalgan061-sudo/aapw`) ve proje sahibi
> asset karantinasını feshetti (bkz. `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §4). Kaynağı/lisansı
> kayıtlı olmayan asset'ler de runtime'da kullanılıyor; bu dosya artık "yalnız lisanslı olanların
> atfı" değil, **kullanılan her asset'in bilinen kaynağının kaydı** olarak tutuluyor. Bilinmeyen
> kaynak, kullanımı engellemiyor ama burada açıkça "bilinmiyor" olarak işaretleniyor.

Bu proje public bir repo olduğu için, kullanılan üçüncü taraf asset'lerin lisans
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

## Kaynağı/Lisansı Bilinmeyen — sahip onayıyla kullanımda (2026-08-13)

Bu dört asset 2026-08-13'e kadar `assets_manifest.quarantine.json` içinde tutuluyordu ("provenance
belirsiz, runtime'da kullanılmaz"). Proje sahibi karantinayı doğrudan talimatla feshetti; dördü de
`assets_manifest.json`'a `license: "UNKNOWN — owner-approved for runtime use"` ile taşındı.

Atıf yapılacak bilinen bir yazar/kaynak **yok** — bu tabloda dürüstçe "bilinmiyor" olarak
kayıtlıdır. Kaynağı sonradan ortaya çıkarsa bu satırlar güncellenmelidir.

| Asset ID | Dosya | Bilinen kaynak ipucu | Lisans |
|---|---|---|---|
| `moon_2k` | `assets/models/Ay/Moon 2K.fbx` | FBX metadata: Blender 2.79 export, iç dosya adı `/foobar.fbx` — kaynak değil | BİLİNMİYOR |
| `character_golden_vanguard_knight` | `assets/models/characters/Meshy_AI_Golden_Vanguard_Knigh_*.fbx` | Dosya adı Meshy AI diyor (repo'da başka Meshy asset'leri var) ama tek başına kanıt sayılmadı | BİLİNMİYOR (muhtemelen Meshy AI) |
| `character_iron_sentinel` | `assets/models/characters/Meshy_AI_Iron_Sentinel_*.fbx` | Aynı — dosya adı Meshy AI | BİLİNMİYOR (muhtemelen Meshy AI) |
| `surface_terrain_reference` | `assets/textures/yüzey/model.fbx` | Çok formatlı bir yüzey/terrain paketiyle yüklendi (.max/.mview/.ksp dahil); sağlayıcı kayıtlı değil | BİLİNMİYOR |

**Public repo notu:** kaynağı belirsiz materyali public bir repoda dağıtmak private repoda
kullanmaktan farklı bir hukuki maruziyettir. Sahip bunu bilerek karar verdi; kayıt burada duruyor.

---

## Özet

| Kaynak | Asset sayısı |
|---|---|
| Adobe Mixamo | 10 |
| Free3D (Dennis Haupt / 3dhaupt) | 2 |
| Meshy AI (orijinal + decimated türevler dahil) | 24 |
| Hitem3d (orijinal + 2 decimated türev dahil) | 5 |
| Kaynağı bilinmeyen (sahip onaylı, eski karantina) | 4 |
| **Toplam** | **45** |

Ayrıca kod/araç bağımlılığı olarak Terrain3D v1.0.2-stable (MIT) kullanılır — yukarıdaki bölüme bakın (asset sayısına dahil değildir).

Ayrıca kod/araç bağımlılığı olarak Terrain3D v1.0.2-stable (MIT) vendor edilmiştir — yukarıdaki bölüme bakın (asset sayısına dahil değildir).

Gerçek HBO Game of Thrones görsel/ses materyali bu projede kullanılmamıştır ve
kullanılmayacaktır (bkz. `GOVERNANCE.md` — TEK KISIT).

---

## 2026-07-31 toplu içe aktarma (yerel oturumda hazırlandı, 2026-08-14'te birleştirildi)

Bu bölüm, proje sahibinin 31 Temmuz'da indirdiği ve yerel bir Claude Code oturumunda
incelenip içe aktarılan 153 asset'in atıflarını içerir. Ana kaynak grupları:

- **Quaternius** (54 model — hayvanlar, ağaçlar, binalar, karakterler) — **CC0**, yayıncının
  katalog geneli kamu malı politikası. Atıf zorunlu değil ama kaynak olarak kaydedilmiştir.
- **Kenney** (2 model — Castle Kit, Wooden Door) — **CC0**, aynı şekilde.
- **Poly by Google** (41 model — hayvanlar, binalar, bitkiler) — **CC-BY 4.0**, atıf zorunlu.
- **Bireysel Sketchfab sanatçıları** (CreativeTrio, madtrollstudio, blaeksprut, Zsky, Pixel,
  3Donimus, jeremy, felix stief, dook, apelab, Jarlan Perez, Jacques Fourie, Dawid2K,
  Danni Bittman, CLOAKING .US) — indirme anında proje sahibi tarafından serbest/indirilebilir
  olduğu doğrulandı; her biri `assets_manifest.json`'da kendi kaydıyla listelidir.
- **AncientGreekCity [GameReadyPack]** (27 model — kemerler, sütunlar, merdivenler, heykeller,
  bahçe çiçekleri) — ücretsiz asset paketi. Yalnızca geometri alındı; paketin orijinal
  16-67MB'lık ham dokuları boyut bütçesi nedeniyle bilinçli olarak dışlandı.
- **Gerçekçi Çim / Realistic Grass** (`grass_ground_cover.fbx`) — ücretsiz indirme,
  zemin bitki örtüsü katmanı için.
- **Medieval House Asset Pack** ve **Sword_FBX** — ücretsiz indirmeler, hazır FBX varyantları.

Her asset'in tam kaynağı, lisansı ve indirme notu `assets_manifest.json`'daki kendi
kaydındadır. Kaynak URL'leri toplu indirme sırasında korunmadığı için "unknown" olarak
işaretlenmiştir — bu, `GOVERNANCE.md`'nin kaynak-kayıt kuralının bilinen bir eksiğidir.
