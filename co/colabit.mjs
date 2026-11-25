// The people in your colabit, as ooze labs have them: <lab>/<name>/… shows <name>'s site, with comments on it.
//   node co/colabit.mjs add <name> <site url> [--lab https://lab.example.com] [--deploy]
//   node co/colabit.mjs remove <name> [--deploy]
//   node co/colabit.mjs list
//   node co/colabit.mjs deploy
// Each person is a pair of rewrites in co/vercel.json. --deploy (or deploy) is the fast way: it commits the change and
// deploys the co folder straight from here with the Vercel CLI, live in seconds (push to git whenever you like, for
// history). Without it: commit and push, and Vercel deploys from git.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const file = path.join(here, 'vercel.json');
const deploy = process.argv.includes('--deploy') || process.argv[2] === 'deploy';
const NAME = /^[a-z0-9][a-z0-9-]{0,29}$/; // the first part of a page's path, as the comments API takes it
const OWN = /^\/_lab\//; // the colabit's own routes, never a person's

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (config) => fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
const people = (config) => {
  const out = new Map();
  for (const r of config.rewrites || []) {
    const name = /^\/([a-z0-9][a-z0-9-]*)$/.exec(r.source)?.[1];
    if (name) out.set(name, r.destination.replace(new RegExp(`/${name}$`), ''));
  }
  return out;
};

const [action, name, site] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--lab');
const lab = (() => {
  const i = process.argv.indexOf('--lab');
  return i > 0 ? process.argv[i + 1]?.replace(/\/+$/, '') : '';
})();
const config = read();

const git = (...args) => execFileSync('git', args, { cwd: here, encoding: 'utf8' }).trim();
// What goes live is a commit: nothing else in the co folder may be uncommitted (Vercel records the commit with the deploy).
if (deploy) {
  let dirty;
  try {
    dirty = git('status', '--porcelain', '--', '.').split('\n').filter((l) => l && !l.endsWith('vercel.json') && !l.includes('.vercel/'));
  } catch {
    die('--deploy needs the co folder in a git repository, so what goes live is a commit.');
  }
  if (dirty.length) die(`Commit these first, so what goes live is a commit:\n${dirty.join('\n')}`);
}
const ship = (message) => {
  if (!deploy) return;
  if (git('status', '--porcelain', '--', 'vercel.json')) {
    git('add', '--', 'vercel.json');
    git('commit', '-q', '-m', message, '--', 'vercel.json');
  }
  console.log(`\nDeploying ${git('log', '-1', '--format=%h')}…`);
  execFileSync('npx', ['--yes', 'vercel@65.14.0', 'deploy', '--prod', '--yes'], { cwd: here, stdio: 'inherit' });
};

if (action === 'list') {
  const all = people(config);
  if (!all.size) console.log('No one yet. Add someone: node co/colabit.mjs add <name> <site url>');
  for (const [n, to] of all) console.log(`/${n}  →  ${to}`);
} else if (action === 'add') {
  if (!NAME.test(name || '')) die('A name is lowercase letters, digits and dashes, up to 30, starting with a letter or digit.');
  let to;
  try {
    to = new URL(site);
  } catch {
    die('Give the site address: node co/colabit.mjs add <name> https://their-site.vercel.app');
  }
  if (!/^https?:$/.test(to.protocol)) die('The site address starts with https://');
  const base = to.origin;
  config.rewrites = (config.rewrites || []).filter((r) => OWN.test(r.source) || (r.source !== `/${name}` && r.source !== `/${name}/:path*`));
  config.rewrites.push({ source: `/${name}`, destination: `${base}/${name}` }, { source: `/${name}/:path*`, destination: `${base}/${name}/:path*` });
  write(config);
  const where = lab || '<your lab address>';
  console.log(`/${name} → ${base}/${name}.${deploy ? '' : ' Commit and push co/vercel.json (or run with --deploy); Vercel deploys it.'}`);
  console.log(`\nFor ${name}'s agent:\n  Serve this site under the base path /${name} (every page and file under /${name}/). In the root layout, just before the closing body tag, add one script tag: src "${where}/_lab/co.js", defer, data-site="lab". Nothing else. Show me the diff; don't push or deploy.`);
  ship(`colabit: add ${name} (${base})`);
} else if (action === 'remove') {
  const before = (config.rewrites || []).length;
  config.rewrites = (config.rewrites || []).filter((r) => OWN.test(r.source) || (r.source !== `/${name}` && r.source !== `/${name}/:path*`));
  if (config.rewrites.length === before) die(`No /${name} in this colabit.`);
  write(config);
  console.log(`/${name} removed.${deploy ? '' : ' Commit and push co/vercel.json (or run with --deploy).'}`);
  ship(`colabit: remove ${name}`);
} else if (action === 'deploy') {
  ship('colabit: deploy');
} else {
  die('node co/colabit.mjs add <name> <site url> [--lab https://lab.example.com] [--deploy] | remove <name> [--deploy] | list | deploy');
}
