from pathlib import Path

SCENE_IMPORT = "import { createVillages } from './world/villages.js';\n"
SCENE_IMPORT_NEW = SCENE_IMPORT + "import { createSettlementAmbientProps, upgradeSettlementAmbientPropAssets } from './world/settlementAmbientProps.js';\n"
SCENE_ANCHOR = "\t// Asset-informed geology is deliberately created after roads/settlements so placement can reserve\n"
SCENE_BLOCK = """\t// Small ambient props occupy only the already-canonical kingdom-seat apron. They do not
\t// participate in collision/gameplay and never create settlement coordinates; placement is
\t// derived from the same seat, terrain and routed-road authorities already live above.
\tconst settlementAmbientPropsResult = createSettlementAmbientProps({
\t\tsampleHeightMeters: groundCollider.getGroundHeight,
\t\tseaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
\t\tseed: WORLD_DEFAULTS.WORLD_SEED,
\t\tseats: settlementsResult.seats,
\t\troadEdges: roadsResult.edges,
\t\tworldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
\t\tworldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
\t\tisMobileClass,
\t});
\tscene.add(settlementAmbientPropsResult.group);
\tconsole.info(
\t\t`[sceneManager] Settlement ambient props: ${settlementAmbientPropsResult.stats.placedCount}/` +
\t\t\t`${settlementAmbientPropsResult.stats.targetCount} deterministic apron placement(s), ` +
\t\t\t`checksum ${settlementAmbientPropsResult.stats.placementChecksum}.`,
\t);
\tconst settlementAmbientAbortController = new AbortController();
\twindow.addEventListener('pagehide', () => settlementAmbientAbortController.abort(), { once: true });
\tvoid upgradeSettlementAmbientPropAssets(settlementAmbientPropsResult.group, {
\t\tsignal: settlementAmbientAbortController.signal,
\t\tisMobileClass,
\t\tsampleHeightMeters: groundCollider.getGroundHeight,
\t\tseaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
\t\tseats: settlementsResult.seats,
\t\troadEdges: roadsResult.edges,
\t}).then((upgrade) => {
\t\tif (upgrade.status === 'active') {
\t\t\tconsole.info(`[sceneManager] Hydrated ${upgrade.hydratedPlacementCount} settlement ambient prop placement(s) from ${upgrade.activeFamilyCount} repository GLB family/families.`);
\t\t} else if (upgrade.status === 'procedural-fallback') {
\t\t\tconsole.info('[sceneManager] Settlement ambient GLBs unavailable/mobile; deterministic weathered fallback remains active.');
\t\t}
\t}).catch((error) => {
\t\tconsole.warn('[sceneManager] Optional settlement ambient prop hydration failed; deterministic fallback remains active.', error);
\t});

"""

scene_path = Path('src/3d/sceneManager.js')
scene = scene_path.read_text()
if "from './world/settlementAmbientProps.js'" not in scene:
    if scene.count(SCENE_IMPORT) != 1:
        raise SystemExit('sceneManager village import anchor drifted')
    scene = scene.replace(SCENE_IMPORT, SCENE_IMPORT_NEW, 1)
if 'const settlementAmbientPropsResult = createSettlementAmbientProps({' not in scene:
    if scene.count(SCENE_ANCHOR) != 1:
        raise SystemExit('sceneManager geology insertion anchor drifted')
    scene = scene.replace(SCENE_ANCHOR, SCENE_BLOCK + SCENE_ANCHOR, 1)
if 'applyShadowRoles(settlementAmbientPropsResult.group' not in scene:
    anchor = "\tapplyShadowRoles(settlementsResult.group, { quality: renderQuality });\n"
    if scene.count(anchor) != 1:
        raise SystemExit('sceneManager shadow anchor drifted')
    scene = scene.replace(anchor, anchor + "\tapplyShadowRoles(settlementAmbientPropsResult.group, { quality: renderQuality });\n", 1)
if 'settlementAmbientProps: settlementAmbientPropsResult.group' not in scene:
    anchor = "\t\tsettlements: settlementsResult.group,\n"
    if scene.count(anchor) != 1:
        raise SystemExit('sceneManager state anchor drifted')
    scene = scene.replace(anchor, anchor + "\t\tsettlementAmbientProps: settlementAmbientPropsResult.group,\n\t\tsettlementAmbientPropStats: settlementAmbientPropsResult.stats,\n", 1)
scene_path.write_text(scene)

game_path = Path('src/3d/game3d.js')
game = game_path.read_text()
import_anchor = "import { disposeVillages } from './world/villages.js';\n"
if "disposeSettlementAmbientProps" not in game:
    if game.count(import_anchor) != 1:
        raise SystemExit('game3d village dispose import anchor drifted')
    game = game.replace(import_anchor, import_anchor + "import { disposeSettlementAmbientProps } from './world/settlementAmbientProps.js';\n", 1)
if 'disposeSettlementAmbientProps(state.settlementAmbientProps);' not in game:
    anchor = "\t\t\tdisposeRealCastleModels(state.realCastles);\n"
    if game.count(anchor) != 1:
        raise SystemExit('game3d teardown anchor drifted')
    game = game.replace(anchor, anchor + "\t\t\tdisposeSettlementAmbientProps(state.settlementAmbientProps);\n", 1)
game_path.write_text(game)
