/**
 * Buzul Muhafızı — scene-facing photorealism bridge.
 *
 * Applies an already-built photorealism frame to renderer-owned targets without
 * creating a second terrain/material/placement authority. The bridge is pure,
 * DOM-free and safe to call once per frame or on quality/context changes.
 */
import type { PhotorealismFrame } from './photorealismDirector.ts';

export type SceneBridgeTargets = Readonly<{
  fog?: { density?: number; color?: unknown };
  renderer?: { toneMappingExposure?: number };
  sun?: { intensity?: number };
  moon?: { intensity?: number };
  material?: {
    color?: { setRGB?: (r: number, g: number, b: number) => void };
    roughness?: number;
    metalness?: number;
    normalScale?: { set?: (x: number, y: number) => void };
    aoMapIntensity?: number;
    clearcoat?: number;
    transmission?: number;
    userData?: Record<string, unknown>;
  };
}>;

export type SceneBridgeReceipt = Readonly<{
  applied: readonly string[];
  skipped: readonly string[];
  deterministicKey: string;
}>;

const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

export function applyPhotorealismFrameToScene(
  frame: PhotorealismFrame,
  targets: SceneBridgeTargets,
): SceneBridgeReceipt {
  const applied: string[] = [];
  const skipped: string[] = [];
  const apply = (name: string, fn: (() => void) | undefined): void => {
    if (!fn) { skipped.push(name); return; }
    fn();
    applied.push(name);
  };

  apply('fog-density', targets.fog && (() => { targets.fog!.density = frame.atmosphere.fogDensity; }));
  apply('renderer-exposure', targets.renderer && (() => { targets.renderer!.toneMappingExposure = frame.atmosphere.exposure; }));
  apply('sun-energy', targets.sun && (() => { targets.sun!.intensity = frame.atmosphere.sunEnergy; }));
  apply('moon-energy', targets.moon && (() => { targets.moon!.intensity = frame.atmosphere.moonEnergy; }));
  apply('material-color', targets.material?.color?.setRGB && (() => {
    targets.material!.color!.setRGB!(frame.pbr.albedo[0], frame.pbr.albedo[1], frame.pbr.albedo[2]);
  }));
  apply('material-roughness', targets.material && (() => { targets.material!.roughness = frame.pbr.roughness; }));
  apply('material-metalness', targets.material && (() => { targets.material!.metalness = frame.pbr.metalness; }));
  apply('material-normal-scale', targets.material?.normalScale?.set && (() => {
    const scale = finite(frame.pbr.normalStrength, 1);
    targets.material!.normalScale!.set!(scale, scale);
  }));
  apply('material-ao', targets.material && (() => { targets.material!.aoMapIntensity = frame.pbr.ao; }));
  apply('material-clearcoat', targets.material && (() => { targets.material!.clearcoat = frame.pbr.clearcoat; }));
  apply('material-transmission', targets.material && (() => { targets.material!.transmission = frame.pbr.transmission; }));
  apply('material-provenance', targets.material && (() => {
    const userData = targets.material!.userData ?? {};
    targets.material!.userData = {
      ...userData,
      photorealism: Object.freeze({
        deterministicKey: frame.manifest.deterministicKey,
        macroMeters: frame.antiTiling.macroMeters,
        microMeters: frame.antiTiling.microMeters,
        triplanarBlend: frame.antiTiling.triplanarBlend,
        sourceAuthority: frame.manifest.sourceAuthority,
        materialAuthority: frame.manifest.materialAuthority,
        placementAuthority: frame.manifest.placementAuthority,
      }),
    };
  }));

  return Object.freeze({
    applied: Object.freeze(applied),
    skipped: Object.freeze(skipped),
    deterministicKey: frame.manifest.deterministicKey,
  });
}

export function sceneBridgeIsSafe(receipt: SceneBridgeReceipt): boolean {
  return receipt.deterministicKey.length > 0
    && !receipt.applied.includes('material-provenance') === false;
}
