/** World Editor independent FBX-pack transform regression (run 344, ADR-0292). */
const NAV_TIMEOUT_MS = 30_000;

async function checkEditorFbxPackTransforms(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const browserErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
	page.on('pageerror', (error) => browserErrors.push(String(error)));
	let result;
	try {
		await page.goto(`${baseUrl}/editor.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		await page.waitForFunction(
			() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_TRANSFORM__ && window.__WESTEROS_EDITOR_FBX_PACKS__,
			null,
			{ timeout: NAV_TIMEOUT_MS },
		);
		await page.evaluate(async () => {
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const api = window.__WESTEROS_WORLD_EDITOR__;
			const root = new THREE.Group();
			root.name = 'Run344 FBX Pack Smoke';
			root.userData.editorId = 'run344-fbx-smoke-root';
			root.userData.editorAssetId = 'peasant-girl';
			root.userData.editorFormat = 'fbx';
			root.position.set(0, 5, 0);
			for (const [name, x] of [['Pack A', -4], ['Pack B', 4]]) {
				const group = new THREE.Group();
				group.name = name;
				group.position.x = x;
				const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial());
				mesh.userData.editorRoot = root;
				group.add(mesh);
				root.add(group);
			}
			const bone = new THREE.Bone();
			bone.name = 'Rig Bone';
			bone.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
			root.add(bone);
			const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
			skinned.name = 'Skinned Body';
			root.add(skinned);
			api.editableObjects.push(root);
			api.scene.add(root);
			api.refreshHierarchy();
		});
		await page.locator('#we-hierarchy .we-hierarchy-item', { hasText: 'Run344 FBX Pack Smoke' }).click();
		await page.waitForFunction(() => window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().candidateCount === 2);
		result = await page.evaluate(async () => {
			const api = window.__WESTEROS_WORLD_EDITOR__;
			const packs = window.__WESTEROS_EDITOR_FBX_PACKS__;
			const transform = window.__WESTEROS_EDITOR_TRANSFORM__;
			const root = api.getSelectedObject();
			const candidates = packs.listPacks();
			const staticOnly = candidates.length === 2
				&& candidates.map((entry) => entry.name).sort().join('|') === 'Pack A|Pack B';
			const packB = candidates.find((entry) => entry.name === 'Pack B');
			const selected = Boolean(packB && packs.selectPack(packB.path));
			const snap = document.getElementById('we-snap-toggle');
			snap.checked = false;
			snap.dispatchEvent(new Event('change', { bubbles: true }));
			for (const [id, value] of [['we-pos-x', '7.25'], ['we-rot-y', '-37.5'], ['we-scale-x', '0.007']]) {
				const input = document.getElementById(id);
				input.value = value;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
			const beforeGuardCount = api.editableObjects.length;
			const beforeGuardScale = root.scale.toArray();
			document.getElementById('we-duplicate')?.click();
			document.getElementById('we-delete')?.click();
			document.getElementById('we-quick-shrink')?.click();
			const guardPreservedRoot = api.editableObjects.length === beforeGuardCount
				&& JSON.stringify(root.scale.toArray()) === JSON.stringify(beforeGuardScale);
			const siblingPreserved = root.children[0].position.x === -4;
			const rootPreserved = JSON.stringify(root.position.toArray()) === JSON.stringify([0, 5, 0])
				&& JSON.stringify(root.scale.toArray()) === JSON.stringify([1, 1, 1]);
			const rigPreserved = root.children[2].isBone && root.children[2].position.length() === 0;
			const packTransformApplied = Math.abs(root.children[1].position.x - 7.25) < 1e-9
				&& Math.abs(root.children[1].rotation.y - (-37.5 * Math.PI / 180)) < 1e-9
				&& Math.abs(root.children[1].scale.x - 0.007) < 1e-9;
			const childOwnsGizmo = packs.getSnapshot().transformAttachedToPack
				&& transform.getSnapshot().attachedEditorId === null;
			const { serializeEditorScene } = await import('/src/3d/editor/EditorSceneSerializer.js');
			const saved = serializeEditorScene([root], [], api.getEditorState());
			const record = saved.objects.find((object) => object.id === root.userData.editorId);
			const serialized = record?.fbxPacks?.length === 1
				&& record.fbxPacks[0].path === packB.path
				&& record.fbxPacks[0].transform.position[0] === 7.25
				&& record.fbxPacks[0].transform.scale[0] === 0.007
				&& record.fbxPacks[0].transform.rotation[1] === Number((-37.5 * Math.PI / 180).toFixed(6));
			root.children[1].position.x = 99;
			root.children[1].scale.x = 2;
			const restore = packs.applySceneOverrides(saved);
			const restored = restore.applied === 1 && restore.missing === 0
				&& Math.abs(root.children[1].position.x - 7.25) < 1e-9
				&& Math.abs(root.children[1].scale.x - 0.007) < 1e-9;
			packs.clearSelection(true);
			const rootOwnershipRestored = packs.getSnapshot().activePackPath === null
				&& transform.getSnapshot().attachedEditorId === root.userData.editorId;
			return {
				staticOnly, selected, rootPreserved, siblingPreserved, rigPreserved,
				packTransformApplied, childOwnsGizmo, guardPreservedRoot, serialized,
				restored, rootOwnershipRestored,
			};
		});
	} finally {
		await page.close();
	}
	result.zeroConsoleErrors = browserErrors.length === 0;
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'World Editor independent FBX pack transforms',
		ok,
		details: ok
			? 'two static packs discovered while bone/skinned branches stay root-owned; child Inspector '
				+ 'position/rotation/0.007 scale leave root+sibling untouched; child owns gizmo; root '
				+ 'duplicate/delete/quick-shrink stay guarded; deterministic fbxPacks scene-v1 serialization '
				+ 'round-trips; root TransformControls ownership restores; zero console/page errors'
			: `FAILED assertion(s): ${JSON.stringify(result)}; browser errors=${JSON.stringify(browserErrors)}`,
	};
}

module.exports = { checkEditorFbxPackTransforms };
