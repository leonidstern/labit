import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------- the labs running on this computer ----------
// Each lab writes ~/.labit/servers/<port>.json while it runs; a file whose process is gone is left over and skipped.
export const REGISTRY = path.join(process.env.LABIT_HOME || path.join(os.homedir(), '.labit'), 'servers');
// Pages are keyed by their file: Pricing.html is /pricing, a/index.html is /a/index. Anything the lab's page
// format doesn't allow (dots, spaces, other scripts) is spelled as _ and its hex bytes, so keys stay unique.
export const keyFor = (rel: string) =>
  '/' + rel.replace(/\.html?$/i, '').split(path.sep).map((seg) =>
    [...Buffer.from(seg.toLowerCase())].map((b, i) => (/[a-z0-9]/.test(String.fromCharCode(b)) || (b === 45 && i) ? String.fromCharCode(b) : `_${b.toString(16)}`)).join(''),
  ).join('/');

export type Lab = { port: number; pid: number; root: string; name: string; proxy?: string | null; version?: string; edge?: string; entry?: string; me?: string; startedAt?: string; listener?: string; listenedAt?: string };
export const runningLabs = (): Lab[] =>
  (fs.existsSync(REGISTRY) ? fs.readdirSync(REGISTRY) : [])
    .filter((n) => n.endsWith('.json'))
    .flatMap((n) => {
      const file = path.join(REGISTRY, n);
      try {
        const lab = JSON.parse(fs.readFileSync(file, 'utf8'));
        process.kill(lab.pid, 0);
        return [lab];
      } catch {
        fs.rmSync(file, { force: true });
        return [];
      }
    })
    .sort((a, b) => a.root.localeCompare(b.root));

/** Asks the lab on `port` for its pages (GET /_lab/pages: its name, folder, pages and who listens), giving up after
 *  `ms`. Rejects when nothing answers there. */
export const askPages = (port: number, ms: number) => fetch(`http://localhost:${port}/_lab/pages`, { signal: AbortSignal.timeout(ms) });

// ---------- parked labs ----------
// A lab parked from the switcher stops and leaves ~/.labit/parked/<port>.json: how to start it again, the same way.
export const PARKED = path.join(path.dirname(REGISTRY), 'parked');
type Parked = { port: number; root: string; name: string; argv: string[]; execArgv: string[]; edge?: string; npx?: boolean; version?: string; archived?: boolean; why?: string; session?: { id: string; [k: string]: unknown }; at: string };
export const parkedLabs = (): Parked[] =>
  (fs.existsSync(PARKED) ? fs.readdirSync(PARKED) : [])
    .filter((n) => n.endsWith('.json'))
    .flatMap((n) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(PARKED, n), 'utf8'))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));

// ---------- every folder a lab has served ----------
// ~/.labit/roots: one JSON string a line, added when a lab starts in a folder it doesn't list yet, never removed by a lab.
// servers/ forgets a lab when it stops and parked/ only holds parked ones, so `labit gc` finds a stopped lab's .lab here.
// Each line starts with a newline of its own, so a write cut short spoils only itself; two labs starting in the same
// instant can both add their line, and the reader keeps one.
const ROOTS = path.join(path.dirname(REGISTRY), 'roots');
export const rememberRoot = (root: string) => {
  const line = JSON.stringify(root);
  let had = '';
  try {
    had = fs.readFileSync(ROOTS, 'utf8');
  } catch {}
  if (!had.split('\n').includes(line))
    try {
      fs.appendFileSync(ROOTS, '\n' + line);
    } catch {}
};
/** Every folder a lab is known to have served: the roots file (lines that aren't a quoted absolute path skipped), the
 *  running labs and the parked ones, each once. */
export const knownRoots = (): string[] => {
  let text = '';
  try {
    text = fs.readFileSync(ROOTS, 'utf8');
  } catch {}
  const out = new Set<string>();
  for (const line of text.split('\n'))
    try {
      const r = JSON.parse(line);
      if (typeof r === 'string' && path.isAbsolute(r)) out.add(r);
    } catch {}
  for (const l of [...runningLabs(), ...parkedLabs()]) out.add(l.root);
  return [...out];
};
