// Where the section bar sits, from sections.mjs, run apart so the two halves run side by side in CI.
process.env.SECTIONS_PART = 'b';
await import('./sections.mjs');
