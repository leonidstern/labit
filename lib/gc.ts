// `labit gc`: what every lab this computer has run keeps in its .lab, and what could go. It only reports: it never
// writes, moves or deletes anything, in a project or in ~/.labit (#427). The labs are the folders in ~/.labit/roots
// plus the running and parked ones (lib/labs.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { knownRoots } from './labs.ts';
import { imageName, imagesOf } from './schema.mjs';

const fsp = fs.promises;
type Stat = typeof fsp.stat;
// A folder on a drive that hangs is given up on after this long; starting a lab never looks at other labs' folders.
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<'slow'>((r) => setTimeout(r, ms, 'slow').unref())]);
const files = async (dir: string) => (await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isFile()).map((d) => path.join(dir, d.name));
const sizeOf = async (p: string): Promise<number> => {
  const s = await fsp.lstat(p);
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const d of await fsp.readdir(p)) n += await sizeOf(path.join(p, d));
  return n;
};
const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

type Gone = { file: string; size: number; why: string };
type Lab = { root: string; state: 'lab' | 'missing' | 'offline' | 'slow' | 'not labit' | 'same as'; of?: string; parts?: [string, number][]; could?: Gone[] };

/** One .lab: its parts by size, and the files a later clean-up could take, all made by labit and named by nothing:
 *  uploads never sent past their life, halves of writes that never finished, pictures no comment (or archived one)
 *  names. Anything changed in the last minute is left out, so a lab running there now loses nothing it is writing. */
async function lookAt(root: string, stat: Stat, ms: number): Promise<Lab> {
  const lab = path.join(root, '.lab');
  const s = await within(stat(lab).catch((e: Error) => e), ms);
  if (s === 'slow') return { root, state: 'slow' };
  if (s instanceof Error) {
    // A folder on a drive that isn't plugged in is offline, not gone: its /Volumes/<drive> (or /media, /mnt) is missing.
    const drive = root.match(/^\/(?:Volumes|mnt|(?:run\/)?media\/[^/]+)\/[^/]+/)?.[0];
    return { root, state: drive && !fs.existsSync(drive) ? 'offline' : fs.existsSync(root) ? 'not labit' : 'missing' };
  }
  // labit writes .lab/.gitignore holding "*" when it makes the folder: without it, the .lab is someone else's.
  if ((await fsp.readFile(path.join(lab, '.gitignore'), 'utf8').catch(() => '')) !== '*\n') return { root, state: 'not labit' };
  const parts: [string, number][] = [];
  for (const d of await fsp.readdir(lab)) parts.push([d, await sizeOf(path.join(lab, d)).catch(() => 0)]);
  const could: Gone[] = [];
  const old = Date.now() - 60e3;
  const add = async (file: string, why: string, olderThan = old) => {
    const f = await fsp.lstat(file).catch(() => null);
    if (f?.isFile() && f.mtimeMs < olderThan) could.push({ file: path.relative(lab, file), size: f.size, why });
  };
  for (const f of await files(path.join(lab, 'attachments', '.staged'))) await add(f, 'uploads never sent', Date.now() - 20 * 60e3);
  for (const dir of ['', 'comments', 'archive', 'boards']) for (const f of await files(path.join(lab, dir))) if (f.endsWith('.tmp')) await add(f, 'unfinished writes');
  // Pictures: one no live or archived comment names. A store that can't be read leaves every picture out.
  const named = new Set<string>();
  let read = true;
  for (const dir of ['comments', 'archive'])
    for (const f of await files(path.join(lab, dir)))
      if (f.endsWith('.json'))
        try {
          for (const c of Object.values(JSON.parse(await fsp.readFile(f, 'utf8')).comments ?? {})) for (const i of imagesOf(c)) named.add(imageName(c, i));
        } catch {
          read = false;
        }
  if (read) for (const f of await files(path.join(lab, 'attachments'))) if (!named.has(path.basename(f))) await add(f, 'pictures no comment names');
  return { root, state: 'lab', parts, could };
}

/** Every known lab, one after another; the same folder reached by two paths is looked at once. */
async function survey({ stat = fsp.stat, ms = 3000 }: { stat?: Stat; ms?: number } = {}): Promise<Lab[]> {
  const seen = new Map<string, string>();
  const out: Lab[] = [];
  for (const root of knownRoots()) {
    const s = await within(stat(root).catch(() => null), ms);
    const id = s && s !== 'slow' ? `${s.dev}:${s.ino}` : '';
    if (id && seen.has(id)) out.push({ root, state: 'same as', of: seen.get(id) });
    else {
      if (id) seen.set(id, root);
      out.push(s === 'slow' ? { root, state: 'slow' } : await lookAt(root, stat, ms));
    }
  }
  return out;
}

export async function gcReport(): Promise<string> {
  const home = os.homedir();
  const tilde = (p: string) => (p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p);
  const labs = await survey();
  if (!labs.length) return 'No labs known on this computer yet.';
  const lines: string[] = [];
  let total = 0;
  let could = 0;
  for (const lab of labs.sort((a, b) => a.root.localeCompare(b.root))) {
    if (lab.state === 'same as') lines.push(`${tilde(lab.root)}  same folder as ${tilde(lab.of!)}`);
    else if (lab.state !== 'lab') lines.push(`${tilde(lab.root)}  ${lab.state === 'offline' ? 'offline (its drive is not plugged in)' : lab.state === 'slow' ? 'did not answer in time' : lab.state === 'missing' ? 'missing (moved or deleted)' : 'no labit .lab here'}`);
    else {
      const size = lab.parts!.reduce((n, [, b]) => n + b, 0);
      total += size;
      lines.push(`${tilde(lab.root)}  ${bytes(size)}: ${lab.parts!.filter(([, b]) => b).sort((a, b) => b[1] - a[1]).map(([n, b]) => `${n} ${bytes(b)}`).join(', ') || 'empty'}`);
      const by = new Map<string, Gone[]>();
      for (const g of lab.could!) by.set(g.why, [...(by.get(g.why) ?? []), g]);
      for (const [why, gs] of by) {
        const b = gs.reduce((n, g) => n + g.size, 0);
        could += b;
        lines.push(`  could go: ${why} (${gs.length}), ${bytes(b)}`);
      }
    }
  }
  lines.push('', `${labs.length} lab folder${labs.length === 1 ? '' : 's'}, ${bytes(total)} in .lab; ${bytes(could)} could go. Nothing was changed: labit gc only reports.`);
  return lines.join('\n');
}
