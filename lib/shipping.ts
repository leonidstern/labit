// What labit leaves in a project that could leave the computer with it. .lab/ is kept out of git by its own .gitignore
// ("*"), but git is not the only way out: a folder that is built output (dist, build, out…) gets deployed as it is,
// and a framework's public/ or static/ folder is copied into every build, dot folders included (Vite, Astro, Next).
// A lab serving such a folder puts its .lab (comments, pictures, the lab's key) where the next deploy takes it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Folders whose files are the site as it ships: built output, or copied into the build as they are.
const OUTPUT = new Set(['dist', 'build', 'out', '_site', 'www', '.output', '.next', '.vercel', '.netlify']);
const COPIED = new Set(['public', 'static']);

const git = (cwd: string, args: string[]): string | null => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch {
    return null;
  }
};

/** Why `root`'s .lab could ship with the site ('' when it can't): a sentence for the lab's start lines. */
export function shipsWithSite(root: string): string {
  const name = path.basename(root);
  const parent = path.dirname(root);
  const project = (dir: string) => fs.existsSync(path.join(dir, 'package.json'));
  if (COPIED.has(name) && project(parent)) return `${name}/ is copied into your app's build, dot folders too`;
  if (OUTPUT.has(name)) return `${name}/ looks like built output, which gets deployed as it is`;
  // Any other folder git ignores, inside a repository that has the folder above it: most often built output too.
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top && fs.realpathSync(top) !== root && git(parent, ['check-ignore', '-q', root]) !== null) return `${name}/ is ignored by git, as built output usually is`;
  return '';
}
