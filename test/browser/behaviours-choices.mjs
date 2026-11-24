// The questions with choices from behaviours.mjs (thread.ts, trial.ts), run apart so the two halves run side by side
// in CI; behaviours.mjs is the page's own behaviours and saves.
process.env.BEHAVIOURS_PART = 'choices';
await import('./behaviours.mjs');
