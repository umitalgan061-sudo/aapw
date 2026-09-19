// Browser/legacy ESM entry point. The implementation lives in TypeScript so modern runtime code stays typed,
// while existing .js scene modules can consume it without importing a raw .ts URL.
export {
  ensureRendererRegistry,
  registerRenderer,
  getRegisteredRenderer,
  clearRegisteredRenderer,
  rendererRegistryDiagnostics,
} from './rendererRegistry.ts';
