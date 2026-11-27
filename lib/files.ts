// Writing the lab's own files whole: boards, settings, reply rules, and local.mjs's stores (which add their own
// recovery when .lab is gone).
import fs from 'node:fs';
import path from 'node:path';

// On Windows a rename over a file that something else has open for a moment (a virus scanner, the search indexer, an
// editor reading it) fails with EPERM, EACCES or EBUSY; it goes through once that lets go, so it is tried again for up
// to about a second there (#544). Elsewhere it is one rename.
const renameOver = (from: string, to: string) => {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || i >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(code || '')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
    }
  }
};

/** Writes a whole file or none of it, through a .tmp beside it. Its folder is made first unless `mkdir` is false. A
 *  failed write takes its .tmp away: a half-written copy would hold on to the space a full disk needs back. */
export const writeAtomic = (file: string, text: string | Buffer, { mode, mkdir = true }: { mode?: number; mkdir?: boolean } = {}) => {
  if (mkdir) fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file + '.tmp', text, mode ? { mode } : undefined);
    renameOver(file + '.tmp', file);
  } catch (e) {
    fs.rmSync(file + '.tmp', { force: true });
    throw e;
  }
};

/** A file that can't be read is put aside (never loaded again, never overwritten): <file>.broken-<time>, its new path. */
export const putAside = (file: string) => {
  const aside = `${file}.broken-${Date.now()}`;
  fs.renameSync(file, aside);
  return aside;
};
