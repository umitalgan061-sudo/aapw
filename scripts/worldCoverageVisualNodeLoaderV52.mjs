/**
 * Node-only resolver for the browser's `three` import-map target.
 * Production/browser resolution remains the existing game3d.html import map; this loader only lets
 * repository-side visual regressions execute the same vendored Three.js module in Node without
 * introducing a package-manager dependency.
 */

const THREE_ROOT = new URL('../src/3d/vendor/three/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return {
      url: new URL('three.module.js', THREE_ROOT).href,
      shortCircuit: true,
    };
  }
  if (specifier.startsWith('three/addons/')) {
    return {
      url: new URL(specifier.slice('three/addons/'.length), new URL('addons/', THREE_ROOT)).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
