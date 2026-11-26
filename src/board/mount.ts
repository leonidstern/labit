// A board's frames on one canvas you pan and zoom, mounted into a box: the box of a board view (overlay.ts), over the
// page that links the board (Leo, 19 Nov: "can board be part of same page?") or, at the board's own address
// (/_lab/board/<name>), over an empty page. The board file and its API come from the lab (lib/board.ts, GET
// /_lab/api/board). Frames are the lab's own pages in iframes, named "lab:<id>", which the widget in them reads as
// "draw nothing, bind nothing" (src/widget/frame.ts, it finds window.__labBoard on top).
//
// Camera: cam = { x, y, z }, box = (world + cam) * z, the box's own px from its top left. The world is one element with one
// transform; a frame is a box in it.
import { clamp, fitAll, fitFrame, panBy, zoomAt } from './camera.ts';
import type { Cam, Box } from './camera.ts';

type Frame = { id: string; src: string; auto?: boolean; ow?: number; oh?: number; kind?: string; file?: string; iw?: number; ih?: number; pv?: number[]; guest?: boolean; w: number; h: number; x: number; y: number; label?: string; state?: string; variantOf?: string };
type Board = { rev: number; frames: Frame[]; of?: string } & Record<string, unknown>;
type Card = { s: Frame; f: Frame; box: HTMLElement; inner: HTMLElement; frame?: HTMLIFrameElement; seen: number; pv?: HTMLImageElement; at?: number };
type Spot = { left: number; top: number; zone: { left: number; top: number; width: number; height: number } | null; clipped?: boolean };

type MountOpts = {
  of?: string; // the page this board is about (the API's ?page=, and where back goes on the board page)
  back?: () => void; // ⇧B and Esc on an empty board: back to the page (the board page) or closing the view (a page's)
  hash?: boolean; // the camera is kept in the address's #x,y,z (the board page; a page's view keeps #board=<name>)
  keep?: string; // the camera is kept in localStorage under this key (a page's view), for the next time it opens
  home?: (key: string, of: string) => void; // told once which page this board lives on (its pins are that page's) and its address
};

const coarse = matchMedia('(pointer: coarse)').matches;
const CAP = coarse ? 3 : 8; // frames alive at once (a phone draws them at 390 wide, so three side by side stay light)
const AT_ONCE = coarse ? 1 : 2; // frames loading at once
const WAKE = coarse ? 56 : 120; // a frame is woken when it is in view and at least this many screen px wide (a phone: every frame fitted, live)

const css = `
#lab-board{position:fixed;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;cursor:default;background:#f7f7f7;color:#1d1d1b;font:13px/1.35 system-ui,-apple-system,sans-serif;overscroll-behavior:none}
@media (prefers-color-scheme:dark){#lab-board{background:#1b1b1a;color:#e9e8e4}}
#lab-board .dots{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,var(--lab-black-2,rgba(0,0,0,.1)) .5px,transparent 1px)}
@media (prefers-color-scheme:dark){#lab-board .dots{background-image:radial-gradient(circle,var(--lab-white-2,rgba(255,255,255,.1)) .5px,transparent 1px)}}
#lab-board .world{position:absolute;left:0;top:0;transform-origin:0 0}
#lab-board.alt{cursor:inherit}
#lab-board.grab,#lab-board.grab *{cursor:grab!important}
#lab-board.grab.grabbing,#lab-board.grab.grabbing *{cursor:grabbing!important}
#lab-board .f{position:absolute;outline:calc(1px*var(--iz,1)) solid rgba(0,0,0,.08)}
#lab-board .b{position:absolute;inset:0;background:#fff;contain:layout paint}
#lab-board .f.off{content-visibility:hidden}
@media (hover:hover){#lab-board:not(.alt,.grab) .f:hover{outline:calc(1px*var(--iz)) solid #1f7a4d}} /* what a click picks (Leo, 21 Nov: "cursor should have selection") */
#lab-board .f.sel,#lab-board .f.pick{outline:calc(1px*var(--iz)) solid #1f7a4d} /* picked or open: the same line as hover (Leo, 23 Nov: "just same as hover") */
#lab-board:not(.alt,.grab) .f.pick .b{cursor:move} /* a selected frame is dragged, with the others selected */
#lab-board .marq{position:absolute;z-index:4;box-sizing:border-box;border:1px solid #1f7a4d;background:color-mix(in srgb,#1f7a4d 8%,transparent);pointer-events:none}
#lab-board iframe,#lab-board img{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;pointer-events:none}
#lab-board .f.in iframe{pointer-events:auto}
@media (prefers-reduced-motion:no-preference){#lab-board.ease .f{transition:top var(--lab-t-slow,.3s) var(--lab-ease,ease),height var(--lab-t-slow,.3s) var(--lab-ease,ease)}}
#lab-board .t{position:absolute;left:0;bottom:100%;white-space:nowrap;max-width:calc(100% / var(--iz));overflow:hidden;text-overflow:ellipsis;transform-origin:0 100%;transform:scale(var(--iz));padding-bottom:4px;opacity:.75}
#lab-board .f.i:not(.sel,.pick,.down) .t{visibility:hidden} /* a picture's file name only once it is pressed or picked (Leo, 23 Nov: "dont show picture names files always"); a page's name always (Leo, 26 Nov: "show frame names right away") */
#lab-board .c{position:absolute;inset:0;box-sizing:border-box;padding:calc(20px*var(--iz));font-size:calc(14px*var(--iz));line-height:1.5;color:#1d1d1b;background:#f6f5f1}
#lab-board .c b{display:block;font-size:calc(22px*var(--iz));font-weight:600;margin-bottom:calc(6px*var(--iz))}
#lab-board .none{position:absolute;inset:0;display:grid;place-items:center;opacity:.7}
#lab-hand{position:fixed;z-index:2147483647;cursor:grab;touch-action:none}
#lab-hand.grabbing{cursor:grabbing}
#lab-board .zm{position:absolute;right:max(10px,env(safe-area-inset-right));top:10px;z-index:5;display:flex;flex-direction:row-reverse;align-items:center;gap:2px;font:500 12px/1 system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;color:inherit}
#lab-board .zm button{font:inherit;color:inherit;background:none;border:0;border-radius:var(--_radius,12px);padding:6px 8px;cursor:pointer;opacity:.55}
#lab-board .zm button:hover,#lab-board .zm.open button{opacity:1;background:rgba(0,0,0,.06)}
#lab-board .zm .zi{white-space:nowrap}
#lab-board .zm .zo{min-width:3.2em;text-align:right}
#lab-board .zm:not(.open) .zc{display:none}
@media (prefers-color-scheme:dark){#lab-board .zm button:hover,#lab-board .zm.open button{background:rgba(255,255,255,.08)}}
#lab-board img{object-fit:contain}
#lab-board .b:has(> img){background:none}#lab-board .b img{background:none;will-change:transform} /* each picture its own layer, the picture itself its texture (Safari does that only for a bare one, no background): a zoom scales it, never paints it again (Leo, 23 Nov: fine lines sparkled while zooming). No white card under it: at a half pixel its edge showed through as a light line while moving (Leo, 23 Nov: "some artifacts appears sometimes when moving images") */
#lab-board.drop{outline:2px solid #1f7a4d;outline-offset:-2px}
#lab-board .ghost{position:absolute;width:200px;height:120px;margin:-60px 0 0 -100px;display:grid;place-items:center;border:calc(1px*var(--iz,1)) dashed currentColor;background:rgba(127,127,127,.12);font-size:calc(14px*var(--iz,1));opacity:.8;pointer-events:none}
#lab-board .note{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:6;max-width:calc(100% - 32px);padding:8px 12px;border-radius:var(--_r-s,6px);background:#1d1d1b;color:#fff;pointer-events:none}
#lab-board .done{position:absolute;top:max(12px,env(safe-area-inset-top));left:12px;z-index:5;font:inherit;color:inherit;background:none;border:0;padding:8px;text-decoration:underline;cursor:pointer}
`;

/** The board called name in root (an element with id lab-board, positioned: it is the board's box). destroy() lets go of
 * every listener and the frames. */
export function mountBoard(root: HTMLElement, name: string, opts: MountOpts = {}) {
  // Its parts live in a shadow root when the view has one (overlay.ts): the sheet goes there, and what the page's event
  // listeners see of a press is the host, so a press is read from its composed path (src(), below).
  const scope = root.getRootNode() as Document | ShadowRoot;
  if (!scope.getElementById('lab-board-css')) (scope instanceof ShadowRoot ? scope : document.head).append(Object.assign(document.createElement('style'), { id: 'lab-board-css', textContent: css }));
  const inside = (e: Event, n: Node | null) => Boolean(n) && e.composedPath().includes(n!);
  const src = (e: Event) => e.composedPath()[0] as HTMLElement; // what was pressed, through the shadow root
  const focused = () => (scope instanceof ShadowRoot ? scope.activeElement : document.activeElement) as HTMLElement | null;
  const ac = new AbortController();
  const signal = ac.signal;
  const on = <K extends string>(type: K, fn: (e: never) => void, o: AddEventListenerOptions | boolean = {}) => addEventListener(type, fn as EventListener, { ...(typeof o === 'boolean' ? { capture: o } : o), signal });
  root.id = 'lab-board';
  // Not shown until the board has been read and fitted (or has failed to be): before, a reload drew the empty board at 100 %,
  // its dots and "100%" label at full size, and a moment later fitted it to 40 % with the frames in (Leo, 21 Nov: "when
  // reloading page its blinking like zoomed and elements appears weird").
  root.style.visibility = 'hidden';
  let shown = false;
  const reveal = () => {
    if (shown) return;
    shown = true;
    root.style.removeProperty('visibility');
    dispatchEvent(new Event('lab-board-moved')); // the widget draws the board's pins now: until here they are told as out of sight (spot, below), not left hanging over an empty board
  };
  // The canvas: a grid of dots, one background on one element (Leo, 19 Nov: "more fancy, maybe dotted, more our
  // style"; then "more whiter pls and smaller dots less visible": near white, 1 px dots at a tenth of black, and a
  // hairline round each frame so a white page still has an edge on it). It goes with the camera (paintCam) and fades
  // out below a quarter zoom, where the dots would run together.
  const dots = document.createElement('div');
  dots.className = 'dots';
  dots.setAttribute('aria-hidden', 'true');
  const world = document.createElement('div');
  world.className = 'world';
  root.append(dots, world);

  let of = opts.of || '';
  let cards: Card[] = [];
  let edited: Record<string, string> = {}; // page path -> when its file was saved
  let cam: Cam = { x: 0, y: 0, z: 1 };
  let view = { w: 1, h: 1 };
  let ox = 0; // where the box is on the screen
  let oy = 0;
  const measure = () => {
    const r = root.getBoundingClientRect();
    [ox, oy, view] = [r.left, r.top, { w: r.width || innerWidth, h: r.height || innerHeight }];
  };
  measure();
  let latest: Board | null = null; // the board as last read: its rev and frames, for a change written back (a picture taken off)
  type Undo = { items: { id: string; x?: number; y?: number }[]; archived: boolean; at?: number };
  const taken: Undo[] = []; // what this browser took off or moved, newest last: ⌘Z puts the last one back
  let moved = false; // the person moved the camera: a resize no longer fits everything again
  let selected = '';
  let picks = new Set<string>(); // the frames a click or a box picked (their ring): Backspace or Delete takes them off the board, a drag moves them
  let entered = '';
  let focus = false; // the camera is fitted to one frame (a phone's first view, Tab): a swipe goes to the next
  let lastDown = 0;
  let checked = { x: 1e9, y: 1e9, z: 0 }; // the camera at the last wake/cull check
  let still: ReturnType<typeof setTimeout> | undefined;
  let movedAt = -1e9; // when the camera last moved
  let kept = false; // the person arranged the board: its zoom stays from then on
  // The camera a view left the board at, kept for this board on this page (opts.keep), so reopened it is where it was
  // (Leo, 21 Nov: "closing/opening board drawer should not move zoom/position inside board"). Only once moved by hand.
  // localStorage as JSON: read (no value given) or written; nothing when it can't be (a private window, blocked site data).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ls = (k: string, v?: unknown): any => {
    try {
      // (none stored: JSON.parse(null) is null)
      return v === undefined ? JSON.parse(localStorage.getItem(k) as string) : localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  };
  const keepCam = () => opts.keep && moved && ls(opts.keep, { x: Math.round(cam.x), y: Math.round(cam.y), z: +cam.z.toFixed(4) });
  const keptCam = (): Cam | null => {
    const c = opts.keep && ls(opts.keep);
    return c && [c.x, c.y, c.z].every(Number.isFinite) && c.z > 0 ? c : null;
  };
  let layered = false; // the world is its own layer (the camera is moving)
  let paintedZ = 0; // the zoom the labels were last sized for

  const boxes = (): Box[] => cards.map((c) => c.f);
  const ago = (iso?: string) => {
    const s = iso ? (Date.now() - Date.parse(iso)) / 1000 : NaN;
    return !(s >= 0) ? '' : s < 60 ? 'edited just now' : s < 3600 ? `edited ${Math.floor(s / 60)}m ago` : s < 86400 ? `edited ${Math.floor(s / 3600)}h ago` : `edited ${Math.floor(s / 86400)}d ago`;
  };
  const text = (tag: string, t: string, to: Node) => to.appendChild(Object.assign(document.createElement(tag), { textContent: t }));

  // A title card: what the frame is, as plain text. No screenshot (it would go stale), no count of comments.
  const card = (c: Card) => {
    const el = document.createElement('div');
    el.className = 'c';
    text('b', c.s.label || c.s.src, el);
    if (c.s.label) text('div', c.s.src, el);
    const when = ago(edited[c.s.src.replace(/\.html?$/i, '').replace(/\/$/, '') || '/']);
    if (when) text('div', when, el);
    return el;
  };

  // A picture drawn small shows its preview instead (Leo, 23 Nov: fine lines sparkled far out; as open whiteboards do it):
  // previews of 1024, 512, 256 and 128 px, made once by the board's page and kept by the lab beside the picture. The one
  // shown is the smallest that is drawn at most 1.4× its size. A smaller one comes at once (zooming out); a bigger one
  // only once the camera rests, so nothing changes mid-zoom. The preview lies over the picture, which stays under it.
  const previewOf = (c: Card, settled: boolean) => {
    const sizes = c.f.pv;
    if (!sizes?.length || !c.pv) return;
    const need = Math.max(c.f.w, c.f.h) * cam.z * devicePixelRatio;
    let at = 0; // the picture itself
    for (const s of sizes) if (s * 1.4 >= need && (!at || s < at)) at = s;
    const was = c.at || 0;
    if (at === was || (!settled && (at === 0 || (was && at > was)))) return;
    c.at = at;
    if (at) c.pv.src = `${c.f.src}-p${at}`;
    c.pv.style.visibility = at ? '' : 'hidden';
  };
  // Pictures with no previews yet get them, one at a time once the board rests, from this page (one that may add to the
  // board: the lab refuses the rest, and then none is tried again).
  const makingFor = new Set<string>();
  let previews: Promise<void> = Promise.resolve(); // one picture at a time
  let mayMake = true;
  const makePreviews = async (c: Card, img: HTMLImageElement) => {
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const want = [1024, 512, 256, 128].filter((s) => s < long && !c.f.pv?.includes(s));
    if (!mayMake || !want.length || makingFor.has(c.f.id) || c.f.src.indexOf('/_lab/board/') !== 0) return;
    makingFor.add(c.f.id);
    let from: CanvasImageSource = img;
    let [w, h] = [img.naturalWidth, img.naturalHeight];
    for (const s of want) {
      while (Math.max(w, h) / 2 >= s) {
        // halved step by step, each from the last: one big step skips most of the picture and comes out jagged
        const cv = Object.assign(document.createElement('canvas'), { width: Math.round(w / 2), height: Math.round(h / 2) });
        const x = cv.getContext('2d');
        if (!x) return;
        x.imageSmoothingQuality = 'high';
        x.drawImage(from, 0, 0, cv.width, cv.height);
        [from, w, h] = [cv, cv.width, cv.height];
      }
      const k = s / Math.max(w, h);
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
      const x = cv.getContext('2d');
      if (!x) return;
      x.imageSmoothingQuality = 'high';
      x.drawImage(from, 0, 0, cv.width, cv.height);
      const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/webp', 0.9));
      if (!blob || signal.aborted) return;
      const admin = document.querySelector<HTMLScriptElement>('script[data-admin]')?.dataset.admin;
      const res = await fetch(`/_lab/api/image?board=${encodeURIComponent(name)}&preview=${c.f.id}`, { method: 'POST', headers: { 'content-type': blob.type, ...(admin && { 'x-lab-admin': admin }) }, body: blob, signal }).catch(() => null);
      if (!res?.ok) return void (mayMake = res?.status !== 403 && res?.status !== 401);
    }
  };

  // One camera write per frame: a trackpad sends two or three wheel events a frame, each was a transform, a --iz restyle
  // of every label and a pin redraw (Leo, 19 Nov: "lags a lot"). Nothing here reads the page's layout, and the labels
  // are sized again only when the zoom changed (a pan restyles nothing).
  let drawFrame = 0;
  let whole = false; // the next paint is not the camera alone
  let sizing = false; // the box is changing size: fitted and held to its edges again once it rests
  const draw = () => {
    drawFrame ||= requestAnimationFrame(paintCam);
  };
  const paintCam = () => {
    drawFrame = 0;
    if (signal.aborted) return;
    world.style.transform = `scale(${cam.z}) translate(${cam.x}px,${cam.y}px)`;
    // The dots: one every GRID px of the board, a dot on the board's own 0,0.
    const step = GRID * cam.z;
    dots.style.backgroundPosition = `${((cam.x * cam.z) % step) - step / 2}px ${((cam.y * cam.z) % step) - step / 2}px`;
    if (cam.z !== paintedZ) {
      paintedZ = cam.z;
      dots.style.backgroundSize = `${step}px ${step}px`;
      dots.style.opacity = String(Math.max(0, Math.min(1, (cam.z - 0.2) / 0.15))); // all there from 35 %, gone at 20 %
      world.style.setProperty('--iz', String(1 / cam.z));
      for (const c of cards) previewOf(c, false);
      const pc = `${Math.round(cam.z * 100)}%`;
      if (zoomBtn.textContent !== pc) zoomBtn.textContent = pc;
    }
    // The widget moves the board's pins with it, in this same frame (detail.camera: only the camera moved, so that is
    // all it does: a whole redraw of the widget on every frame of a pinch took 70 ms a frame; Leo, 19 Nov: "zoom feels
    // weird, slow").
    dispatchEvent(whole ? new Event('lab-board-moved') : new CustomEvent('lab-board-moved', { detail: { camera: true } }));
    whole = false;
  };
  // While the camera moves the world is its own layer (the browser moves the picture it has, it doesn't draw every live
  // frame again at each step); a layer kept after it stops would stay a blurry bitmap at the new zoom. So it is let go
  // once the camera has rested (REST: a trackpad's short pauses between strokes keep the layer), and the same rest is
  // when frames are woken and the address is written: nothing is loaded and no timer is set per event mid-gesture.
  const REST = 180;
  const GRID = 32;
  const rest = () => {
    still = undefined;
    if (signal.aborted) return;
    const left = REST - (performance.now() - movedAt);
    if (left > 1) return void (still = setTimeout(rest, left));
    if (sizing) {
      sizing = false;
      // Once the person has arranged the board the board is never fitted again: it keeps its zoom (Leo, 21 Nov: "do not zoom
      // images on board on resize board"). Till then a new size fits it, as the view settles.
      return go(moved || kept ? cam : fitAll(boxes(), view), false); // (which rests again, and lets the layer go then)
    }
    layered = false;
    for (const c of cards) previewOf(c, true);
    world.style.willChange = '';
    wake();
    keepCam();
    if (!opts.hash) return;
    try {
      history.replaceState(history.state, '', `#${Math.round(cam.x)},${Math.round(cam.y)},${cam.z.toFixed(3)}`);
    } catch {}
  };
  // A reload before the camera rested still comes back where it was: the address takes the camera as the page goes.
  if (opts.hash) addEventListener('pagehide', () => {
    try {
      history.replaceState(history.state, '', `#${Math.round(cam.x)},${Math.round(cam.y)},${cam.z.toFixed(3)}`);
    } catch {}
  });
  const moving = () => {
    movedAt = performance.now();
    if (!layered) {
      layered = true;
      world.style.willChange = 'transform';
    }
    still ||= setTimeout(rest, REST);
  };
  // The camera goes to next, held to the board's edges: past an edge it just stops (Leo, 19 Nov: "remove weird bounce
  // on edge of canvas": it gave way and sprang back). pan: a move that keeps a fitted frame's focus (a phone's swipe).
  let nudging = 0; // the camera's glide to a draft pin (api.nudge)
  let home: number | null = null; // where the camera was before that glide (api.nudgeBack takes it there again)
  const go = (next: Cam, user = true, pan = false, camOnly = false) => {
    const c = camOnly ? next : clamp(next, boxes(), view, cam); // a glide's steps are its own (api.nudge): held to the edges, each would jump to them
    if (user) moved = true;
    if (user) home = null; // moved by hand: it stays where the hand left it
    if (user && (!pan || Math.abs(c.z - cam.z) > 1e-6)) focus = false;
    if (!user && !camOnly) whole = true; // the board itself changed (its box, its frames): the widget draws everything again
    cam = c;
    draw();
    moving();
    // A frame coming into view is shown at once; loading one waits for the rest.
    if (Math.abs(cam.x - checked.x) * cam.z > 64 || Math.abs(cam.y - checked.y) * cam.z > 64 || Math.abs(cam.z / (checked.z || 1) - 1) > 0.05) wake(false);
  };

  // Which frames are alive. Those in view and wide enough, nearest the centre first, up to the cap, two loading at a time;
  // when the cap is reached the one seen longest ago is dropped back to its card (never the selected or entered one).
  const loading = () => cards.filter((c) => c.frame && !c.frame.dataset.ready).length;
  function wake(load = true) {
    if (signal.aborted) return;
    checked = { ...cam };
    const now = performance.now();
    const near = (c: Card) => {
      const f = c.f;
      return { l: (f.x + cam.x) * cam.z, t: (f.y + cam.y) * cam.z, r: (f.x + f.w + cam.x) * cam.z, b: (f.y + f.h + cam.y) * cam.z };
    };
    const seen = cards.filter((c) => {
      const r = near(c);
      const inView = r.r > -200 && r.l < view.w + 200 && r.b > -200 && r.t < view.h + 200;
      if (inView || load) c.box.classList.toggle('off', !inView); // mid-move a frame is only ever shown, never hidden
      return r.r > 0 && r.l < view.w && r.b > 0 && r.t < view.h;
    });
    for (const c of seen) if (c.frame) c.seen = now;
    if (!load) return;
    const dist = (c: Card) => {
      const r = near(c);
      return Math.hypot((r.l + r.r) / 2 - view.w / 2, (r.t + r.b) / 2 - view.h / 2);
    };
    const want = seen.filter((c) => !c.frame && c.f.kind !== 'image' && c.f.w * cam.z >= WAKE).sort((a, b) => dist(a) - dist(b));
    const alive = () => cards.filter((c) => c.frame);
    for (const c of want) {
      if (loading() >= AT_ONCE) break;
      if (alive().length >= CAP) {
        const old = alive().filter((o) => o.f.id !== selected && o.f.id !== entered && !seen.includes(o)).sort((a, b) => a.seen - b.seen)[0];
        if (!old) break;
        sleep(old);
      }
      live(c);
    }
  }
  // again: its page saved, a frame loads it anew in a second frame behind the first, and the two are swapped once the new one
  // has loaded and been measured: no blank frame, no height falling back to the device's (Leo, 26 Nov: "when board opened and
  // page updated can it be more smooth").
  function live(c: Card, again = false) {
    if (c.frame && !again) return;
    const fr = document.createElement('iframe');
    fr.name = `lab:${c.f.id}`;
    fr.title = c.f.label || c.f.src;
    fr.style.height = `${c.s.h}px`; // laid out in its device's height first: what 100vh is (grow, below)
    fr.addEventListener('load', () => {
      grow(c, fr);
      fr.dataset.ready = '1';
      fr.style.visibility = '';
      for (const n of Array.from(c.inner.children)) if (n !== fr) n.remove(); // the card it covered (taken out after, not before: an iframe moved in the page loads again)
      c.frame = fr;
      if (entered === c.f.id) focusIn(c);
      wake(); // the next one may load now
    }, { once: true });
    fr.src = c.f.src;
    if (!again) c.frame = fr;
    c.seen = performance.now();
    // Shown once it has loaded, over its card until then: a reload showed the card, then a blank white frame, then the page
    // (Leo, 21 Nov: "inside canvas after reload one thing not flicker second thing there flickering").
    fr.style.visibility = 'hidden';
    c.inner.append(fr);
  }
  function sleep(c: Card) {
    c.frame?.remove();
    c.frame = undefined;
    c.inner.replaceChildren(card(c));
  }

  // A page is drawn whole, its frame as tall as the page, never a box that scrolls inside (Leo, 26 Nov: "dont show pages inside
  // boards pls i cant scroll there zoom or whatever, always show full thing"). Laid out in its device's height first, then the
  // frame is made as tall as the page; whatever grew with it (sized by the window's height: 100vh) is held at the height it
  // had in the device, else such a page grew without end. Later growth (pictures, fonts) follows, once per step: a step the
  // same as the last is that loop again and stops it. Kept per frame and width, so a reload draws them tall at once.
  let eased: ReturnType<typeof setTimeout> | undefined;
  const tallKey = `lab-tall:${name}`;
  const tall: Record<string, number> = ls(tallKey) || {};
  const grow = (c: Card, fr: HTMLIFrameElement) => {
    const d = fr.contentDocument;
    const w = fr.contentWindow as (Window & typeof globalThis) | null;
    if (!d?.body || !w) return;
    const de = d.documentElement;
    de.style.overflow = 'hidden';
    const page = () => Math.min(30000, Math.max(de.scrollHeight, d.body.scrollHeight));
    const all = [...d.body.querySelectorAll<HTMLElement>('*')];
    const was = all.map((n) => n.offsetHeight);
    let h = page();
    let step = 0;
    const set = (to: number) => {
      const k = c.s.id + ':' + c.s.w;
      const first = !tall[k]; // a frame measured for the first time may fit the board again; a page saved keeps the camera
      [step, h] = [to - h, to];
      fr.style.height = `${h}px`;
      tall[k] = h;
      ls(tallKey, tall);
      lay(first);
    };
    set(h);
    if (page() > h + 1) for (const [i, n] of all.entries()) if (n.offsetHeight > was[i] + 1) n.style.cssText += `;height:${was[i]}px!important;min-height:0!important`;
    set(page());
    // A wheel or a pinch over it (entered) moves the board: the page has nothing to scroll (Leo, 26 Nov: "i cant scroll there
    // zoom or whatever"). Over a box of the page's own that scrolls, it scrolls that box. Its points are the frame's, put on the screen.
    const at = (e: MouseEvent): [number, number] => {
      const r = fr.getBoundingClientRect();
      const k = r.width / w.innerWidth;
      return [r.left + e.clientX * k, r.top + e.clientY * k];
    };
    w.addEventListener('wheel', (e) => {
      for (let n = e.target as Element | null; n && n !== d.body; n = n.parentElement) if (n.scrollHeight > n.clientHeight && /auto|scroll/.test(w.getComputedStyle(n).overflowY)) return;
      wheel(e, ...at(e));
    }, { passive: false });
    w.addEventListener('gesturestart', pinch0);
    w.addEventListener('gesturechange', (e) => pinchTo(e, ...at(e as MouseEvent)));
    new w.ResizeObserver(() => requestAnimationFrame(() => { // (next frame: set inside it, the observer's loop was an error)
      const to = page();
      if (to > h + 1 && Math.abs(to - h - step) > 1) set(to);
    })).observe(d.body);
  };
  // Where each frame is drawn: as stored, as tall as its page, and moved down by as much as the frames over it grew (the gap
  // between them as it was, up to 160 px: a frame already put lower is not moved again).
  const lay = (fit = true) => {
    if (down?.mode) return;
    // Once the board is shown a frame's new height and the frames it moves ease there, not jump (no motion when reduced).
    if (shown) {
      root.classList.add('ease');
      clearTimeout(eased);
      eased = setTimeout(() => root.classList.remove('ease'), 400);
    }
    const by = [...cards].sort((p, q) => p.s.y - q.s.y);
    for (const [i, c] of by.entries()) {
      const s = c.s;
      const h = Math.max(s.h, tall[s.id + ':' + s.w] || 0);
      let y = s.y;
      for (const g of by.slice(0, i)) if (g.s.y < s.y && g.s.x < s.x + s.w && s.x < g.s.x + g.s.w) y = Math.max(y, g.f.y + g.f.h + Math.min(s.y - g.s.y - g.s.h, 160));
      c.f = { ...s, y, h, ...(s.oh && { oh: Math.round((s.oh * h) / s.h) }) }; // (a phone's frame keeps its scale of the stored one)
      Object.assign(c.box.style, { left: `${c.f.x}px`, top: `${y}px`, width: `${c.f.w}px`, height: `${h}px` });
    }
    if (fit && !moved && !kept) cam = fitAll(boxes(), view);
    go(cam, false);
  };

  // ---------- frames in the world ----------
  const label = (f: Frame) => f.label || (f.kind === 'image' ? f.file : f.src); // no size (Leo, 26 Nov: "their resolution no needed to show at all")
  function show(b: Board) {
    if (signal.aborted) return;
    latest = b;
    of = of || (b.of || '').split('#')[0];
    if (typeof b.home === 'string' && b.of) opts.home?.(b.home, b.of);
    const shown = b.frames.filter((f) => f.state !== 'archived' && Number.isFinite(f.x));
    // A phone shows each frame at a phone's width, side by side in board order (Leo, 19 Nov: like the sketch on the
    // page). Only how it's drawn here.
    const next = coarse ? [...shown].sort((p, q) => p.y - q.y || p.x - q.x).map((f, i) => ({ ...f, x: i * (390 + 80), y: 0, w: 390, h: 844, ow: f.w, oh: f.h })) : shown;
    const old = new Map(cards.map((c) => [c.f.id, c]));
    cards = next.map((f) => {
      const was = old.get(f.id);
      old.delete(f.id);
      if (was && was.s.src === f.src) {
        if (!was.frame && f.kind !== 'image' && (was.s.w !== f.w || was.s.h !== f.h)) was.inner.replaceChildren(card({ ...was, s: f }));
        was.s = was.f = f;
        return was;
      }
      was?.box.remove();
      const box = document.createElement('div');
      box.className = f.kind === 'image' ? 'f i' : 'f';
      const inner = document.createElement('div');
      inner.className = 'b';
      const c: Card = { s: f, f, box, inner, seen: 0 };
      box.dataset.id = f.id;
      if (f.kind === 'image') {
        const img = Object.assign(document.createElement('img'), { src: f.src, alt: f.label || '', draggable: false, loading: 'lazy' });
        c.pv = Object.assign(document.createElement('img'), { alt: '', draggable: false, className: 'pv' });
        c.pv.style.visibility = 'hidden';
        img.addEventListener('load', () => (previews = previews.then(() => (signal.aborted ? undefined : makePreviews(c, img))).catch((e) => console.warn('[lab] preview', e))), { once: true, signal });
        inner.append(img, c.pv);
      } else inner.appendChild(card(c));
      box.append(inner);
      const tag = text('div', '', box);
      tag.className = 't';
      tag.setAttribute('data-lab-off', ''); // the label opens its frame: no pin there
      world.append(box);
      return c;
    });
    for (const c of old.values()) c.box.remove();
    lay();
    for (const c of cards) {
      paint(c);
      previewOf(c, true);
    }
    if (selected && !cards.some((c) => c.f.id === selected)) selected = entered = '';
    pickFrames(picks);
    world.querySelector('.none')?.remove();
    measure(); // the box as it is now, for the fit
    const hash = opts.hash ? /^#(-?\d+),(-?\d+),([\d.]+)$/.exec(location.hash) : null;
    const was = !moved && !hash ? keptCam() : null; // where it was when last closed here
    if (hash && !moved) cam = { x: +hash[1], y: +hash[2], z: +hash[3] };
    else if (was) [cam, moved] = [was, true];
    else if (!moved) {
      // Every frame in view, as on a computer, phones too (Leo, 19 Nov: one frame at a time read as a slider, "dont like
      // this view at all"): drag pans, pinch zooms, Tab or a frame's label still fits one.
      focus = false;
      cam = fitAll(boxes(), view);
    }
    moved = moved || Boolean(hash);
    go(cam, false);
    cancelAnimationFrame(drawFrame);
    paintCam(); // now, not in the next frame's callback: the first frame drawn with its frames in it is a fitted one
    wake();
  }
  const api = (more = '') => `/_lab/api/board?name=${name}${of ? `&page=${encodeURIComponent(of)}` : ''}${more}`;
  const load = async () => {
    const res = await fetch(api()).catch(() => null);
    if (signal.aborted) return;
    if (!res?.ok) {
      text('div', res?.status === 404 ? `There is no board called ${name}.` : 'The board could not be read.', world).className = 'none';
      return reveal();
    }
    show(await res.json());
    // Shown with its frames' pages in them, all at once: frame by frame as each loaded, one stood there blank and white for a
    // moment beside another that already had its page (Leo, 21 Nov: "one thing not flicker second thing there flickering").
    // A frame that takes longer than that moment shows its card, then its page.
    const t0 = performance.now();
    const ready = () => {
      if (signal.aborted) return;
      if (loading() && performance.now() - t0 < 450) return void setTimeout(ready, 16);
      reveal();
    };
    ready();
  };
  // When each page was saved, for "edited 5m ago" (a variant's file has no such time here: the card says none).
  fetch('/_lab/pages').then((r) => r.json()).then((d) => {
    edited = Object.fromEntries((d.pages || []).map((p: { path: string; edited: string }) => [p.path, p.edited]));
    for (const c of cards) if (!c.frame && c.f.kind !== 'image') c.inner.replaceChildren(card(c));
  }).catch(() => {});

  // The label above a frame is only text (a click on it is a click on the board).
  const paint = (c: Card) => ((c.box.querySelector('.t') as HTMLElement).textContent = label(c.s));

  // ---------- the frame the camera is on, and entering ----------
  // \`selected\` is the frame Tab last moved to; the open (entered) frame and the picked ones wear the ring.
  const find = (id: string) => cards.find((c) => c.f.id === id);
  // A click on a frame picks it, a click on the canvas lets go, a box drawn on the canvas picks the frames it touches, Shift
  // adds or takes one off; Backspace or Delete then takes them off the board, a drag moves them (Leo, 21 Nov: "Plain drag
  // selects, Space pans", "also moving stuff on board", "deleting them with delete").
  function pickFrames(ids: Iterable<string>) {
    picks = new Set([...ids].filter((id) => find(id)));
    for (const c of cards) c.box.classList.toggle('pick', picks.has(c.f.id));
  }
  function select(id: string) {
    if (entered && entered !== id) leave();
    selected = id;
    for (const c of cards) c.box.classList.toggle('sel', c.f.id === entered);
  }
  function focusIn(c: Card) {
    c.frame?.focus();
    c.frame?.contentWindow?.focus();
  }
  function enter(id: string) {
    const c = find(id);
    if (!c || c.f.kind === 'image') return; // a picture is only looked at, never entered
    select(id);
    entered = id;
    select(id); // the ring, now that it is open
    c.box.classList.add('in');
    if (!c.frame) live(c); // a card is woken to be entered, cap or not
    else focusIn(c);
    if (coarse) done.hidden = false;
  }
  function leave() {
    const c = find(entered);
    entered = '';
    done.hidden = true;
    if (!c) return;
    c.box.classList.remove('in', 'sel');
    // The keys stay with the frame's document until focus is moved back: M, ⇧B and Esc would go to the wrong one.
    (c.frame?.contentWindow as unknown as { __labSpot?: { clear?: () => void } } | null | undefined)?.__labSpot?.clear?.();
    c.frame?.blur();
    window.focus();
  }
  const done = Object.assign(document.createElement('button'), { className: 'done', type: 'button', textContent: 'done', hidden: true });
  done.addEventListener('click', () => (leave(), select('')));
  root.append(done);
  // The zoom, quiet in the top-right corner (the widget has both bottom ones) (Leo, 19 Nov: "show zoom somewhere"); a tap offers fit · 50% · 100%.
  const zoomBox = document.createElement('div');
  zoomBox.className = 'zm';
  zoomBox.setAttribute('data-lab-off', '');
  const zoomBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'zo', textContent: '100%' });
  zoomBtn.setAttribute('aria-label', 'zoom');
  zoomBtn.addEventListener('click', () => zoomBox.classList.toggle('open'));
  zoomBox.append(zoomBtn);
  for (const [t, to] of [['fit', 0], ['50%', 0.5], ['100%', 1]] as const) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'zc', textContent: t });
    b.addEventListener('click', () => {
      measure();
      go(to ? zoomAt(cam, view.w / 2, view.h / 2, to, boxes(), view) : fitAll(boxes(), view));
      zoomBox.classList.remove('open');
    });
    zoomBox.append(b);
  }
  root.append(zoomBox);
  const ours = (e: Event) => inside(e, zoomBox); // its own clicks, not the board's

  // ---------- input: the board owns its surface (these run before the widget's own listeners) ----------
  // Points are the box's own: the screen's less where the box is.
  const at = (e: { clientX: number; clientY: number }) => {
    const x = (e.clientX - ox) / cam.z - cam.x;
    const y = (e.clientY - oy) / cam.z - cam.y;
    return cards.findLast((c) => x >= c.f.x && x <= c.f.x + c.f.w && y >= c.f.y && y <= c.f.y + c.f.h)?.f.id || '';
  };
  const mine = (e: Event) => inside(e, root) || inside(e, handLayer);
  const pts = new Map<number, { x: number; y: number }>();
  // down.hand: this press pans (Space, the middle button, a finger); else (a mouse or pen, the primary button) it draws a box on the
  // canvas (marq) or, on a frame, moves the picked ones (move), once it has gone 4 px. mid: the middle or a side button (the hand without Space).
  type Down = { x: number; y: number; id: string; far: boolean; at: number; t: number; held?: boolean; hand?: boolean; mid?: boolean; shift?: boolean; mode?: 'marq' | 'move'; base?: Set<string>; start?: Map<string, { x: number; y: number }> };
  let down: Down | null = null;
  let holdTimer = 0;
  // A phone comments by holding, as on a page (Leo, 19 Nov: "can't leave a comment" on the board): a finger that stays
  // put for 400 ms with comments on drops a pin there; moving first is a pan or a swipe, as before.
  const boardWidget = () => (window as unknown as { __labBoardWidget?: { dismiss?: () => boolean; pinning: () => boolean; drawing?: () => boolean; holding?: () => boolean; hold?: (x: number, y: number) => void; place: (x: number, y: number) => void } }).__labBoardWidget;
  let tap = { at: 0, x: 0, y: 0 };
  let pinch = 0;
  // On a computer a plain drag draws a box that picks frames, or moves the picked ones when it starts on a frame; the board
  // pans with Space and a drag (the hand), the middle or a side button (Leo, 26 Nov), or a trackpad's two fingers / the wheel (Leo, 21 Nov: "Plain
  // drag selects, Space pans"). ⌥ makes a click a pin and a drag an area, the widget's (Leo, 21 Nov: "regular cursor to
  // operate on boards opt to call comment"). A finger pans, and a hold pins.
  let space = false;
  let theirs = false; // this press went to the widget (comment mode): its click isn't eaten
  // While Space is held one still layer lies over the whole board, frames and pins included, with the hand on it: no
  // frame, pin or pointer rule under it can show its own cursor between frames (Leo, 19 Nov: "switch to hand
  // flickering"). Put there once on the key going down, never on its repeats, and taken away when it is let go.
  let handLayer: HTMLElement | null = null;
  const hand = () => {
    const grab = space || Boolean(down?.mid);
    root.classList.toggle('grab', grab);
    root.classList.toggle('grabbing', grab && Boolean(down?.hand));
    if (space && !handLayer) {
      measure();
      handLayer = document.createElement('div');
      handLayer.id = 'lab-hand';
      handLayer.setAttribute('data-lab-off', '');
      Object.assign(handLayer.style, { left: `${ox}px`, top: `${oy}px`, width: `${view.w}px`, height: `${view.h}px` });
      (scope instanceof ShadowRoot ? scope : document.documentElement).append(handLayer);
    } else if (!space && handLayer && !down?.hand) {
      handLayer.remove();
      handLayer = null;
    }
    handLayer?.classList.toggle('grabbing', Boolean(down?.hand));
  };
  const eat = (e: Event) => (e.stopImmediatePropagation(), e.preventDefault());
  // Where the pointer last was on the board (null once it left: a paste then belongs to what is under it).
  let last: { x: number; y: number } | null = null;
  // ⌥ held (a paste event doesn't carry it: the keys before it do): the picture's own comment box opens on it, as ⌥-click opens one.
  let alt = false;
  // The board has the plain pointer, to pan and look; ⌥ held gives it the pin pointer (the page's, inherited) and a click
  // then comments (Leo, 21 Nov: "regular cursor to operate on boards opt to call comment").
  // A click on the board pins with the pin tool picked (C, the bar's pin), and with ⌥ held on the arrow: the other way round
  // it picks and moves frames (Leo, 26 Nov: "cant comment pin on board": the board pinned only on ⌥, which the pin tool turns
  // into "use", so with it picked nothing pinned at all).
  const pins = (altKey: boolean) => !boardWidget()?.pinning() === altKey;
  const setAlt = (v: boolean) => root.classList.toggle('alt', pins((alt = v)));
  on('keydown', (e: KeyboardEvent) => setAlt(e.altKey), true);
  on('keyup', (e: KeyboardEvent) => setAlt(e.altKey), true);
  on('blur', () => setAlt(false));
  on('pointermove', (e: PointerEvent) => void (setAlt(e.altKey), (last = inBox(e.clientX, e.clientY) ? { x: e.clientX, y: e.clientY } : null)), true);

  on('pointerdown', (e: PointerEvent) => {
    if (!mine(e) || ours(e) || entered && src(e) instanceof HTMLIFrameElement) return;
    if (zoomBox.classList.contains('open')) zoomBox.classList.remove('open');
    measure();
    theirs = false;
    if (e.pointerType !== 'touch' && !space && !pts.size && boardWidget() && (pins(e.altKey) || boardWidget()!.drawing?.())) {
      lastDown = performance.now();
      theirs = true; // a pin (pins(), above, or D, drawing), no Space: the widget's own click (a pin) and drag (an area, or ink)
      return;
    }
    eat(e);
    lastDown = performance.now();
    (document.activeElement as HTMLElement | null)?.blur?.();
    focused()?.blur?.();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture?.(e.pointerId);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      if (down) down.far = true; // a second finger: this was no tap
    } else {
      // A mouse or pen's primary button picks and moves (Space or another button: the hand); a finger pans.
      const plain = !coarse && e.pointerType !== 'touch' && e.button === 0 && !space;
      down = { x: e.clientX, y: e.clientY, id: at(e), far: false, at: performance.now(), t: e.timeStamp, hand: !plain, mid: e.pointerType !== 'touch' && [1, 3, 4].includes(e.button), shift: e.shiftKey };
      hand();
      clearTimeout(holdTimer);
      if (plain && down.id) find(down.id)?.box.classList.add('down'); // a picture's name shows as the press starts, not on the lift (Leo, 23 Nov: "it appears with delay?")
      if (e.pointerType === 'touch') {
        const d = down;
        holdTimer = window.setTimeout(() => {
          const w = boardWidget();
          if (down !== d || d.far || pts.size !== 1 || !w?.holding?.()) return;
          d.held = true; // the comment opens on the lift (below), as a page's hold does: opened now, the lift closed it
          navigator.vibrate?.(8);
        }, 400);
      }
    }
  }, true);
  on('pointermove', (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    eat(e);
    const [dx, dy] = [e.clientX - p.x, e.clientY - p.y];
    if (pts.size === 2) {
      const o = [...pts.entries()].find(([id]) => id !== e.pointerId)![1];
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      const mid = { x: (e.clientX + o.x) / 2 - ox, y: (e.clientY + o.y) / 2 - oy };
      if (pinch) go(panBy(zoomAt(cam, mid.x, mid.y, cam.z * (d / pinch), boxes(), view), dx / 2, dy / 2));
      pinch = d;
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > (down.hand ? 6 : 4)) {
      down.far = true;
      clearTimeout(holdTimer);
    }
    if (down?.held) return; // the hold made a pin: the finger lifting off doesn't pan
    if (down?.far && down.hand) go(panBy(cam, dx, dy), true, true); // a finger or the hand: the board stops at its edge
    else if (down?.far) drag(down, e);
  }, true);
  // The box over the canvas (in the box's own px) while one is drawn.
  const marq = Object.assign(document.createElement('div'), { className: 'marq', hidden: true });
  marq.setAttribute('data-lab-off', '');
  root.append(marq);
  // A press that is no pan, gone 4 px: on a frame it moves the picked frames (that frame becomes the pick first, with Shift one
  // more), on the canvas it draws a box and the frames it touches are the pick (Shift: besides those picked already).
  const drag = (d: Down, e: PointerEvent) => {
    if (!d.mode) {
      d.mode = d.id ? 'move' : 'marq';
      if (d.mode === 'move') {
        if (!picks.has(d.id)) pickFrames(d.shift ? [...picks, d.id] : [d.id]);
        d.start = new Map([...picks].map((id) => [id, { x: find(id)!.f.x, y: find(id)!.f.y }]));
      } else {
        d.base = new Set(d.shift ? picks : []);
        marq.hidden = false;
      }
    }
    if (d.mode === 'move') {
      for (const [id, s] of d.start!) {
        const c = find(id);
        if (!c) continue;
        [c.f.x, c.f.y] = [Math.round(s.x + (e.clientX - d.x) / cam.z), Math.round(s.y + (e.clientY - d.y) / cam.z)]; // the camera's zoom: a screen px is 1/z of the board's
        Object.assign(c.box.style, { left: `${c.f.x}px`, top: `${c.f.y}px` });
      }
      whole = true; // the pins on them go with them
      draw();
      return;
    }
    const [l, t, r, b] = [Math.min(d.x, e.clientX) - ox, Math.min(d.y, e.clientY) - oy, Math.max(d.x, e.clientX) - ox, Math.max(d.y, e.clientY) - oy];
    Object.assign(marq.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
    const hit = cards.filter((c) => (c.f.x + cam.x) * cam.z <= r && (c.f.x + c.f.w + cam.x) * cam.z >= l && (c.f.y + cam.y) * cam.z <= b && (c.f.y + c.f.h + cam.y) * cam.z >= t);
    pickFrames([...d.base!, ...hit.map((c) => c.f.id)]);
  };
  // The drag ended: the box goes, moved frames are written (a cancel puts them back).
  const drop = (d: Down, cancel: boolean) => {
    marq.hidden = true;
    if (d.mode !== 'move') return;
    const to = [...d.start!].flatMap(([id]) => (find(id) ? [{ id, x: find(id)!.f.x, y: find(id)!.f.y }] : []));
    const from = [...d.start!].map(([id, s]) => ({ id, ...s }));
    if (cancel || to.every((p, i) => p.x === from[i].x && p.y === from[i].y)) {
      for (const [id, s] of d.start!) {
        const c = find(id);
        if (c) [c.f.x, c.f.y] = [s.x, s.y];
        if (c) Object.assign(c.box.style, { left: `${s.x}px`, top: `${s.y}px` });
      }
      whole = true;
      return draw();
    }
    kept = moved = true; // the person arranged it: the camera stays where it is (a refit moved the whole view under the pointer)
    void write(placed(to), { items: from, archived: false });
  };
  const up = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    eat(e);
    pinch = 0;
    const d = down;
    clearTimeout(holdTimer);
    if (pts.size || !d) return;
    down = null;
    for (const c of cards) c.box.classList.remove('down');
    hand();
    // Right after the page loads, the live frames keep the page busy: the finger's lift can be handled before the 400 ms
    // timer runs, and the first hold was taken for a tap (Leo, 19 Nov). The touch's own times decide it then.
    if (!d.held && !d.far && e.type === 'pointerup' && e.pointerType === 'touch' && e.timeStamp - d.t >= 400) {
      const w = boardWidget();
      if (w?.holding?.()) d.held = true;
    }
    if (d.held) {
      const w = boardWidget();
      // After the click the lift still sends (it takes the focus off the comment box that opens, and the box closes on that):
      // the comment is opened by that click (below), or after 150 ms if none comes.
      if (w && e.type === 'pointerup') {
        const open = () => ((afterClick = null), clearTimeout(late), (w.hold || w.place)(d.x, d.y));
        const late = window.setTimeout(open, 150);
        afterClick = () => setTimeout(open, 0);
      }
      return;
    }
    if (d.far && coarse && focus && e.type === 'pointerup' && Math.abs(e.clientX - d.x) > 48 && Math.abs(e.clientX - d.x) > 2 * Math.abs(e.clientY - d.y) && !entered) return step(e.clientX < d.x ? 1 : -1); // a swipe on a phone: the next frame
    if (d.far && !d.hand) return drop(d, e.type === 'pointercancel'); // a box drawn, or frames moved
    if (d.far || e.type === 'pointercancel') return;
    const widget = boardWidget();
    // An open comment or the chat: this tap only closes it, as a click outside one does on a page (Leo, 19 Nov: "clicking
    // outside comment should work here same as on page", "same with chat"). A drag (a pan) is no tap and closes nothing.
    if (widget?.dismiss?.()) return;
    // A click on the canvas or on another frame closes the open one, as Esc does: the board's keys, paste and drag work again
    // (Leo, 23 Nov: a double-click opened a frame and the board took nothing until a reload).
    if (entered && d.id !== entered) leave();
    // A click picks the frame under it alone (none: lets go of all); with Shift it adds that frame or takes it off, and on the canvas leaves the rest.
    if (!d.hand) pickFrames(d.id ? (d.shift ? (picks.has(d.id) ? [...picks].filter((id) => id !== d.id) : [...picks, d.id]) : [d.id]) : d.shift ? picks : []);
    // A double tap opens the frame under it to use it.
    const again = performance.now() - tap.at < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 24;
    tap = { at: performance.now(), x: e.clientX, y: e.clientY };
    if (again && d.id) enter(d.id);
  };
  on('pointerup', up, true);
  on('pointercancel', up, true);
  let afterClick: (() => void) | null = null; // what the click that follows a hold's lift opens
  on('click', (e: MouseEvent) => {
    const f = afterClick;
    afterClick = null;
    f?.();
    if (mine(e) && !theirs && !ours(e)) eat(e);
  }, true);
  on('dblclick', (e: MouseEvent) => mine(e) && eat(e), true);
  on('contextmenu', (e: MouseEvent) => mine(e) && e.preventDefault(), true);
  // A side button's lift is no browser back or forward while the board is open, over any of it: it pans (Leo, 26 Nov:
  // "mouse side buttons to pan board"). The lift's default is the browser's step, so the lift's is taken (Chrome, Firefox).
  for (const t of ['pointerup', 'mouseup']) on(t, (e: MouseEvent) => e.button > 2 && e.preventDefault(), true);
  // A mouse or trackpad. Pinch on a trackpad arrives as a wheel with ctrlKey (Chrome, Firefox); ⌘ or Ctrl and a wheel zoom.
  // A wheel over a pin on the board is the board's too: it went to the page behind (Leo, 19 Nov: "scroll inside board
  // working weird"). An entered frame's page has nothing to scroll (it is drawn whole): its wheel comes here too (frame.ts).
  const overPin = (e: Event) => {
    const t = e.composedPath()[0];
    return t instanceof Element && Boolean(t.closest('.pin')) && inBox((e as WheelEvent).clientX, (e as WheelEvent).clientY);
  };
  // A pinch follows the fingers: Chrome and Firefox send it as ctrl + wheel with deltaY = -100 * ln(the fingers' scale),
  // so e^(-deltaY / 100) is that scale again, as Safari's gesture gives it below (it was four times that: a small pinch
  // shot to the most zoom). ⌘ + wheel is the same per px. One event never does more than a quarter.
  let wheelAt = -1e9;
  // (x, y: where it is on the screen; a wheel in an entered frame tells its own, grow() above.)
  const wheel = (e: WheelEvent, x = e.clientX, y = e.clientY) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    // Holding D, the board holds still: a drawing's strokes are where they were drawn on the screen, and a pan between two
    // of them put them apart from the frames they were on (issue 423).
    if (boardWidget()?.drawing?.()) return;
    const t = performance.now(); // (not the event's own time: a frame's starts later)
    if (t - wheelAt > 250) measure(); // where the box is, read once as a gesture starts, never per event
    wheelAt = t;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1; // lines (a mouse in Firefox), pages, px
    if (e.ctrlKey || e.metaKey) {
      const dy = Math.max(-24, Math.min(24, e.deltaY * unit));
      go(zoomAt(cam, x - ox, y - oy, cam.z * Math.exp(-dy * 0.01), boxes(), view));
    } else go(panBy(cam, -(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit, e.shiftKey && !e.deltaX ? 0 : -e.deltaY * unit), true, true);
  };
  on('wheel', (e: WheelEvent) => (mine(e) || overPin(e)) && wheel(e), { passive: false, capture: true });
  // Safari's pinch.
  let g0 = 1;
  const pinch0 = (e: Event) => (e.preventDefault(), measure(), (g0 = cam.z));
  const pinchTo = (e: Event, x?: number, y?: number) => {
    e.preventDefault();
    go(zoomAt(cam, x === undefined ? view.w / 2 : x - ox, y === undefined ? view.h / 2 : y - oy, g0 * (e as unknown as { scale: number }).scale, boxes(), view));
  };
  on('gesturestart', (e: Event) => mine(e) && pinch0(e), true);
  on('gesturechange', (e: MouseEvent) => mine(e) && pinchTo(e, e.clientX, e.clientY), true);

  // ---------- keys (after the widget's own: an Esc it used is not ours) ----------
  const typing = (e: Event, buttons = true) => e.composedPath().some((n) => n instanceof HTMLElement && (n.isContentEditable || (buttons ? /^(INPUT|TEXTAREA|SELECT|BUTTON)$/ : /^(INPUT|TEXTAREA)$/).test(n.tagName) || n.hasAttribute('data-lab-comments')));
  const back = () => opts.back?.();
  // The next (1) or previous (-1) frame in board order, the camera on it.
  const step = (by: number) => {
    if (!cards.length) return;
    const c = cards[(cards.findIndex((o) => o.f.id === selected) + by + cards.length) % cards.length];
    select(c.f.id);
    go(fitFrame(c.f, view));
    focus = true;
  };
  const press = (e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'> & { repeat?: boolean }, fromFrame = false): boolean => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const digit = /^Digit(\d)$/.exec(e.code)?.[1];
    if (e.shiftKey && digit === '1') go(fitAll(boxes(), view));
    else if (e.shiftKey && digit === '2') go(zoomAt(cam, view.w / 2, view.h / 2, 1, boxes(), view));
    else if (e.shiftKey && digit === '0') go(find(selected) ? fitFrame(find(selected)!.f, view) : fitAll(boxes(), view));
    else if (!e.shiftKey && (e.key === '+' || e.key === '=' || e.key === '-') && !fromFrame) go(zoomAt(cam, view.w / 2, view.h / 2, cam.z * (e.key === '-' ? 0.8 : 1.25), boxes(), view));
    else if (e.shiftKey && e.code === 'KeyB' && !entered && opts.back) back();
    else if (e.key === 'Enter' && !e.shiftKey && selected && !entered) enter(selected);
    else if (e.key === 'Tab' && !entered && cards.length) step(e.shiftKey ? -1 : 1);
    else if (e.key === 'Escape') {
      // Heard in the frame, which keeps an Esc its page used (a menu closing) to itself: this one is ours.
      // Mid-drag it cancels the drag: moved frames go back unsaved, a box being drawn goes and the pick is as before it.
      if (down?.mode) {
        const d = down;
        down = null;
        if (d.mode === 'marq') pickFrames([...d.base!]);
        drop(d, true);
        hand();
      } else if (entered) leave();
      else if (picks.size) pickFrames([]);
      else if (opts.back && !coarse) back(); // an empty board's Esc goes back to the page, as ⇧B does
      else return false;
    } else return false;
    return true;
  };
  on('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ' && !typing(e) && !(entered && focused() instanceof HTMLIFrameElement)) {
      e.preventDefault(); // the hand, not a scroll
      if (!space) {
        space = true;
        hand();
      }
      return;
    }
    if (e.defaultPrevented || typing(e) || (entered && focused() instanceof HTMLIFrameElement)) return;
    if (press(e)) e.preventDefault();
  });
  on('keyup', (e: KeyboardEvent) => e.key === ' ' && space && ((space = false), hand()));
  on('blur', () => {
    if (!space) return;
    space = false;
    hand();
  });

  // ---------- what the frames and the widget see ----------
  // By the box as last measured (its size changing, a press, a gesture starting): asked for every pin in every frame.
  const inBox = (x: number, y: number) => x >= ox && x <= ox + view.w && y >= oy && y <= oy + view.h;
  // ---------- pictures: paste, drop, or "+ image" put one on the board as a frame (this computer's browser only) ----------
  const note = (t: string) => {
    const n = text('div', t, root);
    n.className = 'note';
    setTimeout(() => n.remove(), 3000);
  };
  // The board written back, with one change to its frames (patch: what a frame becomes, or nothing), one at a time, and read again
  // (a move, a frame or more taken off the board and ⌘Z). Taken off (archived: the file stays) and moved are the owner's (this
  // computer's browser, or a device with a pass). A frame drawn in the lab's rows stays in them unless it is put somewhere:
  // a move puts every frame where it is drawn now, so the ones that were not touched don't move to fill its place.
  let saving: Promise<void> = Promise.resolve();
  const write = (patch: (f: Frame) => Partial<Frame> | undefined, undo?: Undo) => (saving = saving.then(async () => {
    if (!latest || signal.aborted) return;
    const frames = latest.frames.map((f) => {
      const p = patch(f);
      return { ...f, ...p, ...(!p && f.auto ? { x: undefined, y: undefined } : {}) };
    });
    const res = await fetch(api(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...latest, frames }) }).catch(() => null);
    if (res?.ok) {
      if (undo) taken.push({ ...undo, at: Date.now() });
      await load();
    } else {
      note(res?.status === 409 ? 'The board changed meanwhile: look, then try again.' : "Only the board's owner can do that.");
      await load(); // the frames as they are (a move put them back)
    }
  }));
  // Every frame as drawn, but the ones in at (their new places).
  const placed = (at: { id: string; x?: number; y?: number }[]) => (f: Frame): Partial<Frame> | undefined => {
    const to = at.find((p) => p.id === f.id);
    return f.state === 'archived' ? undefined : { x: f.x, y: f.y, ...to, auto: false };
  };
  // Backspace or Delete with frames picked takes them all off, one ⌘Z puts them all back where they were; ⌘Z after a move puts those back.
  if (!coarse) {
    on('keydown', (e: KeyboardEvent) => {
      if (typing(e) || entered) return;
      // Backspace on the board is never the browser's "back" (WebKit's can be): with nothing picked it does nothing at all.
      if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
      const gone = (e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey && picks.size > 0;
      const back = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ' && taken.length > 0 && !e.defaultPrevented; // prevented: the widget took this ⌘Z for a newer pin or drawing
      if (!gone && !back) return;
      e.preventDefault();
      if (gone) {
        const ids = new Set(picks);
        const items = cards.filter((c) => ids.has(c.f.id)).map((c) => ({ id: c.f.id, ...(c.f.auto ? {} : { x: c.f.x, y: c.f.y }) })); // where each stood: an archived frame is listed without its place
        pickFrames([]);
        void write((f) => (ids.has(f.id) ? { state: 'archived' } : undefined), { items, archived: true });
        return;
      }
      const last = taken.pop()!;
      if (last.archived) {
        void write((f) => {
          const was = last.items.find((i) => i.id === f.id);
          return was && { state: 'live', x: was.x, y: was.y };
        }).then(() => pickFrames(last.items.map((i) => i.id))); // …and picked again, as they were
      } else void write(placed(last.items));
    });
  }
  // One picture to the board at a world point (its centre; corner: its top left), a ghost there while it goes; the board is
  // read again as soon as it is there. Gives the frame as placed, or null.
  const put = async (file: Blob, wx: number, wy: number, pin = false, corner = false) => {
    const ghost = text('div', 'adding image…', world);
    Object.assign(ghost.style, { left: `${wx}px`, top: `${wy}px` }, corner ? { margin: '0' } : {});
    ghost.className = 'ghost';
    try {
      const out = await (await import(new URL('pics.js', import.meta.url).href) as typeof import('../widget/pics.ts')).send<{ frame: Frame }>(`?board=${encodeURIComponent(name)}${of ? `&page=${encodeURIComponent(of)}` : ''}&x=${Math.round(wx)}&y=${Math.round(wy)}${corner ? '&corner=1' : ''}`, file, 25 * 1024 * 1024, 2400);
      await load();
      const c = find(out.frame.id);
      const r = pin && c?.box.getBoundingClientRect();
      if (r) boardWidget()?.place(r.left + r.width / 2, r.top + r.height / 2);
      return out.frame;
    } catch (err) {
      note((err as Error).message);
      return null;
    } finally {
      ghost.remove();
    }
  };
  // Pictures one after another, the first centred where asked and each next one beside the one before, in the order given,
  // tops in line (Leo, 23 Nov: pasted pictures "pile up"). The first error stops it.
  const putAll = async (files: Blob[], at?: { x: number; y: number }, pin = false) => {
    measure();
    const [wx, wy] = at ? [(at.x - ox) / cam.z - cam.x, (at.y - oy) / cam.z - cam.y] : [view.w / 2 / cam.z - cam.x, view.h / 2 / cam.z - cam.y];
    let prev = await put(files[0], wx, wy, pin);
    for (const f of files.slice(1, 6)) {
      if (!prev) break;
      prev = await put(f, prev.x + prev.w + 80, prev.y, false, true);
    }
  };
  const pictures = (dt: DataTransfer | null) => [...(dt?.files || [])].filter((f) => f.type.startsWith('image/'));
  on('paste', (e: ClipboardEvent) => {
    if (typing(e, false) || entered) return; // a text box, or an open frame (its page gets it), has its own paste
    const got = pictures(e.clipboardData);
    if (!got.length) return; // a text paste stays untouched
    measure();
    if (!last) return; // the pointer was never on the board: the paste is the page's
    eat(e);
    void putAll(got, last || undefined, alt); // every picture pasted, not only the first (Leo, 23 Nov)
  }, true);
  const files = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
  on('dragover', (e: DragEvent) => {
    if (!mine(e) || !files(e) || entered) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    root.classList.add('drop');
  }, true);
  on('dragleave', (e: DragEvent) => mine(e) && root.classList.remove('drop'), true);
  on('drop', (e: DragEvent) => {
    root.classList.remove('drop');
    if (!mine(e) || !files(e) || entered) return;
    e.preventDefault();
    void putAll(pictures(e.dataTransfer), { x: e.clientX, y: e.clientY }, e.altKey);
  }, true);
  const pick = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  pick.addEventListener('change', () => {
    void putAll([...(pick.files || [])]);
    pick.value = '';
  });
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'zi', textContent: '+ image' });
  add.addEventListener('click', () => pick.click());
  zoomBox.append(add, pick);

  // Where a point of a picture's frame is on the picture itself: shares of the file's width and height (the picture sits in its
  // frame whole, centred, so a frame of another shape has bars the point may be on: held to the edge), and the file's name and size.
  const kx = (f: Frame) => (f.ow ? f.ow / f.w : 1); // stored px per drawn px (a phone draws every frame 390 wide)
  const ky = (f: Frame) => (f.oh ? f.oh / f.h : 1);
  const onPicture = (f: Frame, x: number, y: number) => {
    const k = Math.min(f.w / f.iw!, f.h / f.ih!);
    const [dw, dh] = [f.iw! * k, f.ih! * k];
    const share = (v: number) => Math.min(1, Math.max(0, v));
    return { file: f.file, nw: f.iw, nh: f.ih, imgX: share((x - (f.w - dw) / 2) / dw), imgY: share((y - (f.h - dh) / 2) / dh) };
  };
  // A pin on a page's frame keeps what it is on in that page (its element, words, section: what a page's own pin keeps), and
  // the frame's page finds it again (frame.ts, with the same code as a page's pins). Its px in the frame stay, for a frame
  // that is asleep or loading, or whose page no longer has it.
  type Spotter = Window & { __labSpot?: { anchor?: (x: number, y: number) => Record<string, unknown>; spot?: (a: object) => { left: number; top: number } | null } };
  const spotter = (c?: Card) => {
    try {
      const w = c?.frame?.dataset.ready ? (c.frame.contentWindow as Spotter | null) : null;
      return w?.__labSpot?.spot && w.innerWidth ? w : null;
    } catch {
      return null; // (another origin's page)
    }
  };
  // What a page's pin says of its element, taken onto a board pin (not its kind, its picture or its area: the board's own).
  const ON_PAGE = ['selector', 'x', 'y', 'docX', 'docY', 'width', 'height', 'element', 'eh', 'text', 'fp', 'quote', 'word', 'inside', 'section', 'block', 'shadow', 'component', 'source', 'looks', 'rules', 'box', 'chosen', 'state', 'cssText', 'gapAbove', 'gapBelow', 'sx', 'scheme', 'background', 'build'];
  const onPage = (c: Card | undefined, wx: number, wy: number) => {
    const w = spotter(c);
    if (!w || !c) return {};
    const k = w.innerWidth / c.f.w; // the page's px per world px (1, unless the frame is drawn at another width)
    let a: Record<string, unknown> | undefined;
    try {
      a = w.__labSpot!.anchor?.((wx - c.f.x) * k, (wy - c.f.y) * k);
    } catch {}
    return a?.selector ? Object.fromEntries(ON_PAGE.filter((n) => a![n] !== undefined).map((n) => [n, a![n]])) : {};
  };
  // Where a frame's pin is now in the frame as stored (fx, fy): on its element when the frame's page has it, else as put.
  type FramePin = { frame?: string; fx?: number; fy?: number; selector?: string; zw?: number };
  const inFrame = (c: Card | undefined, a: FramePin): [number, number] | null => {
    if (!c || a.fx === undefined) return null;
    const w = a.selector && !a.zw ? spotter(c) : null;
    let s: { left: number; top: number } | null | undefined = null;
    try {
      s = w?.__labSpot!.spot!(a);
    } catch {}
    if (!s) return [a.fx, a.fy || 0];
    const k = c.f.w / w!.innerWidth;
    return [s.left * k * kx(c.f), s.top * k * ky(c.f)];
  };
  const boardApi = {
    name,
    /** When the newest move or take-off ⌘Z would put back was made (0: none): one ⌘Z undoes only the newest thing, the board's or a pin's. */
    undoAt: () => taken.at(-1)?.at || 0,
    back,
    busy: () => performance.now() - lastDown < 1500,
    key: (k: Parameters<typeof press>[0]) => press(k, true),
    /** A press inside an entered frame (its page tells, frame.ts): outside any open comment or the chat, so they close. */
    pressed: () => void boardWidget()?.dismiss?.(),
    /** A middle or side button dragged in an entered frame (frame.ts): the board pans by those screen px. */
    pan: (dx: number, dy: number) => go(panBy(cam, dx, dy), true, true),
    frame: (id: string) => find(id)?.frame,
    /** A frame's page was saved and wants a reload (live.ts): the board loads it anew behind it and swaps (live, above). */
    again: (name: string) => {
      const c = find(name.slice(4));
      return Boolean(c?.frame?.dataset.ready && (live(c, true), true));
    },
    box: (id: string) => find(id)?.box || null, // a frame's box in the world: what the widget ties a board pin to
    size: (id: string) => { const c = find(id); return c ? { w: c.s.ow || c.s.w, h: c.s.oh || c.s.h, t: c.f.oh || c.f.h } : null; }, // its size in world px, read without laying the page out: h as stored (an area's shares), t as drawn (its whole page)
    /** A screen point is on this board (a page's view is less than the window). Its box read now: read as the view slid
     * in, it was still below the screen on a busy machine, and an ⌥-click on the board went to the page. */
    contains: (x: number, y: number) => (measure(), inBox(x, y)),
    // Where a point on the screen is on the board: the frame under it (else the nearest), by px from its top left, and the point.
    anchor: (sx: number, sy: number, page = false) => {
      measure();
      const [wx, wy] = [Math.round((sx - ox) / cam.z - cam.x), Math.round((sy - oy) / cam.z - cam.y)];
      const gap = (c: Card) => Math.hypot(Math.max(c.f.x - wx, 0, wx - c.f.x - c.f.w), Math.max(c.f.y - wy, 0, wy - c.f.y - c.f.h));
      const near = [...cards].reverse().sort((a, b) => gap(a) - gap(b))[0]; // (a picture over other frames is on top: the newer one wins a tie)
      const f = near?.f;
      // A point on a frame is its px of the frame as stored (the same on every device); a phone draws it at 390 wide, so it is scaled up
      // from there, and says it was laid out so (lay).
      // A pin (not an area's corners) on a page's frame: what it is on in the page too.
      const on: Record<string, unknown> = page && f?.kind !== 'image' && near && !gap(near) ? onPage(near, (sx - ox) / cam.z - cam.x, (sy - oy) / cam.z - cam.y) : {};
      return { ...on, kind: 'board', board: name, ...(f && { frame: f.id, fx: Math.round((wx - f.x) * kx(f)), fy: Math.round((wy - f.y) * ky(f)), ...(f.ow && { lay: f.w }) }), ...(f?.kind === 'image' && onPicture(f, wx - f.x, wy - f.y)), bx: wx, by: wy, ...(!on.selector && { selector: '', x: 0, y: 0, docX: 0, docY: 0, width: view.w, height: view.h }) };
    },
    // Where a board pin is, in page px (the pins' layer is the page's): with its frame, else at the point it was put.
    /** Where a pin on a frame is now, in the frame's px as stored: on its element in the frame's page, else where it was put. */
    at: (a: FramePin) => inFrame(find(a.frame || ''), a),
    /** The page in a frame changed (frame.ts): its pins are found again. */
    changed: () => dispatchEvent(new Event('lab-board-moved')),
    spot: (a: FramePin & { bx?: number; by?: number; zh?: number; docW?: number; docH?: number; pinX?: number; pinY?: number }): Spot => {
      const c = find(a.frame || '');
      const f = c?.f;
      const p = inFrame(c, a);
      const [wx, wy] = f && p ? [f.x + p[0] / kx(f), f.y + p[1] / ky(f)] : [a.bx || 0, a.by || 0];
      const [sx, sy] = [ox + (wx + cam.x) * cam.z, oy + (wy + cam.y) * cam.z];
      // An area or a drawing on a frame: its box is its shares of the frame (as drawn, whatever the device), from its corner, and its
      // pin where the drag ended.
      // One on the board itself (not within one frame): its size is in the board's px.
      const zone = f && p && a.zw ? { left: sx + scrollX, top: sy + scrollY, width: a.zw * f.w * cam.z, height: (a.zh || 0) * c!.s.h * cam.z }
        : !a.frame && a.zw && a.docW ? { left: sx + scrollX, top: sy + scrollY, width: a.docW * cam.z, height: (a.docH || 0) * cam.z } : null;
      return { left: sx + scrollX + (zone && a.pinX ? zone.width : 0), top: sy + scrollY + (zone && a.pinY ? zone.height : 0), zone, ...((!inBox(sx, sy) || !shown) && { clipped: true }) };
    },
    camera: () => ({ ...cam }),
    /** A pin gone to (W, a pick in the list): the camera brings its spot into view, at the same zoom, when it is off the
     *  screen. A frame is drawn whole now, so a spot far down it is far down the board, never inside a frame that scrolls. */
    look: (a: { frame?: string; fx?: number; fy?: number; bx?: number; by?: number }) => {
      measure();
      const f = find(a.frame || '')?.f;
      const [wx, wy] = f && a.fx !== undefined ? [f.x + a.fx / kx(f), f.y + (a.fy || 0) / ky(f)] : [a.bx || 0, a.by || 0];
      const [sx, sy] = [(wx + cam.x) * cam.z, (wy + cam.y) * cam.z];
      if (sx < 40 || sy < 60 || sx > view.w - 40 || sy > view.h - 60) go({ ...cam, x: view.w / 2 / cam.z - wx, y: view.h / 3 / cam.z - wy });
    },
    /** The camera glides by dy screen px (the keyboard is up: a draft pin comes above its sheet), past the board's edges if it must. */
    nudge: (dy: number) => {
      home ??= cam.y;
      glide(cam.y + dy / cam.z);
    },
    /** …and back to where it was before; done once it is there (at once when it never left). */
    nudgeBack: (done?: () => void) => {
      const to = home;
      if (to == null) return void (cancelAnimationFrame(nudging), done?.());
      glide(to, () => ((home = null), done?.()));
    },
    selected: () => selected,
    entered: () => entered,
    live: () => cards.filter((c) => c.frame).map((c) => c.f.id),
  };
  // The box changed size (the window, or a page's view dragged smaller): everything fits again until the camera was moved.
  // While it changes (a view's edge being dragged) what is on the screen stays where it is: the camera goes with the
  // box's corner, nothing is fitted again, no frame is woken and the widget draws nothing but what the edge crosses.
  // Once it rests the board fits again (or is held to its edges, when the camera was moved), in one step (Leo, 19 Nov:
  // "when moving size of boards its sometimes flickering weirdly on some points": it fitted and drew all of it per step).
  // The camera's glide up or down (api.nudge), not one frame (Leo, 21 Nov: "scrolling position to pin can be smoother"). It
  // goes with a phone's keyboard and the comment's sheet, so it moves as they do: off at once and settling, about 0.3 s
  // (eased in and out over 0.42 s it started after them and was still going when they had stopped). The camera alone: the
  // widget moves the pins and the open box with it and draws nothing again (drawn again on each step, the box was made
  // anew and took the cursor every frame of the glide).
  const glide = (to: number, done?: () => void) => {
    const from = cam.y;
    cancelAnimationFrame(nudging);
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(380, 240 + Math.abs(to - from) * cam.z * 0.3);
    const t0 = performance.now();
    const step = (now: number) => {
      if (signal.aborted) return;
      const k = ms ? Math.min(1, Math.max(0, (now - t0) / ms)) : 1; // (a frame's own time can be a little before t0: never backwards)
      go({ ...cam, y: from + (to - from) * (1 - (1 - k) ** 3) }, false, true, true);
      if (k < 1) return void (nudging = requestAnimationFrame(step));
      nudging = 0;
      done?.();
    };
    step(t0);
  };
  let sized = false;
  const ro = new ResizeObserver(() => {
    const [px, py, pv] = [ox, oy, view];
    measure();
    if (!sized || !cards.length) return void ((sized = true), go(moved ? cam : fitAll(boxes(), view), false));
    if (px === ox && py === oy && pv.w === view.w && pv.h === view.h) return; // already drawn at this size (resized(), below)
    // What is on the board stays where it is in the view, its zoom and place, as the view's edge moves (Leo, 21 Nov:
    // "closing/opening board drawer should not move zoom/position inside board").
    sizing = true;
    cancelAnimationFrame(drawFrame);
    paintCam(); // now, before this frame is drawn (a frame later the frames would trail the edge by one step of the drag)
    moving();
  });
  ro.observe(root);
  // The board file changed (the agent added a frame, a person moved one elsewhere): read it again. The lab's state says so.
  let bver: number | undefined;
  let started = false;
  on('lab-state', (e: CustomEvent) => {
    if (typeof e.detail?.boards === 'number' && e.detail.boardNames?.includes?.(name) !== false && e.detail.boards !== bver) {
      const was = bver;
      bver = e.detail.boards;
      // The first state this page hears may already be a change (a tab that joins the lab's stream hears none until
      // one comes): it names this board then, and the board is read again.
      if (started && (was !== undefined || e.detail.boardNames?.includes?.(name))) load();
    }
  });
  load().then(() => (started = true));
  const destroy = () => {
    keepCam();
    ac.abort();
    ro.disconnect();
    cancelAnimationFrame(drawFrame);
    clearTimeout(still);
    clearTimeout(holdTimer);
    handLayer?.remove();
    if (entered) leave();
    for (const c of cards) c.frame?.remove();
    root.replaceChildren();
  };
  return { api: boardApi, destroy };
}
