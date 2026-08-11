#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?stable tag is required}"

PROGRESS_MARKER='## Run 269 — finalize Run264 HTerrain authoring checkpoint'
if ! grep -Fq "$PROGRESS_MARKER" 3D_GAME_PROGRESS.md; then
  cat >> 3D_GAME_PROGRESS.md <<'EOF'

## Run 269 — finalize Run264 HTerrain authoring checkpoint
- Run264 merged the owner-provided Zylann HTerrain 1.8 package as an isolated Godot 4.6 authoring workspace; the browser HTML/JS/Three.js game remains the canonical runtime and receives no Run264 runtime behavior change.
- Authoring proof PASS: a real HTerrain node creates 513x513 Terrain Data, four starter terrain texture slots, one detail map, deterministic grass seed 20260811 and restored collision; Raise/Lower/Smooth/Flatten/Level/Erode, texture and detail editor assets load through the vendor plugin.
- Visual/normal proof PASS with real Mesa llvmpipe OpenGL: two 1280x720 terrain camera angles were captured, and a 17x17 same-tile height edit queued one normal tile through the compatibility bridge and changed the sampled normal from approximately (0.498,0.498,1.0) to (0.051,0.502,0.722).
- Full PWA/cache/installability, mobile performance, seeded determinism, world-reference/hydrology, terrain/road safety, technical-debt and Chromium smoke/console gates passed. Memory-leak review: the editor-only bridge owns one TerrainData signal connection, rebinds on data replacement and disconnects in _exit_tree; no browser listener/timer/DOM/geometry/material ownership was added.
- Risk MEDIUM: isolated authoring toolchain only. Known upstream/CI Godot diagnostics remain documented; functional real-render normal baking is proven. Next safe work must refresh remote main/open PRs before selecting a runtime export/import bridge task.
EOF
fi

ADR_MARKER='## ADR Run269-HTerrain — Isolated Godot HTerrain authoring workspace'
if ! grep -Fq "$ADR_MARKER" DECISIONS.md; then
  cat >> DECISIONS.md <<'EOF'

## ADR Run269-HTerrain — Isolated Godot HTerrain authoring workspace
**Karar:** Zylann HTerrain 1.8, `godot/terrain-authoring/` altında Godot 4.6 tabanlı ve mevcut browser oyundan izole bir arazi authoring aracı olarak tutulur. HTML/JS/Three.js/PWA tarafı oyunun kanonik runtime'ı olmaya devam eder. Vendor HTerrain kaynakları yerel uyumluluk davranışları için değiştirilmez; proje-spesifik uyumluluk katmanları vendor klasörünün dışında tutulur.

**Neden:** Proje sahibinin heightmap boyama, doku katmanları ve çim/detail araçlarını olgun bir editör üzerinden kullanabilmesi gerekirken mevcut 2D/3D web oyununun mimarisi ve PWA davranışı regresyon riski almamalıdır.

**Alternatifler:** (1) Aynı araçların tamamını mevcut web editöründe yeniden yazmak daha yüksek geliştirme ve regresyon maliyetine sahiptir. (2) Oyunun tamamını Godot runtime'a taşımak mevcut mimariyi gereksiz yere değiştirir. (3) HTerrain vendor dosyasını doğrudan yamamak upstream senkronizasyonunu zorlaştırır. Bu nedenle izole authoring + vendor dışı compatibility bridge seçildi.

**Sonuç:** Godot authoring projesi HTerrain Terrain Data, dört başlangıç texture katmanı, detail/grass haritası, collision ve deterministik grass seed ile açılır. HTerrain 1.8'in küçük fırça normal-tile scheduler açığı vendor dışı editor-only bridge ile kapatılır ve gerçek OpenGL render testiyle doğrulanır. Godot verisinin browser runtime'a hangi format ve dönüştürme sözleşmesiyle aktarılacağı bu kararın kapsamında değildir ve ayrı bir alt görev/karar gerektirir.

**Etkilenen sistemler:** `godot/terrain-authoring/`, Run264/Run269 CI ve authoring dokümantasyonu. Mevcut HTML/JS/Three.js/PWA runtime davranışı etkilenmez.

**Gelecek faz etkisi:** Dünya üretimi için güçlü bir authoring veri kaynağı sağlar; ancak runtime terrain import/export sözleşmesini peşinen belirlemez. Gelecek köprü çalışması deterministik veri dönüşümü, boyut/LOD ve PWA asset bütçelerini ayrı doğrulamalıdır.

**Geri alma planı:** `godot/terrain-authoring/` çalışma alanı ve ona özel CI devre dışı bırakılabilir/kaldırılabilir; browser runtime'a bağımlılık eklenmediği için oyun tarafında geri alma gerektirmez. Vendor-dışı normal scheduler bridge bağımsız kaldırılabilir.

**Risk:** MEDIUM. Yeni bir authoring toolchain eklenmiştir; web runtime delta 0'dır. Vendor normal baker ile Godot CI arasında tanısal log gürültüsü vardır, fakat gerçek renderer altında fonksiyonel normal üretimi ayrıca kanıtlanmıştır.
EOF
fi

if ! grep -Fq 'run269,2026-08-11,run264-hterrain-authoring-checkpoint' perf_log.csv; then
  printf '%s\n' 'run269,2026-08-11,run264-hterrain-authoring-checkpoint,,,,,,,"Godot 4.6.3 HTerrain authoring checkpoint; two-angle real-render evidence + normal-baker proof + full PWA/browser chain PASS; mobile drawCalls 35 triangles 195929 geometries 30 textures 22"' >> perf_log.csv
fi

if ! grep -Fq 'Run269 Run264 HTerrain authoring checkpoint' STABLE_TAGS.md; then
  printf '\n- `%s` — Run269 Run264 HTerrain authoring checkpoint; Godot 4.6.3 Terrain Data/texture/detail tools, two-angle visual evidence, real-render normal-baker proof, PWA/perf/full smoke PASS.\n' "$TAG" >> STABLE_TAGS.md
fi
