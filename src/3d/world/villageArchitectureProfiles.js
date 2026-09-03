const PROFILE_ASSETS = Object.freeze({
	north: ['assets/models/settlements/log_cabin_et0OmFeZVkb.glb', 'assets/models/settlements/cabin_shed_HTx7PZt6Zm.glb'],
	fertile: ['assets/models/settlements/fantasy_house_dcPho4SUA3.glb', 'assets/models/settlements/small_wooden_house.glb'],
	maritime: ['assets/models/settlements/cabin_shed_HTx7PZt6Zm.glb', 'assets/models/settlements/log_cabin_et0OmFeZVkb.glb'],
	arid: ['assets/models/settlements/house_fdaqERLQCc.glb', 'assets/models/settlements/house_roqiHdrpgc.glb'],
	mountain: ['assets/models/settlements/medium_house_4hI5fNvl6z.glb', 'assets/models/settlements/log_cabin_et0OmFeZVkb.glb'],
	temperate: ['assets/models/settlements/small_wooden_house.glb', 'assets/models/settlements/fantasy_house_dcPho4SUA3.glb'],
	volcanic: ['assets/models/settlements/house_roqiHdrpgc.glb', 'assets/models/settlements/medium_house_4hI5fNvl6z.glb'],
});

function profile(id, label, paletteId, proceduralWallHex, proceduralRoofHex, layers) {
	const [assetUrl, secondaryAssetUrl] = PROFILE_ASSETS[id];
	return Object.freeze({ id, label, paletteId, proceduralWallHex, proceduralRoofHex, assetUrl, secondaryAssetUrl, layers: Object.freeze(layers) });
}

export const VILLAGE_ARCHITECTURE_PROFILES = Object.freeze({
	north: profile('north', 'Kuzey ahşap yerleşimi', 'house', 0xb8b6ae, 0x59636d, [{ to: 0.16, palette: 'stone' }, { to: 0.72, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	fertile: profile('fertile', 'Verimli ova yerleşimi', 'house', 0xe2d3af, 0xa9874d, [{ to: 0.12, palette: 'stone' }, { to: 0.62, palette: 'plaster' }, { to: 0.7, palette: 'wood' }, { to: 1, palette: 'thatch' }]),
	maritime: profile('maritime', 'Rüzgârlı kıyı yerleşimi', 'house', 0xaeb8b8, 0x68757c, [{ to: 0.16, palette: 'rock' }, { to: 0.64, palette: 'house' }, { to: 0.72, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	arid: profile('arid', 'Kurak güney yerleşimi', 'house', 0xe0c39b, 0xb67852, [{ to: 0.18, palette: 'stone' }, { to: 0.72, palette: 'plaster' }, { to: 0.79, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	mountain: profile('mountain', 'Dağ eteği yerleşimi', 'brick', 0xaaa59d, 0x515b61, [{ to: 0.2, palette: 'rock' }, { to: 0.74, palette: 'brick' }, { to: 0.82, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	temperate: profile('temperate', 'Ilıman kır yerleşimi', 'house', 0xd1c3a7, 0x846849, [{ to: 0.12, palette: 'stone' }, { to: 0.62, palette: 'house' }, { to: 0.7, palette: 'wood' }, { to: 1, palette: 'thatch' }]),
	volcanic: profile('volcanic', 'Volkanik taş yerleşimi', 'brick', 0x7f7770, 0x3f4146, [{ to: 0.2, palette: 'rock' }, { to: 0.72, palette: 'brick' }, { to: 0.8, palette: 'iron' }, { to: 1, palette: 'roof-tile' }]),
});

const SEAT_ARCHITECTURE_REGION = Object.freeze({
	berkalp: 'north', jon: 'north', 'Night King': 'north', ziya: 'fertile', berk: 'fertile', olena: 'fertile',
	balon: 'maritime', stannis: 'maritime', doran: 'arid', Xaro: 'arid', robin: 'mountain', twin: 'temperate',
	cersei: 'temperate', umit: 'volcanic',
});

export function resolveVillageArchitectureProfile(seatId) {
	const regionId = SEAT_ARCHITECTURE_REGION[String(seatId ?? '')];
	return regionId ? VILLAGE_ARCHITECTURE_PROFILES[regionId] : null;
}

export function resolveVillageArchitectureAssetUrl(profileData, site) {
	return (site?.assetIndex ?? 0) > 0 ? (profileData.secondaryAssetUrl || profileData.assetUrl) : profileData.assetUrl;
}
