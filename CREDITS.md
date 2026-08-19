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

<!-- OWNER_APPROVED_MODEL_INVENTORY_V1 -->
## Owner-upload model inventory — runtime use approved (§33.3)

Bu tablo `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §4 uyarınca runtime kullanımına sahip tarafından açıkça izin verilen, ancak lisansı ayrı ayrı doğrulanmamış model dosyalarını kaydeder. Dosya adında açık bir üretici/yazar ipucu varsa yalnızca **filename attribution** olarak gösterilir; lisans tahmin edilmez.

| Asset ID | Dosya | Kaynak kaydı | Lisans |
|---|---|---|---|
| `owner_model_viking_by_blaeksprut_6uxtboeq2g_baae687b142f5911` | `assets/models/fbx/⚔️ Viking by blaeksprut - 6UxTboeQ2G.glb` | blaeksprut (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_2_744375f52595fe0d` | `assets/models/fbx/2.FBX` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_3d_sea_66184ce30d553f23` | `assets/models/fbx/3d_sea.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_adventurer1_cbb405e59ede5a30` | `assets/models/fbx/adventurer1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_alien_landscapefbx_ac8aebe4db4ba7f2` | `assets/models/fbx/Alien_LandscapeFBX.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_alpaca_by_quaternius_bcvfd48i2l_3d8439910c14830b` | `assets/models/fbx/Alpaca by Quaternius - bCVFD48i2l.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_american_road_snowy_terrain_c45e20e67c9649a7` | `assets/models/fbx/american_road_snowy_terrain.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_ancient_assets_pack_fb505cd15a547d13` | `assets/models/fbx/Ancient_Assets_Pack.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_ancient_assets_6536e774a48a55da` | `assets/models/fbx/Ancient_Assets.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_ancient_columns_blend_ancient_columns_b26282faf2df835c` | `assets/models/fbx/Ancient_Columns_Blend_Ancient_Columns.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_ancienthousev5_house_a55f2886a10bf62f` | `assets/models/fbx/AncientHouseV5_house.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_arch_free_arch_10a8f7d2d63345e8` | `assets/models/fbx/Arch_Free_arch.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_badger_by_poly_by_google_8k4cduyrhi4_20bed36371531589` | `assets/models/fbx/Badger by Poly by Google - 8k4cduyRhi4.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_barn_by_creativetrio_a6ukpq33az_14f3a73bc1c34f05` | `assets/models/fbx/Barn by CreativeTrio - A6UkPq33aZ.glb` | CreativeTrio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_barn_by_poly_by_google_0qth_kuzrye_ed5575b0d3efcc1f` | `assets/models/fbx/Barn by Poly by Google - 0QTh_KUZRYE.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_barn_by_poly_by_google_dssuaulaxhk_e9ce043974529ab0` | `assets/models/fbx/Barn by Poly by Google - dSsUaUlaxHk.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_barn_by_quaternius_vsqqna7ez6_88d58ec36999273b` | `assets/models/fbx/Barn by Quaternius - vSqQNA7ez6.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_barracks_by_quaternius_uxcowrbsxx_6dc89e3f40e999f3` | `assets/models/fbx/Barracks by Quaternius - UXCOwRBSxx.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_barrel_by_quaternius_zjcqp1taci_bf2aad58e53b6b00` | `assets/models/fbx/Barrel by Quaternius - zjCQP1TAci.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_basic_temple_temple_bf1ae928729aa3c1` | `assets/models/fbx/Basic_Temple_temple.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bear_by_poly_by_google_0pxwfxfb0hu_7e13e36ab2d45da0` | `assets/models/fbx/Bear by Poly by Google - 0PXWfxfb0Hu.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bee_by_apelab_f0lw38lzjd4_bf4cbd3b9c7ddc1e` | `assets/models/fbx/Bee by apelab - f0lW38lzjd4.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_big_barn_by_quaternius_q1n3xn2spc_45b839894bd83320` | `assets/models/fbx/Big Barn by Quaternius - q1N3xn2SpC.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_big_tree_by_3donimus_dnwh762pn_6_81b3122c719b3761` | `assets/models/fbx/Big Tree by 3Donimus - dNWh762PN-6.glb` | 3Donimus (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_big_long_stairs_stairs_eb6c6fc4cfae06d9` | `assets/models/fbx/Big_Long_stairs_stairs.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bighorn_sheep_by_poly_by_google_4kuchlmv8vp_081f0ef3d00482db` | `assets/models/fbx/Bighorn sheep by Poly by Google - 4kUChlMv8Vp.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_birch_trees_by_quaternius_r7qmwzb7nk_618b34626cc84f74` | `assets/models/fbx/Birch Trees by Quaternius - R7qMWzb7nk.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bird_by_poly_by_google_8ph79khbt9s_39230e9420d6a2ed` | `assets/models/fbx/Bird by Poly by Google - 8Ph79kHbt9s.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bird_house_by_zsky_jspf4ljoqp_ebe1425664c67f59` | `assets/models/fbx/Bird House by Zsky - jSpF4LjoQp.glb` | Zsky (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bison_by_poly_by_google_9strha_txds_a0f5dc18f8b09d58` | `assets/models/fbx/Bison by Poly by Google - 9sTrha-TxdS.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bizon_by_madtrollstudio_rqklnypnfx_2692df9b1b3dddaa` | `assets/models/fbx/Bizon by madtrollstudio - RqkLNYPnfx.glb` | madtrollstudio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_blacksmith_by_quaternius_bv52etg1aj_41a819cfdf4916aa` | `assets/models/fbx/Blacksmith by Quaternius - bV52eTG1Aj.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_blender_file_black_student_ec3d3ccb34e0ec3d` | `assets/models/fbx/Blender File_Black Student.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_boat_c5916e3135cde7d4` | `assets/models/fbx/Boat.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bodymaletemplate_c78b9c495dab0262` | `assets/models/fbx/BodyMaleTemplate.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bonfire_by_quaternius_azj9hjwwwg_f7e1cc79b240f87d` | `assets/models/fbx/Bonfire by Quaternius - Azj9hJwwwG.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_brdy_forest_fe239d8871fb31b6` | `assets/models/fbx/brdy_forest.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bridge1_9cdc7a188f2ebd9c` | `assets/models/fbx/bridge1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_buffalo_107f6b65bd7bf77d` | `assets/models/fbx/Buffalo.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_building_pier1_building_0d71bf8193920b66` | `assets/models/fbx/Building_pier1_building.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_bull_by_quaternius_a8piiywf7r_4e4911afc415ad99` | `assets/models/fbx/Bull by Quaternius - a8PIIYwF7r.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_butterfly_by_poly_by_google_e9naqqrcblu_b248d0caf3752c43` | `assets/models/fbx/Butterfly by Poly by Google - e9NAQQrCbLu.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cabin_by_poly_by_google_1gpgti_c05m_405fa2c34d9793ad` | `assets/models/fbx/Cabin by Poly by Google - 1GpgtI-C05M.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cabin_by_poly_by_google_dtsrda0oz0a_0086f25231f7addc` | `assets/models/fbx/Cabin by Poly by Google - dTSrDa0oz0a.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cabin_shed_by_creativetrio_htx7pzt6zm_e4c935d9d9e8cff8` | `assets/models/fbx/Cabin Shed by CreativeTrio - HTx7PZt6Zm.glb` | CreativeTrio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_candle_by_poly_by_google_ah83blsfxju_40c5cc454ec02ed0` | `assets/models/fbx/Candle by Poly by Google - aH83BlSFxJu.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_castle_1234_by_felix_stief_dmp1nre_2gm_876c30fe198edf73` | `assets/models/fbx/castle 1234 by felix stief - dmP1nRE_2GM.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_castle_by_creativetrio_4360gdbxre_9fbc44c45e4d3c25` | `assets/models/fbx/Castle by CreativeTrio - 4360GdbxRe.glb` | CreativeTrio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_castle_by_quaternius_optomcn3o9_caa6b2bf4cc3c054` | `assets/models/fbx/Castle by Quaternius - opTOmcN3o9.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_castle_gate_by_quaternius_tktchdiqzv_78775f39da252e5d` | `assets/models/fbx/Castle Gate by Quaternius - tKTchdiQzV.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_castle_kit_by_kenney_2pa966ztjjx_c1e1ccc7a70098b0` | `assets/models/fbx/Castle Kit by Kenney - 2pA966ztJJX.glb` | Kenney (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_castle_3840dc2ac1739c23` | `assets/models/fbx/castle.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cat_by_poly_by_google_6dm1j6f6pm9_21ec318631395446` | `assets/models/fbx/Cat by Poly by Google - 6dM1J6f6pm9.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_chicken_by_jeremy_1ye8u35hxsi_d545bd35c023d51b` | `assets/models/fbx/Chicken by jeremy - 1YE8U35HXsI.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_chinese_sofa_4k_c3c09ff6feb1d708` | `assets/models/fbx/chinese_sofa_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_church_by_creativetrio_ghzpfvoyzx_60e80133a4da6cb9` | `assets/models/fbx/Church by CreativeTrio - GHzPfvoyzX.glb` | CreativeTrio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_church_by_poly_by_google_6vztphxl9w4_048d830d80832862` | `assets/models/fbx/Church by Poly by Google - 6vzTphxL9w4.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cigarette_butt_by_poly_by_google_5epzhvuzplk_1e1d7d10af60ff7b` | `assets/models/fbx/Cigarette butt by Poly by Google - 5EpZHvuZplk.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_classic_building_building_363483af6b6ee76c` | `assets/models/fbx/Classic_Building_building.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_clay_roof_tiles_4k_3cdde1fafb9445df` | `assets/models/fbx/clay_roof_tiles_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cliff_4541b4e554b34287` | `assets/models/fbx/Cliff.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_coastscan_5143cd9faff2e77d` | `assets/models/fbx/CoastScan.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cottage_by_creativetrio_ydgllt0emc_bb89e495b8fd9186` | `assets/models/fbx/Cottage by CreativeTrio - YDGLLT0emC.glb` | CreativeTrio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cougar_by_poly_by_google_1icrwbhsin7_d5833c04dab55b2a` | `assets/models/fbx/Cougar by Poly by Google - 1ICRwBHSin7.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cow_by_poly_by_google_0otoigkcvm7_0f238b4d4bf959b5` | `assets/models/fbx/Cow by Poly by Google - 0OToIgkcVM7.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_cow_by_quaternius_26zm1outcr_97ff0543b843bd21` | `assets/models/fbx/Cow by Quaternius - 26zM1outCr.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_coyote_by_poly_by_google_auvas_kt6ne_d28e57998a8b733a` | `assets/models/fbx/Coyote by Poly by Google - auVAs_kT6nE.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_crate_by_quaternius_3oefd1awfa_dfba7f9533bde92b` | `assets/models/fbx/Crate by Quaternius - 3OEFd1AWfa.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_crops_by_quaternius_ro6k0yg7mx_56a4e1a9beeb745c` | `assets/models/fbx/Crops by Quaternius - Ro6K0Yg7mx.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_crow_by_poly_by_google_1mivwq5q3r9_5a6893d8ab5565a0` | `assets/models/fbx/Crow by Poly by Google - 1MIvWQ5Q3R9.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_curtains_by_poly_by_google_afwefo0cefo_ebd111613bd8a25a` | `assets/models/fbx/Curtains by Poly by Google - aFWefo0cEFo.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dead_tree_by_quaternius_n8fhmgmldd_1d3c9b5a1bdfc61d` | `assets/models/fbx/Dead Tree by Quaternius - n8FhMgMldD.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dead_trees_by_quaternius_f5i0q7two5_6645ab29c66025c2` | `assets/models/fbx/Dead Trees by Quaternius - F5I0Q7TwO5.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dead_trees_with_snow_by_dook_ieuwxwner0_3d8b5f3dbb09b9d2` | `assets/models/fbx/Dead Trees With Snow by dook - iEuwXWner0.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dead_tree_trunk_02_4k_6c11ad3768080594` | `assets/models/fbx/dead_tree_trunk_02_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_deer_by_quaternius_t6cs7tmmhj_a17865d2213993c7` | `assets/models/fbx/Deer by Quaternius - T6Cs7tmMHJ.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_desert_rocks_1f6eff2467a32269` | `assets/models/fbx/desert_rocks.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dining_table_4k_ad2500846653726d` | `assets/models/fbx/dining_table_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dirt_aerial_02_4k_9462fc3ee56bd5f7` | `assets/models/fbx/dirt_aerial_02_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dirt_road_test_df5bf314e951f9eb` | `assets/models/fbx/dirt_road_test.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_docks_by_quaternius_f7twmhwpxy_e6589ea2b801bbd1` | `assets/models/fbx/Docks by Quaternius - F7twMHWPXY.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dog_by_madtrollstudio_9bqpcxoyrk_5f8279a3212e3491` | `assets/models/fbx/Dog by madtrollstudio - 9bqPCxOyrk.glb` | madtrollstudio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_dry_branches_medium_01_4k_260229cd0face47b` | `assets/models/fbx/dry_branches_medium_01_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_elephant_by_poly_by_google_a27ma0rxyyj_c393d6f7e2cbf6c4` | `assets/models/fbx/Elephant by Poly by Google - a27MA0rXyyj.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_elk_by_poly_by_google_bo8xpdrab5g_aeba3767cb389619` | `assets/models/fbx/Elk by Poly by Google - bO8XPdrAb5G.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fall_tree_by_danni_bittman_4gyen9xm3kj_8a16c28d76a765ee` | `assets/models/fbx/Fall Tree by Danni Bittman - 4GYen9Xm3Kj.glb` | Danni Bittman (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fantasy_house_by_quaternius_dcpho4sua3_fc417edd0952caf6` | `assets/models/fbx/Fantasy House by Quaternius - dcPho4SUA3.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fantasy_stable_by_quaternius_qhnqsoggbi_851b324e5fc96fed` | `assets/models/fbx/Fantasy Stable by Quaternius - qhNQSOGGbi.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_farm_by_poly_by_google_5gdbujv2vqb_5a3793696c3bde7e` | `assets/models/fbx/Farm by Poly by Google - 5GDbUJV2vQb.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_farm_by_quaternius_91wmlb9kko_73e80a0f650d1072` | `assets/models/fbx/Farm by Quaternius - 91wMLb9kKo.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_farm_dirt_by_quaternius_8bqfbumoec_c603d5bd106de2ec` | `assets/models/fbx/Farm Dirt by Quaternius - 8BQFbUMOeC.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_farmer_by_quaternius_7pn3r6hpve_c238c67986dd3673` | `assets/models/fbx/Farmer by Quaternius - 7pn3R6hPvE.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fbx_export_c23d664ebdfe4b7c` | `assets/models/fbx/fbx export.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_female_blender_5_0_db0eac37da161c11` | `assets/models/fbx/female_blender_5.0.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fence_fence_5da93d98806580ce` | `assets/models/fbx/fence_fence.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fir_tree_01_4k_00204b225be67750` | `assets/models/fbx/fir_tree_01_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_flower_heliophila_4k_3ecebf32d385509d` | `assets/models/fbx/flower_heliophila_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_flowers_by_quaternius_nbuxhir6fj_7a07c1c685b63c3b` | `assets/models/fbx/Flowers by Quaternius - NBUxHir6FJ.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_flying_seagull_by_poly_by_google_6tpj_vcwp3f_573b55de8ad565cc` | `assets/models/fbx/Flying seagull by Poly by Google - 6Tpj_vcWP3f.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fortress_by_creativetrio_hzpozu2nim_a83f36e93c92824a` | `assets/models/fbx/Fortress by CreativeTrio - HZPOZU2NiM.glb` | CreativeTrio (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_founain_square_fountain_e3d8ae9962939e29` | `assets/models/fbx/Founain-Square_fountain.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fountain_fount_7071eecd9a524f0b` | `assets/models/fbx/Fountain_fount.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fox_by_poly_by_google_10u8fypc5br_b1d1d9bbec747400` | `assets/models/fbx/Fox by Poly by Google - 10u8FYPC5Br.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_fox_by_quaternius_bc97c66hki_e0f94ba7497c89fc` | `assets/models/fbx/Fox by Quaternius - Bc97C66HKi.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_free_building_house_house_4efc9f483a307141` | `assets/models/fbx/Free_Building_House_house.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_free_dome_dome_4be11b54f1fc077b` | `assets/models/fbx/Free_Dome_dome.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_free_rock_rock_1_389e0118b17f27e3` | `assets/models/fbx/Free_rock_Rock_1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_free_roman_building_building_dae1eae3cb7afdf1` | `assets/models/fbx/Free_Roman_Building_building.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_free_temple_temple_ebf9ca1cd580ef13` | `assets/models/fbx/Free_temple_temple.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_free_tower22_tower_4d65d6b1b80d5e57` | `assets/models/fbx/Free_tower22_tower.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_freeallblend_e77bd73651ec1d1f` | `assets/models/fbx/FreeAllBLEND.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_freebuilding_building_ff4852a268171119` | `assets/models/fbx/FreeBuilding_building.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_ganges_river_pebbles_4k_6738dc30b8523fea` | `assets/models/fbx/ganges_river_pebbles_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_goat_by_poly_by_google_d7dimmjtf8e_d660d3991bc92e9b` | `assets/models/fbx/Goat by Poly by Google - d7dImmjtF8E.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_governmentbuilding_building_7066072479db0557` | `assets/models/fbx/GovernmentBuilding_building.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_grass_by_quaternius_ugtozco3p2_c3acd7642660cff1` | `assets/models/fbx/Grass by Quaternius - UGTOzcO3P2.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_grass_bermuda_01_4k_4b8ecbbadce28655` | `assets/models/fbx/grass_bermuda_01_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_grass_medium_02_4k_318fee03e9672276` | `assets/models/fbx/grass_medium_02_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_grass_04563b00fa7b180c` | `assets/models/fbx/Grass.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_great_horned_owl_by_poly_by_google_fnkq9cwsg_a4ced20a2156ca7b` | `assets/models/fbx/Great horned owl by Poly by Google - fNkq9CwSG6d.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_guy_by_cloaking_us_0eu7bl0a6cg_a09d4d5e2ac253c0` | `assets/models/fbx/guy by CLOAKING .US - 0eU7bl0a6Cg.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_hitem3d_1785396398302_b77d8e0d17bce49c` | `assets/models/fbx/Hitem3d-1785396398302.glb` | Hitem3d (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_hitem3d_1785398580755_b982eb12ec8dd4a9` | `assets/models/fbx/Hitem3d-1785398580755.glb` | Hitem3d (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_hitem3d_1785400605600_7c396808738d6c15` | `assets/models/fbx/Hitem3d-1785400605600.glb` | Hitem3d (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_horse_by_poly_by_google_5ocnvsh_zf_e77d8fddcd13f86a` | `assets/models/fbx/Horse by Poly by Google - 5ocnVSh_ZF-.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_house_by_pixel_fdaqerlqcc_e435094d828975af` | `assets/models/fbx/House by Pixel - fdaqERLQCc.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_house_by_quaternius_hehdd2rtpx_8f2f062d55220e8f` | `assets/models/fbx/House by Quaternius - HeHDd2rTpX.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_house_by_quaternius_roqihdrpgc_59058eaf214c5a10` | `assets/models/fbx/House by Quaternius - roqiHdrpgc.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_house_free_house_1f70d82c7153602d` | `assets/models/fbx/House_free_house.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_house_with_garden_glb_61c89901d314346f` | `assets/models/fbx/House_with_Garden_GLB.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_husky_by_quaternius_wcwiueqwzq_41d145bdb5e698b7` | `assets/models/fbx/Husky by Quaternius - wcWiuEqwzq.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_karakter_aaa40cf0a19f0528` | `assets/models/fbx/karakter.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_king_by_quaternius_i1gtjmuk2m_7d3328143967cd0c` | `assets/models/fbx/King by Quaternius - I1gTjmuK2m.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_knight_by_dawid2k_isc73b8skq_0a2120830e36ebf4` | `assets/models/fbx/Knight by Dawid2K - isC73B8SKq.glb` | Dawid2K (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_knights_character_kit_by_jacques_fourie_3r2j_09bb24b2504f39da` | `assets/models/fbx/Knights Character Kit by Jacques Fourie - 3r2JcOZShpE.glb` | Jacques Fourie (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_labrador_retriever_03_45e4dc36badce390` | `assets/models/fbx/Labrador-Retriever_03.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_lamp_pillar_lamp_c19b1c992bf1e27f` | `assets/models/fbx/Lamp_Pillar_lamp.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_lamp6_lamp_2580585d4827a0b0` | `assets/models/fbx/Lamp6_lamp.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_lion_by_poly_by_google_3xajojwxswz_c09c7a08798cc18c` | `assets/models/fbx/Lion by Poly by Google - 3XAJojWxSWz.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_log_cabin_by_jarlan_perez_et0omfezvkb_40003e40f83a7408` | `assets/models/fbx/Log Cabin by Jarlan Perez - et0OmFeZVkb.glb` | Jarlan Perez (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_low_poly_lion_5e12a42a2cff8371` | `assets/models/fbx/low_poly_lion.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_low_poly_winter_tree_pack_9b8d9136fef395b4` | `assets/models/fbx/low_poly_winter_tree_pack.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_maple_trees_by_quaternius_igftqd0pjo_a739d6dc4acd1d52` | `assets/models/fbx/Maple Trees by Quaternius - iGFtQd0PJO.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medhouse_d127a6df47b4658f` | `assets/models/fbx/MedHouse.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medieval_gloves_0c15315de02ca4e9` | `assets/models/fbx/medieval_gloves.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medieval_house_d678a41c09655121` | `assets/models/fbx/medieval_house.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medieval_market_a4b2d6a8011088fc` | `assets/models/fbx/Medieval_Market_.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medieval_market_asset_pack_2acbbdcffda2ca94` | `assets/models/fbx/Medieval_Market_Asset_Pack.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medievalpacksty_chest1_c21895172f48255e` | `assets/models/fbx/MedievalPackSTY_Chest1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_medium_house_by_pixel_4hi5fnvl6z_ce02b87ccfa254f9` | `assets/models/fbx/Medium House by Pixel - 4hI5fNvl6z.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshes_v1_f8c550d98ea8b2b0` | `assets/models/fbx/Meshes_-_V1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshes_v2_0e9e8bbc0705c450` | `assets/models/fbx/Meshes_-_V2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshes_v3_bcfa2fb196641c2f` | `assets/models/fbx/Meshes_-_V3.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_a_formidable_spiked_s_0730081710_te_8234dbf45e64b3b8` | `assets/models/fbx/Meshy_AI_A_formidable_spiked_s_0730081710_texture.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_auric_dragon_0730080152_generate_f58b18199106c980` | `assets/models/fbx/Meshy_AI_Auric_Dragon_0730080152_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_boho_western_muse_0730060053_textur_8dfccc510e9f1a46` | `assets/models/fbx/Meshy_AI_Boho_Western_Muse_0730060053_texture.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_brickstone_citadel_0730082448_gener_82af9a223efe2a41` | `assets/models/fbx/Meshy_AI_Brickstone_Citadel_0730082448_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_castle_on_a_rock_0730082636_generat_b53af171fdafc340` | `assets/models/fbx/Meshy_AI_Castle_on_a_Rock_0730082636_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_casual_confidence_0730083526_genera_fd13373c8d828fe5` | `assets/models/fbx/Meshy_AI_Casual_Confidence_0730083526_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_create_exactly_one_dr_0808193627_ge_cfdc824250581bc5` | `assets/models/fbx/Meshy_AI_Create_exactly_ONE_dr_0808193627_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_create_exactly_one_hi_0808194328_ge_8887f6c4cb6cdb3b` | `assets/models/fbx/Meshy_AI_Create_exactly_ONE_hi_0808194328_generate.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_elven_warrior_in_gree_0730060103_te_c27094113da2eaa3` | `assets/models/fbx/Meshy_AI_Elven_Warrior_in_Gree_0730060103_texture.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_emerald_citadel_0730082238_generate_11b4021977a1c5d2` | `assets/models/fbx/Meshy_AI_Emerald_Citadel_0730082238_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_fortress_of_the_crown_0730083348_ge_d2dd7ef9792c0700` | `assets/models/fbx/Meshy_AI_Fortress_of_the_Crown_0730083348_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_frostscale_dragon_0730080648_genera_13949d138677316a` | `assets/models/fbx/Meshy_AI_Frostscale_Dragon_0730080648_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_frostwing_dragon_0808195300_generat_c61f8356b1029b39` | `assets/models/fbx/Meshy_AI_Frostwing_Dragon_0808195300_generate.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_gilded_knight_of_the_0809083228_tex_1d780a11c8f1010d` | `assets/models/fbx/Meshy_AI_Gilded_Knight_of_the__0809083228_texture.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_golden_ember_dragon_0808200332_gene_e9642371cdcf1d5c` | `assets/models/fbx/Meshy_AI_Golden_Ember_Dragon_0808200332_generate.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_golden_vanguard_knigh_0809074809_te_2eeff7aef5065b29` | `assets/models/fbx/Meshy_AI_Golden_Vanguard_Knigh_0809074809_texture.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_greystone_castle_0730083023_generat_7f4de067e07343b2` | `assets/models/fbx/Meshy_AI_Greystone_Castle_0730083023_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_icebound_citadel_0730082031_generat_b3b5440a4822cf64` | `assets/models/fbx/Meshy_AI_Icebound_Citadel_0730082031_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_ionic_grace_0730081719_texture_353cb28f4c2a63c1` | `assets/models/fbx/Meshy_AI_Ionic_Grace_0730081719_texture.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_iron_throne_0808200614_generate_8346aa8fc1070281` | `assets/models/fbx/Meshy_AI_Iron_Throne_0808200614_generate.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_ivory_ascendancy_0808200513_texture_25e8bfd6cf326bd8` | `assets/models/fbx/Meshy_AI_Ivory_Ascendancy_0808200513_texture_fbx/Meshy_AI_Ivory_Ascendancy_0808200513_texture.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_ivory_stallion_0730083726_generate_b8d4420d9fab4466` | `assets/models/fbx/Meshy_AI_Ivory_Stallion_0730083726_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_march_of_the_wooden_l_0730091717_ge_cc3779a95066041c` | `assets/models/fbx/Meshy_AI_March_of_the_Wooden_L_0730091717_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_obsidian_wyvern_0808195051_generate_a0cc05dae101e857` | `assets/models/fbx/Meshy_AI_Obsidian_Wyvern_0808195051_generate.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_slice_of_truth_0730094215_texture_c094059139bab826` | `assets/models/fbx/Meshy_AI_Slice_of_Truth_0730094215_texture.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_verdant_knight_0730081659_generate_8bf47a3c1248dd83` | `assets/models/fbx/Meshy_AI_Verdant_Knight_0730081659_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_verdant_wyrm_0730075050_texture_42bac3577ded0b16` | `assets/models/fbx/Meshy_AI_Verdant_Wyrm_0730075050_texture.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_walled_city_fortress_0730075436_gen_c57f1c0ac198fb72` | `assets/models/fbx/Meshy_AI_Walled_City_Fortress_0730075436_generate.glb` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_meshy_ai_winter_s_sentinel_0809081717_textur_2a93e9722045a850` | `assets/models/fbx/Meshy_AI_Winter_s_Sentinel_0809081717_texture.fbx` | Meshy AI (filename attribution; account/license tier unverified) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_metal_jerrycan_green_4k_cf116c1206cb618e` | `assets/models/fbx/metal_jerrycan_green_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_modular_castle_kit_by_quaternius_ahhyxvo6fd_085450615967f63d` | `assets/models/fbx/Modular Castle Kit by Quaternius - AhhyXvO6Fd.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_modular_ruins_pack_by_quaternius_f2lak03b0r_83c98cf72095f637` | `assets/models/fbx/Modular Ruins Pack by Quaternius - F2LAK03B0r.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_mongoose_4e6f71f287e1c9dc` | `assets/models/fbx/Mongoose.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_mount_fuji_cead5d1c46eb8461` | `assets/models/fbx/Mount_Fuji.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_mount_hood_eaa867b6ea35e62d` | `assets/models/fbx/Mount_Hood.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_mouse_by_poly_by_google_4kke4d2fv1d_6f9e36970b5937c2` | `assets/models/fbx/Mouse by Poly by Google - 4KKE4D2FV1D.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_namaqualand_boulder_02_4k_1040d86f18d08d02` | `assets/models/fbx/namaqualand_boulder_02_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_namaqualand_boulder_05_4k_57a08c07ec7bace7` | `assets/models/fbx/namaqualand_boulder_05_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_nettle_plant_4k_646e73dd6a3c8784` | `assets/models/fbx/nettle_plant_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_oil_tin_4k_e515e080a3115358` | `assets/models/fbx/oil_tin_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_old_bridge_189a810d627c3d7e` | `assets/models/fbx/Old Bridge.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_old_house_2_3d_models_a2c17cb397214483` | `assets/models/fbx/Old House 2/Old House Files/Old House 2 3D Models.FBX` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_old_bed_frame_4k_51c67ffa2cb2f657` | `assets/models/fbx/old_bed_frame_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_others_cfdfa4b1d9b33632` | `assets/models/fbx/Others.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_others2_821c2402811316ec` | `assets/models/fbx/Others2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_oval_lamp_lamp_8234638c57b60b57` | `assets/models/fbx/Oval_Lamp_lamp.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_palace_by_poly_by_google_f5wb0x6qk3j_6668819334983eae` | `assets/models/fbx/Palace by Poly by Google - f5wb0x6Qk3j.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_palm_trees_by_quaternius_vyslw9dei6_e028eab729640db1` | `assets/models/fbx/Palm Trees by Quaternius - VYslw9DEi6.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_pillar_world_pillar_676dcf52a0591574` | `assets/models/fbx/Pillar_World_pillar.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_pine_by_quaternius_zt62gcekxz_fc93613d3f8dc66b` | `assets/models/fbx/Pine by Quaternius - Zt62gceKXZ.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_pine_trees_by_quaternius_oytdty0fr6_f1db05704b0fda15` | `assets/models/fbx/Pine Trees by Quaternius - oYtDty0fR6.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_pine_realistic_937aadce51d3b53d` | `assets/models/fbx/pine_realistic.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_quiver_tree_02_4k_d08ec63ce139e155` | `assets/models/fbx/quiver_tree_02_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rabbit_by_poly_by_google_8_zf1zgrpk5_51f2b7ba16db4942` | `assets/models/fbx/Rabbit by Poly by Google - 8_ZF1ZGRpk5.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rabbit_by_poly_by_google_9obtrvyusmt_de3fc09755d6e2a3` | `assets/models/fbx/Rabbit by Poly by Google - 9OBTRVYUSmt.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rcr01_904e9d9e776135f4` | `assets/models/fbx/RCR01.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rhino_faa688dc379e1433` | `assets/models/fbx/rhino.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_riggedcat_d38f1ed000362c9e` | `assets/models/fbx/riggedcat.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_road_terrain_4bcede0bcca1c94e` | `assets/models/fbx/road_terrain.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rocky_terrain_low_poly_0b247c9ae9f7b002` | `assets/models/fbx/rocky_terrain_low_poly.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_roman_centurion_by_blaeksprut_g2ckfsgszb_73c880f4d5554070` | `assets/models/fbx/Roman Centurion by blaeksprut - g2ckFsGszB.glb` | blaeksprut (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rubber_boots_4k_bdc6634818f4b307` | `assets/models/fbx/rubber_boots_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_rugged_mountain_landscape_611626a9c574d95d` | `assets/models/fbx/rugged_mountain_landscape.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_ruins_column_columns_e8f435daf4c2b57c` | `assets/models/fbx/Ruins_Column_columns.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_seagull_by_poly_by_google_0wrzrtciirp_b2e05426474a5e1c` | `assets/models/fbx/Seagull by Poly by Google - 0WRzrtCIIRp.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_sheep_by_quaternius_c39auxuues_a46bc9d7aba575e2` | `assets/models/fbx/Sheep by Quaternius - C39AUXUUes.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_silo_house_by_quaternius_zgstejsacn_77253fff968c1867` | `assets/models/fbx/Silo House by Quaternius - ZgstejsAcN.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_singlemountain_b3ea55997c9b5886` | `assets/models/fbx/singlemountain.FBX` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_skunk_by_poly_by_google_bf8ide1qb7u_adc6c0a8729677cb` | `assets/models/fbx/Skunk by Poly by Google - bf8IDe1qb7u.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_snow_leopard_by_poly_by_google_26ttvxyxkpc_25c1d81534eb38e7` | `assets/models/fbx/Snow leopard by Poly by Google - 26tTvxyxkPC.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_snow_terrain_low_poly_643b946516c2c47a` | `assets/models/fbx/snow_terrain_low_poly.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_snowlandscape_52be12c37509808f` | `assets/models/fbx/sNOWlaNDSCAPE.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_son_18588509276d2c76` | `assets/models/fbx/son.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_spear_7bf3b9be7c744499` | `assets/models/fbx/Spear.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_spider_monkey_by_poly_by_google_4ci4dwwucrd_57aed5226f7d8b47` | `assets/models/fbx/Spider monkey by Poly by Google - 4Ci4DWwucRd.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stag_by_quaternius_tqdzbz1cmw_b499be7e5f56b10c` | `assets/models/fbx/Stag by Quaternius - tQdzbZ1Cmw.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stairs_orient_stairs_86173a3bb0ab1bab` | `assets/models/fbx/Stairs_Orient_stairs.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stone_wall_towers_by_quaternius_geiskzlsfz_89d45fda0845aaaa` | `assets/models/fbx/Stone Wall Towers by Quaternius - geisKzlSFZ.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentfive_lod1_38329d1ca8b9db74` | `assets/models/fbx/StoneFloor_FragmentFive_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentfive_lod2_b66db1674dbbb701` | `assets/models/fbx/StoneFloor_FragmentFive_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentfive_6d3699a6e28e875f` | `assets/models/fbx/StoneFloor_FragmentFive.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentfour_lod1_2d46d470aca1cf59` | `assets/models/fbx/StoneFloor_FragmentFour_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentfour_lod2_0240b25d2342c083` | `assets/models/fbx/StoneFloor_FragmentFour_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentfour_b123129b8d415a9f` | `assets/models/fbx/StoneFloor_FragmentFour.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentone_lod1_1a3ddb494f603c7c` | `assets/models/fbx/StoneFloor_FragmentOne_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentone_lod2_14ee3a73fb44ef69` | `assets/models/fbx/StoneFloor_FragmentOne_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentone_502c816472d5cc08` | `assets/models/fbx/StoneFloor_FragmentOne.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentthree_lod1_1d67377b16d5601e` | `assets/models/fbx/StoneFloor_FragmentThree_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentthree_lod2_8fe63160e5c0c086` | `assets/models/fbx/StoneFloor_FragmentThree_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmentthree_073b5b0bdb6a482d` | `assets/models/fbx/StoneFloor_FragmentThree.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmenttwo_lod1_c142329bb8fc6eec` | `assets/models/fbx/StoneFloor_FragmentTwo_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmenttwo_lod2_e6e2d01b362c1b07` | `assets/models/fbx/StoneFloor_FragmentTwo_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_fragmenttwo_67cb47f003d01663` | `assets/models/fbx/StoneFloor_FragmentTwo.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_grassone_lod1_f6dd365af7b2b173` | `assets/models/fbx/StoneFloor_GrassOne_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_grassone_lod2_515e8cea9dad6f44` | `assets/models/fbx/StoneFloor_GrassOne_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_grassone_7cc6c2d3cb69e28e` | `assets/models/fbx/StoneFloor_GrassOne.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_grasstwo_lod1_5de09a8925ee7543` | `assets/models/fbx/StoneFloor_GrassTwo_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_grasstwo_lod2_23bbb6e34a2574eb` | `assets/models/fbx/StoneFloor_GrassTwo_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_grasstwo_27a5346ce71897bb` | `assets/models/fbx/StoneFloor_GrassTwo.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_ground_lod1_e339add4e8bf0031` | `assets/models/fbx/StoneFloor_Ground_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_ground_lod2_9597e879b2f3e2d6` | `assets/models/fbx/StoneFloor_Ground_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_ground_54e9fa5039dd8f8d` | `assets/models/fbx/StoneFloor_Ground.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_slabone_lod1_9036d490bb16b46e` | `assets/models/fbx/StoneFloor_SlabOne_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_slabone_lod2_c02cdd4586b2463a` | `assets/models/fbx/StoneFloor_SlabOne_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_slabone_abdcbf92ddc30155` | `assets/models/fbx/StoneFloor_SlabOne.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_slabtwo_lod1_7ca5bbfd0b43b2d1` | `assets/models/fbx/StoneFloor_SlabTwo_LOD1.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_slabtwo_lod2_71aad9db290580d5` | `assets/models/fbx/StoneFloor_SlabTwo_LOD2.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_stonefloor_slabtwo_a322c5c3cec92f65` | `assets/models/fbx/StoneFloor_SlabTwo.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_street_lamp_lamp_cc0265ebdc9fc114` | `assets/models/fbx/Street_Lamp_lamp.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_street_rat_4k_d20cbf6698d57a51` | `assets/models/fbx/street_rat_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_structure_gate_gate_75a871b6846f6afc` | `assets/models/fbx/Structure_gate_gate.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_temple_building5_building_b9c0dd4f256239f3` | `assets/models/fbx/Temple_Building5_building.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_temple_tower_temple_523f338b33a5e4e6` | `assets/models/fbx/temple_tower_temple.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_terrain_01_f90a88f921b31f2b` | `assets/models/fbx/terrain_01.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_terrain_test_2_6c436fa3e39e9b33` | `assets/models/fbx/terrain_test_2.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_terrain_test_81f2f0a2ae8340fa` | `assets/models/fbx/terrain_test.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_the_landscape_is_a_forest_in_the_mountains_ce1b62b1fbf9390c` | `assets/models/fbx/the_landscape_is_a_forest_in_the_mountains.glb` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tiger_251f41a2980b3c4d` | `assets/models/fbx/tiger.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tower22_tower_f2a52d128745c1fb` | `assets/models/fbx/tower22_tower.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_treasure_chest_4k_c53261b8679b8737` | `assets/models/fbx/treasure_chest_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tree_by_quaternius_avoxahrpwe_1c8c9785d626a0ce` | `assets/models/fbx/Tree by Quaternius - aVOxaHRPWe.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tree_by_quaternius_qvoop92wmg_aeb8cc447b8111fb` | `assets/models/fbx/Tree by Quaternius - QVOop92WmG.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tree_by_quaternius_qztx0ahhcy_23191232f3032900` | `assets/models/fbx/Tree by Quaternius - qZtx0AHhcy.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tree_by_zsky_vfzbakek1r_ec65381e5b7a18e6` | `assets/models/fbx/Tree by Zsky - VfZbAkek1r.glb` | Zsky (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tree_stump_by_poly_by_google_esfongb0uwl_54fce2fe59b6b490` | `assets/models/fbx/Tree stump by Poly by Google - esFOngb0uwl.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_tree_stump_01_4k_1bab44924593ec37` | `assets/models/fbx/tree_stump_01_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_trees_by_quaternius_etfgnvsifv_76c736a4962ebc80` | `assets/models/fbx/Trees by Quaternius - etFGNvsiFv.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_triple_lamp_lamp_bfb1f653fbe26c87` | `assets/models/fbx/Triple_Lamp_lamp.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_twin_pillar_pilalrs_200432184120d6b1` | `assets/models/fbx/Twin_Pillar_pilalrs.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_twisted_tree_by_quaternius_8orakn9m0x_5b6c9b95758b07db` | `assets/models/fbx/Twisted Tree by Quaternius - 8oraKn9m0x.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_twisted_tree_by_quaternius_9awlx82xuf_ef99886cdcdb4d82` | `assets/models/fbx/Twisted Tree by Quaternius - 9aWlx82xUf.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_twisted_tree_by_quaternius_gvtsmmuzv7_6d85f6038f8cc94f` | `assets/models/fbx/Twisted Tree by Quaternius - GVTsMmuzv7.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_untitled_5b992cb973ae18ca` | `assets/models/fbx/untitled.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_viking_sword_blend_viking_sword_ea8442b7a4bc8733` | `assets/models/fbx/Viking Sword Blend_Viking Sword.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_vintage_day_bed_4k_157331adaa0ae7ef` | `assets/models/fbx/vintage_day_bed_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wasp_by_poly_by_google_4udwqxbm0_b_af49ffe6bf6218c7` | `assets/models/fbx/Wasp by Poly by Google - 4UdWQxbm0-B.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_weapons_f1cbd41e6ce92568` | `assets/models/fbx/weapons.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_white_horse_by_quaternius_bede4rmzy9_0c80daa522143613` | `assets/models/fbx/White Horse by Quaternius - bEdE4rmZy9.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_witch_by_quaternius_qbeov9zut8_e23194570940a58b` | `assets/models/fbx/Witch by Quaternius - QBEOV9ZUT8.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wood_log_by_quaternius_l4e32wee6c_baf30caf6a98f077` | `assets/models/fbx/Wood Log by Quaternius - L4E32Wee6C.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wooden_door_rounded_by_kenney_tpsxxwudtn_06dd17c959ee1467` | `assets/models/fbx/Wooden Door Rounded by Kenney - tPsxxWUdTn.glb` | Kenney (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wooden_broom_4k_11c5a195497327dc` | `assets/models/fbx/wooden_broom_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wooden_ladder_02_4k_05274e52e5dd7564` | `assets/models/fbx/wooden_ladder_02_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wooden_military_crate_4k_225b2c8574aae734` | `assets/models/fbx/wooden_military_crate_4k.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_wooden_shelf_fbx_file_8b36b5a085e82b02` | `assets/models/fbx/wooden_shelf_fbx_file.fbx` | Owner upload — original source not recorded | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_woodrat_by_poly_by_google_24xnzj_nmln_84f4d24b96d4997f` | `assets/models/fbx/Woodrat by Poly by Google - 24Xnzj_Nmln.glb` | Poly by Google (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |
| `owner_model_zebra_by_quaternius_iclpbr6sbz_bf5f621b72ec5e18` | `assets/models/fbx/Zebra by Quaternius - iclPBR6SBZ.glb` | Quaternius (filename attribution) | UNKNOWN — owner-approved for runtime use (§33.3) |

## Kenney (Kenney Vleugels, Kenney.nl) — run 346, first audio in the game

Kaynak: https://kenney.nl/assets/ui-audio — CC0 1.0 Universal (kamu malı, atıf gerekmez ama
memnuniyetle karşılanır). Dosya, orijinal Kenney zip'inin doğrudan indirilmesi JS render gerektirdiği
için, aynı asset setinin Godot için paketlenmiş bir aynası olan
https://github.com/Calinou/kenney-ui-audio (`click1.wav`, kendi `LICENSE.txt`'i de CC0'ı doğruluyor)
üzerinden alındı ve `assets/audio/ui-click.wav` olarak eklendi.

| Asset ID | Dosya | Kullanım |
|---|---|---|
| `ui_click_kenney` | `assets/audio/ui-click.wav` | Duraklatma menüsü açılış/kapanış tık sesi (`src/3d/audio/audioManager.js`) |
