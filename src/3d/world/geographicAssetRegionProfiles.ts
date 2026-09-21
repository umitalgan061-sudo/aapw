/** Production TypeScript owner for src/3d/world/geographicAssetRegionProfiles.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
/*
 * Geographic region profile catalog for asset distribution.
 *
 * Profiles are deliberately expressed as ecological/geometric archetypes rather than hard-coded
 * renderer coordinates. A producer may map a canonical world region to one of these profiles, then
 * the runtime orchestrator combines profile weights with the canonical surface context. This keeps
 * the catalog useful across map revisions while still making regional character explicit.
 */

export const GEOGRAPHIC_REGION_PROFILE_POLICY = Object.freeze({
  id: 'geographic-region-profile-catalog-2026-09-14-v1',
  canonicalSurfaceRequired: true,
  coordinatesAuthoritativeOutsideCatalog: true,
  familyWeightsAreAdvisory: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  deterministic: true,
});

const profile = (id, parent, config = {}) => Object.freeze({
  id,
  parent,
  moistureMin: config.moistureMin ?? 0,
  moistureMax: config.moistureMax ?? 1,
  elevationMin: config.elevationMin ?? -100,
  elevationMax: config.elevationMax ?? 4000,
  slopeMax: config.slopeMax ?? 38,
  density: config.density ?? 1,
  familyBias: Object.freeze(config.familyBias || {}),
  avoidFamilies: Object.freeze(config.avoidFamilies || []),
  preferredModes: Object.freeze(config.preferredModes || ['ambient']),
  seasonality: Object.freeze(config.seasonality || {}),
  continuityRadius: config.continuityRadius ?? 24,
  chunkMargin: config.chunkMargin ?? 6,
});

export const GEOGRAPHIC_REGION_PROFILES = Object.freeze([
  profile('north_temperate_forest', 'north', { moistureMin: .42, moistureMax: .88, elevationMax: 1200, density: 1.14, familyBias: { broadleaf: .8, birch: 1.18, pine: 1.24, fern: 1.08, wetboulder: 1.06 }, preferredModes: ['ambient', 'geology'], seasonality: { winter: .64, summer: .9 } }),
  profile('north_windwood', 'north', { moistureMin: .26, moistureMax: .62, elevationMax: 1000, density: .84, familyBias: { pine: 1.28, birch: 1.12, weatheredstone: 1.08, deadwood: 1.16 }, avoidFamilies: ['junglevine'], preferredModes: ['ambient', 'geology'], seasonality: { winter: .82 } }),
  profile('north_river_vale', 'north', { moistureMin: .55, moistureMax: 1, elevationMax: 650, density: 1.08, familyBias: { birch: 1.12, meadowgrass: 1.2, wetboulder: 1.28, watermill: 1.22, reeds: 1.18 }, preferredModes: ['ambient', 'shoreline', 'geology'], continuityRadius: 30 }),
  profile('north_high_moor', 'north', { moistureMin: .48, moistureMax: .92, elevationMin: 450, elevationMax: 1500, slopeMax: 30, density: .72, familyBias: { pine: 1.1, shrub: 1.28, meadowgrass: 1.08, cairn: 1.16, froststone: 1.24 }, preferredModes: ['ambient', 'geology'] }),
  profile('north_coastal_headland', 'north', { moistureMin: .4, moistureMax: .82, elevationMin: 0, elevationMax: 500, slopeMax: 42, density: .68, familyBias: { driftwood: 1.24, wetboulder: 1.18, weatheredstone: 1.1, shrub: 1.08 }, preferredModes: ['shoreline', 'geology'] }),
  profile('north_snowline', 'north', { moistureMin: .2, moistureMax: .62, elevationMin: 900, elevationMax: 2400, slopeMax: 48, density: .52, familyBias: { snowpine: 1.42, froststone: 1.4, cairn: 1.26, pine: .72 }, avoidFamilies: ['broadleaf', 'junglevine', 'marketstall'], preferredModes: ['ambient', 'geology'], seasonality: { winter: 1.25 } }),
  profile('north_frozen_pass', 'north', { moistureMin: .12, moistureMax: .58, elevationMin: 1100, elevationMax: 2700, slopeMax: 56, density: .34, familyBias: { froststone: 1.5, snowpine: 1.3, waystone: 1.18, cairn: 1.2 }, avoidFamilies: ['broadleaf', 'meadowgrass'], preferredModes: ['geology', 'roadside'] }),
  profile('north_bog_edge', 'north', { moistureMin: .72, moistureMax: 1, elevationMax: 500, slopeMax: 22, density: .92, familyBias: { marshreed: 1.46, shrub: 1.12, wetboulder: 1.18, driftwood: 1.08 }, preferredModes: ['shoreline', 'ambient'] }),
  profile('north_ancient_grove', 'north', { moistureMin: .46, moistureMax: .9, elevationMax: 900, slopeMax: 30, density: 1.04, familyBias: { broadleaf: 1.34, birch: 1.3, fern: 1.24, weatheredstone: 1.18, cairn: 1.1 }, preferredModes: ['ambient', 'geology'], continuityRadius: 36 }),
  profile('north_lake_margin', 'north', { moistureMin: .64, moistureMax: 1, elevationMax: 450, slopeMax: 20, density: .96, familyBias: { marshreed: 1.32, wetboulder: 1.34, driftwood: 1.12, dock: 1.14 }, preferredModes: ['shoreline', 'ambient'] }),

  profile('beyond_wall_snowfield', 'beyond-wall', { moistureMin: .18, moistureMax: .66, elevationMin: 600, elevationMax: 3000, slopeMax: 50, density: .26, familyBias: { froststone: 1.6, snowpine: 1.42, cairn: 1.34 }, avoidFamilies: ['broadleaf', 'marketstall', 'junglevine', 'watermill'], preferredModes: ['geology', 'ambient'], seasonality: { winter: 1.4 } }),
  profile('beyond_wall_ice_margin', 'beyond-wall', { moistureMin: .3, moistureMax: .84, elevationMin: 0, elevationMax: 1800, slopeMax: 42, density: .3, familyBias: { froststone: 1.72, wetboulder: 1.12, snowpine: 1.2, driftwood: 1.08 }, preferredModes: ['shoreline', 'geology'] }),
  profile('beyond_wall_tundra', 'beyond-wall', { moistureMin: .24, moistureMax: .62, elevationMin: 250, elevationMax: 1800, slopeMax: 34, density: .36, familyBias: { shrub: 1.28, froststone: 1.34, pine: 1.06, snowpine: 1.2 }, avoidFamilies: ['broadleaf', 'junglevine'], preferredModes: ['ambient', 'geology'] }),
  profile('beyond_wall_valley', 'beyond-wall', { moistureMin: .46, moistureMax: .78, elevationMin: 100, elevationMax: 900, density: .62, familyBias: { pine: 1.24, birch: 1.08, wetboulder: 1.2, meadowgrass: 1.04 }, preferredModes: ['ambient', 'geology'] }),
  profile('beyond_wall_mountain_ledge', 'beyond-wall', { moistureMin: .12, moistureMax: .48, elevationMin: 800, elevationMax: 2800, slopeMax: 60, density: .24, familyBias: { froststone: 1.58, granite: 1.34, basalt: 1.12, snowpine: 1.08 }, preferredModes: ['geology'] }),
  profile('beyond_wall_forest_pocket', 'beyond-wall', { moistureMin: .38, moistureMax: .74, elevationMin: 100, elevationMax: 900, slopeMax: 32, density: .76, familyBias: { pine: 1.34, birch: 1.18, fern: 1.08, weatheredstone: 1.06 }, preferredModes: ['ambient', 'geology'] }),
  profile('beyond_wall_coast', 'beyond-wall', { moistureMin: .36, moistureMax: .82, elevationMax: 420, slopeMax: 44, density: .42, familyBias: { driftwood: 1.42, wetboulder: 1.32, froststone: 1.22 }, preferredModes: ['shoreline', 'geology'] }),
  profile('beyond_wall_river_crossing', 'beyond-wall', { moistureMin: .64, moistureMax: 1, elevationMax: 700, slopeMax: 24, density: .58, familyBias: { wetboulder: 1.4, marshreed: 1.2, waystone: 1.08, watermill: .86 }, preferredModes: ['shoreline', 'roadside'] }),

  profile('riverlands_floodplain', 'riverlands', { moistureMin: .62, moistureMax: 1, elevationMax: 320, slopeMax: 16, density: 1.06, familyBias: { meadowgrass: 1.28, marshreed: 1.22, wetboulder: 1.3, willowlike: 1.18, watermill: 1.2 }, preferredModes: ['ambient', 'shoreline'] }),
  profile('riverlands_meadow', 'riverlands', { moistureMin: .4, moistureMax: .8, elevationMax: 500, slopeMax: 24, density: 1.12, familyBias: { meadowgrass: 1.34, broadleaf: 1.08, birch: 1.04, waystone: 1.1 }, preferredModes: ['ambient', 'roadside'] }),
  profile('riverlands_wetwood', 'riverlands', { moistureMin: .68, moistureMax: 1, elevationMax: 420, slopeMax: 28, density: 1.16, familyBias: { broadleaf: 1.16, birch: 1.08, fern: 1.3, wetboulder: 1.18, marshreed: 1.14 }, preferredModes: ['ambient', 'shoreline'] }),
  profile('riverlands_stone_road', 'riverlands', { moistureMin: .34, moistureMax: .82, elevationMax: 650, slopeMax: 20, density: .54, familyBias: { meadowgrass: 1.08, waystone: 1.32, weatheredstone: 1.14, shrub: .92 }, preferredModes: ['roadside'] }),
  profile('riverlands_riverbank', 'riverlands', { moistureMin: .74, moistureMax: 1, elevationMax: 220, slopeMax: 18, density: .88, familyBias: { marshreed: 1.5, wetboulder: 1.42, driftwood: 1.16, watermill: 1.14 }, preferredModes: ['shoreline'] }),
  profile('riverlands_hill_country', 'riverlands', { moistureMin: .34, moistureMax: .72, elevationMin: 180, elevationMax: 900, slopeMax: 34, density: .78, familyBias: { shrub: 1.2, meadowgrass: 1.16, granite: 1.08, weatheredstone: 1.08 }, preferredModes: ['ambient', 'geology'] }),
  profile('riverlands_castle_edge', 'riverlands', { moistureMin: .36, moistureMax: .76, elevationMax: 500, slopeMax: 18, density: .46, familyBias: { meadowgrass: 1.08, waystone: 1.26, ruinwall: 1.16, timberfence: 1.08 }, preferredModes: ['settlementEdge', 'roadside'] }),
  profile('riverlands_wooded_ridge', 'riverlands', { moistureMin: .44, moistureMax: .84, elevationMin: 200, elevationMax: 780, slopeMax: 38, density: 1.02, familyBias: { broadleaf: 1.3, birch: 1.16, fern: 1.14, wetboulder: 1.04 }, preferredModes: ['ambient', 'geology'] }),

  profile('vale_high_valley', 'vale', { moistureMin: .34, moistureMax: .76, elevationMin: 450, elevationMax: 1600, slopeMax: 46, density: .54, familyBias: { meadowgrass: 1.18, pine: 1.12, granite: 1.36, waystone: 1.16 }, preferredModes: ['ambient', 'geology'] }),
  profile('vale_mountain_foothill', 'vale', { moistureMin: .28, moistureMax: .68, elevationMin: 700, elevationMax: 2200, slopeMax: 54, density: .34, familyBias: { granite: 1.48, pine: 1.22, shrub: 1.04, cairn: 1.14 }, preferredModes: ['geology', 'ambient'] }),
  profile('vale_mountain_pass', 'vale', { moistureMin: .2, moistureMax: .58, elevationMin: 900, elevationMax: 2500, slopeMax: 60, density: .28, familyBias: { granite: 1.52, waystone: 1.22, cairn: 1.28, snowpine: .86 }, preferredModes: ['geology', 'roadside'] }),
  profile('vale_lowland_meadow', 'vale', { moistureMin: .42, moistureMax: .82, elevationMax: 420, slopeMax: 20, density: .96, familyBias: { meadowgrass: 1.34, broadleaf: 1.1, shrub: .94 }, preferredModes: ['ambient'] }),
  profile('vale_sea_cliff', 'vale', { moistureMin: .34, moistureMax: .76, elevationMin: 80, elevationMax: 700, slopeMax: 58, density: .28, familyBias: { granite: 1.42, weatheredstone: 1.18, driftwood: 1.06 }, preferredModes: ['geology', 'shoreline'] }),
  profile('vale_lake_edge', 'vale', { moistureMin: .68, moistureMax: 1, elevationMax: 500, slopeMax: 18, density: .82, familyBias: { marshreed: 1.28, wetboulder: 1.38, meadowgrass: 1.12, dock: 1.08 }, preferredModes: ['shoreline', 'ambient'] }),
  profile('vale_road_terrace', 'vale', { moistureMin: .28, moistureMax: .74, elevationMin: 200, elevationMax: 900, slopeMax: 18, density: .44, familyBias: { waystone: 1.42, shrub: 1.04, weatheredstone: 1.12 }, preferredModes: ['roadside'] }),

  profile('westerlands_low_hill', 'westerlands', { moistureMin: .28, moistureMax: .68, elevationMin: 0, elevationMax: 680, slopeMax: 34, density: .88, familyBias: { meadowgrass: 1.2, broadleaf: 1.08, limestone: 1.22, shrub: 1.04 }, preferredModes: ['ambient', 'geology'] }),
  profile('westerlands_gold_road', 'westerlands', { moistureMin: .22, moistureMax: .6, elevationMax: 450, slopeMax: 18, density: .36, familyBias: { meadowgrass: 1.12, waystone: 1.28, limestone: 1.1, timberfence: 1.08 }, preferredModes: ['roadside'] }),
  profile('westerlands_woodland', 'westerlands', { moistureMin: .38, moistureMax: .8, elevationMin: 40, elevationMax: 820, slopeMax: 38, density: 1.02, familyBias: { broadleaf: 1.34, birch: 1.12, fern: 1.12, wetboulder: .92 }, preferredModes: ['ambient'] }),
  profile('westerlands_limestone_ridge', 'westerlands', { moistureMin: .22, moistureMax: .56, elevationMin: 180, elevationMax: 900, slopeMax: 46, density: .52, familyBias: { limestone: 1.5, weatheredstone: 1.18, shrub: 1.08 }, preferredModes: ['geology', 'ambient'] }),
  profile('westerlands_coast', 'westerlands', { moistureMin: .46, moistureMax: .86, elevationMax: 380, slopeMax: 46, density: .48, familyBias: { driftwood: 1.32, wetboulder: 1.16, sandstone: 1.08 }, preferredModes: ['shoreline', 'geology'] }),
  profile('westerlands_castle_grounds', 'westerlands', { moistureMin: .3, moistureMax: .72, elevationMax: 420, slopeMax: 16, density: .5, familyBias: { meadowgrass: 1.14, waystone: 1.24, ruinwall: 1.12, timberfence: 1.06 }, preferredModes: ['settlementEdge', 'roadside'] }),

  profile('reach_fertile_plain', 'reach', { moistureMin: .42, moistureMax: .78, elevationMax: 320, slopeMax: 18, density: 1.2, familyBias: { meadowgrass: 1.48, broadleaf: 1.1, shrub: .88, timberfence: 1.16 }, preferredModes: ['ambient', 'roadside'] }),
  profile('reach_orchard_edge', 'reach', { moistureMin: .46, moistureMax: .82, elevationMax: 400, slopeMax: 14, density: 1.08, familyBias: { broadleaf: 1.16, meadowgrass: 1.32, timberfence: 1.12, marketstall: 1.04 }, preferredModes: ['ambient', 'settlementEdge'] }),
  profile('reach_riverbank', 'reach', { moistureMin: .68, moistureMax: 1, elevationMax: 250, slopeMax: 16, density: .96, familyBias: { marshreed: 1.42, wetboulder: 1.26, meadowgrass: 1.28, watermill: 1.2 }, preferredModes: ['shoreline', 'ambient'] }),
  profile('reach_low_wood', 'reach', { moistureMin: .38, moistureMax: .76, elevationMax: 620, slopeMax: 30, density: 1.0, familyBias: { broadleaf: 1.32, birch: 1.06, fern: 1.16, weatheredstone: .94 }, preferredModes: ['ambient'] }),
  profile('reach_coastal_marsh', 'reach', { moistureMin: .72, moistureMax: 1, elevationMax: 180, slopeMax: 14, density: 1.0, familyBias: { marshreed: 1.56, driftwood: 1.2, wetboulder: 1.18, dock: 1.04 }, preferredModes: ['shoreline'] }),
  profile('reach_road_approach', 'reach', { moistureMin: .36, moistureMax: .7, elevationMax: 380, slopeMax: 14, density: .42, familyBias: { meadowgrass: 1.22, waystone: 1.38, timberfence: 1.16 }, preferredModes: ['roadside'] }),

  profile('crownlands_lowland', 'crownlands', { moistureMin: .32, moistureMax: .74, elevationMax: 360, slopeMax: 20, density: .82, familyBias: { meadowgrass: 1.18, shrub: 1.08, broadleaf: 1.04, waystone: 1.06 }, preferredModes: ['ambient'] }),
  profile('crownlands_road_corridor', 'crownlands', { moistureMin: .26, moistureMax: .64, elevationMax: 420, slopeMax: 14, density: .3, familyBias: { waystone: 1.46, timberfence: 1.18, meadowgrass: 1.12 }, preferredModes: ['roadside'] }),
  profile('crownlands_river_mouth', 'crownlands', { moistureMin: .62, moistureMax: 1, elevationMax: 220, slopeMax: 14, density: .88, familyBias: { marshreed: 1.42, wetboulder: 1.18, dock: 1.28, driftwood: 1.16 }, preferredModes: ['shoreline'] }),
  profile('crownlands_wetwood', 'crownlands', { moistureMin: .52, moistureMax: .9, elevationMax: 480, slopeMax: 28, density: .92, familyBias: { broadleaf: 1.26, birch: 1.08, fern: 1.18, wetboulder: 1.12 }, preferredModes: ['ambient', 'geology'] }),
  profile('crownlands_settlement_edge', 'crownlands', { moistureMin: .28, moistureMax: .72, elevationMax: 320, slopeMax: 12, density: .36, familyBias: { timberfence: 1.3, marketstall: 1.24, waystone: 1.18, meadowgrass: .92 }, preferredModes: ['settlementEdge'] }),
  profile('crownlands_stone_shore', 'crownlands', { moistureMin: .44, moistureMax: .84, elevationMax: 400, slopeMax: 34, density: .46, familyBias: { sandstone: 1.24, wetboulder: 1.24, driftwood: 1.12 }, preferredModes: ['shoreline', 'geology'] }),

  profile('stormlands_wet_forest', 'stormlands', { moistureMin: .62, moistureMax: 1, elevationMax: 780, slopeMax: 36, density: 1.26, familyBias: { broadleaf: 1.34, birch: 1.16, fern: 1.3, wetboulder: 1.18 }, preferredModes: ['ambient', 'geology'] }),
  profile('stormlands_heath', 'stormlands', { moistureMin: .46, moistureMax: .9, elevationMin: 50, elevationMax: 650, slopeMax: 30, density: .74, familyBias: { shrub: 1.28, meadowgrass: 1.18, sandstone: 1.08, driftwood: 1.04 }, preferredModes: ['ambient', 'shoreline'] }),
  profile('stormlands_rain_slope', 'stormlands', { moistureMin: .74, moistureMax: 1, elevationMin: 120, elevationMax: 1000, slopeMax: 46, density: .88, familyBias: { wetboulder: 1.42, fern: 1.28, broadleaf: 1.16, basalt: 1.06 }, preferredModes: ['ambient', 'geology'] }),
  profile('stormlands_rocky_coast', 'stormlands', { moistureMin: .52, moistureMax: .96, elevationMax: 460, slopeMax: 52, density: .54, familyBias: { basalt: 1.32, wetboulder: 1.38, driftwood: 1.24 }, preferredModes: ['shoreline', 'geology'] }),
  profile('stormlands_castle_edge', 'stormlands', { moistureMin: .58, moistureMax: .92, elevationMax: 360, slopeMax: 16, density: .44, familyBias: { meadowgrass: 1.08, timberfence: 1.12, waystone: 1.22, ruinwall: 1.1 }, preferredModes: ['settlementEdge', 'roadside'] }),
  profile('stormlands_river_gorge', 'stormlands', { moistureMin: .7, moistureMax: 1, elevationMin: 80, elevationMax: 720, slopeMax: 58, density: .46, familyBias: { basalt: 1.36, wetboulder: 1.48, fern: 1.14 }, preferredModes: ['geology', 'shoreline'] }),

  profile('dorne_desert_core', 'dorne', { moistureMin: 0, moistureMax: .28, elevationMax: 520, slopeMax: 30, density: .22, familyBias: { desertgrass: 1.72, sandstone: 1.44, ashrock: 1.2, driftwood: .5 }, avoidFamilies: ['broadleaf', 'birch', 'marshreed', 'snowpine'], preferredModes: ['ambient', 'geology'] }),
  profile('dorne_red_mesa', 'dorne', { moistureMin: .08, moistureMax: .34, elevationMin: 80, elevationMax: 900, slopeMax: 50, density: .28, familyBias: { sandstone: 1.68, desertgrass: 1.46, weatheredstone: 1.14, ashrock: 1.1 }, preferredModes: ['geology', 'ambient'] }),
  profile('dorne_oasis_edge', 'dorne', { moistureMin: .46, moistureMax: .86, elevationMax: 340, slopeMax: 12, density: .62, familyBias: { meadowgrass: 1.28, marshreed: 1.18, broadleaf: 1.16, wetboulder: 1.04 }, preferredModes: ['shoreline', 'ambient'] }),
  profile('dorne_scrub_hills', 'dorne', { moistureMin: .12, moistureMax: .46, elevationMin: 60, elevationMax: 780, slopeMax: 42, density: .48, familyBias: { shrub: 1.48, desertgrass: 1.34, sandstone: 1.18, limestone: 1.08 }, preferredModes: ['ambient', 'geology'] }),
  profile('dorne_coastal_shelf', 'dorne', { moistureMin: .28, moistureMax: .62, elevationMax: 300, slopeMax: 36, density: .36, familyBias: { sandstone: 1.42, driftwood: 1.3, shrub: 1.06, wetboulder: 1.0 }, preferredModes: ['shoreline', 'geology'] }),
  profile('dorne_road_dust', 'dorne', { moistureMin: .04, moistureMax: .32, elevationMax: 360, slopeMax: 16, density: .18, familyBias: { waystone: 1.38, sandstone: 1.24, desertgrass: 1.26 }, preferredModes: ['roadside'] }),
  profile('dorne_garden_edge', 'dorne', { moistureMin: .36, moistureMax: .76, elevationMax: 320, slopeMax: 14, density: .72, familyBias: { broadleaf: 1.18, meadowgrass: 1.26, shrub: 1.16, marketstall: 1.06 }, preferredModes: ['settlementEdge', 'ambient'] }),

  profile('iron_islands_wind_coast', 'iron-islands', { moistureMin: .5, moistureMax: 1, elevationMax: 420, slopeMax: 52, density: .34, familyBias: { basalt: 1.42, wetboulder: 1.46, driftwood: 1.52, weatheredstone: 1.08 }, preferredModes: ['shoreline', 'geology'] }),
  profile('iron_islands_rock_slope', 'iron-islands', { moistureMin: .34, moistureMax: .82, elevationMin: 80, elevationMax: 800, slopeMax: 60, density: .3, familyBias: { basalt: 1.54, wetboulder: 1.28, shrub: .9 }, preferredModes: ['geology'] }),
  profile('iron_islands_moor', 'iron-islands', { moistureMin: .58, moistureMax: 1, elevationMax: 620, slopeMax: 34, density: .42, familyBias: { shrub: 1.3, meadowgrass: 1.18, driftwood: .96, wetboulder: 1.14 }, preferredModes: ['ambient'] }),
  profile('iron_islands_harbor_edge', 'iron-islands', { moistureMin: .74, moistureMax: 1, elevationMax: 140, slopeMax: 12, density: .26, familyBias: { dock: 1.5, driftwood: 1.32, wetboulder: 1.1, timberfence: 1.18 }, preferredModes: ['shoreline', 'settlementEdge'] }),
  profile('iron_islands_stone_road', 'iron-islands', { moistureMin: .42, moistureMax: .9, elevationMax: 360, slopeMax: 18, density: .2, familyBias: { waystone: 1.28, weatheredstone: 1.2, shrub: .98 }, preferredModes: ['roadside'] }),

  profile('frost_pass', 'mountain', { moistureMin: .16, moistureMax: .58, elevationMin: 900, elevationMax: 2800, slopeMax: 60, density: .22, familyBias: { granite: 1.42, froststone: 1.48, snowpine: 1.16, cairn: 1.32 }, preferredModes: ['geology', 'roadside'], seasonality: { winter: 1.35 } }),
  profile('mountain_alpine_meadow', 'mountain', { moistureMin: .36, moistureMax: .76, elevationMin: 800, elevationMax: 1900, slopeMax: 48, density: .56, familyBias: { meadowgrass: 1.26, shrub: 1.14, granite: 1.2, cairn: 1.06 }, preferredModes: ['ambient', 'geology'] }),
  profile('mountain_granite_ridge', 'mountain', { moistureMin: .18, moistureMax: .6, elevationMin: 700, elevationMax: 3000, slopeMax: 66, density: .2, familyBias: { granite: 1.72, froststone: 1.18, snowpine: .86 }, preferredModes: ['geology'] }),
  profile('mountain_snow_pocket', 'mountain', { moistureMin: .24, moistureMax: .72, elevationMin: 1300, elevationMax: 3200, slopeMax: 58, density: .18, familyBias: { froststone: 1.66, snowpine: 1.48, cairn: 1.24 }, preferredModes: ['geology', 'ambient'], seasonality: { winter: 1.5 } }),
  profile('mountain_boulder_valley', 'mountain', { moistureMin: .5, moistureMax: .88, elevationMin: 400, elevationMax: 1500, slopeMax: 50, density: .64, familyBias: { granite: 1.36, wetboulder: 1.32, pine: 1.08, fern: 1.02 }, preferredModes: ['geology', 'ambient'] }),
  profile('mountain_river_cut', 'mountain', { moistureMin: .68, moistureMax: 1, elevationMin: 100, elevationMax: 1400, slopeMax: 54, density: .5, familyBias: { wetboulder: 1.52, granite: 1.28, marshreed: 1.14 }, preferredModes: ['shoreline', 'geology'] }),

  profile('volcanic_basalt_field', 'volcanic', { moistureMin: .08, moistureMax: .58, elevationMin: 0, elevationMax: 1500, slopeMax: 54, density: .3, familyBias: { basalt: 1.76, ashrock: 1.54, shrub: .9, desertgrass: .84 }, preferredModes: ['geology', 'ambient'] }),
  profile('volcanic_ash_slope', 'volcanic', { moistureMin: .02, moistureMax: .42, elevationMin: 80, elevationMax: 2200, slopeMax: 60, density: .2, familyBias: { ashrock: 1.82, basalt: 1.36, sandstone: .76 }, preferredModes: ['geology'] }),
  profile('volcanic_wet_crater', 'volcanic', { moistureMin: .62, moistureMax: 1, elevationMax: 900, slopeMax: 42, density: .46, familyBias: { basalt: 1.48, wetboulder: 1.3, fern: 1.08, marshreed: 1.06 }, preferredModes: ['geology', 'shoreline'] }),
  profile('volcanic_black_sand_coast', 'volcanic', { moistureMin: .42, moistureMax: .88, elevationMax: 280, slopeMax: 36, density: .34, familyBias: { basalt: 1.54, driftwood: 1.22, wetboulder: 1.2, ashrock: 1.18 }, preferredModes: ['shoreline', 'geology'] }),
  profile('volcanic_stone_road', 'volcanic', { moistureMin: .1, moistureMax: .58, elevationMax: 700, slopeMax: 20, density: .24, familyBias: { basalt: 1.34, waystone: 1.28, ashrock: 1.1 }, preferredModes: ['roadside', 'geology'] }),

  profile('ruined_lowland', 'ruin', { moistureMin: .32, moistureMax: .78, elevationMax: 600, slopeMax: 24, density: .38, familyBias: { ruinwall: 1.58, weatheredstone: 1.34, fern: 1.14, shrub: 1.1 }, preferredModes: ['settlementEdge', 'geology'] }),
  profile('ruined_hillfort', 'ruin', { moistureMin: .28, moistureMax: .68, elevationMin: 100, elevationMax: 820, slopeMax: 36, density: .32, familyBias: { ruinwall: 1.72, weatheredstone: 1.48, shrub: 1.14, cairn: .92 }, preferredModes: ['settlementEdge', 'geology'] }),
  profile('ruined_coast', 'ruin', { moistureMin: .46, moistureMax: .92, elevationMax: 380, slopeMax: 44, density: .3, familyBias: { ruinwall: 1.46, wetboulder: 1.28, driftwood: 1.2, weatheredstone: 1.32 }, preferredModes: ['shoreline', 'settlementEdge'] }),
  profile('ruined_forest', 'ruin', { moistureMin: .46, moistureMax: .9, elevationMax: 720, slopeMax: 34, density: .54, familyBias: { broadleaf: 1.16, fern: 1.3, ruinwall: 1.42, weatheredstone: 1.24 }, preferredModes: ['ambient', 'settlementEdge'] }),
  profile('ruined_mountain_pass', 'ruin', { moistureMin: .2, moistureMax: .58, elevationMin: 700, elevationMax: 2300, slopeMax: 58, density: .2, familyBias: { ruinwall: 1.5, granite: 1.32, froststone: 1.12, waystone: 1.18 }, preferredModes: ['geology', 'roadside'] }),

  profile('settlement_market_edge', 'settlement', { moistureMin: .2, moistureMax: .8, elevationMax: 500, slopeMax: 10, density: .34, familyBias: { marketstall: 1.62, timberfence: 1.46, waystone: 1.22, meadowgrass: .72 }, preferredModes: ['settlementEdge'] }),
  profile('settlement_farm_edge', 'settlement', { moistureMin: .32, moistureMax: .8, elevationMax: 420, slopeMax: 12, density: .66, familyBias: { timberfence: 1.58, meadowgrass: 1.34, broadleaf: 1.0, watermill: .86 }, preferredModes: ['settlementEdge', 'ambient'] }),
  profile('settlement_harbor_edge', 'settlement', { moistureMin: .58, moistureMax: 1, elevationMax: 160, slopeMax: 10, density: .32, familyBias: { dock: 1.72, driftwood: 1.28, timberfence: 1.34, wetboulder: 1.04 }, preferredModes: ['settlementEdge', 'shoreline'] }),
  profile('settlement_walled_edge', 'settlement', { moistureMin: .18, moistureMax: .72, elevationMax: 480, slopeMax: 12, density: .3, familyBias: { weatheredstone: 1.34, waystone: 1.28, timberfence: 1.24, ruinwall: 1.08 }, preferredModes: ['settlementEdge', 'roadside'] }),
  profile('settlement_garden_edge', 'settlement', { moistureMin: .48, moistureMax: .9, elevationMax: 380, slopeMax: 10, density: .62, familyBias: { broadleaf: 1.3, meadowgrass: 1.28, shrub: 1.18, fern: 1.12 }, preferredModes: ['settlementEdge', 'ambient'] }),
  profile('settlement_ruin_edge', 'settlement', { moistureMin: .36, moistureMax: .84, elevationMax: 620, slopeMax: 18, density: .42, familyBias: { ruinwall: 1.56, weatheredstone: 1.34, shrub: 1.18, fern: 1.12 }, preferredModes: ['settlementEdge', 'geology'] }),
]);

export const GEOGRAPHIC_REGION_PROFILE_BY_ID = Object.freeze(
  Object.fromEntries(GEOGRAPHIC_REGION_PROFILES.map((item) => [item.id, item])),
);

export function getGeographicRegionProfile(id) {
  return GEOGRAPHIC_REGION_PROFILE_BY_ID[String(id || '')] || null;
}

export function listGeographicRegionProfiles(parent = null) {
  if (!parent) return GEOGRAPHIC_REGION_PROFILES.slice();
  return GEOGRAPHIC_REGION_PROFILES.filter((item) => item.parent === String(parent));
}

export function mergeRegionProfile(baseProfile, overlayProfile = null) {
  if (!baseProfile && !overlayProfile) return null;
  const base = baseProfile || profile('anonymous', 'anonymous');
  const overlay = overlayProfile || {};
  return Object.freeze({
    ...base,
    ...overlay,
    familyBias: Object.freeze({ ...(base.familyBias || {}), ...(overlay.familyBias || {}) }),
    avoidFamilies: Object.freeze([...(base.avoidFamilies || []), ...(overlay.avoidFamilies || [])]),
    preferredModes: Object.freeze([...(overlay.preferredModes || base.preferredModes || [])]),
    seasonality: Object.freeze({ ...(base.seasonality || {}), ...(overlay.seasonality || {}) }),
  });
}

export function scoreRegionProfile(profileValue, surface = {}, mode = 'ambient') {
  if (!profileValue) return { score: 0, reasons: ['missing-profile'] };
  const moisture = Number(surface.moisture ?? 0);
  const elevation = Number(surface.elevationMeters ?? 0);
  const slope = Number(surface.slopeDegrees ?? 0);
  const modeBonus = profileValue.preferredModes.includes(mode) ? .16 : 0;
  const moistureFit = moisture >= profileValue.moistureMin && moisture <= profileValue.moistureMax ? .34 : -.34;
  const elevationFit = elevation >= profileValue.elevationMin && elevation <= profileValue.elevationMax ? .28 : -.28;
  const slopeFit = slope <= profileValue.slopeMax ? .18 : -.28;
  return {
    score: Math.max(0, Math.min(1, .04 + modeBonus + moistureFit + elevationFit + slopeFit)),
    reasons: [
      modeBonus ? 'mode-match' : 'mode-mismatch',
      moistureFit > 0 ? 'moisture-match' : 'moisture-mismatch',
      elevationFit > 0 ? 'elevation-match' : 'elevation-mismatch',
      slopeFit > 0 ? 'slope-match' : 'slope-mismatch',
    ],
  };
}

export function validateGeographicRegionProfiles() {
  const errors = [];
  const ids = new Set();
  for (const item of GEOGRAPHIC_REGION_PROFILES) {
    if (!item.id) errors.push('missing-id');
    if (ids.has(item.id)) errors.push(`duplicate-id:${item.id}`);
    ids.add(item.id);
    if (item.moistureMin > item.moistureMax) errors.push(`moisture-range:${item.id}`);
    if (item.elevationMin > item.elevationMax) errors.push(`elevation-range:${item.id}`);
    if (item.slopeMax < 0) errors.push(`slope:${item.id}`);
    if (item.density < 0) errors.push(`density:${item.id}`);
    for (const family of item.avoidFamilies) if (item.familyBias[family] !== undefined && item.familyBias[family] > 0) errors.push(`avoid-biased:${item.id}:${family}`);
  }
  return Object.freeze({ ok: errors.length === 0, count: GEOGRAPHIC_REGION_PROFILES.length, errors });
}

export const __TEST__ = Object.freeze({ profile, GEOGRAPHIC_REGION_PROFILES, GEOGRAPHIC_REGION_PROFILE_BY_ID });
