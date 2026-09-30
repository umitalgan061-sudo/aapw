/** Compatibility launcher: production strategy application lives in script.ts. */
import('./script.ts').catch((error) => {
  console.error('[Westeros] TypeScript strategy application failed to load:', error);
});
