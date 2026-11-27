// Builds the page script: src/comments.js and its modules, bundled and minified into public/_lab/comments.js (and the
// parts it loads later, below, and lab.css). The
// stylesheet (src/widget/styles.css) goes in as text, minified too: esbuild's command line can't minify CSS it loads
// as text, so this runs esbuild's API instead.
//
// labit has no dependencies: package.json runs this through `npx -p esbuild@<pinned> -p terser@<pinned> node …`, which
// puts both on PATH for this process only, and their APIs are found next to those commands.
//   node scripts/build-widget.mjs --outfile=<file> [--watch] [--map] [--co]
// --co: colabit's one script (co/README.md): the page script alone, with no lab or agent parts, no parts and no lab.css.
// --map: not minified, with an inline source map, for ci/reach.mjs (which lines of src/ each browser test runs).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outfile = arg('outfile') || 'public/_lab/comments.js';
const watch = process.argv.includes('--watch');
const mapped = process.argv.includes('--map');
const co = process.argv.includes('--co');

import { tool } from './npx-tools.mjs';

const esbuild = tool('esbuild');
const terser = tool('terser');

// esbuild leaves the spaces inside what it can't read: a custom property's value (`--_ease: var(--lab-ease, cubic-bezier(.2, .8, .2, 1))`)
// and a var() fallback. They only separate; taking them out (outside strings) leaves every value the same.
const tighten = (css) => css.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/).map((part, i) => (i % 2 ? part : part.replace(/(--[\w-]+):\s+/g, '$1:').replace(/,\s+/g, ',').replace(/\s+([;}])/g, '$1'))).join('');
// The stylesheet as text, minified (comments and spaces out). Everything else as the plain command line did it.
const minifiedCss = {
  name: 'minified-css-text',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (a) => {
      const { code } = await esbuild.transform(await fs.promises.readFile(a.path, 'utf8'), { loader: 'css', minify: true });
      return { contents: tighten(code.trim()), loader: 'text' };
    });
  },
};
// Each built file has its local names given again by terser (the same escapes for letters outside ASCII, the licence
// comment kept). esbuild numbers a nested function's names after its parents', so deep code gets two-letter names;
// terser gives each function the shortest names it does not itself use, the same few letters over and over, which gzip
// packs about 4% smaller (the page script: 3 KB). terser's compress runs too, in two passes, as for the command line
// (scripts/build-cli.mjs): it folds what esbuild leaves, 0.4 KB of the package's brotli (26 Nov). It writes some
// constants out where they are used, which brotli takes in its stride and gzip doesn't: evaluate, sequences and join_vars
// stay off, so the page script's gzip barely moves. pure_getters off: a property read
// is never taken for free, so a read that only makes the browser lay out (el.offsetHeight) stays. ecma 2020: the source
// already uses newer syntax, so what terser writes is no newer than what it is given.
const shortNames = {
  name: 'short-names',
  setup(build) {
    const { format } = build.initialOptions;
    build.onEnd(async (result) => {
      for (const file of result.outputFiles || []) {
        const { code } = await terser.minify(file.text, { ecma: 2020, compress: { passes: 2, pure_getters: false, evaluate: false, sequences: false, join_vars: false }, mangle: true, module: format === 'esm', format: { comments: /^!/, ascii_only: true } });
        await fs.promises.mkdir(path.dirname(file.path), { recursive: true });
        await fs.promises.writeFile(file.path, code + '\n');
      }
    });
  },
};
// --map: each file written as esbuild made it, its source map inside.
const asBuilt = {
  name: 'as-built',
  setup(build) {
    build.onEnd(async (result) => {
      for (const file of result.outputFiles || []) {
        await fs.promises.mkdir(path.dirname(file.path), { recursive: true });
        await fs.promises.writeFile(file.path, file.text);
      }
    });
  },
};
const options = {
  entryPoints: ['src/comments.js'],
  bundle: true,
  format: 'iife',
  legalComments: 'inline',
  minify: !mapped,
  ...(mapped ? { sourcemap: 'inline', sourcesContent: false } : {}),
  logLevel: 'warning',
  outfile,
  write: false, // shortNames writes each file
  plugins: [minifiedCss, mapped ? asBuilt : shortNames],
  define: { 'globalThis.__LAB_DEBUG__': 'false', 'globalThis.__LAB_CO__': String(co) },
  metafile: true, // what each script is made of: code built into two of them is counted (bundles.json, below)
};
// Parts the page script loads only when they are used (part(name) in src/comments.js): each one an ES module beside
// it, <name>.js, with its own styles in it. The lab serves them with the script (public/_lab/*.js), and its widget
// version covers them (widgetRev in local.mjs), so a change to one reloads open pages too.
// boardview is the one board: a view over the page that links it, and the board's own page (/_lab/board/<name>) loads
// the same file.
const PARTS = { components: 'src/widget/components.ts', switcher: 'src/widget/switcher.ts', draw: 'src/widget/draw.ts', motion: 'src/widget/motion.ts', boardview: 'src/board/overlay.ts', pics: 'src/widget/pics.ts', attach: 'src/widget/attach.ts', reload: 'src/widget/reload.ts', walkie: 'src/widget/walkie.ts' };
const builds = [
  options,
  ...Object.entries(PARTS).map(([name, entry]) => ({ ...options, entryPoints: [entry], format: 'esm', outfile: path.join(path.dirname(outfile), `${name}.js`) })),
];
// The lab's design system for pages (src/lab.css) is served as /_lab/lab.css, minified the same way: the commented source
// stays here, the package carries the small one (the comments were 40% of the file), brotli-packed as the scripts are
// (lab.css.br, below): 0.24 KB less in the package than npm's gzip of it.
const labCss = async () => {
  const { code } = await esbuild.transform(await fs.promises.readFile('src/lab.css', 'utf8'), { loader: 'css', minify: true });
  await fs.promises.mkdir(path.dirname(outfile), { recursive: true });
  const css = tighten(code.trim()) + '\n';
  await fs.promises.writeFile(path.join(path.dirname(outfile), 'lab.css'), css);
  await fs.promises.writeFile(path.join(path.dirname(outfile), 'lab.css.br'), zlib.brotliCompressSync(css, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }));
};
if (co) {
  await esbuild.build(options);
  // The colabit's API takes the lab's own (lib/comments-api.mjs and what it reads) from a copy beside it, so the co
  // folder deploys on its own: nothing outside it is uploaded.
  const lib = path.join(path.dirname(outfile), 'api/_lib');
  fs.mkdirSync(lib, { recursive: true });
  for (const f of ['comments-api', 'schema', 'images', 'moment', 'cut', 'status']) fs.copyFileSync(`lib/${f}.mjs`, path.join(lib, `${f}.mjs`));
  process.exit(0);
}
await labCss();
if (watch) {
  for (const o of builds) await (await esbuild.context(o)).watch();
  fs.watch('src/lab.css', () => void labCss());
} else {
  const results = await Promise.all(builds.map((o) => esbuild.build(o)));
  // Code shipped twice (Leo, 23 Nov: "add check so this wont happen again when you duplicating things"): a module built
  // into the page script and a part, or into two parts, is downloaded twice. bundles.json lists each such module with
  // the scripts that carry it, and sharedBytes, the minified bytes of every copy after the first; ci/metrics.mjs gates it.
  const inScripts = new Map();
  results.forEach((r, i) => {
    for (const out of Object.values(r.metafile.outputs)) {
      for (const [file, { bytesInOutput }] of Object.entries(out.inputs)) {
        if (!bytesInOutput) continue;
        const e = inScripts.get(file) || { scripts: [], bytes: [] };
        e.scripts.push(path.basename(builds[i].outfile));
        e.bytes.push(bytesInOutput);
        inScripts.set(file, e);
      }
    }
  });
  const shared = [...inScripts].filter(([, e]) => e.scripts.length > 1).sort(([a], [b]) => a.localeCompare(b));
  const sharedBytes = shared.reduce((n, [, e]) => n + e.bytes.reduce((s, b) => s + b, 0) - Math.max(...e.bytes), 0);
  // The gate counts copies, not bytes: the bytes of the same module move by a few as the minifier renames around it.
  const copies = shared.reduce((n, [, e]) => n + e.scripts.length - 1, 0);
  fs.writeFileSync(path.join(path.dirname(outfile), 'bundles.json'), JSON.stringify({ copies, sharedBytes, shared: Object.fromEntries(shared.map(([f, e]) => [f, e.scripts])) }, null, 2) + '\n');
  // The npm package carries each script brotli-packed (<name>.js.br, package.json "files"): npm's gzip leaves 8 KB more in
  // it. The lab sends the packed bytes as they are to a browser that takes brotli and unpacks them for one that doesn't
  // (sendPacked in lib/dev.ts); a checkout serves the plain .js beside them. Same bytes in, same bytes out, so a repeat
  // build writes identical files.
  for (const o of builds) {
    const plain = fs.readFileSync(o.outfile);
    const params = { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: plain.length };
    fs.writeFileSync(`${o.outfile}.br`, zlib.brotliCompressSync(plain, { params }));
  }
}
