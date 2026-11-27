// The pictures of a comment, in their own file (public/_lab/attach.js, scripts/build-widget.mjs): the page script only
// listens for a paste or a drop on a comment box (composer.ts) and loads this when a picture comes, or a message with
// pictures is drawn. A picture is made ready and sent by the one shared part (pics.ts) as it is added; the comment then
// goes with the tokens the lab gave back (attachments), and the lab moves the files to the comment's own names.
import css from './attach.css';

type Pic = { file: Blob; url: string; token: Promise<string> };
type Image = { n: number; type: string };
const MAX = 4; // pictures to a message
// (list: the pictures of a box, which the page script keeps by the box's draft key (composer.ts) and reads the length of:
// the widget draws its boxes again and the new box takes them back (restore), until the comment goes.)
const styled = (from: Node) => {
  const root = from.getRootNode() as ShadowRoot;
  if (!root.querySelector?.('#lab-att-css')) root.append(Object.assign(document.createElement('style'), { id: 'lab-att-css', textContent: css }));
};
const upload = (p: Pic['file']) => (import(new URL('pics.js', import.meta.url).href) as Promise<typeof import('./pics.ts')>).then((m) => m.send<{ token: string }>('', p, 25 * 1024 * 1024, 2000)).then((r) => r.token);
const synced = (wrap: HTMLElement) => wrap.querySelector('textarea')?.dispatchEvent(new Event('input')); // the send arrow is ready with a picture alone
/** One picture in the strip above a box, with its ✕. */
const place = (wrap: HTMLElement, list: Pic[], p: Pic) => {
  let strip = wrap.querySelector('.atts');
  if (!strip) wrap.prepend((strip = Object.assign(document.createElement('div'), { className: 'atts' })));
  const el = Object.assign(document.createElement('span'), { className: 'p' });
  const x = Object.assign(document.createElement('button'), { className: 'x', type: 'button', textContent: '×', title: 'remove' });
  el.append(Object.assign(document.createElement('img'), { src: p.url, alt: 'picture to send' }), x);
  const error = wrap.querySelector('.error') as HTMLElement;
  p.token.catch((e) => {
    el.classList.add('bad');
    error.textContent = e.message;
  });
  x.addEventListener('click', () => {
    list.splice(list.indexOf(p), 1);
    URL.revokeObjectURL(p.url);
    el.remove();
    error.textContent = '';
    synced(wrap);
  });
  strip.append(el);
};

/** Pictures into a comment box (pasted, dropped or picked): shown at once with an ✕, uploaded straight away. `words` is what
 *  the clipboard held as text, put in at the cursor unless it is only a file name. */
export function add(wrap: HTMLElement, list: Pic[], files: File[], words = '') {
  styled(wrap);
  const field = wrap.querySelector('textarea')!;
  if (words && !/^[^\n]+\.(png|jpe?g|gif|webp|heic)$/i.test(words.trim())) field.setRangeText(words, field.selectionStart, field.selectionEnd, 'end');
  if (files.length > MAX - list.length) (wrap.querySelector('.error') as HTMLElement).textContent = `A comment holds ${MAX} pictures at most.`;
  for (const file of files.slice(0, MAX - list.length)) {
    const p: Pic = { file, url: URL.createObjectURL(file), token: upload(file) };
    list.push(p);
    place(wrap, list, p);
  }
  synced(wrap);
}

/** A box drawn again: the pictures its draft kept are put back. */
export function restore(wrap: HTMLElement, list: Pic[]) {
  styled(wrap);
  for (const p of list) place(wrap, list, p);
  synced(wrap);
}

/** The send, with the pictures: waits for their uploads, and if that or the send fails, uploads them again once and sends again. */
export async function send<T>(wrap: HTMLElement, list: Pic[], fn: (att: { attachments: string[] }) => Promise<T>): Promise<T> {
  const go = async () => fn({ attachments: await Promise.all(list.map((p) => p.token)) });
  const out = await go().catch(() => {
    for (const p of list) p.token = upload(p.file);
    return go();
  });
  for (const p of list) URL.revokeObjectURL(p.url);
  list.length = 0;
  wrap.querySelector('.atts')?.remove();
  synced(wrap);
  return out;
}

/** A message's pictures, as one quiet line ("2 images attached"), not thumbnails (Leo, 22 Nov, #424: they are there for
 *  the agent, and big thumbnails that opened in a new tab made short comments tall). A tap on the line opens them in
 *  the message, a second closes them (Leo, 23 Nov: "a way to look at image?"); nothing opens a tab. The name is built here
 *  from the comment's id, never read from the record (a record with another n or type, or an id that is not 12 hex
 *  digits, shows nothing). */
export function show(box: HTMLElement, item: { id: string; images?: (Image & { w?: number; h?: number })[] }) {
  if (!/^[a-f0-9]{12}$/.test(item.id)) return;
  const ok = (item.images || []).filter((i) => Number.isInteger(i.n) && i.n >= 1 && i.n <= MAX && /^(png|jpg|webp|gif)$/.test(i.type));
  if (!ok.length) return;
  styled(box);
  const said = `${ok.length} image${ok.length > 1 ? 's' : ''} attached`;
  const line = Object.assign(document.createElement('button'), { className: 'att', type: 'button', textContent: said, title: 'show' });
  line.setAttribute('aria-expanded', 'false');
  line.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="2" width="10" height="8" rx="1.5"/><path d="M1.5 9 4.5 6l2 2 1.5-1.5L10.5 9"/></svg>');
  let pics: HTMLElement | null = null;
  line.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = line.getAttribute('aria-expanded') !== 'true';
    line.setAttribute('aria-expanded', String(open));
    line.title = open ? 'hide' : 'show';
    if (!pics) {
      pics = Object.assign(document.createElement('div'), { className: 'att-pics' });
      for (const i of ok) {
        const src = new URL(`/_lab/attachments/${item.id}-${i.n}.${i.type}`, import.meta.url).href;
        pics.append(Object.assign(document.createElement('img'), { src, decoding: 'async', alt: `picture ${i.w || ''}×${i.h || ''}`, width: i.w || undefined, height: i.h || undefined }));
      }
      line.after(pics);
    }
    pics.hidden = !open;
  });
  box.append(line);
}
