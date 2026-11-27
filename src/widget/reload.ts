// Live reload in place (a save in the lab: a stylesheet, a picture, a font or the page's own HTML patched without a
// reload). Part of the comment widget, its own file (public/_lab/reload.js), loaded by live.ts on the first save the page
// hears about: a page nobody edits never downloads it. live.ts hands over what it shares (startLive's own helpers).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { W: any; reload: () => void; loaded: (p: string, by?: RegExp) => boolean; samePath: (u: string, paths: string[] | null) => boolean; idOf: (x: any) => string; selDirty: (n: any) => boolean; board: boolean; scriptsOf: (doc: Document) => string[]; ownScripts: () => boolean; aroundMorph: (change: () => void) => void };
export function reloader({ W, reload, loaded, samePath, idOf, selDirty, board, scriptsOf, ownScripts, aroundMorph }: Ctx) {
  // A CSS save: load the new stylesheet next to the old one and drop the old one once it's in, so nothing flashes,
  // moves or closes. The saved file's own <link>s, or every same-site one when it's pulled in another way (@import).
  let swapN = 0;
  const swapCss = (files) => {
    // A saved stylesheet this page never loaded (another page's) leaves it alone: it used to swap every sheet here, taking
    // it for an @import. One pulled in by @import is in the page's list of what it loaded too (live.ts loaded).
    if (files.length && !files.some((f) => loaded(f))) return;
    if (restyled) return reload(); // a sheet loaded again would bring the old picture's address back
    // A clone still loading from an earlier save is skipped (its original is swapped instead) and dropped once a newer one is in.
    const links = [...(document.querySelectorAll('link[rel~="stylesheet"][href]:not([data-lab-swap])') as NodeListOf<HTMLLinkElement>)].filter((l) => new URL(l.href, location.href).origin === location.origin);
    const own = (l: HTMLLinkElement) => decodeURIComponent(new URL(l.href, location.href).pathname);
    const named = links.filter((l) => files.includes(own(l)));
    // A saved file no link names is pulled in by @import: every sheet is swapped then, not only the ones named.
    for (const s of document.querySelectorAll('style')) if (/@import/.test(s.textContent) && !W.host.contains(s)) s.textContent += ''; // an @import in a style block is read again
    for (const link of named.length && files.every((f) => named.some((l) => own(l) === f)) ? named : links) {
      const url = new URL(link.href, location.href);
      url.searchParams.set('lab-v', Date.now().toString(36));
      const next = (link.cloneNode() as HTMLLinkElement);
      next.href = url.href;
      const n = ++swapN;
      next.dataset.labSwap = '' + n; // newer saves have higher numbers: a clone never removes one newer than itself
      const path = url.pathname;
      // The old one goes a frame after the new one has loaded, not in the same task: livereload-js waits a few ms there in WebKit.
      // It loads switched off (media "not all": fetched, not applied) and is switched on once loaded, with the pins placed
      // again in that frame: Chrome applied a loaded sheet and drew the page before its load event ran, so a layout it
      // moved showed the pins off their spots for a frame or two (488 px for ~28 ms, 27 Nov).
      const media = link.getAttribute('media');
      next.media = 'not all';
      next.addEventListener('load', () => {
        if (media) next.media = media;
        else next.removeAttribute('media');
        requestAnimationFrame(() => {
          if (!next.isConnected) return; // another clone of the same file took it out first
          for (const l of (document.querySelectorAll('link[rel~="stylesheet"][href]') as NodeListOf<HTMLLinkElement>)) if (l !== next && !(+l.dataset.labSwap! > n) && new URL(l.href, location.href).pathname === path) l.remove();
          delete next.dataset.labSwap;
        });
        W.reflow();
      }, { once: true });
      next.addEventListener('error', () => next.remove(), { once: true });
      link.after(next);
    }
  };
  // The address as the file wrote it, with a version on the end: a later patch of the page knows it for the same one.
  const plain = (u) => u.replace(/[?&]lab-v=\w+/g, '');
  const fresh = (u) => plain(u) + (plain(u).includes('?') ? '&' : '?') + 'lab-v=' + Date.now().toString(36);
  // A picture or SVG: every element that shows it gets the new file (img, srcset, poster, SVG image/use, the tab
  // icon). With no paths: every picture. Returns how many it swapped (none: it's a CSS background, so the stylesheets are).
  const swapImages = (paths) => {
    let hit = 0;
    for (const n of document.querySelectorAll('img, input, object, embed, source, video[poster], image, use, link[rel~="icon"]')) {
      if (W.host.contains(n)) continue;
      for (const attr of ['src', 'href', 'data', 'poster', 'xlink:href']) {
        const v = n.getAttribute(attr);
        if (!v || !samePath(v.split('#')[0], paths)) continue;
        // The new file is loaded and decoded first, then shown: the picture never blinks empty.
        const next = fresh(v.split('#')[0]);
        (n as any)['lab' + attr] = next;
        const im = new Image();
        const ready = new Promise((ok) => ((im.onload = () => ok(true)), (im.onerror = () => ok(false))));
        im.src = next;
        // A file that is not there (deleted, about to be written again) leaves the old picture showing.
        void ready.then(async (ok) => {
          if (ok) await im.decode?.().catch(() => {});
          if (ok && (n as any)['lab' + attr] === next) n.setAttribute(attr, next + (v.includes('#') ? v.slice(v.indexOf('#')) : ''));
        });
        hit++;
      }
      const set = n.getAttribute('srcset');
      if (set && set.split(',').some((c) => samePath(c.trim().split(/\s+/)[0], paths))) {
        n.setAttribute('srcset', set.split(',').map((c) => {
          const [u, ...rest] = c.trim().split(/\s+/);
          return [samePath(u, paths) ? fresh(u) : u, ...rest].join(' ');
        }).join(', '));
        hit++;
      }
    }
    return hit;
  };
  // A picture only a stylesheet shows (a CSS background, a ::before, a variable): the browser keeps its copy under the old address,
  // so every url() in the page's CSS that names it gets a new version, in place. The next save of a stylesheet loads the old address
  // again, so that one reloads the page (`restyled`).
  let restyled = false;
  const restyle = (paths) => {
    const urls = new Map(); // old address -> new address
    const failed = new Set(); // a new picture that didn't load (mid-save): its old address stays
    const fix = (text, base) =>
      text.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, _q, u) => {
        try {
          const abs = new URL(u, base).href;
          if (!samePath(abs.split('#')[0], paths) || failed.has(abs)) return m;
          if (!urls.has(abs)) urls.set(abs, fresh(abs));
          return `url("${urls.get(abs)}")`;
        } catch {
          return m;
        }
      });
    // One pass finds them (and changes nothing), the new pictures load, then a second pass puts the new addresses in: no blank between.
    const pass = (apply) => {
      const walk = (rules, base) => {
        for (const r of rules || []) {
          try {
            const css = r.style?.cssText;
            if (css && css.includes('url(')) {
              const t = fix(css, base);
              if (apply && t !== css) r.style.cssText = t;
            }
            if (r.styleSheet) walk(r.styleSheet.cssRules, r.styleSheet.href || base);
            else walk(r.cssRules, base);
          } catch {} // another site's sheet, or a rule that can't be read
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          if (!W.host.contains(sheet.ownerNode as Node)) walk(sheet.cssRules, sheet.href || location.href);
        } catch {} // another site's sheet
      }
      for (const n of document.querySelectorAll('[style*="url("]')) {
        const t = W.host.contains(n) ? '' : fix(n.getAttribute('style'), location.href);
        if (apply && t && t !== n.getAttribute('style')) n.setAttribute('style', t);
      }
    };
    pass(false);
    if (!urls.size) return 0;
    restyled = true;
    void Promise.all([...urls].map(([old, u]) => new Promise((done) => Object.assign(new Image(), { onload: done, onerror: () => done(failed.add(old)), src: u })))).then(() => pass(true));
    return urls.size;
  };
  // A font: each @font-face that uses it is loaded again as a new face, which takes over from the old one.
  const reloadFonts = (paths) => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // another site's stylesheet
      }
      const all = (rs, out = []) => { for (const r of rs || []) { out.push(r); try { all(r.styleSheet ? r.styleSheet.cssRules : r.cssRules, out); } catch {} } return out; };
      for (const r of all(rules)) {
        if (!(r instanceof CSSFontFaceRule)) continue;
        const src = r.style.getPropertyValue('src');
        const base = r.parentStyleSheet.href || location.href;
        if (!/url\(/.test(src) || ![...src.matchAll(/url\(["']?([^"')]+)/g)].some((m) => samePath(new URL(m[1], base).href, paths))) continue;
        const again = src.replace(/url\(["']?([^"')]+)["']?\)/g, (all, u) => (samePath(new URL(u, base).href, paths) ? `url("${fresh(new URL(u, base).href)}")` : all));
        const d = (k) => r.style.getPropertyValue(k) || undefined;
        try {
          const face = new FontFace(d('font-family').replace(/^["']|["']$/g, ''), again, ({ weight: d('font-weight'), style: d('font-style'), stretch: d('font-stretch'), unicodeRange: d('unicode-range'), display: d('font-display') } as any));
          face.load().then((f) => document.fonts.add(f)).catch(() => {});
        } catch {}
      }
    }
  };
  // An HTML page: fetch it and change only what differs, in place (scroll, open things and typed text stay). A
  // changed script or stylesheet list can't be patched safely: then it's a normal reload.
  const ownStyles = () => new Set([W.pageStyle, W.pinCursorStyle]);
  const sheetsOf = (doc) => [...doc.querySelectorAll('link[rel~="stylesheet"]:not([data-lab-swap])')].map((l) => { try { return new URL(l.getAttribute('href'), location.href).pathname; } catch { return ''; } });
  // What the morph touched, to be outlined for a moment: the person sees what the agent's save changed.
  const touched = new Set<Element>();
  const hit = (n) => (n?.nodeType === 1 ? touched.add(n) : touched.add(n?.parentNode));
  // Labit's own (the widget, an open board's view: +board writes the page's file while its board is open) and scripts.
  const keepOut = (n) => n === W.host || (n.nodeType === 1 && (n.localName === 'script' || n.hasAttribute('data-lab-board-view')));
  // Old and new children are paired in order, looking a few ahead, so an added or removed element doesn't shift
  // everything after it (an open <details> further down stays the same element, and stays open).
  const same = (o, n) => o.nodeType === n.nodeType && o.nodeName === n.nodeName && idOf(o) === idOf(n);
  const alike = (o, n) => same(o, n) && (o.nodeType === 1 ? Boolean(idOf(o)) || o.getAttribute('class') === n.getAttribute('class') : o.nodeType !== 3 || o.data === n.data);
  const morphKids = (a, b) => {
    const olds = [...a.childNodes].filter((n) => !keepOut(n));
    const news = [...b.childNodes].filter((n) => !(n.nodeType === 1 && n.localName === 'script'));
    let j = 0;
    let prev = null;
    const put = (n) => {
      const c = document.importNode(n, true);
      a.insertBefore(c, prev ? prev.nextSibling : olds[j] || a.firstChild);
      hit(c);
      return c;
    };
    news.forEach((n, i) => {
      const o = olds[j];
      if (!o) return void (prev = put(n));
      // The same kind of node as many left on both sides: it is the same one, whatever changed on it (a row whose class changed
      // keeps what was typed in it).
      const left = (l, x) => l.filter((m) => same(m, x)).length;
      if (alike(o, n) || (same(o, n) && left(olds.slice(j), n) === left(news.slice(i), n))) return void ((prev = morphNode(o, n)), j++);
      // The old one comes back a little later: this new one was added before it.
      if (news.slice(i + 1, i + 8).some((m) => alike(o, m))) return void (prev = put(n));
      // This new one is a little further on among the old ones: the ones before it were removed.
      const k = olds.slice(j + 1, j + 8).findIndex((m) => alike(m, n));
      if (k >= 0) {
        for (const gone of olds.slice(j, j + 1 + k)) gone.remove();
        j += k + 1;
        return void (prev = morphNode(olds[j], n), j++);
      }
      prev = morphNode(o, n);
      j++;
    });
    for (const o of olds.slice(j)) o.remove();
  };
  const morphNode = (o, n) => {
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName || idOf(o) !== idOf(n)) {
      const c = document.importNode(n, true);
      o.replaceWith(c);
      hit(c);
      return c;
    }
    if (o.nodeType === 3 || o.nodeType === 8) {
      if (o.data !== n.data) {
        o.data = n.data;
        hit(o);
      }
      return o;
    }
    if (o.nodeType !== 1) return o;
    if (o.isEqualNode(n)) return o; // the same inside and out: nothing to walk (Eleventy's dev server does this)
    // An opened <details> or <dialog> stays open (you opened it; the file doesn't say so).
    for (const { name } of Array.from(o.attributes as NamedNodeMap)) if (!n.hasAttribute(name) && !(name === 'open' && /^(details|dialog)$/.test(o.localName))) {
      o.removeAttribute(name);
      hit(o);
    }
    for (const { name, value } of Array.from(n.attributes as NamedNodeMap)) if (!o.hasAttribute(name) || plain(o.getAttribute(name)) !== value) {
      o.setAttribute(name, value);
      hit(o);
    }
    // A playing video, a canvas, a field's own value, a web component's insides: left as they are. What you typed stays,
    // because only the file's text under a <textarea> and the options of a <select> follow it.
    if (o.isContentEditable || o.shadowRoot || /^(iframe|canvas|video|audio|input|noscript)$/.test(o.localName)) return o;
    const picked = o.localName === 'select' && selDirty(o) ? [...o.options].filter((x) => x.selected).map((x) => x.value) : null;
    morphKids(o, n);
    if (picked) for (const x of o.options) x.selected = picked.includes(x.value);
    return o;
  };
  let morphRun = 0;
  const morphPage = async () => {
    if (board) return;
    const run = ++morphRun;
    try {
      const res = await fetch(location.href, { cache: 'no-store', headers: { accept: 'text/html', 'x-lab': '1' } });
      const html = await res.text();
      if (run !== morphRun) return; // a newer save is already being fetched: only the latest is applied
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // The file is gone for now (a build that clears its folder): the lab answers with its own screen, which has no
      // widget and nobody to hear the file come back. This page stays and follows the file when it is saved again.
      const tag = doc.querySelector('script[data-live]') as HTMLScriptElement | null;
      if (!res.ok || !tag) return;
      // The page's file is as it was when this one loaded (a lab restart with nothing saved meanwhile): nothing to do. A
      // page with scripts of its own was reloaded here every time (issue 428).
      if (tag.dataset.sum && tag.dataset.sum === W.script.dataset.sum) return;
      if (ownScripts() || scriptsOf(doc).join('\n') !== scriptsOf(document).join('\n') || sheetsOf(doc).join('\n') !== sheetsOf(document).join('\n')) return reload();
      // What you're looking at stays put: an element a third down the window keeps its place on screen. Found before
      // the change (during a cross-fade the page can't be hit-tested).
      let mark = null;
      for (const y of [Math.min(innerHeight / 3, 240), innerHeight / 2, 80]) {
        const e = document.elementFromPoint(innerWidth / 2, y);
        if (e && e !== document.body && e !== document.documentElement && !W.host.contains(e) && e !== W.host) {
          mark = e;
          break;
        }
      }
      const markTop = mark?.getBoundingClientRect().top;
      // The browser cross-fades the old page into the new one (View Transitions, Safari 18+ and Chrome; others just swap).
      const apply = () => {
        // The page's own new title, with the "(3)" of new messages kept in front.
        if (doc.title !== W.tabTitle.base) {
          W.tabTitle.base = doc.title;
          document.title = doc.title; // drawList puts the "(3)" back in front
          W.drawList();
        }
        const mine = ownStyles();
        // The lab's own (data-lab) are the widget's, not the page's.
        const olds = [...document.head.querySelectorAll('style:not([data-lab])')].filter((x) => !mine.has(x));
        const news = [...doc.head.querySelectorAll('style:not([data-lab])')];
        news.forEach((n, i) => (olds[i] ? olds[i].textContent !== n.textContent && (olds[i].textContent = n.textContent) : document.head.append(document.importNode(n, true))));
        for (const o of olds.slice(news.length)) o.remove();
        for (const { name, value } of Array.from(doc.body.attributes)) if (document.body.getAttribute(name) !== value) document.body.setAttribute(name, value);
        for (const { name } of Array.from(document.body.attributes)) if (!doc.body.hasAttribute(name)) document.body.removeAttribute(name);
        const H = document.documentElement;
        for (const { name, value } of Array.from(doc.documentElement.attributes)) {
          const v = name === 'class' ? [value, ...[...H.classList].filter((c) => c.startsWith('lab-'))].join(' ') : value;
          if (name !== 'style' && H.getAttribute(name) !== v) H.setAttribute(name, v);
        }
        W.script.dataset.sum = tag.dataset.sum || ''; // this page now is that file
        aroundMorph(() => morphKids(document.body, doc.body)); // a choice tried in the page: its words back first (thread.ts)
        // The elements that changed are outlined for a moment (not for someone who asked for less motion).
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (const e of [...touched].slice(0, 12)) if (e?.isConnected && e !== document.body) e.animate?.([{ outline: '2px solid Highlight' }, { outline: '2px solid transparent' }], 1200);
        touched.clear();
        if (mark?.isConnected) {
          const moved = mark.getBoundingClientRect().top - markTop;
          if (Math.abs(moved) > 1) scrollBy(0, moved);
        }
        W.reflow();
        W.relook();
      };
      // An error inside the cross-fade would go unseen: any failure falls back to a reload.
      const safe = () => {
        try {
          apply();
        } catch {
          reload();
        }
      };
      // WebKit shifts the whole page by scrollY for ~250 ms under a view transition when scrolled: it only fades there when at the top.
      const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
      if (document.startViewTransition && !W.still.matches && !(webkit && scrollY > 0)) {
        // Under the cross-fade the browser hits nothing but <html> (a click then pinned the page): W.fade is what a click waits for (comments.js, pinned).
        const fade: Promise<void> = (W.fade = Promise.race([document.startViewTransition(safe).finished.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]).then(() => void (W.fade === fade && (W.fade = null))));
      } else safe();
    } catch {
      reload();
    }
  };
  // Away for a while (a lab that restarted, saves missed): the page, every stylesheet and every picture again.
  const catchUp = () => {
    morphPage();
    swapCss([]);
    swapImages(null);
  };
  const hotUpdate = (files) => {
    const of = (kind) => files.filter((f) => f.kind === kind).map((f) => f.path);
    // Only a save of this page's own file patches it (another page saved in the lab changes nothing here).
    const here = decodeURIComponent(location.pathname).replace(/\/$/, '/index').replace(/\.html?$/i, '').toLowerCase();
    if (of('html').some((p) => !p || p.replace(/\.html?$/i, '').toLowerCase() === here)) morphPage();
    else if (of('html').some((p) => loaded(p, /fetch|xml/))) reload(); // a page a script fetched
    // A picture only a stylesheet shows (a CSS background): its addresses in the CSS get a new version; when none is found but the page loaded it, it reloads.
    // Both run: one picture can be an <img> and a CSS background at once.
    if (of('img').length) {
      const swapped = swapImages(of('img'));
      const restyled = restyle(of('img'));
      if (!swapped && !restyled && of('img').some((p) => loaded(p))) reload();
    }
    if (of('css').length) swapCss(of('css')); // after the pictures: one that was restyled makes this a reload
    if (of('font').length) reloadFonts(of('font'));
  };
  return { catchUp, hotUpdate };
}
