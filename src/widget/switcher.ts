// Labs & pages (⌘K, or the ⋯ menu): every lab running on this computer and its pages, to go to one; who listens on
// each; archive a lab (which stops its listening) and start it again. A guest on a phone sees this lab's pages only. Part of the comment
// widget, built as its own file (public/_lab/switcher.js, scripts/build-widget.mjs) that src/comments.js loads the
// first time it is asked for (⌘K, or as the ⋯ menu opens). Leo, 18 Nov (the lab-navigation page, option B).
import css from './switcher.css';

type Page = { url: string; title: string; file: string; path: string; open: number; done?: number; last?: string | null; edited?: string | null; first?: string | null; replies?: number; agent?: number; people?: string[]; opened?: string | null; archived?: string | null; board?: string };
type Lab = { name: string; port: number; here: boolean; mode: string; listening: string | null; pages: Page[]; root?: string; unreachable?: boolean; started?: string; created?: string | null };
type Parked = { name: string; port: number; root: string; archived?: boolean; at?: string };
type Deps = {
  root: ShadowRoot;
  el: (tag: string, attrs?: Record<string, string>, text?: string | Node) => HTMLElement;
  api: string; // /_lab/labs
  admin: string; // this computer's key ('' for a guest)
  page: string; // this page's key
  beforeOpen: () => void; // closes the ⋯ menu and anything else in the way
  // Phones: the box is one of the widget's own sheets (the comment and chat drawer, sheets.ts): the shared dimmed page,
  // the handle, the swipe down, the keyboard fit and back closing all come from there. sheet(open) tells the widget.
  sheet: (open: boolean) => void;
  swipe: (node: HTMLElement, close: () => void) => void;
  leave: (node: HTMLElement, hide: () => void) => void; // the card's exit, then hide
};

let d: Deps;
let box: HTMLElement;
let input: HTMLInputElement;
let list: HTMLElement;
let data: { labs: Lab[]; parked: Parked[]; guest: boolean; local?: { name: string; port: number }[]; self?: string | null } | null = null;
let active = 0;
let toCur = false; // the first list after opening starts on the page you're on, scrolled to it
let armed = ''; // the archive button waiting for its second click: "action port"
let showArchived = false;

let panelEl: HTMLElement;
let foot: HTMLElement;
const switcherOpen = () => Boolean(box && !box.hidden);
/** The open box, for the widget's sheets (null when closed). */
export const switcherSheet = () => (switcherOpen() ? panelEl : null);

export function bindSwitcher(deps: Deps) {
  d = deps;
  const { el, root } = d;
  root.append(el('style', {}, css)); // its styles come with it, after the widget's own
  box = el('div', { class: 'switch', hidden: '', role: 'dialog', 'aria-label': 'labs and pages' });
  const panel = el('div', { class: 'sw-box' });
  panelEl = panel;
  input = el('input', { type: 'search', placeholder: 'Go to a page or a lab', 'aria-label': 'Go to a page or a lab', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }) as HTMLInputElement;
  list = el('div', { class: 'sw-list', role: 'listbox' });
  foot = el('div', { class: 'sw-foot' });
  panel.append(el('div', { class: 'handle' }), input, list, foot);
  box.append(panel);
  (root.querySelector('.ui') || root).append(box); // with the bar, so a pinch zoom keeps it on screen (sheets.ts)
  // A computer's box is a popover: above the page's own dialogs and full screen, and the browser closes it on a press
  // elsewhere or Esc (then it says so here). Phones keep it one of the widget's sheets.
  if (!matchMedia('(pointer: coarse)').matches) {
    box.popover = 'auto';
    box.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState !== 'closed' || box.hidden) return;
      // The browser closed it (a press elsewhere): it leaves as a card does. The popover's display is held for the length of
      // the exit (switcher.css), so the card's own leaving plays; openSwitcher takes the class off again.
      panelEl.classList.add('out');
      box.hidden = true;
      d.sheet(false);
    });
  }
  d.swipe(panel, () => closeSwitcher());
  input.addEventListener('input', () => {
    active = 0;
    draw();
  });
  // Keys anywhere in the box (after a click on a fold button too); Enter only from the search, so a focused
  // button still does its own thing.
  panel.addEventListener('keydown', (e) => {
    const rows = [...list.querySelectorAll<HTMLElement>('.sw-row')];
    if (e.key === 'Enter' && e.target !== input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      mark(rows);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[active]?.dispatchEvent(new MouseEvent('click', { metaKey: e.metaKey || e.ctrlKey }));
    } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyA') {
      // ⌥A archives the chosen page, or brings an archived one back; ⇧⌥A archives the page's whole lab, asking first
      // (the lab stops). Read by key position: Option turns the letter into another character on a Mac.
      e.preventDefault();
      if (data?.guest) return;
      const row = rows[active];
      const port = Number(row?.dataset.port);
      if (!row || !port || !row.dataset.page) return;
      if (!e.shiftKey) return void act(row.dataset.kind === 'archived-page' ? 'unarchive-page' : 'archive-page', port, row.dataset.page);
      if (row.dataset.kind !== 'page') return;
      if (armed !== `archive ${port}`) {
        armed = `archive ${port}`;
        return draw();
      }
      armed = '';
      void act('archive', port);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSwitcher();
    }
  });
}

export function openSwitcher() {
  d.beforeOpen();
  panelEl.classList.remove('out'); // opened again while it was leaving
  box.hidden = false;
  if (box.popover && !box.matches(':popover-open')) box.showPopover();
  d.sheet(true);
  input.value = '';
  active = 0;
  toCur = true;
  armed = '';
  showArchived = false;
  draw();
  // A phone: no keyboard until you tap the search (it pushed the sheet up and down as it opened, Leo 18 Nov).
  if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
  void load();
}

export function closeSwitcher() {
  if (box.hidden) return;
  d.sheet(false);
  // A computer: the box leaves as a card does. A phone: the sheet goes as the widget's sheets do.
  if (matchMedia('(pointer: coarse)').matches) box.hidden = true;
  else
    d.leave(panelEl, () => {
      box.hidden = true;
      if (box.popover && box.matches(':popover-open')) box.hidePopover();
    });
}

/** Ask for the labs ahead, as the ⋯ menu opens, so the box opens with its list. */
export const preloadSwitcher = () => void load();

async function load() {
  try {
    data = await (await fetch(`${d.api}?page=${encodeURIComponent(d.page)}`, { cache: 'no-store' })).json();
  } catch {
    data = null;
  }
  if (switcherOpen()) draw();
}

// A click on a button that draw() then replaces leaves focus nowhere; back to the search, so the keys keep working.
const keepKeys = () => {
  if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
};

function start(port: number, row: HTMLElement) {
  (row.querySelector('.sw-m') as HTMLElement).textContent = 'starting…';
  void act('start', port);
}

async function act(action: 'archive' | 'start' | 'archive-page' | 'unarchive-page', port: number, page?: string) {
  try {
    await fetch(d.api, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-admin': d.admin }, body: JSON.stringify({ action, port, page }) });
  } catch {}
  // A lab that starts takes a moment to answer; one that's archived a moment to go; a page is at once.
  if (action.endsWith('-page')) return void load();
  setTimeout(load, action === 'start' ? 1500 : 400);
  if (action === 'start') setTimeout(load, 4000);
}

const hit = (q: string, ...words: string[]) => !q || words.some((w) => (w || '').toLowerCase().includes(q));
const short = (lab: Lab, p: Page) => p.title || p.path;
/** "now", "5m", "3h", "2d", or a date for anything older than a week. */
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!(s >= 0)) return '';
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
/** A time as the rows show it: "just now", "4m ago", "Nov 3". */
const since = (iso?: string | null) => {
  const a = ago(iso);
  return !a ? '' : a === 'now' ? 'just now' : /\d[mhd]$/.test(a) ? `${a} ago` : a;
};
const latest = (...d: (string | null | undefined)[]) => d.filter(Boolean).sort().pop() || '';
// A page's last activity: a comment, reply or close, or someone opening it (Leo 18 Nov: "show last activity, don't show
// comments count, sort it by last activity"). The rows show it and are ordered by it, newest first.
const touched = (p: Page) => latest(p.last, p.opened);

/** A lab as its topic (labit --name "Lab navigation"), else its folder, "~/projects/site" (Leo 18 Nov: "lab-nav :4481"
 *  confused). A guest, without the path, gets the name. */
const where = (l: { name: string; root?: string }) => {
  if (!l.root || l.name !== l.root.split('/').pop()) return l.name;
  const parts = l.root.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~').split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : parts.join('/'); // deep folders keep their last two
};

// A page row goes to its page (⌘-click: a new tab).
function goes(row: HTMLElement, lab: Lab, p: Page) {
  const url = lab.here ? new URL(p.url, location.href).pathname : p.url;
  row.addEventListener('click', (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey) window.open(lab.here ? location.origin + url : url, '_blank');
    else location.href = url;
  });
}

function draw() {
  const { el } = d;
  const q = input.value.trim().toLowerCase();
  const out: HTMLElement[] = [];
  if (!data) {
    list.replaceChildren(el('div', { class: 'sw-none' }, 'loading…'));
    return;
  }
  const local = !data.guest;
  // Lean (Leo 18 Nov: "make this lean"); the lab keys only where they work, a guest can't archive labs.
  foot.textContent = `↵ go · ⌘↵ new tab${local ? ' · ⌥A archive · ⇧⌥A archive its lab' : ''}`;
  if (data.self) {
    const note = el('div', { class: 'sw-none' }, 'This is your computer, opened through its wifi address, so it sees what a phone sees. ');
    note.append(el('a', { href: data.self }, 'Open it on localhost'), ' for every lab and the lab keys.');
    out.push(note);
  }
  // One list of pages, last active first, from every lab (Leo 18 Nov: "why do we need folders once again?"): a lab is
  // only the folder a page lives in, so it's named in grey on the row, not a heading over it.
  const shelved: { lab: Lab; p: Page }[] = []; // archived pages, listed under "archived" at the bottom
  const live: { lab: Lab; p: Page }[] = [];
  for (const lab of data.labs) {
    const labHit = hit(q, lab.name, String(lab.port), where(lab), lab.root || ''); // the grey label it shows, and its folder
    for (const p of lab.pages) if (labHit || hit(q, p.title, p.path, p.file)) (p.archived ? shelved : live).push({ lab, p });
  }
  live.sort((a, b) => touched(b.p).localeCompare(touched(a.p)));
  for (const { lab, p } of live) {
    const here = lab.here && p.path === d.page;
    const key = `archive ${lab.port}`;
    const row = el('button', { type: 'button', class: `sw-row${here ? ' cur' : ''}${armed === key ? ' armed' : ''}`, role: 'option', 'data-port': String(lab.port), 'data-kind': 'page', 'data-page': p.path });
    // The page's last activity, "5m ago", after its lab's name (Leo 18 Nov: "show last activity, don't show comments count").
    const when = since(touched(p));
    const meta = el('span', { class: 'sw-m' }, armed === key ? `${where(lab)}: archive the whole lab? ⇧⌥A again` : where(lab));
    // What needs you on the page's board, in words, between its lab and its time (Leo, 23 Nov, #422: boards are part of
    // their page and have no rows of their own).
    if (armed !== key && p.board) meta.append(' · ', el('b', {}, p.board === 'needs your reply' ? 'board needs your reply' : 'agent working on its board'));
    if (armed !== key && when) meta.append(` · ${when}`);
    meta.title = [`${lab.root || lab.name} · localhost:${lab.port}`, p.opened ? `opened ${new Date(p.opened).toLocaleString()}` : 'never opened', p.last ? `last comment ${new Date(p.last).toLocaleString()}` : ''].filter(Boolean).join('\n');
    // The title, and the page's path beside it (Leo 18 Nov: "Getting around your labs" didn't say it was /lab-navigation).
    const t = el('span', { class: 'sw-t' }, short(lab, p));
    if (p.title) t.append(el('span', { class: 'sw-path' }, ` ${p.path}`));
    row.append(t, meta);
    goes(row, lab, p);
    out.push(row);
  }
  // A phone: the labs it can't open (not on the wifi, or an older labit), named so none seems missing (Leo 18 Nov).
  const away = (data.local || []).filter((l) => hit(q, l.name, String(l.port)));
  if (data.guest && away.length) {
    out.push(el('div', { class: 'sw-group' }, `on the computer only · ${away.length}`));
    for (const l of away) {
      const r = el('div', { class: 'sw-lab parked' });
      const n = el('div', { class: 'sw-name' });
      n.append(el('span', { class: 'sw-port' }, l.name)); // grey: nothing to tap here
      r.append(n);
      out.push(r);
    }
    out.push(el('div', { class: 'sw-none' }, 'They open here once they run the newest labit with --wifi.'));
  }
  if (local) {
    const all = data.parked.filter((p) => hit(q, p.name, String(p.port), where(p), p.root));
    // Every saved lab that isn't running (archived, or parked by an older build) folds away under "archived".
    const archivedRow = (p: Parked) => {
      const row = el('button', { type: 'button', class: 'sw-row parked', role: 'option', 'data-port': String(p.port), 'data-kind': 'parked' });
      const t = el('span', { class: 'sw-t' });
      t.append(el('b', {}, where(p)));
      row.title = `start it again on localhost:${p.port} (↵)`;
      row.append(t, el('span', { class: 'sw-m' }, `archived ${since(p.at)}`.trim()));
      row.addEventListener('click', () => start(p.port, row));
      return row;
    };
    // An archived page: ↵ still opens it; ⌥A puts it back in its lab.
    const shelvedRow = ({ lab, p }: { lab: Lab; p: Page }) => {
      const row = el('button', { type: 'button', class: 'sw-row parked', role: 'option', 'data-port': String(lab.port), 'data-kind': 'archived-page', 'data-page': p.path });
      const t = el('span', { class: 'sw-t' }, short(lab, p));
      if (p.title) t.append(el('span', { class: 'sw-path' }, ` ${p.path}`));
      row.append(t, el('span', { class: 'sw-m' }, `${where(lab)} · archived ${since(p.archived)}`.trim()));
      goes(row, lab, p);
      return row;
    };
    const archived = [...all].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    shelved.sort((a, b) => String(b.p.archived).localeCompare(String(a.p.archived)));
    const count = archived.length + shelved.length;
    if (count) {
      const open = showArchived || Boolean(q);
      const g = el('button', { type: 'button', class: 'sw-group sw-fold', 'aria-expanded': String(open) }, `${open ? '▾' : '▸'} archived · ${count}`);
      g.addEventListener('click', () => {
        showArchived = !showArchived;
        // Opening it chooses its first row, so the list scrolls down to what opened, not back to the top (Leo 18 Nov).
        if (showArchived) active = list.querySelectorAll('.sw-row').length;
        draw();
        keepKeys();
      });
      out.push(g);
      if (open) out.push(...shelved.map(shelvedRow), ...archived.map(archivedRow));
    }
  }
  // Says so when a search finds no page, even under the phone's note (it used to leave an empty sheet).
  if (!out.length || (q && !out.some((e) => e.classList.contains('sw-row')))) out.push(el('div', { class: 'sw-none' }, 'nothing matches'));
  const kept = list.scrollTop; // a redraw (the fold, a reload of the list) keeps where you were
  list.replaceChildren(...out);
  list.scrollTop = kept;
  const rows = [...list.querySelectorAll<HTMLElement>('.sw-row')];
  if (toCur && rows.length) {
    active = Math.max(0, rows.findIndex((r) => r.classList.contains('cur')));
    toCur = false;
  }
  mark(rows);
}

function mark(rows: HTMLElement[]) {
  if (active >= rows.length) active = Math.max(0, rows.length - 1);
  rows.forEach((r, i) => r.classList.toggle('on', i === active));
  rows[active]?.scrollIntoView({ block: 'nearest' });
}
