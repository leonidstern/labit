// The recorder for the phone checks (test/phone/sim.mjs). It writes down, every frame while something happens and a
// few times a second otherwise: where the page is scrolled, what the keyboard covers, what has focus, what text is
// selected, where the pins and the comment boxes are, and where the page's own paragraphs sit on the screen. It sends
// that to the runner's sink, which checks it. The page is the test's own; the widget is untouched.
(() => {
  if (self !== top) return; // a frame (a board's pages are iframes) records nothing: its lines would pass for the page's
  const SINK = `http://${location.hostname}:${Number(location.port) + 1}/log`;
  // A name of its own, so the widget never asks and never uses anyone's real name.
  try { if (!localStorage.getItem('lab-name')) localStorage.setItem('lab-name', 'phone-check'); } catch {}
  const load = Math.random().toString(36).slice(2, 8); // one per page load: a reload or a navigation shows as a new one
  const q = [];
  const r = (e) => (e ? (({ left, top, width, height }) => ({ x: Math.round(left), y: Math.round(top), w: Math.round(width), h: Math.round(height) }))(e.getBoundingClientRect()) : null);
  const desc = (e) => (e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}` : null);
  const shadow = () => document.querySelector('[data-lab-comments]')?.shadowRoot || null;
  const bv = () => {
    const v = document.querySelector('[data-lab-board-view]');
    if (!v) return null;
    const s = v.shadowRoot;
    return { ...r(v), close: r(s?.querySelector('.bv-close')), closeText: s?.querySelector('.bv-close')?.textContent, size: r(s?.querySelector('.bv-size')), sizeText: s?.querySelector('.bv-size')?.textContent, frames: [...(s?.querySelectorAll('#lab-board .f') || [])].map((f) => ({ id: f.dataset.id, ...r(f) })) };
  };
  const snap = (why, extra) => {
    const sr = shadow();
    const vv = visualViewport;
    const ae = document.activeElement;
    const inner = sr?.activeElement;
    const visible = (sel) => [...(sr?.querySelectorAll(sel) || [])].filter((n) => !n.hidden && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
    const t = {};
    for (const n of document.querySelectorAll('[data-t]')) t[n.id] = r(n);
    q.push({
      at: Date.now(), why, load, href: location.pathname,
      sy: Math.round(scrollY), ih: innerHeight, iw: innerWidth,
      vh: Math.round(vv.height), vt: Math.round(vv.offsetTop), vs: +vv.scale.toFixed(3),
      ae: desc(ae), inner: inner ? desc(inner) + (inner.closest?.('.float') ? '@float' : inner.closest?.('.card') ? '@card' : inner.closest?.('.chatwin') ? '@chat' : '') : null,
      sel: String(getSelection?.() || '').slice(0, 40),
      pins: visible('.pin').map((p) => ({ ...r(p), c: p.className, fixed: p.style.position === 'fixed' })), // fixed: a pin of a board's frame (held to the screen)
      float: r(visible('.float')[0]), card: r(visible('.card')[0]), chat: r(visible('.chatwin')[0]),
      rows: visible('.choice').map(r), keep: r(visible('.keep')[0]), // a question's choices; a Keep button must not exist any more (a tap answers)
      hash: location.hash, bv: bv(), // a board opened over the page (src/board/overlay.ts): the view, its buttons, its frames
      scrimOn: (() => { const s = sr?.querySelector('.scrim'); return Boolean(s && getComputedStyle(s).display !== 'none' && +getComputedStyle(s).opacity > 0); })(),
      chatBtn: r(visible('.chat-btn')[0]), toggle: r(visible('.toggle')[0]),
      // The quoted words are lit (CSS highlight) on text that can't be selected: Safari then paints whole blocks green.
      quoteOnUnselectable: (() => { const h = window.CSS?.highlights?.get('lab-quote'); if (!h?.size) return null; const r = [...h][0]; const e = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement; const cs = e && getComputedStyle(e); return Boolean(cs && (cs.webkitUserSelect || cs.userSelect) === 'none'); })(),
      t, ...extra,
    });
  };
  // Every frame for 3 s after anything happens; otherwise four times a second.
  let until = 0;
  const frame = () => { if (performance.now() < until) { snap('frame'); requestAnimationFrame(frame); } };
  const busy = (why, extra) => { snap(why, extra); const was = performance.now() < until; until = performance.now() + 3000; if (!was) requestAnimationFrame(frame); };
  setInterval(() => performance.now() >= until && snap('tick'), 250);
  const pt = (e) => ({ type: e.type, kind: e.pointerType || (e.touches ? 'touch' : ''), cx: Math.round(e.clientX ?? e.changedTouches?.[0]?.clientX ?? -1), cy: Math.round(e.clientY ?? e.changedTouches?.[0]?.clientY ?? -1), sx: Math.round(e.screenX ?? e.changedTouches?.[0]?.screenX ?? -1), sy2: Math.round(e.screenY ?? e.changedTouches?.[0]?.screenY ?? -1), on: desc(e.composedPath?.()[0] || e.target) });
  for (const k of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'contextmenu']) addEventListener(k, (e) => busy(k, { ev: pt(e) }), { capture: true, passive: true });
  for (const k of ['focusin', 'focusout', 'selectionchange']) document.addEventListener(k, () => busy(k), true);
  addEventListener('scroll', () => busy('scroll'), { passive: true });
  visualViewport.addEventListener('resize', () => busy('vv-resize'));
  visualViewport.addEventListener('scroll', () => busy('vv-scroll'));
  addEventListener('pagehide', () => { snap('pagehide'); flush(true); });
  const flush = (last) => {
    if (!q.length) return;
    const body = JSON.stringify({ ua: navigator.userAgent, lines: q.splice(0) });
    if (last && navigator.sendBeacon) navigator.sendBeacon(SINK, body);
    else fetch(SINK, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  };
  setInterval(flush, 300);
  addEventListener('load', () => busy('load'));
  // The runner can ask the page a question (sim.mjs ask "<js>"): it runs here and the answer goes back with the log.
  setInterval(async () => {
    try {
      const js = await (await fetch(SINK.replace('/log', '/ask'))).text();
      if (!js) return;
      let out;
      try { out = await new Function('shadow', `return (async () => (${js}))()`)(shadow()); } catch (e) { out = 'error: ' + e.message; }
      q.push({ at: Date.now(), why: 'answer', load, answer: typeof out === 'string' ? out : JSON.stringify(out) });
      flush();
    } catch {}
  }, 500);
})();
