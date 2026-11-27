// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
//
// A board in the page, and the widget's part in it: showing a board, a tap on it that closes a comment, the board's camera
// moving the pins with it, and the page's pins hiding under a board's view.
import { heldPin } from './pinhold.ts';
import { anchorAt, boxTo, position } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
let S: any; // the widget's state (W.S), read once at startup
// A board in this page (src/board/overlay.ts, loaded when one is opened): its link, the address's #board=<name> (a
// reload, a forward) or a board picked in the list opens it.
// The host's data-board hides the page's pins (styles.css, .onp): set here from the moment it is asked for, so none
// shows while its script loads; the view keeps it while it is open (overlay.ts).
const board = (on: boolean) => W.host.toggleAttribute('data-board', on);
let asked = false;
/** A press on what opens a board (its link, its row in the bar): the page's pins go as it goes down, not after the
 * click a press later (Leo, 26 Nov: "disappering can be even faster?"); back if it opened nothing (let go elsewhere). */
export const pressBoard = () => {
  if (globalThis.__LAB_CO__ || W.host.hasAttribute('data-board')) return;
  asked = false;
  board(true);
  void W.part('boardview').catch(() => {}); // fetched while the button is down: the board comes up at the click
  // (a press the browser takes back, a scroll or a gesture, ends in pointercancel: the pins come back then too)
  const ac = new AbortController();
  const off = () => (ac.abort(), setTimeout(() => asked || board(false), 60));
  for (const t of ['pointerup', 'pointercancel']) addEventListener(t, off, { signal: ac.signal });
};
export const showBoard = (name: string, of = '', push = true) => globalThis.__LAB_CO__ ? undefined :
  ((asked = true), board(true), W.part('boardview').then((m) => m.show(name, { page: S.page, of, push, onClose: () => {
    const open = S.comments.find((c) => c.id === S.openId);
    if (open?.anchor?.kind === 'board') S.openId = null;
    if (S.draft?.anchor?.kind === 'board') S.draft = null;
    W.render();
  } }), () => (board(false), W.say("the board couldn't load"))));
// This page's boards, read from the lab's list: the bar's "boards" part lists them (Leo, 23 Nov, S5: every board of a
// page in one place, no hidden ones).
type Listed = { name: string; of?: string; title?: string; frames: number };
const loadBoards = () =>
  fetch('/_lab/api/board', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null).then((d) => {
    if (!d?.boards) return;
    const mine = (d.boards as Listed[]).filter((b) => (b.of || '').split('#')[0] === S.page);
    const was = JSON.stringify(S.pageBoards);
    S.pageBoards = mine;
    if (JSON.stringify(mine) !== was) W.render();
  });
/** "+ New board" in the boards list: a board of this page, named after it, and it opens. */
export const newBoard = async () => {
  if (globalThis.__LAB_CO__) return;
  const made = await fetch('/_lab/api/board', { method: 'POST', headers: W.headers(), body: JSON.stringify({ action: 'new', of: S.page }) }).then((r) => (r.ok ? r.json() : null), () => null);
  if (!made?.board) return W.say("the board couldn't be made");
  void loadBoards();
  return showBoard(made.board.name);
};
// The lab says a board changed: this page's list is read again.
const watchBoards = () => {
  let rev = -1;
  addEventListener('lab-state', (e) => {
    const d = (e as CustomEvent).detail;
    if (typeof d?.boards !== 'number' || d.boards === rev) return;
    if (rev >= 0) void loadBoards(); // the first is the one read at startup
    rev = d.boards;
  });
};
// A tap on the board outside an open comment or the chat closes it, as a click outside one does on a page (onPageClick,
// and the chat's own press above); the board's surface eats its presses, so it asks here (Leo, 19 Nov). True when
// something closed: that tap only closes, a sent pin's undo card too (as on a page: the sent pin stays, no new one).
const dismiss = () => {
  const chat = S.chatOpen && !W.coarse; // phones close the chat by its handle or the dimmed page
  if (!S.draft && !S.openId && !chat) return false;
  if (S.undo && S.openId === S.undo.id) S.undo = null;
  S.draft = null;
  S.openId = null;
  if (chat) S.chatOpen = false;
  W.render();
  return true;
};
// Many pins drop their soft shadow while the camera moves and take it back once it rests (styles.css): Safari's engine
// draws 480 shadows too slowly to keep a pan smooth.
let resting: ReturnType<typeof setTimeout>;
const moving = () => {
  W.layer.toggleAttribute('data-moving', true);
  clearTimeout(resting);
  resting = setTimeout(() => W.layer.removeAttribute('data-moving'), 200);
};
// The board's camera moved (a pinch, a pan) and nothing else: its pins go with it in the same frame, placed by the
// board's own sums (no read of the page, no redraw of the widget: that took 70 ms a frame on a page with many pins,
// and ran a frame late, so the pins swam behind the frames; Leo, 19 Nov: "zoom feels weird, slow"). An open card or a
// new comment's box on the board moves by as much as its pin, as it is (what is typed in it stays). Pins the browser
// holds move by themselves. False when it can't (a pin being dragged): the caller draws everything again.
const followCamera = () => {
  if (S.grabbing) return false;
  // Only what is held to the board (onBoard: fixed, placed by its pin). A phone's sheet is not: it sits on the screen's
  // bottom, and one sliding away has a top of its own for that, which the camera going back under it added 251 px to (it
  // jumped up the screen and slid down from there: iOS 27 simulator, 21 Nov).
  const by = (n: HTMLElement | null | undefined, dx: number, dy: number) => {
    if (!n?.style.left || n.style.position !== 'fixed' || !(dx || dy)) return;
    n.style.left = `${parseFloat(n.style.left) + dx}px`;
    n.style.top = `${parseFloat(n.style.top) + dy}px`;
  };
  // Every spot is read first, then every pin written: a spot reads the page's scroll, and reading it after a pin was
  // moved lays the page out again, once per pin (600 pins in a half view: a long task on every frame of a pan).
  const moves: [string, HTMLElement, ReturnType<typeof position>][] = [];
  for (const [id, pin] of W.pinsById) {
    const a = W.pinData.get(pin)?.c.anchor;
    if (a?.kind === 'board' && !heldPin(pin)) moves.push([id, pin, position(a)]);
  }
  if (moves.length > 100) moving();
  const [sx, sy] = [scrollX, scrollY];
  for (const [id, pin, at] of moves) {
    // A drawing is placed by its corner (its lines are laid from there), any other pin by its own spot: the corner where the
    // drag ended is a drawing's pin spot too, which put it beside what was circled, by its own size, after a zoom (21 Nov, Mac test).
    const ink = at.zone && pin.classList.contains('ink');
    const [x, y] = [(ink ? at.zone.left : at.left) - sx, (ink ? at.zone.top : at.top) - sy]; // held to the screen (onBoard)
    if (S.openId === id && S.openCard?.isConnected) by(S.openCard, x - parseFloat(pin.style.left), y - parseFloat(pin.style.top));
    pin.style.left = `${x}px`;
    pin.style.top = `${y}px`;
    // A drawing is as big as the area it covers: its lines go with the zoom (Leo, 21 Nov: "zooming board and drawings doesnt work").
    // An area's outline, shown while its pin is open or pointed at, goes with the zoom too (Leo, 26 Nov: "zoom with selection
    // pin works weird": it kept its size on the screen while the frame under it grew or shrank).
    if (at.zone && (S.openId === id || W.pinData.get(pin)?.hot)) boxTo(W.layer.querySelector('.zone.saved'), at.zone);
    const svg = at.zone && (pin.querySelector(':scope > svg.ink') as SVGElement | null);
    if (svg && at.zone) [svg.style.width, svg.style.height] = [`${at.zone.width}px`, `${at.zone.height}px`];
    pin.style.visibility = at.clipped && S.openId !== id ? 'hidden' : '';
  }
  if (S.draft?.anchor?.kind === 'board') {
    const pin = W.layer.querySelector('.pin.draft') as HTMLElement | null;
    if (pin) {
      const at = position(S.draft.anchor);
      const [dx, dy] = [at.left - scrollX - parseFloat(pin.style.left), at.top - scrollY - parseFloat(pin.style.top)];
      by(pin, dx, dy);
      by(W.layer.querySelector('.float:not(.out)') as HTMLElement | null, dx, dy);
      if (at.zone) boxTo(W.layer.querySelector('.zone.draft'), at.zone); // a new area's outline, as its comment box is written
    }
  }
  return true;
};
export function bindBoardCam(w: unknown) {
  W = w;
  S = W.S;
  // A board page (src/board/): a tap in comment mode puts a pin on the board (anchoring.ts asks the board where a point is
  // and where a pin sits), and the pins move with the camera.
  S.pageBoards = [] as Listed[];
  if (!S.board && self === top && !globalThis.__LAB_CO__) { // colabit has no boards
    watchBoards();
    void loadBoards();
    Object.assign(window, { __labBoardView: { show: showBoard } });
    const bn = /^#board=([a-z0-9][a-z0-9_-]*)/i.exec(location.hash)?.[1];
    if (bn) showBoard(bn, '', false);
  }
  Object.assign(window, { __labBoardWidget: { pinning: () => W.commenting() /* the pin tool picked (C): a plain click on the board comments */, drawing: () => S.dKey || S.penTool /* D held, or the board's draw tool (⋯ → draw) */, holding: () => S.on /* a phone's hold comments in either mode, as on a page */, hold: (x: number, y: number) => { if (S.draft || S.openId) W.closeOrNudge(); else W.begin(anchorAt(x, y)); }, place: (x: number, y: number) => (S.draft || S.openId ? W.closeOrNudge() : W.begin(anchorAt(x, y))), dismiss } });
  addEventListener('lab-board-moved', (e) => {
    const d = (e as CustomEvent).detail;
    if (!S.on) return;
    // The camera alone: no redraw. (The page's own pins are hidden under the view all at once, by the host's
    // data-board: styles.css, .onp.)
    if (d?.camera && followCamera()) return;
    S.moveFrame ||= requestAnimationFrame(() => ((S.moveFrame = 0), W.render()));
  });
}
