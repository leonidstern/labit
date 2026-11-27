// Loaded before every test file (npm test): labs started by tests keep their registry and update check
// in a throwaway folder, never in the person's ~/.labit, and never ask npm for the latest version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The folders this process makes go when it ends; the test files it runs inherit them and leave them alone.
const own = [];
const made = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  own.push(d);
  return d;
};
process.on('exit', () => own.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
// The runner makes one home and its test files reuse it (LABIT_TEST_RUN_HOME marks it as the run's own). A LABIT_HOME set
// outside the run is never used: it may be the person's real one. LABIT_TEST_HOME picks a folder on purpose.
const run = process.env.LABIT_TEST_RUN_HOME;
process.env.LABIT_HOME = process.env.LABIT_TEST_HOME || (run && process.env.LABIT_HOME === run ? run : made('labit-test-home-'));
process.env.LABIT_TEST_RUN_HOME = process.env.LABIT_HOME;
process.env.LABIT_NO_UPDATE_CHECK = '1';
// Settings (lib/settings.ts) too: a run never reads or writes the person's own ~/.config/labit/settings.json.
process.env.XDG_CONFIG_HOME = made('labit-test-config-');
// Every lab a test starts ends with the test file that started it, also when the file fails or is stopped before its
// own cleanup (local.mjs watches its parent).
process.env.LABIT_EXIT_WITH_PARENT = '1';
