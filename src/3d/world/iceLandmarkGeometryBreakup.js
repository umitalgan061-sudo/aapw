function hash2D(x, y, seed) {
	let value = Math.imul((x | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((y | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function refreshGeometry(geometry) {
	const position = geometry?.getAttribute?.('position');
	if (!position) return false;
	position.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return true;
}

function fractureWall(group, sections, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	const position = wall?.geometry?.getAttribute?.('position');
	if (!position) return 0;
	let moved = 0;
	for (let index = 0; index < sections.length; index += 1) {
		const section = sections[index];
		const base = section.baseVertex;
		const macro = hash2D(index, 7, seed + 6101) - 0.5;
		const shear = hash2D(index, 11, seed + 6203) - 0.5;
		const frontTop = base + 1;
		const backTop = base + 3;
		const frontBase = base;
		const backBase = base + 2;
		const crownOffset = macro * 9.0;
		const baseOffset = shear * 2.8;
		for (const [vertex, normalSign, amount] of [
			[frontTop, 1, crownOffset],
			[backTop, -1, crownOffset * 0.72],
			[frontBase, 1, baseOffset],
			[backBase, -1, baseOffset * 0.65],
		]) {
			position.setX(vertex, position.getX(vertex) + section.nx * amount * normalSign + section.tx * shear * 1.7);
			position.setZ(vertex, position.getZ(vertex) + section.nz * amount * normalSign + section.tz * shear * 1.7);
			moved += 1;
		}
		position.setY(frontTop, position.getY(frontTop) + (hash2D(index, 17, seed + 6301) - 0.5) * 6.5);
		position.setY(backTop, position.getY(backTop) + (hash2D(index, 19, seed + 6401) - 0.5) * 5.0);
	}
	refreshGeometry(wall.geometry);
	wall.userData.primaryGlacialBreakup = true;
	return moved;
}

function fractureCave(group, portal, rings, seed) {
	const cave = group.getObjectByName('ice-cave-shell');
	const position = cave?.geometry?.getAttribute?.('position');
	if (!position || !rings.length) return 0;
	const ringStride = Math.round(position.count / rings.length);
	let moved = 0;
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		const ring = rings[ringIndex];
		for (let step = 0; step < ringStride; step += 1) {
			const vertex = ringIndex * ringStride + step;
			const edgeRatio = Math.abs(step / Math.max(1, ringStride - 1) - 0.5) * 2;
			const warp = (hash2D(ringIndex * 37 + step, 23, seed + 6503) - 0.5) * (0.8 + edgeRatio * 0.9);
			const lift = (hash2D(ringIndex * 41 + step, 29, seed + 6607) - 0.5) * (0.55 + (1 - edgeRatio) * 1.15);
			position.setX(vertex, position.getX(vertex) + portal.tx * warp);
			position.setZ(vertex, position.getZ(vertex) + portal.tz * warp);
			position.setY(vertex, position.getY(vertex) + lift);
			moved += 1;
		}
	}
	refreshGeometry(cave.geometry);
	cave.userData.primaryGlacialBreakup = true;
	return moved;
}

export function applyIceLandmarkGeometryBreakup({ group, wallSections, portal, caveRings, seed }) {
	const wallVertexMoves = fractureWall(group, wallSections, seed);
	const caveVertexMoves = fractureCave(group, portal, caveRings, seed);
	return Object.freeze({
		wallVertexMoves,
		caveVertexMoves,
		primaryMeshesFractured: wallVertexMoves > 0 && caveVertexMoves > 0,
	});
}
