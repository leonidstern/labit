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

/** Keeps a file labit made in a repository out of `git add` on this computer only (.git/info/exclude, never shared).
 * Returns what happened: 'excluded', 'tracked' (it is in git already, so the change shows in `git status`), or ''. */
export function keepOutOfGit(file: string): '' | 'excluded' | 'tracked' {
  const dir = path.dirname(file);
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return '';
  const rel = path.relative(fs.realpathSync(top), fs.realpathSync(file)).split(path.sep).join('/');
  if (git(top, ['ls-files', '--error-unmatch', rel]) !== null) return 'tracked';
  if (git(top, ['check-ignore', '-q', rel]) !== null) return '';
  const exclude = git(top, ['rev-parse', '--git-path', 'info/exclude']);
  if (!exclude) return '';
  const at = path.resolve(top, exclude);
  try {
    const had = fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : '';
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, `${had}${had && !had.endsWith('\n') ? '\n' : ''}/${rel}\n`);
    return 'excluded';
  } catch {
    return '';
  }
}
