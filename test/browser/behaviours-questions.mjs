// Words that look like HTML, a quote over two blocks, hints, touches and a question in the chat, from behaviours.mjs,
// run apart so its parts run side by side in CI.
process.env.BEHAVIOURS_PART = 'questions';
await import('./behaviours.mjs');
