// Timing recorder for a phone's thread sheet (run.mjs injects it into a copy of a site; see there). Not part of `npm test`
// or CI. In the page it:
// - records every interaction a touch starts: the frames after it (rAF times, the open sheet's top, the dimmed page's
//   opacity, the scroll, the keyboard), the tap's click handler time and Event Timing entries, and posts it to the sink;
// - runs the widget's own open and close paths by script (`bench`): a pin's click (what a tap on it ends in) and a click on
//   the dimmed page, each timed from the dispatch to the frames that follow;
// - answers `ask`: JavaScript from run.mjs, with the widget's shadow root as `shadow`.
(() => {
  if (self !== top) return;
  const SINK = `http://${location.hostname}:${Number(document.currentScript?.dataset.sink) || Number(location.port) + 1}`;
  const q = [];
  const post = (o) => q.push({ at: Date.now(), ...o });
  const flush = () => {
    if (!q.length) return;
    const body = JSON.stringify({ lines: q.splice(0) });
    fetch(`${SINK}/log`, { method: 'POST', body, keepalive: body.length < 60000 }).catch(() => {});
  };
  setInterval(flush, 300);
  const host = () => document.querySelector('[data-lab-comments]');
  const root = () => host()?.shadowRoot;
  const now = () => Math.round(performance.now() * 10) / 10;
  // What shows, cheaply: the open sheet (or the one leaving), the dimmed page, the host's states, scroll and keyboard.
  const look = () => {
    const r = root();
    const sheet = r?.querySelector('.card:not(.out), .float:not(.out)') || r?.querySelector('.card.out, .float.out');
    const box = sheet?.getBoundingClientRect();
    const scrim = r?.querySelector('.scrim');
    const h = host();
    const o = {
      k: sheet ? sheet.className.split(' ')[0] + (sheet.classList.contains('out') ? '.out' : '') : '-',
      top: box ? Math.round(box.top) : null,
      so: scrim && getComputedStyle(scrim).display !== 'none' ? +(+getComputedStyle(scrim).opacity).toFixed(2) : 0,
      a: h ? ['data-sheet', 'data-leaving', 'data-opening', 'data-kb'].filter((n) => h.hasAttribute(n)).join(',') : '',
      sy: Math.round(scrollY),
      vh: Math.round(visualViewport.height),
      vt: Math.round(visualViewport.offsetTop),
    };
    o.s = JSON.stringify([o.k, o.top, o.so, o.a, o.sy, o.vh, o.vt]);
    return o;
  };
  // Event Timing (Safari 26+): events whose handling and next paint took 16 ms or more. Long tasks where there are any.
  const entries = [];
  const types = PerformanceObserver.supportedEntryTypes || [];
  for (const type of ['event', 'longtask', 'long-animation-frame']) {
    if (!types.includes(type)) continue;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) entries.push({ type, name: e.name, start: Math.round(e.startTime), dur: Math.round(e.duration), work: e.processingEnd ? Math.round(e.processingEnd - e.processingStart) : undefined }); })
        .observe({ type, buffered: false, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
    } catch {}
  }
  // One recording: frames from t0 for `ms` (longer while touches keep coming). Frames are read right after they are drawn
  // (a message posted from rAF runs after the rendering step).
  let rec = null;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => rec && rec.frames.push({ raf: rec.raf, ...look() });
  const frame = (t) => {
    if (!rec) return;
    rec.raf = Math.round(t * 10) / 10;
    ch.port2.postMessage(0);
    if (performance.now() < rec.until) requestAnimationFrame(frame);
    else finish();
  };
  let done = null;
  const finish = () => {
    const r = rec;
    rec = null;
    r.entries = entries.filter((e) => e.start >= r.t0 - 50 && e.start <= r.until);
    post({ why: 'run', ...r });
    done?.(r);
  };
  const start = (t0, label, ev, ms = 1600) => {
    if (rec) return void (rec.ev.push(ev), (rec.until = Math.max(rec.until, performance.now() + ms)));
    rec = { label: label || window.__perfLabel || '', t0, ev: [ev], pre: look(), frames: [], clicks: [], until: performance.now() + ms };
    requestAnimationFrame(frame);
  };
  for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click'])
    addEventListener(type, (e) => start(Math.round(e.timeStamp * 10) / 10, '', { type, t: Math.round(e.timeStamp), x: Math.round(e.touches?.[0]?.clientX ?? e.clientX ?? -1), y: Math.round(e.touches?.[0]?.clientY ?? e.clientY ?? -1) }), { capture: true, passive: true });
  // A tap's click: how long its handlers (the widget's render) kept the page busy.
  addEventListener('click', (e) => {
    const t = performance.now();
    const c = new MessageChannel();
    c.port1.onmessage = () => rec?.clicks.push({ at: Math.round(e.timeStamp), handler: Math.round((performance.now() - t) * 10) / 10 });
    c.port2.postMessage(0);
  }, { capture: true });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pinNo = (n) => [...(root()?.querySelectorAll('.pin') || [])].find((p) => new RegExp(`^comment ${n} by`).test(p.getAttribute('aria-label') || ''));
  // The widget's own paths, by script: a click on pin n (a phone opens its sheet through goTo), then one on the dimmed page.
  // Each is timed from the dispatch: the handler, then the frames until it rests.
  const timed = async (label, act) => {
    const t0 = now();
    const recDone = new Promise((r) => (done = r));
    start(t0, label, { type: 'script', t: Math.round(t0) }, 1400);
    const h0 = performance.now();
    act();
    rec.clicks.push({ at: Math.round(t0), handler: Math.round((performance.now() - h0) * 10) / 10 });
    const r = await recDone;
    done = null;
    return r;
  };
  window.__perf = {
    async bench({ pins = [7], n = 5, label = '', at = 237 } = {}) {
      for (const pin of pins)
        for (let i = 0; i < n; i++) {
          const p = pinNo(pin);
          if (!p) return `no pin ${pin}`;
          if (root().querySelector('.card:not(.out), .float:not(.out)')) { root().querySelector('.scrim').click(); await sleep(900); }
          scrollTo(0, scrollY + p.getBoundingClientRect().top - at);
          await sleep(900);
          await timed(`${label}pin${pin}:open`, () => pinNo(pin).click());
          await sleep(400);
          await timed(`${label}pin${pin}:close`, () => root().querySelector('.scrim').click());
          await sleep(500);
        }
      flush();
      return 'done';
    },
  };
  // run.mjs ask: JavaScript to run here, its answer posted back.
  setInterval(async () => {
    if (document.hidden) return; // a tab in the background answers nothing
    try {
      const js = await (await fetch(`${SINK}/ask`)).text();
      if (!js) return;
      let answer;
      try {
        answer = await new Function('shadow', `return (async () => (${js}))()`)(root());
      } catch (e) {
        answer = `error: ${e.message}`;
      }
      post({ why: 'answer', answer: typeof answer === 'string' ? answer : JSON.stringify(answer) });
      flush();
    } catch {}
  }, 400);
  post({ why: 'load', ua: navigator.userAgent, types });
})();
