// Small pieces of a message: what a comment is on, in a few words (the list), and the time and mark in a bubble's
// corner (chat and threads). Part of the comment widget (src/comments.js bundles it).

type Deps = {
  el: (tag: string, attrs?: Record<string, string>, text?: string) => HTMLElement;
  mine: (c: any) => boolean;
  repliesOf: (id: string) => any[];
  lineUp: () => Map<string, { s: string; n: number }>;
  ord: (n: number) => string;
  render: () => void;
  S: any;
  root: ParentNode;
};

// Set once by the widget at startup (bindMessages).
let d: Deps;
export function bindMessages(deps: Deps) {
  d = deps;
}

export const stampOf = (m: any, root: any, prefix = ''): HTMLElement => {
  const { el, mine, repliesOf, lineUp, ord } = d;
  const at = new Date(m.createdAt);
  const time = at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const stamp = el('span', { class: 'stamp' });
  stamp.append(el('span', { class: 'tm' }, prefix + time));
  if (mine(m) && !m.session) {
    const thread = root ? [root, ...repliesOf(root.id)] : [m];
    const latest = !thread.some((x) => !x.session && x.createdAt > m.createdAt);
    // Answered: a reply from the agent after it, or the thread done with nothing after it, as a plain "go" is (the
    // agent resolves it without a word: one green ✓ where the grey ✓✓ was, Leo 17 Nov).
    const answered = thread.some((x) => x.session && x.createdAt > m.createdAt) || Boolean(root?.resolved && latest);
    // The agent is on this very message (its newest one in the thread): the ring, as on the pin (grey once it has gone
    // quiet). Answered: green ✓. Handed over but behind another: its place in line.
    const sg = !answered && latest && root ? lineUp().get(root.id) : null;
    if (sg?.s === 'now' || sg?.s === 'stale') {
      stamp.classList.add('busy');
      stamp.append(el('span', { class: `ring${sg.s === 'stale' ? ' stale' : ''}`, role: 'img', 'aria-label': sg.s === 'stale' ? 'no sign from the agent for a while' : 'the agent is on it' }));
    } else if (answered) {
      stamp.classList.add('ans');
      stamp.append(el('span', { class: 'tick', role: 'img', 'aria-label': 'answered' }, '✓'));
    } else {
      const got = root?.handedAt && root.handedAt >= m.createdAt;
      stamp.append(el('span', { class: `tick${got ? ' got' : ''}`, role: 'img', 'aria-label': got ? 'delivered to the agent' : 'sent' }, got ? '✓✓' : '✓'));
    }
    // Until it is answered, where it stands says so in words on one line of its own under the bubble, like a messenger's
    // "Delivered". In the corner beside the time the words came and went, and the bubble grew and shrank with them (Leo,
    // 20 Nov: "its jumping and moving things"). The line is always there while it waits, so only its words change.
    // With no agent listening there is nothing to say yet, and no line.
    if (!answered && latest && root && (sg || !d.S.unheard)) {
      // Short, and only what the ticks don't say: sent and picked up are ✓ and ✓✓ (Leo, 23 Nov: "make it super short and
      // remove unnecessary"). The line is kept, empty, so the bubble doesn't move when words come.
      const words = { now: 'on it', stale: 'quiet', wait: `${ord(sg?.n ?? 0)} in line`, missed: 'no answer' }[sg?.s as string] || '';
      stamp.append(el('span', { class: 'state' }, words));
    }
  }
  // An agent's done answer says it looked at the result (labit reply --done --checked "…", #425), on the line its stamp
  // keeps for where a message stands. Just "checked", how it checked on hover; nothing when it didn't (Leo, 23 Nov: the long line ran out of the column).
  if (m.session && m.intent === 'done' && m.checked) stamp.append(el('span', { class: 'state', title: m.checked }, 'checked'));
  return stamp;
};

// An agent's status message: its "on it" (reply --on-it, stored as intent "working"). Not an answer, so it is never
// unread, and once the thread has its answer it folds (foldStatus). Old records work: the intent is all it reads.
export const isStatus = (m: any): boolean => Boolean(m?.parent && m.session && m.intent === 'working');

type Slot = { m: any } | { fold: string; n: number; items: any[]; open: boolean };

// Lays a list of messages out with its status runs folded. A run is consecutive status messages in one thread (other
// threads' messages between them don't break it: in the chat, interleaved threads fold into one row each). When the
// thread has a non-status agent message after the run, the whole run becomes one slot { fold, n, items, open } where its
// first message was (open: the person tapped it, so the messages show in place); with no answer yet it folds all but its
// latest, which stays where it is so you can see it is working. rootOf names a message's thread.
export function foldStatus(msgs: any[], rootOf: (m: any) => string, openKeys: Set<string>): Slot[] {
  const byRoot = new Map<string, any[]>();
  for (const m of msgs) {
    const k = rootOf(m);
    if (!byRoot.has(k)) byRoot.set(k, []);
    byRoot.get(k)!.push(m);
  }
  const folds = new Map<any, Slot>(); // a run's first folded message → the row that stands for the run
  const hidden = new Set<any>();
  for (const list of byRoot.values()) {
    for (let i = 0; i < list.length; ) {
      if (!isStatus(list[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < list.length && isStatus(list[j])) j++;
      const run = list.slice(i, j);
      const answered = list.slice(j).some((x) => x.session && !isStatus(x));
      const gone = answered ? run : run.slice(0, -1);
      if (gone.length) {
        const key = `fold-${gone[0].id}`;
        folds.set(gone[0], { fold: key, n: gone.length, items: gone, open: openKeys.has(key) });
        for (const g of gone) hidden.add(g);
      }
      i = j;
    }
  }
  const out: Slot[] = [];
  for (const m of msgs) {
    const f = folds.get(m);
    if (f) out.push(f);
    else if (!hidden.has(m)) out.push({ m });
  }
  return out;
}

// The row that stands for a fold: "2 updates ›" (muted), "1 update ›"; open, it reads "‹" and the messages follow it.
// A tap flips it in `unfolded`. With inPlace (a thread) the row changes itself and inPlace(open) shows or removes the
// messages after it: nothing is drawn again, so the scroll, the focus and what is typed stay as they are. Without it (the
// chat) the list is drawn again, which replaces the button: the new one takes the keyboard focus back by its data-id,
// and S.foldToggle tells the chat to leave its scroll alone (no stick to the end, no entrance animation for the messages
// it opens).
export const foldRow = (slot: Extract<Slot, { fold: string }>, unfolded: Set<string>, inPlace?: (open: boolean) => void): HTMLElement => {
  const label = (open: boolean) => `${slot.n} update${slot.n === 1 ? '' : 's'} ${open ? '‹' : '›'}`;
  const b = d.el('button', { class: `updates${slot.open ? ' open' : ''}`, type: 'button', 'data-id': slot.fold, 'aria-expanded': String(slot.open) }, label(slot.open));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !unfolded.has(slot.fold);
    if (open) unfolded.add(slot.fold);
    else unfolded.delete(slot.fold);
    if (inPlace) {
      b.classList.toggle('open', open);
      b.setAttribute('aria-expanded', String(open));
      b.textContent = label(open);
      return inPlace(open);
    }
    d.S.endStays?.(); // a stay still settling after the list opened would pull it back to the end
    d.S.foldToggle = true;
    try {
      d.render();
    } finally {
      d.S.foldToggle = false;
    }
    (d.root.querySelector(`.updates[data-id="${slot.fold}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  });
  return b;
};
