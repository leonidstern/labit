// A dev server reloads the page as soon as a file changes — under you, mid-sentence, or with the chat open. The lab
// puts a small holder at the top of every page it serves from a dev server (local.mjs, HOLD): it wraps WebSocket and
// keeps a reload message waiting while words sit unsent, a drawing is not sent yet, or a sheet (the chat, a thread, the
// list, a new comment) is open, the same rule the lab's own reload follows (live.ts, busy). This is the widget's side of it.
// Where there is no holder (a folder of files), nothing waits — the words are still kept (composer.ts).

type Holder = { writing: number; held: unknown[]; flush: () => void };
const holder = (): Holder | null => (window as unknown as { __lab?: Holder }).__lab || null;

let words = 0;
let open = false;
let drawing = false;
const update = () => {
  const L = holder();
  if (!L) return;
  L.writing = words + (open ? 1 : 0) + (drawing ? 1 : 0);
  if (!L.writing) L.flush(); // nothing is being written or read any more: the page can catch up
};

/** Called as a box changes: how many boxes hold words nobody has sent. */
export function holdReloads(count: number) {
  words = Math.max(0, count);
  update();
}

/** Called as the widget draws: whether a sheet (chat, thread, list, new comment) is open. */
export function holdWhileOpen(isOpen: boolean) {
  if (open === isOpen) return;
  open = isOpen;
  update();
}

/** Called as a drawing starts and is sent (drag.ts): a reload mid-drawing would lose its strokes (issue 428). */
export function holdWhileDrawing(on: boolean) {
  if (drawing === on) return;
  drawing = on;
  update();
}
