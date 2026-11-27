// The projects the dev-servers area runs real dev servers on: one small hand-written project per framework (no create-*
// tool), with exact dependency versions. A framework's dependencies are installed once into a cache folder under the
// system's temp folder (CACHE/<framework>/node_modules, with a stamp that names the versions) and used by every later
// run; a case's project is only its source files, in CACHE/<framework>/cases/<id>/, and finds node_modules one folder
// up, as a package in a monorepo does. Nothing is installed into the labit checkout.
//
// Every project shows the same marks, so one model reads them all:
//   #anchor-a            a heading no step ever changes (pins sit on it)
//   #tok-page            the route's own file: data-v is its version, data-route says which route is shown
//   #tok-comp            a component (or a module that draws) every route shows
//   #tok-mod             a plain module the component imports
//   --v on :root         the stylesheet
//   #count               a button that counts its clicks in memory (the count is gone after a full reload)
//   #nav-home, #nav-about  links between the routes
// Each file a step may save holds exactly one version token (v0000012), which is what the oracle reads from disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const CACHE = process.env.TORTURE_DEVSERVERS_CACHE || path.join(fs.realpathSync(os.tmpdir()), 'labit-torture-devservers');

const CSS = (tok) => `:root { --v: ${tok}; }\nbody { font-family: system-ui, sans-serif; margin: 40px; }\nh1 { margin: 0 0 16px; font-size: 28px; }\np { margin: 8px 0; height: 24px; }\nbutton { margin: 8px 0; }\n`;
const MOD = (tok) => `export const MOD = '${tok}';\n`;
const MOD_BROKEN = (tok) => `export const MOD = '${tok}' + ;\n`;
const NAV = (about) => `<nav><a id="nav-home" href="/">home</a> <a id="nav-about" href="${about}">about</a></nav>`;
// A module that draws the component's and the module's marks into a plain page (Vite without a framework, webpack, a static server).
const DRAW = (tok, modPath) => `import { MOD } from '${modPath}';\nexport const COMP = '${tok}';\nexport function render() {\n  const set = (id, v) => {\n    const e = document.getElementById(id);\n    if (e) (e.dataset.v = v), (e.textContent = id + ' ' + v);\n  };\n  set('tok-comp', COMP);\n  set('tok-mod', MOD);\n}\n`;
const DRAW_BROKEN = (tok, modPath) => `import { MOD } from '${modPath}';\nexport const COMP = '${tok}';\nexport function render( {\n`;
const PLAIN_PAGE = (script) => (tok, route) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${route}</title>${script.head || ''}</head><body><main id="m"><h1 id="anchor-a">Stable heading</h1><p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p><p id="tok-comp">-</p><p id="tok-mod">-</p><button id="count">0</button>${NAV(script.about)}</main>${script.body || ''}</body></html>\n`;
// Files every project serves as they are (its public folder): a text worth compressing, bytes that are no text (for
// range requests), and a piece of HTML that is no page (what a script fetches and puts into its page).
const BIG = Array.from({ length: 600 }, (_, i) => `line ${i} of a text file that a server may compress on its way out`).join('\n') + '\n';
const BYTES = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 89) % 256));
// A tab icon, as most projects have one (a 1x1 picture in an .ico file); a case may leave it out.
export const FAVICON = Buffer.from('AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAAAAA==', 'base64');
const PUBLIC = (dir) => ({ [`${dir}big.txt`]: BIG, [`${dir}pic.bin`]: BYTES, [`${dir}partial.html`]: '<p id="frag">a piece of HTML, not a page</p>\n', [`${dir}favicon.ico`]: FAVICON });
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";
const pkg = (name, dev, more = {}) => JSON.stringify({ name: `torture-${name}`, private: true, version: '0.0.0', scripts: { dev }, ...more }, null, 2) + '\n';

const WEBPACK_CONFIG = (more) => `const HtmlWebpackPlugin = require('html-webpack-plugin');
module.exports = {
  mode: 'development',
  entry: './src/index.js',
  devtool: false,
  module: { rules: [{ test: /\\.css$/, use: ['style-loader', 'css-loader'] }] },
  plugins: [new HtmlWebpackPlugin({ template: './src/index.html' })],
  devServer: { ${more}hot: true, historyApiFallback: true },
  stats: 'errors-warnings',
};
`;

/**
 * A framework: { deps, fixed: { file: text }, pages: { route: { file, url, key, text(tok, route), broken? } },
 *   comp, mod, css: { file, text(tok), broken? }, newRoute(n) | null, spa (links change the route without a page load),
 *   start(port): [command, ...args] (run in the case's folder; BIN is CACHE/<fw>/node_modules), hmr: how its live
 *   reload socket is opened, slowStart: ms a first answer may take }.
 * key: the page's key in the lab (its address without .html, / is /index).
 */
export const FRAMEWORKS = {
  // Vite with no framework: two HTML pages, a module that draws, a module it imports, a stylesheet.
  vite: {
    deps: { vite: '8.3.8' },
    fixed: {
      'package.json': pkg('vite', 'vite', { type: 'module' }),
      'src/main.js': `import './style.css';\nimport { render } from './comp.js';\nrender();\nlet n = 0;\nconst b = document.getElementById('count');\nif (b) b.onclick = () => (b.textContent = String(++n));\nif (import.meta.hot) import.meta.hot.accept('./comp.js', (m) => m && m.render());\n`,
      ...PUBLIC('public/'),
    },
    // With a Content-Security-Policy header on every answer (the page itself has no inline script).
    csp: { 'vite.config.js': `export default { server: { headers: { 'Content-Security-Policy': ${JSON.stringify(CSP)} } } };\n` },
    pages: {
      home: { file: 'index.html', url: '/', key: '/index' },
      about: { file: 'about.html', url: '/about.html', key: '/about' },
    },
    pageText: PLAIN_PAGE({ about: '/about.html', body: '<script type="module" src="/src/main.js"></script>' }),
    comp: { file: 'src/comp.js', text: (t) => DRAW(t, './mod.js'), broken: (t) => DRAW_BROKEN(t, './mod.js') },
    mod: { file: 'src/mod.js', text: MOD, broken: MOD_BROKEN },
    css: { file: 'src/style.css', text: CSS },
    newRoute: (n) => ({ file: `extra${n}.html`, url: `/extra${n}.html`, key: `/extra${n}` }),
    spa: false,
    start: (port, bin) => [process.execPath, path.join(bin, 'vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    hmr: 'vite',
  },
  // Vite and React 18 with fast refresh: one HTML shell, a small router of its own (pushState), a component per route.
  react: {
    deps: { vite: '8.3.8', '@vitejs/plugin-react': '6.3.0', react: '18.3.1', 'react-dom': '18.3.1' },
    fixed: {
      'package.json': pkg('react', 'vite', { type: 'module' }),
      'vite.config.js': `import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };\n`,
      ...PUBLIC('public/'),
      'index.html': `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>react</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`,
      'src/main.jsx': `import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './style.css';\ncreateRoot(document.getElementById('root')).render(<App />);\n`,
      'src/App.jsx': `import { useEffect, useState } from 'react';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import Shared from './Shared.jsx';
function Counter() {
  const [n, setN] = useState(0);
  return <button id="count" onClick={() => setN(n + 1)}>{n}</button>;
}
export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = (to) => (e) => {
    e.preventDefault();
    window.history.pushState({}, '', to);
    setPath(to);
  };
  const about = path.replace(/\\/+$/, '') === '/about';
  return (
    <main id="m">
      <h1 id="anchor-a">Stable heading</h1>
      {about ? <About /> : <Home />}
      <Shared />
      <Counter />
      <nav><a id="nav-home" href="/" onClick={go('/')}>home</a> <a id="nav-about" href="/about" onClick={go('/about')}>about</a></nav>
    </main>
  );
}
`,
    },
    pages: {
      home: { file: 'src/pages/Home.jsx', url: '/', key: '/index' },
      about: { file: 'src/pages/About.jsx', url: '/about', key: '/about' },
    },
    pageText: (tok, route) => `export default function ${route === 'home' ? 'Home' : 'About'}() {\n  return <p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p>;\n}\n`,
    pageBroken: (tok, route) => `export default function ${route === 'home' ? 'Home' : 'About'}() {\n  return <p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p\n}\n`,
    comp: {
      file: 'src/Shared.jsx',
      text: (t) => `import { MOD } from './mod.js';\nexport default function Shared() {\n  return (\n    <>\n      <p id="tok-comp" data-v="${t}">comp ${t}</p>\n      <p id="tok-mod" data-v={MOD}>mod {MOD}</p>\n    </>\n  );\n}\n`,
      broken: (t) => `import { MOD } from './mod.js';\nexport default function Shared() {\n  return (\n    <>\n      <p id="tok-comp" data-v="${t}">comp ${t}</p>\n  );\n}\n`,
    },
    mod: { file: 'src/mod.js', text: MOD, broken: MOD_BROKEN },
    css: { file: 'src/style.css', text: CSS },
    newRoute: null,
    spa: true,
    start: (port, bin) => [process.execPath, path.join(bin, 'vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    hmr: 'vite',
  },
  // Vite and Vue 3 single-file components, the same shape as the React project.
  vue: {
    deps: { vite: '8.3.8', '@vitejs/plugin-vue': '6.0.11', vue: '3.5.46' },
    fixed: {
      'package.json': pkg('vue', 'vite', { type: 'module' }),
      'vite.config.js': `import vue from '@vitejs/plugin-vue';\nexport default { plugins: [vue()] };\n`,
      ...PUBLIC('public/'),
      'index.html': `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>vue</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>\n`,
      'src/main.js': `import { createApp } from 'vue';\nimport App from './App.vue';\nimport './style.css';\ncreateApp(App).mount('#app');\n`,
      'src/App.vue': `<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Home from './pages/Home.vue';
import About from './pages/About.vue';
import Shared from './Shared.vue';
const path = ref(window.location.pathname);
const n = ref(0);
const on = () => (path.value = window.location.pathname);
onMounted(() => window.addEventListener('popstate', on));
onUnmounted(() => window.removeEventListener('popstate', on));
const go = (to) => {
  window.history.pushState({}, '', to);
  path.value = to;
};
const about = computed(() => path.value.replace(/\\/+$/, '') === '/about');
</script>
<template>
  <main id="m">
    <h1 id="anchor-a">Stable heading</h1>
    <About v-if="about" />
    <Home v-else />
    <Shared />
    <button id="count" @click="n++">{{ n }}</button>
    <nav><a id="nav-home" href="/" @click.prevent="go('/')">home</a> <a id="nav-about" href="/about" @click.prevent="go('/about')">about</a></nav>
  </main>
</template>
`,
    },
    pages: {
      home: { file: 'src/pages/Home.vue', url: '/', key: '/index' },
      about: { file: 'src/pages/About.vue', url: '/about', key: '/about' },
    },
    pageText: (tok, route) => `<template>\n  <p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p>\n</template>\n`,
    pageBroken: (tok, route) => `<template>\n  <p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</span>\n</template>\n`,
    comp: {
      file: 'src/Shared.vue',
      text: (t) => `<script setup>\nimport { MOD } from './mod.js';\n</script>\n<template>\n  <p id="tok-comp" data-v="${t}">comp ${t}</p>\n  <p id="tok-mod" :data-v="MOD">mod {{ MOD }}</p>\n</template>\n`,
      broken: (t) => `<script setup>\nimport { MOD } from './mod.js';\nconst x = ;\n</script>\n<template>\n  <p id="tok-comp" data-v="${t}">comp ${t}</p>\n</template>\n`,
    },
    mod: { file: 'src/mod.js', text: MOD, broken: MOD_BROKEN },
    css: { file: 'src/style.css', text: CSS },
    newRoute: null,
    spa: true,
    start: (port, bin) => [process.execPath, path.join(bin, 'vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    hmr: 'vite',
  },
  // Astro: .astro pages in a layout with the client router (links swap the page in place), a component, a stylesheet
  // and a client script (the page's own script, bundled by Astro: its "island" here, with no UI framework).
  astro: {
    deps: { astro: '7.4.13' },
    fixed: {
      'package.json': pkg('astro', 'astro dev', { type: 'module' }),
      'astro.config.mjs': `import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`,
      ...PUBLIC('public/'),
      'src/layouts/Base.astro': `---
import { ClientRouter } from 'astro:transitions';
import Shared from '../components/Shared.astro';
import '../styles/style.css';
const { route } = Astro.props;
---
<html lang="en">
  <head><meta charset="utf-8" /><title>{route}</title><ClientRouter /></head>
  <body>
    <main id="m">
      <h1 id="anchor-a">Stable heading</h1>
      <slot />
      <Shared />
      <button id="count">0</button>
      <nav><a id="nav-home" href="/">home</a> <a id="nav-about" href="/about">about</a></nav>
    </main>
    <script>import '../lib/island.js';</script>
  </body>
</html>
`,
      'src/lib/island.js': `let n = 0;\nconst show = () => {\n  const b = document.getElementById('count');\n  if (b) b.textContent = String(n);\n};\ndocument.addEventListener('click', (e) => {\n  if (e.target && e.target.id === 'count') (n++, show());\n});\ndocument.addEventListener('astro:page-load', show);\n`,
    },
    pages: {
      home: { file: 'src/pages/index.astro', url: '/', key: '/index' },
      about: { file: 'src/pages/about.astro', url: '/about', key: '/about' },
    },
    pageText: (tok, route) => `---\nimport Base from '../layouts/Base.astro';\n---\n<Base route="${route}"><p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p></Base>\n`,
    pageBroken: (tok, route) => `---\nimport Base from '../layouts/Base.astro';\nconst x = ;\n---\n<Base route="${route}"><p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p></Base>\n`,
    comp: {
      file: 'src/components/Shared.astro',
      text: (t) => `---\nimport { MOD } from '../lib/mod.js';\n---\n<p id="tok-comp" data-v="${t}">comp ${t}</p>\n<p id="tok-mod" data-v={MOD}>mod {MOD}</p>\n`,
      broken: (t) => `---\nimport { MOD } from '../lib/mod.js';\nconst x = ;\n---\n<p id="tok-comp" data-v="${t}">comp ${t}</p>\n`,
    },
    mod: { file: 'src/lib/mod.js', text: MOD, broken: MOD_BROKEN },
    css: { file: 'src/styles/style.css', text: CSS },
    newRoute: (n) => ({ file: `src/pages/extra${n}.astro`, url: `/extra${n}`, key: `/extra${n}` }),
    spa: true,
    start: (port, bin) => [process.execPath, path.join(bin, 'astro/bin/astro.mjs'), 'dev', '--port', String(port), '--ignore-lock'],
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
    hmr: 'vite',
    slowStart: 60000,
  },
  // webpack 5 with webpack-dev-server and hot module replacement: one page from an HTML template (never saved again:
  // webpack-dev-server only reloads for a template when told to watch it, and loses such a reload while a page loads),
  // a module that holds the page's own version, a module that draws, a module it imports, a stylesheet.
  webpack: {
    deps: { webpack: '5.113.0', 'webpack-cli': '7.3.1', 'webpack-dev-server': '6.1.0', 'html-webpack-plugin': '5.6.8', 'style-loader': '4.0.0', 'css-loader': '7.1.5' },
    fixed: {
      'package.json': pkg('webpack', 'webpack serve'),
      'webpack.config.js': WEBPACK_CONFIG(''),
      ...PUBLIC('public/'),
      'src/index.js': `import './style.css';\nimport { render } from './comp.js';\nimport { PAGE } from './page.js';\nconst draw = () => {\n  render();\n  const e = document.getElementById('tok-page');\n  if (e) (e.dataset.v = PAGE), (e.textContent = 'page ' + PAGE);\n};\ndraw();\nlet n = 0;\nconst b = document.getElementById('count');\nif (b) b.onclick = () => (b.textContent = String(++n));\nif (module.hot) module.hot.accept(['./comp.js', './page.js'], draw);\n`,
      'src/index.html': PLAIN_PAGE({ about: '/' })('-', 'home').replace(' data-v="-">page -<', '>-<'),
    },
    csp: { 'webpack.config.js': WEBPACK_CONFIG(`headers: { 'Content-Security-Policy': ${JSON.stringify(CSP)} }, `) },
    pages: { home: { file: 'src/page.js', url: '/', key: '/index' } },
    pageText: (tok) => `export const PAGE = '${tok}';\n`,
    pageBroken: (tok) => `export const PAGE = '${tok}' + ;\n`,
    comp: { file: 'src/comp.js', text: (t) => DRAW(t, './mod.js'), broken: (t) => DRAW_BROKEN(t, './mod.js') },
    mod: { file: 'src/mod.js', text: MOD, broken: MOD_BROKEN },
    css: { file: 'src/style.css', text: CSS },
    newRoute: null,
    spa: false,
    start: (port, bin) => [process.execPath, path.join(bin, 'webpack-cli/bin/cli.js'), 'serve', '--port', String(port)],
    hmr: 'webpack',
    slowStart: 60000,
  },
  // Next.js (app router): a layout with next/link, a page per route, a server component, a client component that counts.
  next: {
    deps: { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' },
    fixed: {
      'package.json': pkg('next', 'next dev'),
      'next.config.mjs': `export default {};\n`,
      ...PUBLIC('public/'),
      'app/layout.jsx': `import './style.css';
import Link from 'next/link';
import Shared from './Shared.jsx';
import Counter from './Counter.jsx';
export const metadata = { title: 'next' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <main id="m">
          <h1 id="anchor-a">Stable heading</h1>
          {children}
          <Shared />
          <Counter />
          <nav><Link id="nav-home" href="/">home</Link> <Link id="nav-about" href="/about">about</Link></nav>
        </main>
      </body>
    </html>
  );
}
`,
      'app/Counter.jsx': `'use client';\nimport { useState } from 'react';\nexport default function Counter() {\n  const [n, setN] = useState(0);\n  return <button id="count" onClick={() => setN(n + 1)}>{n}</button>;\n}\n`,
    },
    pages: {
      home: { file: 'app/page.jsx', url: '/', key: '/index' },
      about: { file: 'app/about/page.jsx', url: '/about', key: '/about' },
    },
    pageText: (tok, route) => `export default function Page() {\n  return <p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p>;\n}\n`,
    pageBroken: (tok, route) => `export default function Page() {\n  return <p id="tok-page" data-route="${route}" data-v="${tok}">page ${tok}</p\n}\n`,
    comp: {
      file: 'app/Shared.jsx',
      text: (t) => `import { MOD } from './mod.js';\nexport default function Shared() {\n  return (\n    <>\n      <p id="tok-comp" data-v="${t}">comp ${t}</p>\n      <p id="tok-mod" data-v={MOD}>mod {MOD}</p>\n    </>\n  );\n}\n`,
      broken: (t) => `import { MOD } from './mod.js';\nexport default function Shared() {\n  return (\n    <>\n      <p id="tok-comp" data-v="${t}">comp ${t}</p>\n  );\n}\n`,
    },
    mod: { file: 'app/mod.js', text: MOD, broken: MOD_BROKEN },
    css: { file: 'app/style.css', text: CSS },
    newRoute: (n) => ({ file: `app/extra${n}/page.jsx`, url: `/extra${n}`, key: `/extra${n}` }),
    spa: true,
    start: (port, bin) => [process.execPath, path.join(bin, 'next/dist/bin/next'), 'dev', '-p', String(port)],
    env: { NEXT_TELEMETRY_DISABLED: '1' },
    hmr: 'next',
    slowStart: 90000,
  },
  // A plain static server (python3 -m http.server): no build, no live reload of its own. Behind the lab nothing
  // reloads such a page ("the dev server reloads its own pages"), so its pages are only read after a reload by hand.
  static: {
    deps: {},
    fixed: {
      'package.json': pkg('static', 'python3 -m http.server'),
      ...PUBLIC(''),
      'main.js': `import { render } from './comp.js';\nrender();\nlet n = 0;\nconst b = document.getElementById('count');\nif (b) b.onclick = () => (b.textContent = String(++n));\n`,
    },
    pages: {
      home: { file: 'index.html', url: '/', key: '/index' },
      about: { file: 'about.html', url: '/about.html', key: '/about' },
    },
    pageText: PLAIN_PAGE({ about: '/about.html', head: '<link rel="stylesheet" href="/style.css">', body: '<script type="module" src="/main.js"></script>' }),
    comp: { file: 'comp.js', text: (t) => DRAW(t, './mod.js') },
    mod: { file: 'mod.js', text: MOD },
    css: { file: 'style.css', text: CSS },
    newRoute: (n) => ({ file: `extra${n}.html`, url: `/extra${n}.html`, key: `/extra${n}` }),
    spa: false,
    start: (port) => ['python3', '-m', 'http.server', String(port), '--bind', '127.0.0.1'],
    hmr: null,
    noReload: true,
  },
};

/** Every version the README names: { framework: { package: version } }. */
export const VERSIONS = Object.fromEntries(Object.entries(FRAMEWORKS).map(([k, f]) => [k, f.deps]));

const stampOf = (fw) => createHash('sha256').update(JSON.stringify([FRAMEWORKS[fw].deps, process.versions.node.split('.')[0], process.platform, process.arch])).digest('hex').slice(0, 16);
export const homeOf = (fw) => path.join(CACHE, fw);
export const binOf = (fw) => path.join(CACHE, fw, 'node_modules');
export const isInstalled = (fw) => {
  try {
    return fs.readFileSync(path.join(homeOf(fw), '.stamp'), 'utf8').trim() === stampOf(fw);
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Installs what is missing, once: each framework's exact versions into CACHE/<fw> (npm install, no audit), several at
 * a time. A second run finds the stamp and installs nothing. Two runs at once wait for each other (a lock folder).
 * Also clears case folders a crashed run left more than two hours ago. Returns { fw: { ok, ms, error } }.
 */
export async function ensureInstalled(names, say = () => {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = {};
  await Promise.all(names.map(async (fw) => {
    const dir = homeOf(fw);
    const t0 = Date.now();
    fs.mkdirSync(path.join(dir, 'cases'), { recursive: true });
    for (const d of fs.readdirSync(path.join(dir, 'cases'))) {
      try {
        if (Date.now() - fs.statSync(path.join(dir, 'cases', d)).mtimeMs > 2 * 3600e3) fs.rmSync(path.join(dir, 'cases', d), { recursive: true, force: true });
      } catch {}
    }
    if (isInstalled(fw)) return void (out[fw] = { ok: true, ms: 0 });
    const lock = path.join(dir, '.installing');
    for (let n = 0; ; n++) {
      try {
        fs.mkdirSync(lock);
        break;
      } catch (e) {
        // Only a lock that is there means another run: a cache that can't be written is said, not waited on forever.
        if (e?.code !== 'EEXIST') return void (out[fw] = { ok: false, ms: Date.now() - t0, error: `can't take the install lock ${lock}: ${e?.message || e}` });
        // Another run is installing it (or one died doing so, more than ten minutes ago).
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 600e3) fs.rmSync(lock, { recursive: true, force: true });
        } catch {}
        await sleep(1000);
        if (isInstalled(fw)) return void (out[fw] = { ok: true, ms: Date.now() - t0 });
      }
    }
    try {
      // Another run may have installed it between the look above and taking the lock: then its files stay as they are.
      if (isInstalled(fw)) return void (out[fw] = { ok: true, ms: Date.now() - t0 });
      if (!Object.keys(FRAMEWORKS[fw].deps).length) {
        fs.writeFileSync(path.join(dir, '.stamp'), stampOf(fw));
        return void (out[fw] = { ok: true, ms: 0 });
      }
      say(`installing ${fw} (${Object.entries(FRAMEWORKS[fw].deps).map(([k, v]) => `${k}@${v}`).join(', ')}) into ${dir}`);
      // The old stamp goes first: an install that fails half way must not leave a stamp that says the cache is whole.
      fs.rmSync(path.join(dir, '.stamp'), { force: true });
      fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
      fs.rmSync(path.join(dir, 'package-lock.json'), { force: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `torture-cache-${fw}`, private: true, dependencies: FRAMEWORKS[fw].deps }, null, 2));
      const r = await new Promise((resolve) => {
        const p = spawn('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--save-exact'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_update_notifier: 'false' } });
        let log = '';
        p.stdout.on('data', (d) => (log += d));
        p.stderr.on('data', (d) => (log += d));
        p.once('error', (e) => resolve({ code: -1, log: String(e) }));
        p.once('close', (code) => resolve({ code, log }));
      });
      if (r.code !== 0) return void (out[fw] = { ok: false, ms: Date.now() - t0, error: r.log.trim().slice(-600) });
      fs.writeFileSync(path.join(dir, '.stamp'), stampOf(fw));
      say(`installed ${fw} in ${Math.round((Date.now() - t0) / 1000)} s`);
      out[fw] = { ok: true, ms: Date.now() - t0 };
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }));
  return out;
}

/** What a framework's project looks like at the start: every file with its text. `tokOf(file)` names each file's version. */
export function projectFiles(fw, tokOf, { csp = false, favicon = true } = {}) {
  const F = FRAMEWORKS[fw];
  const out = { ...F.fixed, ...(csp && F.csp ? F.csp : {}) };
  if (!favicon) for (const f of Object.keys(out)) if (f.endsWith('favicon.ico')) delete out[f];
  for (const [route, p] of Object.entries(F.pages)) out[p.file] = F.pageText(tokOf(p.file), route);
  for (const k of ['comp', 'mod', 'css']) out[F[k].file] = F[k].text(tokOf(F[k].file));
  return out;
}
