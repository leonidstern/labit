// Builds the command line and server into dist/local.mjs (what npm ships): local.mjs and lib/ bundled and minified by
// esbuild, then every local name given again by terser (the same step the page script gets, scripts/build-widget.mjs):
// the shortest names, gzip packs the result about 2% smaller (1.5 KB of the package). terser's compress runs too, in one
// pass (it folds what esbuild leaves: 0.6 KB of the package, 21 Nov; since 26 Nov one pass packs 50 B smaller than two).
//   npx -p esbuild@<pinned> -p terser@<pinned> node scripts/build-cli.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { tool } from './npx-tools.mjs';

const esbuild = tool('esbuild');
const terser = tool('terser');
fs.rmSync('dist', { recursive: true, force: true });
const { outputFiles } = await esbuild.build({
  entryPoints: ['local.mjs'],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
  write: false,
});
for (const f of outputFiles) {
  const { code } = await terser.minify(f.text, { compress: true, mangle: true, module: true, format: { comments: /^!/, ascii_only: true } });
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync(f.path, code + '\n');
}
// The skill ships brotli-packed too (skills/labit/SKILL.md.br, package.json "files"), as lab.css does: `labit skill` is
// the only reader of the package's copy (the plugins install from the repository) and unpacks it. 1.2 KB less than
// npm's gzip of the plain file (26 Nov). A checkout reads the plain file.
const skill = fs.readFileSync('skills/labit/SKILL.md');
fs.writeFileSync('skills/labit/SKILL.md.br', zlib.brotliCompressSync(skill, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: skill.length } }));
