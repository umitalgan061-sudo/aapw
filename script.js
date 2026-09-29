/** Compatibility boundary: production strategy application lives in script.ts. */
(async () => {
  try {
    await import('./script.ts');
  } catch (error) {
    console.error('[Westeros] TypeScript application bootstrap failed:', error);
  }
})();
