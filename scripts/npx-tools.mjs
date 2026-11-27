// The two build tools, found where npx put them: labit has no dependencies, so package.json runs the build scripts
// through `npx -p esbuild@<pinned> -p terser@<pinned> node …`, which puts both on PATH for that process only.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const tool = (name) => {
  const bin = (process.env.PATH || '').split(path.delimiter).find((d) => fs.existsSync(path.join(d, name)) && fs.existsSync(path.join(d, '..', name, 'package.json')));
  if (!bin) {
    console.error(`${name} not found: run this with npm run build (npx -p esbuild@… -p terser@… node scripts/build-widget.mjs)`);
    process.exit(1);
  }
  return createRequire(path.join(bin, '..', name, 'package.json'))(name);
};
