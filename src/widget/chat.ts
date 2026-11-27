// The chat sheet's messages, its own file (public/_lab/chat.js): loaded as the chat button shows, drawn only while the
// chat is open. The button and its count are the page script's (drawChat in src/comments.js). Uses the widget's own parts
// through W (the thread's question rows, a list that stays at its newest), so nothing is built in twice.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;

// The chat: the page's whole conversation in time order (messages about the page as a whole, pins and every reply;
// a pin's say what they're on). An agent's question with choices shows its rows, as in a thread (thread.ts). New messages are about the page; on phones swipe one to answer it instead.
// A long chat lays out only the messages near the screen (styles.css: content-visibility), each held at a 64 px guess
// until it is first drawn. Scrolling up the first time, each message drawn for the first time took its real height
// above what you were reading, and Safari (no scroll anchoring) let all of it jump down: 38, 17, 80 px at a time (iOS 27
// simulator, 27 Nov; Leo's phone: "open chat and scroll on top its like preloading", fine once scrolled through). So as
// the chat opens, every message is drawn once, in the frame it opens in, before it is put at its newest: each keeps that
// height when it is away again (contain-intrinsic-size: auto), and nothing above changes height later. It used to be a
// batch a frame, paused while a finger was down or the list moving (setting the scroll then stops it): a flick in the
// first 150 ms ran into messages not drawn yet, 17-253 px a frame with nothing to take it up (iPhone 18 Pro simulator,
// 27 Nov). The cost, all at once: opening 150 messages (drawChat's most) took 85 ms against 33 (WebKit on a Mac); the
// newest 60 only, with the rest in batches, still 63 and the jumps further up.
const warmed = new WeakSet<Element>(); // drawn once: a node kept across redraws keeps its height (drawMsgs's same())
function warmChat(box: HTMLElement) {
  const cold = [...box.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('msg') && !warmed.has(n));
  for (const n of cold) {
    n.classList.add('warm');
    warmed.add(n);
  }
  // Drawn in full in the next frame: their real heights are kept from then on, and they go back to being skipped.
  if (cold.length) requestAnimationFrame(() => requestAnimationFrame(() => cold.forEach((n) => n.classList.remove('warm'))));
}

/** The open chat's messages (msgs, byId: drawChat's in src/comments.js); opening: it was closed until now. */
export function drawMsgs(w: unknown, msgs, byId: Map<unknown, any>, opening: boolean) {
  W = w;
  const box = W.$('.msgs', W.chatEl);
  // Opens at the newest; later it follows new messages only while you're at the bottom, not while you read back (nor
  // when a fold row was just tapped: the messages it opens are not new, and the row stays where it is).
  const atEnd = opening || (!W.S.foldToggle && box.scrollHeight - box.scrollTop - box.clientHeight < 48);
  const before = new Set(opening ? [] : [...(box.children as HTMLCollectionOf<HTMLElement>)].map((n) => n.dataset.id));
  // A message already on screen that hasn't changed keeps its own node: a redraw for one new message used to rebuild
  // every bubble (a phone showed the chat blink as messages arrived).
  const kept = new Map([...(box.children as HTMLCollectionOf<HTMLElement>)].filter((n) => n.dataset.id).map((n) => [n.dataset.id, n]));
  // A message's pictures go in after it is drawn (the attach part, a moment later): read without them, a message with
  // pictures is the same message, and a picture opened in it stays open (it was built again, closed, on every draw).
  const html = (n: HTMLElement) => {
    if (!n.querySelector(':scope > [data-pics]')) return n.outerHTML;
    const c = n.cloneNode(true) as HTMLElement;
    c.querySelector(':scope > [data-pics]')!.remove();
    return c.outerHTML;
  };
  const same = (n) => {
    const old = kept.get(n.dataset?.id);
    return old && html(old).replace(' fresh', '').replace(/ warm"/, '"') === n.outerHTML ? old : n; // (warm: warmChat's, for a frame)
  };
  const unfolded: Set<string> = (W.S.unfolded ||= new Set());
  const rootId = (m) => m.parent || m.id;
  // The agent's "on it" messages fold into one muted row once an answer follows them (as in a thread).
  const slots = W.foldStatus(msgs, rootId, unfolded).flatMap((s) => (s.fold ? [s, ...(s.open ? s.items.map((m) => ({ m })) : [])] : [s]));
  W.patchKids(box, slots.flatMap((slot) => {
    if (slot.fold) return [W.foldRow(slot, unfolded)];
    const m = slot.m;
    const root = m.parent ? byId.get(m.parent) : m;
    const b = W.el('div', { class: `msg${W.mine(m) && !m.session ? ' mine' : ''}${before.size && !before.has(m.id) && !W.S.foldToggle ? ' fresh' : ''}`, 'data-id': m.id, ...(W.agentOf(m) ? { 'data-agent': W.agentOf(m) } : {}) });
    // No done mark by the agent's name (Leo, 15 Nov): your own message's green ✓ already says it was answered, and a
    // "Done" answer closes the thread.
    b.append(W.nameLine(m.name));
    // A reply shows what it answers, as in Telegram: the name and the start of that message; a tap there jumps to it.
    if (m.parent && root) {
      const q = W.el('div', { class: 'quote' });
      q.append(W.el('b', {}, String(root.name || '').replace(/\s*·\s*session\s+\S+$/i, '')), document.createTextNode(root.text.replace(/\s+/g, ' ').slice(0, 90)));
      q.addEventListener('click', (e) => {
        e.stopPropagation();
        const box = W.$('.msgs', W.chatEl);
        const to = W.$(`[data-id="${root.id}"]`, box);
        if (!to) return;
        box.scrollTo({ top: to.offsetTop - box.offsetTop - 12, behavior: W.still.matches ? 'auto' : 'smooth' });
        to.animate?.([{ boxShadow: `0 0 0 2px ${getComputedStyle(to).getPropertyValue('--_green').trim()}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: W.ms('hold') });
      });
      b.append(q);
    }
    b.append(...W.readable(m.text));
    if (m.images) W.part('attach').then((a) => a.show(b.appendChild(W.el('div', { 'data-pics': '' })), m)); // pictures, as in a thread (thread.ts)
    // The agent's question with choices: its rows under it, as in a thread's card (thread.ts), nothing tried in the page.
    if (m.session && Array.isArray(m.choices) && m.choices.length && root) {
      b.classList.add('asks');
      b.append(W.choicesEl(root, m, W.chatEl, true));
    }
    W.stamped(b, W.stampOf(m, root));
    return m.id === W.S.newFrom && m !== msgs[0] ? [W.el('div', { class: 'newline' }, 'new'), b] : [b];
  }).map(same));
  if (!box.firstChild) box.append(W.el('div', { class: 'none' }, 'say something about the page as a whole'));
  const chat = W.chatEl.querySelector('.chat');
  if (!chat.firstChild) {
    // At its newest it stays at its newest while it gets shorter (the keyboard coming up as you write), as a thread
    // does; scrolled back to read, it stays put (Leo, 19 Nov: "opening keyboard in chat scrolls content so I can't
    // see the latest message").
    const end = W.stickToEnd(box);
    // Going to write: the last message comes into view, so you write under it.
    chat.addEventListener('focusin', (e) => (e.target as Element).localName === 'textarea' && end.pin());
  }
  if (!chat.firstChild)
    chat.append(
      W.composer({
        placeholder: 'message',
        draftKey: `lab-typing:${W.S.page}:chat`,
        attach: true,
        onSubmit: async (name, text, att) => {
          const { comment } = await W.send({ name, text, ...att, anchor: { kind: 'page', width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1, board: (window as unknown as { __labBoard?: { name?: string } }).__labBoard?.name } }); // sent with a board open: its name, so the agent knows (Leo, 26 Nov)
          W.addComment(comment, 1);
          box.scrollTop = box.scrollHeight;
          W.S.stayAtEnd?.(box);
          W.render();
          return { keep: true }; // the same box stays, with the cursor in it: the phone's keyboard stays up
        },
      }),
    );
  if (opening) warmChat(box); // before it is put at its newest: the heights above it are real from the first frame
  if (atEnd) {
    box.scrollTop = box.scrollHeight;
    W.S.stayAtEnd?.(box); // and stays at the newest while the sheet and its words settle (comments.js)
  }
}
