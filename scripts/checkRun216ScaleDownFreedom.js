import fs from 'node:fs';

const controller = fs.readFileSync('src/3d/editor/EditorTransformControls.js', 'utf8');
const vendor = fs.readFileSync('src/3d/vendor/three/addons/controls/TransformControls.js', 'utf8');

const legacyScaleSnap = "transform.setScaleSnap(enabled ? SCALE_SNAP : null);";
const freeScaleOverride = "transform.setScaleSnap(null);";
const translationSnap = "transform.setTranslationSnap(enabled ? Math.max(0.1, state.snapSize) : null);";
const rotationSnap = "transform.setRotationSnap(enabled ? ROTATE_SNAP : null);";
const vendorFloor = "Math.round( object.scale.x / this.scaleSnap ) * this.scaleSnap || this.scaleSnap";

if (!controller.includes(translationSnap)) throw new Error('translation snap contract missing');
if (!controller.includes(rotationSnap)) throw new Error('rotation snap contract missing');
if (!controller.includes(legacyScaleSnap)) throw new Error('legacy scale snap line missing; review contract');
if (!controller.includes(freeScaleOverride)) throw new Error('free-scale override missing');
if (controller.indexOf(freeScaleOverride) < controller.indexOf(legacyScaleSnap)) throw new Error('free-scale override must run after legacy scale snap');
if (!vendor.includes(vendorFloor)) throw new Error('Three.js r160 scale-snap floor behavior changed; review policy');

console.log('PASS Run216 scale-down freedom: translation/rotation snap retained, scale snap disabled after legacy assignment.');
