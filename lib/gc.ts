// `labit gc`: every lab this computer has run (lib/labs.ts knownRoots), how much its .lab holds and how much could go:
// labit's own files that nothing names, untouched for a while (uploads never sent, unfinished writes, pictures no live
// or archived comment names). It only reports: it never writes, moves or deletes anything (#427).
import fs from 'node:fs';
import path from 'node:path';
import { knownRoots } from './labs.ts';
import { imageName, imagesOf } from './schema.mjs';

const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;

export const gcReport = () =>
  knownRoots()
    .sort()
    .map((root) => {
      const lab = path.join(root, '.lab');
      // labit writes .lab/.gitignore holding "*" when it makes the folder: without it, the .lab is not labit's.
      try {
        if (fs.readFileSync(path.join(lab, '.gitignore'), 'utf8') !== '*\n') throw 0;
      } catch {
        return `${root}  ${fs.existsSync(root) ? 'no labit .lab' : 'not found (moved, deleted or on a drive not plugged in)'}`;
      }
      const named = new Set<string>();
      let size = 0;
      let could = 0;
      const files = (fs.readdirSync(lab, { recursive: true }) as string[]).flatMap((rel) => {
        const s = fs.lstatSync(path.join(lab, rel));
        if (!s.isFile()) return [];
        size += s.size;
        if (/^(comments|archive)\/[^/]+\.json$/.test(rel))
          try {
            for (const c of Object.values(JSON.parse(fs.readFileSync(path.join(lab, rel), 'utf8')).comments)) for (const i of imagesOf(c)) named.add(imageName(c, i));
          } catch {
            named.add('*'); // a store that can't be read: no picture counts as unnamed
          }
        return [{ rel, s }];
      });
      for (const { rel, s } of files)
        if (Date.now() - s.mtimeMs > 30 * 60e3 && (rel.endsWith('.tmp') || rel.startsWith('attachments/.staged/') || (/^attachments\/[^/]+$/.test(rel) && !named.has('*') && !named.has(rel.slice(12))))) could += s.size;
      return `${root}  ${kb(size)}, ${kb(could)} could go`;
    })
    .join('\n') || 'No labs known on this computer yet.';
