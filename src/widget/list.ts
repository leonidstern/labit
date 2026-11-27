// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
import { PROGRESS_MS } from '../../lib/schema.mjs';
import { scrollPageTo } from './sheets.ts';
import { pageBottom } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindList(w: unknown) {
  W = w;
}

let going = 0; // the latest goTo: a board that opens late opens its pin only if nothing else was picked meanwhile
export const goTo = (c, keys = false) => {
  const mine = ++going;
  // A pin on a board this page links (overlay.ts): the board opens over the page and the pin opens on it; the page stays.
  const a = c.anchor || {};
  const view = (window as unknown as { __labBoard?: { name?: string; look?: (a: unknown) => void }; __labBoardView?: { show: (n: string) => Promise<unknown> } });
  // On its board, open: the camera goes to it (a frame is drawn whole: the board moves, no frame scrolls).
  if (a.kind === 'board' && view.__labBoard && (W.S.board || view.__labBoard.name === a.board)) return void (view.__labBoard.look?.(a), (W.S.openId = c.id), (W.S.draft = null), W.render());
  if (a.kind === 'board' && !W.S.board) {
    const was = W.S.openId;
    return void view.__labBoardView?.show(a.board).then(() => setTimeout(() => mine === going && W.S.openId === was && (view.__labBoard?.look?.(a), (W.S.openId = c.id), (W.S.draft = null), W.render()), 300));
  }
  W.S.stepping = Boolean(W.S.openId);
  W.S.keepKeys = W.S.stepping && (keys || W.root.activeElement?.localName === 'textarea');
  W.S.openId = c.id;
  W.S.draft = null;
  W.render();
  // The pin comes into view: on phones in the middle of what the sheet leaves free above it; on a computer the pin
  // and its open card together, in the middle of the window when they fit, else from the pin down.
  const pinTop = W.position(c.anchor || {}).top;
  const room = pageBottom(); // what a half board view leaves of the window
  let top = pinTop - Math.max(40, W.coarse && W.S.openCard?.isConnected ? (innerHeight - W.S.openCard.offsetHeight) / 2 : room / 3);
  if (!W.coarse && W.S.openCard?.isConnected) {
    const bottom = W.S.openCard.getBoundingClientRect().bottom + scrollY;
    const tall = bottom - pinTop + 28;
    top = tall <= room - 80 ? pinTop - 28 - (room - tall) / 2 : pinTop - 40;
  }
  // The card was placed before the page moved: with its pin off screen it was kept on screen where the page then was, and
  // the glide left it there, far from its pin (Leo, 23 Nov: "new" from the page's end opened a card down there). Once
  // the page is where it goes, the card goes back by its pin.
  scrollPageTo(top, () => W.S.openId === c.id && W.followOpen?.()); // with room below the page's end on phones, for a pin near it
};

// Turning the phone (or resizing the window) with a thread's sheet open: the page has reflowed under it, and the pin may
// now be off screen or under the sheet. If so it is brought into the middle of what the sheet leaves free, as goTo does;
// the page only scrolls, so the words in the reply box and the caret stay.
export function revealOpen() {
  const card: HTMLElement | null = W.S.openCard;
  const c = W.S.openId && !W.S.draft && W.threads().find((t) => t.id === W.S.openId);
  if (!W.coarse || !c || !card?.isConnected || (c.anchor || {}).kind === 'board') return;
  const pinTop = W.position(c.anchor || {}).top;
  const at = pinTop - scrollY;
  const sheetTop = innerHeight - card.offsetHeight - 8;
  if (at >= 56 && at + 28 <= sheetTop - 16) return;
  scrollPageTo(pinTop - Math.max(40, (innerHeight - card.offsetHeight) / 2));
}

export function drawList(places?: Map<string, { moved?: boolean }>) {
  const all = W.threads();
  W.paintWho?.(); // the pill's words and a phone sheet's line follow the agent's work
  const freshAll = all.filter((c) => !W.isPage(c)).reduce((n, c) => n + W.unread(c).length, 0); // a new message in a done thread counts too
  // The middle shows how many are new (a click goes to the next one). The pills keep their place whatever the counts:
  // with nothing new or done they stay, quiet and disabled, so nothing in the bar moves.
  W.listBtn.hidden = !W.S.on;
  W.listBtn.replaceChildren(W.coarse ? 'new' : W.keyLabel('new', W.KEYS.next), W.el('b', { class: `cnt${freshAll ? '' : ' zero'}` }, String(freshAll))); // phones: no keys
  W.listBtn.setAttribute('aria-label', `next new comment, ${freshAll} new`);
  W.listBtn.setAttribute('aria-keyshortcuts', W.KEYS.next);
  const key = W.KEYS.next.toUpperCase();
  W.listBtn.title = `next new comment: ${key} (⌃D while typing), ⌥${key}: back to the one read before`;
  W.listBtn.disabled = !freshAll;
  W.listBtn.classList.toggle('quiet', !freshAll);
  const doneCount = all.filter((c) => !W.isPage(c) && (c.resolved || workState(c)[0] === 'done') && !W.unread(c).length).length;
  const gone = movedPins(places);
  W.movedBtn.hidden = !W.S.on || !gone.length;
  W.movedBtn.textContent = `moved · ${gone.length}`;
  const boards = W.S.pageBoards?.length || 0; // this page's boards (boardcam.ts): the bar's part while there are any
  W.boardsBtn.hidden = !W.S.on || !boards;
  W.boardsBtn.textContent = `boards · ${boards}`;
  W.doneBtn.hidden = !W.S.on;
  W.doneBtn.disabled = !doneCount && !W.S.showDone;
  W.doneBtn.classList.toggle('quiet', W.doneBtn.disabled);
  W.doneBtn.replaceChildren(W.S.showDone ? `hide done · ${doneCount}` : `show done · ${doneCount}`, W.el('kbd', { 'aria-hidden': 'true' }, W.KEYS.done));
  W.doneBtn.setAttribute('aria-keyshortcuts', W.KEYS.done);
  W.placeBar();
  // The browser tab shows how many new messages there are, as "(3) Page title".
  const tabNew = all.reduce((n, c) => n + W.unread(c).length, 0);
  if (!W.tabTitle.base || !document.title.startsWith('(')) W.tabTitle.base = document.title.replace(/^\(\d+\) /, '');
  const want = tabNew ? `(${tabNew}) ${W.tabTitle.base}` : W.tabTitle.base;
  if (document.title !== want) document.title = want;
}

// A thread's state for the agent: ['now' | 'got' | 'missed' | 'asks' | 'next' | 'done' | null, since when]. now: it said it is on it
// (--on-it) or gave a progress line; got: handed to it, nothing from it yet; asks: it asked a question (--question) and
// waits for the person; missed: handed to a session that never answered; next: sent, not handed yet. "since" is its latest sign.
export const workState = (c) => {
  const thread = [c, ...W.repliesOf(c.id)];
  const lastPerson = thread.filter((m) => !m.session).map((m) => m.createdAt).sort().at(-1) || '';
  const answer = thread.filter((m) => m.session).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  const answered = answer && answer.createdAt > lastPerson;
  // What the answer is: its intent (labit reply --done / --on-it / --question; the lab reads it from the first words
  // of an answer that doesn't say).
  const said = answered && answer.intent;
  if (c.resolved || said === 'done') return ['done', answered ? answer.createdAt : c.createdAt];
  if (said === 'question') return ['asks', answer.createdAt];
  // A progress line is a sign for PROGRESS_MS, then it lapses: only its time is kept (build() greys it).
  if (said === 'working' || c.progress) return ['now', [said === 'working' && answer.createdAt, (c.progress && (Date.now() - Date.parse(c.progress.at) < PROGRESS_MS || !said)) && c.progress.at].filter(Boolean).sort().at(-1)];
  // Handed over and nothing came back within the lab's two minutes (local.mjs ANSWER_MS): it goes to the next wait.
  if (!answered && c.unanswered && c.unanswered >= lastPerson && !(c.handedAt > c.unanswered)) return ['missed', c.unanswered];
  if (!answered && c.handedAt && c.handedAt >= lastPerson) return ['got', c.handedAt];
  return answered ? [null, ''] : ['next', lastPerson];
};

// Where each thread stands with the agent: { s, n, at, line }. s is workState's, but with now → stale when it has shown
// no sign for 5 minutes (a picked-up one too), and the pins handed over while another is being worked on → wait, n their
// place in line (1st, 2nd…). With none being worked on, the oldest picked-up one is "got" and the rest wait behind it.
const STALE_MS = 300000;
function build() {
  const out = new Map();
  const live = [];
  const pend = [];
  for (const c of W.threads()) {
    const [s, at] = workState(c);
    const e = { s, n: 0, at, line: c.progress?.text || '', c };
    out.set(c.id, e);
    if (s === 'now') live.push(e);
    else if (s === 'got') pend.push(e);
  }
  pend.sort((a, b) => a.at.localeCompare(b.at) || a.c.createdAt.localeCompare(b.c.createdAt));
  pend.forEach((e, i) => {
    if (live.length || i) Object.assign(e, { s: 'wait', n: i + (live.length ? 1 : 0) });
  });
  // No sign: 5 minutes for a pin picked up, PROGRESS_MS when its only sign is a status line that was not renewed.
  for (const e of [...live, ...pend]) if (e.s !== 'wait' && Date.now() - Date.parse(e.at) > (e.at === e.c.progress?.at ? PROGRESS_MS : STALE_MS)) e.s = 'stale';
  return out;
}
// Kept until the next drawing (or the 10 s tick) sets W.S.line to null: stamps and pins ask for it many times a drawing.
export const lineUp = () => (W.S.line ||= build());
// "just now", "40 s ago", "3 min ago", and the bare "3 min" for "no update for 3 min".
const mins = (at) => {
  const m = Math.floor((Date.now() - Date.parse(at)) / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
};
const age = (at) => {
  const s = (Date.now() - Date.parse(at)) / 1000;
  return s < 10 ? 'just now' : s < 60 ? `${Math.floor(s / 10) * 10} s ago` : `${mins(at)} ago`;
};
export const ord = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
// The line for one thread as it stands: its progress and age, or "no update for 6 min · last: …" once it has gone quiet.
export const lineOf = (e) => (e.s === 'stale' ? `no update for ${mins(e.at)}${e.line ? ` · last: ${e.line}` : ''}` : e.line ? `${e.line} · ${age(e.at)}` : '');
// What the pill's box says about the agent's work: the line of the thread it signed most recently (when even that one went
// quiet, "No update for 6 min" and, as last, what it said then), and how many wait.
export function pillLine() {
  const all = [...lineUp().values()];
  const top = all.filter((e) => e.s === 'now' || e.s === 'stale').sort((a, b) => b.at.localeCompare(a.at))[0];
  const stale = top?.s === 'stale';
  return { text: !top ? '' : stale ? `No update for ${mins(top.at)}` : top.line, last: stale && top.line ? `Last: ${top.line}` : '', stale, waiting: all.filter((e) => e.s === 'wait').length };
}

export const stepNew = (dir) => {
  const fresh = W.threads().filter((c) => !W.isPage(c) && W.unread(c).length);
  if (!fresh.length) return;
  const tops = new Map(fresh.map((c) => [c.id, W.position(c.anchor || {}).top])); // read once each, not in the comparator
  const top = (c) => tops.get(c.id) ?? W.position(c.anchor || {}).top;
  fresh.sort((a, b) => top(a) - top(b));
  // The open one was read when it opened, so it's no longer in the list: step on from where it is on the page.
  const open = W.S.openId && W.threads().find((c) => c.id === W.S.openId);
  const here = open ? top(open) : null;
  const after = here == null ? -1 : fresh.findIndex((c) => top(c) > here);
  const at = fresh.findIndex((c) => c.id === W.S.openId);
  const next = at >= 0 ? (at + dir + fresh.length) % fresh.length
    : here == null ? (dir > 0 ? 0 : fresh.length - 1)
    : dir > 0 ? (after < 0 ? 0 : after)
    : ((after < 0 ? fresh.length : after) - 1 + fresh.length) % fresh.length;
  W.S.chatOpen = false; // N new from the chat: the chat closes and the new comment opens
  goTo(fresh[next], !W.coarse); // the reply box takes the cursor (not on phones: no keyboard popping up)
};

// ⌥W goes back to the thread read before the open one, read or not, in the order they were first read; with none open,
// to the last one read (Leo, 26 Nov: "doesnt open last readed comment"; it went to the unread one above).
const opened: string[] = [];
let last = '';
export const noteOpened = (id: string) => ((last = id), opened.includes(id) || opened.push(id));
export const stepBack = () => {
  const c = W.threads().find((t) => t.id === (W.S.openId ? opened[opened.indexOf(W.S.openId) - 1] : last));
  if (!c) return;
  W.S.chatOpen = false;
  goTo(c, !W.coarse);
};

// Pins whose spot is gone from the page: off the page, listed in the ⋯ menu as "moved · N". A done one is listed as a done
// pin on the page is shown: while show done is on or it has something unread (#569: the agent's edit took its spot, its
// answer came, and the pin was nowhere to read it or open it again).
const movedPins = (places?: Map<string, { moved?: boolean }>) =>
  W.threads().filter((c) => !W.isPage(c) && (!c.resolved || W.S.showDone || W.unread(c).length) && (places?.get(c.id) || W.placeOf(c)).moved);
export const stepMoved = () => {
  const all = movedPins();
  if (all.length) goTo(all[(all.findIndex((c) => c.id === W.S.openId) + 1) % all.length]);
};
