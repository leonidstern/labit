// Area 1, DEV SYNC: the paths that keep a lab and its folder in step. Comments live in the lab's memory, are written to
// .lab/comments/<page>.json and .lab/comments.md, are sent to pages as lists and as deltas (/_lab/api/changes), follow a
// page's file when it is renamed, and must survive the lab being stopped, killed, started twice or started on a damaged
// store. In front of a dev server (--proxy) the lab must pass the dev server's pages and bytes on as they are.
//
// Kinds of case: writers (several clients write at the same moment), crash (the lab is killed in the middle of a burst
// of writes), damaged (files in .lab are cut, garbled or stale before a start), two-labs (a second lab on the same
// folder), rename (pages moved under their comments), proxy (a dev server behind the lab).
// The oracle is the model each case keeps of what was said yes to (ids from 2xx answers), compared with the lab's
// lists, its deltas, its files and its agent text.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { Lab, LAB, rq, agentRq, sleep, until, oddText, storeName, diffComments } from './lib.mjs';

export const name = 'dev-sync';
const PAGES = ['/index', '/sub/deep/page', '/a_b-c'];
const SESSION = { id: 'sess-dev', name: 'dev', agent: 'Claude', kind: 'claude' };
// What the API keeps of a text: trimmed, at most 2000 characters, never half an emoji at the cut.
const kept = (t) => t.trim().slice(0, 2000).replace(/[\uD800-\uDBFF]$/, '');
const TEXTS = {
  odd: (rng, tag) => oddText(rng, tag),
  long: (rng, tag) => `${tag} ${'long '.repeat(520)}`,
  cut: (rng, tag) => `${tag} ${'c'.repeat(1998 - tag.length)}👍 tail`,
  lines: (rng, tag) => `${tag}\n\n  indented\n\ttabbed\r\nwindows separator`,
};
const DAMAGE = ['cut-short', 'garbage-added', 'empty-file', 'not-comments', 'null-entry', 'entry-without-date', 'future-date', 'date-not-a-date', 'same-id-on-two-pages', 'old-shape', 'stray-tmp', 'state-garbled', 'state-cut', 'key-garbled', 'server-json-stale', 'lock-stale', 'page-not-a-path'];

// ---------- the plan ----------
export function plan(rng) {
  const kind = rng.weighted([[42, 'writers'], [22, 'crash'], [16, 'damaged'], [7, 'two-labs'], [7, 'rename'], [6, 'proxy']]);
  const ops = [];
  let r = 0;
  let solo = false;
  const push = (op, same) => {
    const joins = Boolean(same && r && !solo);
    ops.push({ ...op, r: joins ? r : ++r });
    solo = op.t === 'restart' || op.t === 'wait';
  };
  const text = () => ({ as: rng.weighted([[8, 'odd'], [1, 'long'], [1, 'cut'], [1, 'lines']]) });
  if (kind === 'writers') {
    const threads = [];
    for (let k = rng.between(6, 22); k--; ) {
      const live = threads.filter((t) => !t.gone);
      const what = rng.weighted([[24, 'new'], [22, 'reply'], [5, 'replyreply'], [8, 'toggle'], [5, 'move'], [7, 'del'], [5, 'progress'], [4, 'twice'], [6, 'bad'], [4, 'restart'], [4, 'wait'], [4, 'done']]);
      if (what === 'new' || !live.length) {
        push({ t: 'new', page: rng.pick(PAGES), ...text() }, rng.bool(0.6));
        threads.push({ op: ops.length - 1, round: r, plain: false, replies: [] });
      } else if (what === 'restart') push({ t: 'restart' });
      else if (what === 'wait') push({ t: 'wait', ms: rng.pick([5, 40, 200]) });
      else if (what === 'bad') push({ t: 'bad', what: rng.pick(['empty', 'spaces', 'too-big', 'not-json', 'bad-page', 'no-thread', 'no-name']) }, rng.bool(0.6));
      else if (what === 'twice') push({ t: 'twice', page: rng.pick(PAGES), n: rng.between(2, 6), ...text() }, rng.bool(0.5));
      else {
        const t = rng.pick(live);
        const plain = what === 'reply' || what === 'replyreply';
        if (what === 'replyreply' && !t.replies.length) continue;
        const same = t.round === r ? plain && t.plain && rng.bool(0.8) : rng.bool(0.5);
        push({ t: what, to: what === 'replyreply' ? rng.pick(t.replies) : t.op, ...(plain || what === 'done' ? text() : {}) }, same);
        if (plain) t.replies.push(ops.length - 1);
        Object.assign(t, { round: r, plain });
        if (what === 'del') t.gone = true;
      }
    }
  } else if (kind === 'crash') {
    for (let k = rng.between(2, 5); k--; ) push({ t: 'seed', page: rng.pick(PAGES) });
    const seeds = ops.length;
    const used = new Set();
    for (let k = rng.between(15, 60); k--; ) {
      const what = rng.weighted([[10, 'new'], [8, 'reply'], [2, 'del'], [2, 'resolve']]);
      const to = rng.int(seeds);
      if ((what === 'del' || what === 'resolve') && used.has(to)) continue;
      if (what === 'del' || what === 'resolve') used.add(to);
      ops.push({ t: `burst-${what}`, r: 99, page: rng.pick(PAGES), to: what === 'new' ? undefined : to, at: rng.int(30), noReplyTo: null });
    }
    // Replies only go to seeds nobody deletes in the same burst.
    for (const op of ops) if (op.t === 'burst-reply') op.to = [...Array(seeds).keys()].find((i) => !ops.some((o) => (o.t === 'burst-del' || o.t === 'burst-resolve') && o.to === i)) ?? -1; // a person's reply would reopen a thread resolved in the same burst
    ops.push({ t: 'kill', r: 99, sig: rng.weighted([[6, 'SIGKILL'], [4, 'SIGTERM']]), at: rng.pick([0, 2, 5, 10, 15, 25, 40]) });
  } else if (kind === 'damaged') {
    for (let k = rng.between(2, 5); k--; ) push({ t: 'seed', page: rng.pick(PAGES.slice(0, 2)), reply: rng.bool(0.5) });
    for (const what of rng.shuffle(DAMAGE).slice(0, rng.between(1, 2))) push({ t: 'damage', what, cut: rng.float() });
  } else if (kind === 'two-labs') {
    for (let k = rng.between(1, 3); k--; ) push({ t: 'seed', page: rng.pick(PAGES) });
    push({ t: 'second', how: rng.pick(['while-running', 'both-at-once', 'after-a-crash', 'three-at-once']) });
  } else if (kind === 'rename') {
    for (let k = rng.between(2, 4); k--; ) push({ t: 'seed', page: rng.pick(['/one', '/two']), reply: rng.bool(0.4) });
    for (let k = rng.between(1, 3); k--; ) push({ t: 'mv', how: rng.pick(['rename', 'into-folder', 'swap', 'chain']), running: rng.bool(0.6) });
  } else {
    for (let k = rng.between(3, 8); k--; ) push({ t: 'fetch', what: rng.weighted([[6, 'page'], [2, 'bytes'], [1, 'packed'], [1, 'own-widget'], [1, 'socket'], [1, 'comment']]), cuts: rng.between(0, 12), seed: rng.int(1e9) });
  }
  return { kind, ops };
}
export const describe = (op) =>
  !op ? '(left out)'
  : op.t === 'new' ? `a pin on ${op.page} (${op.as} text)`
  : op.t === 'reply' || op.t === 'replyreply' ? `a reply ${op.t === 'replyreply' ? 'to the reply' : 'in the thread'} of step ${op.to} (${op.as} text)`
  : op.t === 'done' ? `the agent answers step ${op.to} --done`
  : op.t === 'toggle' ? `the thread of step ${op.to} is resolved or reopened`
  : op.t === 'move' ? `the pin of step ${op.to} is moved`
  : op.t === 'del' ? `the thread of step ${op.to} is deleted`
  : op.t === 'progress' ? `the agent notes progress on step ${op.to}`
  : op.t === 'twice' ? `one pin sent ${op.n} times at once with one nonce on ${op.page}`
  : op.t === 'bad' ? `a request the lab must refuse (${op.what})`
  : op.t === 'restart' ? 'the lab is stopped and started'
  : op.t === 'wait' ? `wait ${op.ms} ms`
  : op.t === 'seed' ? `a pin on ${op.page}${op.reply ? ' with a reply' : ''}, before`
  : op.t.startsWith('burst-') ? `in the burst at ${op.at} ms: ${op.t.slice(6)}${op.to === undefined ? ` on ${op.page}` : ` of seed ${op.to}`}`
  : op.t === 'kill' ? `the lab is killed (${op.sig}) ${op.at} ms into the burst, then started`
  : op.t === 'damage' ? `while the lab is stopped: ${op.what}`
  : op.t === 'second' ? `a second lab on the same folder: ${op.how}`
  : op.t === 'mv' ? `a page with comments is moved (${op.how}) while the lab ${op.running ? 'runs' : 'is stopped'}`
  : `through the lab in front of a dev server: ${op.what}${op.cuts ? ` in ${op.cuts + 1} pieces` : ''}`;

// ---------- one case ----------
const H1 = { selector: 'h1', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1>' };
export async function run(plan, ctx, opts) {
  const pageFile = (p) => path.join(ctx.dir, `${p.slice(1)}.html`);
  for (const p of [...PAGES, '/one', '/two']) {
    fs.mkdirSync(path.dirname(pageFile(p)), { recursive: true });
    fs.writeFileSync(pageFile(p), `<!doctype html><title>${p}</title><h1>${p}</h1>`);
  }
  if (plan.kind === 'proxy') return proxyCase(plan, ctx, opts);
  const lab = new Lab(ctx);
  if (!(await lab.start()).ok) return ctx.add('harness', 'lab-did-not-start', lab.log.slice(-400));
  // The browser's key on this computer (kept in .lab/key across starts; read while the lab is up).
  let token = lab.serverJson().token;
  const admin = () => {
    try {
      token = lab.serverJson().token;
    } catch {}
    return { 'x-lab-admin': token };
  };
  const post = (body, headers = {}, more = {}) => rq(lab, { method: 'POST', path: '/_lab/api/comments', body, headers, ...more });
  const list = async (page) => (await rq(lab, { path: `/_lab/api/comments?page=${encodeURIComponent(page)}` })).json().comments;
  const everything = async (pages = PAGES) => (await Promise.all(pages.map(async (p) => (await list(p)).map((c) => ({ ...c, page: p }))))).flat();
  const M = new Map(); // id -> { op, page, parent, text, gone }
  const T = new Map(); // thread id -> resolved
  const made = new Map(); // step -> id
  const texts = new Map(); // step -> the words it sent
  const words = (op, i) => texts.get(i) ?? texts.set(i, TEXTS[op.as || 'odd'](mulberry(ctx.seed, i), `w${i}`)).get(i);
  const note = (c, i, page) => {
    M.set(c.id, { op: i, page, parent: c.parent || null, text: c.text, gone: false });
    made.set(i, c.id);
    if (!c.parent) T.set(c.id, false);
  };
  const seed = async (op, i) => {
    const r = await post({ page: op.page, name: 'Leo', text: `seed ${i}`, anchor: H1 });
    if (r.status !== 201) return ctx.add('loud', 'write-refused', `a pin on ${op.page}: ${r.status} ${r.text.slice(0, 200)}`, { step: 'seed' });
    note(r.json().comment, i, op.page);
    if (op.reply) {
      const a = await post({ page: op.page, parent: r.json().comment.id, name: 'Mira', text: `seed reply ${i}` });
      if (a.status === 201) note(a.json().comment, -i - 1, op.page);
    }
  };
  // What must hold whenever the lab is up and quiet: its lists, its files, its deltas and its agent text say the model.
  const check = async (when, pages = PAGES, tags = {}) => {
    const all = await everything(pages);
    for (const [id, m] of M) {
      if (!pages.includes(m.page)) continue;
      const c = all.find((x) => x.id === id);
      if (!m.gone && !c) ctx.add('silent', 'acknowledged-comment-missing', `${when}: ${m.parent ? 'the reply' : 'the pin'} ${id} (step ${m.op}, ${m.page}) was answered 2xx and the lab does not list it`, { when, ...tags });
      else if (m.gone && c) ctx.add('silent', 'deleted-comment-is-back', `${when}: ${id} (step ${m.op}) was deleted (2xx) and the lab lists it`, { when, ...tags });
      else if (c && c.text !== m.text) ctx.add('silent', 'comment-text-changed', `${when}: ${id} was saved as ${JSON.stringify(m.text.slice(0, 60))} and reads ${JSON.stringify(c.text.slice(0, 60))}`, { when, ...tags });
      else if (c && ((c.parent || null) !== m.parent || c.page !== m.page)) ctx.add('silent', 'comment-in-wrong-thread', `${when}: ${id} belongs to ${m.parent || 'no thread'} on ${m.page}, the lab has it in ${c.parent || 'no thread'} on ${c.page}`, { when, ...tags });
    }
    for (const c of all) if (!M.has(c.id)) ctx.add('silent', 'comment-nobody-made', `${when}: the lab lists ${c.id} "${c.text.slice(0, 50)}" on ${c.page}, which no step made`, { when, ...tags });
    for (const [id, resolved] of T) {
      const c = all.find((x) => x.id === id);
      if (c && resolved !== null && Boolean(c.resolved) !== resolved) ctx.add('silent', 'thread-state-wrong', `${when}: thread ${id} should be ${resolved ? 'resolved' : 'open'}, the lab says ${c.resolved ? 'resolved' : 'open'}`, { when, want: resolved ? 'resolved' : 'open', ...tags });
    }
    // Pins never share a number on a page.
    for (const p of pages) {
      const nums = all.filter((c) => c.page === p && !c.parent).map((c) => c.num);
      if (new Set(nums).size !== nums.length) ctx.add('silent', 'two-pins-share-a-number', `${when}: on ${p} the pins are numbered ${nums.join(', ')}`, { when });
    }
    // The files: one per page, holding what the lab lists (they are written a moment after the answer).
    let disk = {};
    const same = () => {
      disk = lab.store();
      return pages.every((p) => JSON.stringify(Object.values(disk[p] || {}).sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify(all.filter((c) => c.page === p).map(({ page, ...c }) => c).sort((a, b) => a.id.localeCompare(b.id))));
    };
    if (!(await until(same, 2500 * opts.slow, 40))) {
      for (const p of pages) {
        const d = diffComments(all.filter((c) => c.page === p).map(({ page, ...c }) => c), Object.values(disk[p] || {}));
        if (d.missing.length || d.extra.length || d.changed.length) ctx.add('silent', 'files-differ-from-the-lab', `${when}: .lab/comments/${storeName(p)}: missing ${d.missing.join(' ') || '-'}, extra ${d.extra.join(' ') || '-'}, changed ${d.changed.map((x) => x.join('.')).join(' ') || '-'}`, { when, what: d.missing.length ? 'missing' : d.extra.length ? 'extra' : 'field', ...tags });
      }
    }
    const left = fs.existsSync(path.join(lab.dir, '.lab/comments')) ? fs.readdirSync(path.join(lab.dir, '.lab/comments')).filter((n) => !n.endsWith('.json')) : [];
    if (left.length && !/was damaged|no comments; left out/.test(lab.log)) ctx.add('silent', 'stray-files-in-the-store', `${when}: .lab/comments holds ${left.join(', ')} and the lab said nothing`, { when });
    // The agent's text and comments.md name every open thread and every message in it.
    const md = await until(() => {
      const t = fs.existsSync(path.join(lab.dir, '.lab/comments.md')) ? fs.readFileSync(path.join(lab.dir, '.lab/comments.md'), 'utf8') : '';
      return all.every((c) => all.find((x) => x.id === (c.parent || c.id))?.resolved !== false || t.includes(`id ${c.id}`)) && t;
    }, 2000 * opts.slow, 40);
    for (const p of pages) {
      const text = (await rq(lab, { path: `/_lab/agent${p}` })).text;
      for (const c of all.filter((x) => x.page === p)) {
        const root = all.find((x) => x.id === (c.parent || c.id));
        if (!root || root.resolved) continue;
        if (!text.includes(`id ${c.id}`)) ctx.add('silent', 'agent-text-misses-a-comment', `${when}: the agent text of ${p} lacks ${c.id}`, { when, where: 'agent-text' });
        else if (!md) ctx.add('silent', 'agent-text-misses-a-comment', `${when}: .lab/comments.md lacks a comment of ${p} (e.g. ${c.id})`, { when, where: 'comments.md' });
      }
    }
    return all;
  };

  // ----- writers -----
  if (plan.kind === 'writers') {
    let rev0 = (await rq(lab, { path: '/_lab/state' })).json().comments;
    let base = []; // what the lab listed at rev0
    let restarted = false;
    const step = async ([op, i]) => {
      ctx.note(`${i}: ${describe(op)}`);
      const root = op.to === undefined ? null : made.get(op.to);
      if (op.to !== undefined && !root) return;
      const m = root && M.get(root);
      const thread = m ? m.parent || root : null;
      const refuse = (r, what, tags) => ctx.add(r.status >= 500 || r.status === 0 ? 'loud' : 'loud', 'write-refused', `step ${i} (${what}): ${r.status} ${r.text.slice(0, 200)}`, { step: op.t, status: r.status, ...tags });
      if (op.t === 'new') {
        const text = words(op, i);
        const r = await post({ page: op.page, name: 'Leo', text, anchor: H1 });
        if (r.status !== 201) return refuse(r, describe(op));
        const c = r.json().comment;
        if (c.text !== kept(text)) ctx.add('silent', 'comment-text-changed', `sent ${JSON.stringify(text.slice(-30))} (${text.length} long), the lab answered ${JSON.stringify(c.text.slice(-30))} (${c.text.length}); the rule keeps ${kept(text).length}`, { when: 'on-save', as: op.as });
        note(c, i, op.page);
      } else if (op.t === 'reply' || op.t === 'replyreply' || op.t === 'done') {
        const text = words(op, i);
        const r = op.t === 'done' ? await agentRq(lab, SESSION, '/_lab/api/comments', { page: m.page, parent: root, name: 'Claude · dev', text, intent: 'done' }) : await post({ page: m.page, parent: root, name: 'Mira', text });
        if (M.get(thread).gone) return r.status === 404 ? null : ctx.add('silent', 'accepted-what-should-be-refused', `a reply in the deleted thread ${thread} was answered ${r.status}`, { step: op.t });
        if (r.status !== 201) return refuse(r, describe(op));
        const c = r.json().comment;
        // A reply to a reply goes in its thread.
        if (c.parent !== thread) ctx.add('silent', 'comment-in-wrong-thread', `a reply to ${root} was put in ${c.parent}, its thread is ${thread}`, { when: 'on-save' });
        note({ ...c, parent: thread }, i, m.page);
        T.set(thread, op.t === 'done'); // a person writing reopens; the agent's --done closes
      } else if (op.t === 'toggle') {
        const now = T.get(root);
        const r = await post({ page: m.page, action: now ? 'reopen' : 'resolve', id: root }, admin());
        if (m.gone) return r.status === 404 ? null : ctx.add('silent', 'accepted-what-should-be-refused', `resolving the deleted thread ${root} was answered ${r.status}`, { step: op.t });
        if (r.status !== 200) return refuse(r, describe(op));
        T.set(root, !now);
      } else if (op.t === 'move') {
        const r = await post({ page: m.page, action: 'move', id: root, anchor: { ...H1, selector: 'h1.moved', x: 0.9 } }, admin());
        if (m.gone) return r.status === 404 ? null : ctx.add('silent', 'accepted-what-should-be-refused', `moving the deleted pin ${root} was answered ${r.status}`, { step: op.t });
        if (r.status !== 200) return refuse(r, describe(op));
        if (r.json().comment.anchor.selector !== 'h1.moved') ctx.add('silent', 'move-not-kept', `the pin ${root} was moved (200) and its spot is ${r.json().comment.anchor.selector}`, {});
      } else if (op.t === 'del') {
        const r = await post({ page: m.page, action: 'delete', id: root }, admin());
        if (m.gone) return r.status === 404 ? null : ctx.add('silent', 'accepted-what-should-be-refused', `deleting ${root} a second time was answered ${r.status}`, { step: op.t });
        if (r.status !== 200) return refuse(r, describe(op));
        for (const x of M.values()) if (x === m || x.parent === root) x.gone = true;
      } else if (op.t === 'progress') {
        const r = await agentRq(lab, SESSION, '/_lab/api/comments', { page: m.page, action: 'progress', id: root, text: `working ${i}` });
        if (m.gone) return r.status === 404 ? null : ctx.add('silent', 'accepted-what-should-be-refused', `progress on the deleted thread ${root} was answered ${r.status}`, { step: op.t });
        if (r.status !== 200) return refuse(r, describe(op));
      } else if (op.t === 'twice') {
        // The same pin sent several times at one moment with one nonce (a page that retries): one comment, the same id to all.
        const text = words(op, i);
        const nonce = `tw${ctx.seed}n${i}`.padEnd(12, '0');
        const rs = await Promise.all(Array.from({ length: op.n }, () => post({ page: op.page, name: 'Leo', text, anchor: H1, nonce })));
        const ok = rs.filter((r) => r.status < 300);
        const ids = new Set(ok.map((r) => r.json().comment.id));
        // What was said yes to is recorded first, also when another copy was refused (else the audit finds a pin nobody made).
        for (const r of ok) note(r.json().comment, i, op.page);
        if (ids.size > 1) ctx.add('silent', 'retry-made-a-second-comment', `${op.n} copies of one pin with one nonce came back as ${ids.size} comments: ${[...ids].join(' ')}`, {});
        if (ok.length < rs.length) return refuse(rs.find((r) => r.status >= 300), describe(op));
      } else if (op.t === 'bad') {
        const want = { empty: 400, spaces: 400, 'too-big': 413, 'not-json': 400, 'bad-page': 400, 'no-thread': 404, 'no-name': 400 }[op.what];
        const body = { empty: { page: '/index', name: 'Leo', text: '', anchor: H1 }, spaces: { page: '/index', name: 'Leo', text: ' \n\t ', anchor: H1 }, 'bad-page': { page: '/../etc', name: 'Leo', text: 'x', anchor: H1 }, 'no-thread': { page: '/index', parent: '000000000000', name: 'Leo', text: 'x' }, 'no-name': { page: '/index', text: 'x', anchor: H1 } }[op.what];
        const r = op.what === 'too-big' ? await rq(lab, { method: 'POST', path: '/_lab/api/comments', raw: Buffer.from(JSON.stringify({ page: '/index', name: 'Leo', text: 'x'.repeat(300000), anchor: H1 })), headers: { 'content-type': 'application/json', origin: lab.base } }).catch((e) => ({ status: 0, text: String(e) }))
          : op.what === 'not-json' ? await rq(lab, { method: 'POST', path: '/_lab/api/comments', raw: Buffer.from('{"page":"/index","name":"Leo","text":'), headers: { 'content-type': 'application/json', origin: lab.base } })
          : await post(body);
        if (r.status < 300) ctx.add('silent', 'accepted-what-should-be-refused', `${op.what}: answered ${r.status} ${r.text.slice(0, 120)}`, { step: op.what });
        else if (r.status !== want && r.status !== 0) ctx.add('unclear', 'refused-with-another-status', `${op.what}: answered ${r.status}, ${want} expected`, { step: op.what });
      } else if (op.t === 'wait') await sleep(op.ms);
      else if (op.t === 'restart') {
        // Stopped the lab's own way (SIGTERM), a moment after its last answer, and started again: nothing said yes to is lost.
        await lab.stop('SIGTERM');
        if (!(await lab.start()).ok) throw new Error(`the lab did not start again: ${lab.log.slice(-300)}`);
        restarted = true;
        await check('after-a-restart');
        rev0 = (await rq(lab, { path: '/_lab/state' })).json().comments;
        base = await everything();
      }
    };
    const rounds = new Map();
    plan.ops.forEach((op, i) => op && rounds.set(op.r, [...(rounds.get(op.r) || []), [op, i]]));
    for (const [, ops] of [...rounds].sort((a, b) => a[0] - b[0])) await Promise.all(ops.map(step));
    const all = await check('at-the-end', PAGES, restarted ? { restart: 1 } : {});
    // A page that was open since rev0 and asks for what changed gets exactly the way from then to now.
    for (const p of PAGES) {
      const d = (await rq(lab, { path: `/_lab/api/changes?page=${encodeURIComponent(p)}&since=${rev0}` })).json();
      if (d.full) continue; // told to load the whole list: fine
      const now = new Map(base.filter((c) => c.page === p).map(({ page, ...c }) => [c.id, c]));
      for (const id of d.del) now.delete(id);
      for (const c of d.set) now.set(c.id, c);
      const diff = diffComments(all.filter((c) => c.page === p).map(({ page, ...c }) => c), [...now.values()]);
      if (diff.missing.length || diff.extra.length || diff.changed.length) ctx.add('silent', 'delta-differs-from-the-list', `${p}: a page that applies the changes since ${rev0} ends up missing ${diff.missing.join(' ') || '-'}, with extra ${diff.extra.join(' ') || '-'}, with old ${diff.changed.map((x) => x.join('.')).join(' ') || '-'}`, { what: diff.missing.length ? 'missing' : diff.extra.length ? 'extra' : 'old-field' });
    }
    return;
  }

  // ----- crash: killed in the middle of a burst -----
  if (plan.kind === 'crash') {
    const seeds = plan.ops.map((op, i) => [op, i]).filter(([op]) => op?.t === 'seed');
    for (const [op, i] of seeds) await seed(op, i);
    const kill = plan.ops.find((op) => op?.t === 'kill') || { sig: 'SIGTERM', at: 0 };
    const burst = plan.ops.map((op, i) => [op, i]).filter(([op]) => op?.t.startsWith('burst-'));
    const sent = []; // { what, text, id, acked }
    const dead = (async () => {
      await sleep(kill.at);
      await lab.stop(kill.sig);
    })();
    await Promise.all(burst.map(async ([op, i]) => {
      await sleep(op.at);
      // op.to is the seed's own step number (seeds are the plan's first steps): a replay that leaves a seed out has none.
      const target = op.to === undefined ? null : made.get(op.to);
      if (op.to !== undefined && !target) return;
      const what = op.t.slice(6);
      const text = `burst ${i}`;
      const one = { what, text, id: target, acked: false, page: what === 'new' ? op.page : M.get(target).page };
      sent.push(one);
      const r = await (what === 'new' ? post({ page: op.page, name: 'Leo', text, anchor: H1 }, {}, { timeout: 4000 })
        : what === 'reply' ? post({ page: one.page, parent: target, name: 'Mira', text }, {}, { timeout: 4000 })
        : post({ page: one.page, action: what === 'del' ? 'delete' : 'resolve', id: target }, admin(), { timeout: 4000 })).catch(() => null);
      if (r && r.status < 300) Object.assign(one, { acked: true, made: what === 'new' || what === 'reply' ? r.json().comment : null });
    }));
    await dead;
    ctx.note(`killed with ${kill.sig}: ${sent.filter((s) => s.acked).length} of ${sent.length} writes had their answer`);
    const again = await lab.start();
    if (!again.ok) return ctx.add('loud', 'lab-did-not-start-after-a-kill', lab.log.slice(-400), { sig: kill.sig });
    const tags = { sig: kill.sig };
    const all = await everything();
    for (const s of sent) {
      if (!s.acked) continue; // no answer came: it may be there or not
      if (s.made && !all.some((c) => c.id === s.made.id)) ctx.add('silent', 'acknowledged-write-lost', `the ${s.what === 'new' ? 'pin' : 'reply'} ${s.made.id} "${s.text}" was answered 201 before the lab was killed (${kill.sig}) and is gone after the start`, { what: s.what === 'new' ? 'pin' : 'reply', ...tags });
      if (s.what === 'del' && all.some((c) => c.id === s.id)) ctx.add('silent', 'acknowledged-write-lost', `the delete of ${s.id} was answered 200 before the kill and the pin is back after the start`, { what: 'delete', ...tags });
      if (s.what === 'resolve' && all.find((c) => c.id === s.id)?.resolved === false) ctx.add('silent', 'acknowledged-write-lost', `the resolve of ${s.id} was answered 200 before the kill and the thread is open after the start`, { what: 'resolve', ...tags });
    }
    for (const c of all) if (!M.has(c.id) && !sent.some((s) => s.text === c.text)) ctx.add('silent', 'comment-nobody-made', `after the kill the lab lists ${c.id} "${c.text.slice(0, 40)}"`, tags);
    for (const [id, m] of M) if (!all.some((c) => c.id === id) && !sent.some((s) => s.what === 'del' && s.id === (m.parent || id))) ctx.add('silent', 'acknowledged-comment-missing', `the pin ${id} from before the burst is gone after the kill`, { when: 'after-a-kill', ...tags });
    if (/was damaged|no comments; left out/.test(lab.log.split('\n').slice(-12).join('\n'))) ctx.add('loud', 'store-damaged-by-a-kill', lab.log.split('\n').filter((l) => /damaged|left out/.test(l)).join(' / '), tags);
    // And the store still takes a write and keeps it over a normal stop.
    const r = await post({ page: '/index', name: 'Leo', text: 'after the kill', anchor: H1 });
    // Refused is said as refused; only a pin the lab said yes to has to be there after the next start.
    if (r.status !== 201) return ctx.add('loud', 'write-refused', `a pin made after the restart: ${r.status} ${r.text.slice(0, 200)}`, { step: 'after-recovery', status: r.status, ...tags });
    await lab.stop('SIGTERM');
    if (!(await lab.start()).ok) return ctx.add('loud', 'lab-did-not-start-after-a-kill', lab.log.slice(-400), tags);
    if (!(await list('/index')).some((c) => c.text === 'after the kill')) ctx.add('silent', 'acknowledged-write-lost', `a pin made after the restart (${r.status}) is gone after a normal stop and start`, { what: 'pin', when: 'after-recovery', ...tags });
    return;
  }

  // ----- damaged: files in .lab cut, garbled or stale before a start -----
  if (plan.kind === 'damaged') {
    for (const [op, i] of plan.ops.map((op, i) => [op, i]).filter(([op]) => op?.t === 'seed')) await seed(op, i);
    await check('before');
    await lab.stop('SIGTERM');
    const dir = path.join(lab.dir, '.lab');
    const fileOf = (p) => path.join(dir, 'comments', storeName(p));
    const hit = new Set(); // pages whose own file was damaged
    const lost = new Set(); // pages whose comments may rightly be gone (the file can't be read: put aside)
    const must = []; // what the lab has to say or leave behind
    const applied = [];
    for (const op of plan.ops.filter((o) => o?.t === 'damage')) {
      const page = PAGES.slice(0, 2).find((p) => fs.existsSync(fileOf(p)));
      const f = page && fileOf(page);
      // (A file an earlier step of this case already damaged is left as it is.)
      let data = null;
      try {
        data = f && JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {}
      const ids = data?.comments ? Object.keys(data.comments).filter((id) => data.comments[id]?.createdAt) : [];
      const onFile = !['stray-tmp', 'state-garbled', 'state-cut', 'key-garbled', 'server-json-stale', 'lock-stale'].includes(op.what);
      if (onFile && (!f || !ids.length || hit.has(page))) continue;
      applied.push(op.what);
      if (['cut-short', 'garbage-added', 'empty-file', 'not-comments', 'page-not-a-path'].includes(op.what)) {
        if (!f) continue;
        const raw = fs.readFileSync(f);
        const bytes = op.what === 'cut-short' ? raw.subarray(0, Math.max(1, Math.floor(raw.length * op.cut * 0.98))) : op.what === 'garbage-added' ? Buffer.concat([raw, Buffer.from('}{"oops')]) : op.what === 'empty-file' ? Buffer.alloc(0) : op.what === 'not-comments' ? Buffer.from('["a list, not a page of comments"]') : Buffer.from(JSON.stringify({ ...data, page: 42 }));
        fs.writeFileSync(f, bytes);
        hit.add(page);
        lost.add(page);
        must.push({ what: op.what, aside: path.basename(f), bytes });
      } else if (op.what === 'null-entry' || op.what === 'entry-without-date') {
        if (!f) continue;
        data.comments.bogus0000001 = op.what === 'null-entry' ? null : { id: 'bogus0000001', name: 'x', text: 'no date' };
        fs.writeFileSync(f, JSON.stringify(data));
        hit.add(page);
        must.push({ what: op.what, aside: path.basename(f) });
      } else if (op.what === 'future-date' || op.what === 'date-not-a-date') {
        if (!f) continue;
        data.comments[ids[0]].createdAt = op.what === 'future-date' ? '2099-01-01T00:00:00.000Z' : 'yesterday afternoon';
        fs.writeFileSync(f, JSON.stringify(data));
        hit.add(page);
      } else if (op.what === 'same-id-on-two-pages') {
        if (!f) continue;
        fs.writeFileSync(fileOf('/copy'), JSON.stringify({ v: 2, page: '/copy', comments: { [ids[0]]: data.comments[ids[0]] } }));
      } else if (op.what === 'old-shape') {
        if (!f) continue;
        const c = data.comments[ids[0]];
        data.comments[ids[0]] = { ...c, v: undefined, deliveredAt: '2026-01-01T00:00:00.000Z', deliveredTo: 'old', resolved: false };
        delete data.v;
        fs.writeFileSync(f, JSON.stringify(data));
      } else if (op.what === 'stray-tmp') fs.writeFileSync(path.join(dir, 'comments', 'index.json.tmp'), '{"v":2,"page":"/index","comments":{"half');
      else if (op.what === 'state-garbled') (fs.writeFileSync(path.join(dir, 'state.json'), '{"name": oops'), must.push({ what: op.what, aside: 'state.json' }));
      else if (op.what === 'state-cut') (fs.writeFileSync(path.join(dir, 'state.json'), '{"handed":{"abc":["2026-'), must.push({ what: op.what, aside: 'state.json' }));
      else if (op.what === 'key-garbled') fs.writeFileSync(path.join(dir, 'key'), 'not a key\n');
      else if (op.what === 'server-json-stale') fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ port: lab.port, pid: 2 ** 22 - 3, token: 'x', agent: 'y' }));
      else if (op.what === 'lock-stale') fs.writeFileSync(path.join(dir, 'lock'), JSON.stringify({ pid: 2 ** 22 - 5, at: Date.now() - 5000, port: lab.port }));
    }
    const tags = { damage: applied.sort().join('+') };
    const logAt = lab.log.length;
    const again = await lab.start();
    if (!again.ok) return ctx.add('loud', 'lab-did-not-start-on-a-damaged-store', `after ${applied.join(', ')}: ${lab.log.slice(logAt).trim().split('\n').slice(-3).join(' / ').slice(0, 400)}`, tags);
    const said = lab.log.slice(logAt);
    const all = await everything();
    for (const [id, m] of M) {
      const there = all.some((c) => c.id === id);
      if (there) continue;
      if (lost.has(m.page)) continue; // its file could not be read: put aside is the documented end (checked below)
      ctx.add('silent', 'comment-lost-on-start', `${id} on ${m.page} was in a file ${hit.has(m.page) ? 'that still reads (only one entry in it was damaged)' : 'nobody touched'} and is not listed after the start (${applied.join(', ')})`, { ...tags, page: hit.has(m.page) ? 'damaged-file' : 'other-file' });
    }
    // A file the lab can't read, or entries it leaves out: the file as it was is kept beside it, and the lab says so.
    for (const m of must) {
      const names = fs.readdirSync(m.aside === 'state.json' ? dir : path.join(dir, 'comments'));
      const aside = names.find((n) => n.startsWith(`${m.aside}.broken-`));
      const readable = m.bytes && (() => { try { const j = JSON.parse(m.bytes.toString('utf8')); return typeof j.page === 'string' && j.page.startsWith('/') && j.comments && typeof j.comments === 'object'; } catch { return false; } })();
      if (readable) continue; // the cut left a whole file by chance
      if (!aside) ctx.add('silent', 'damaged-file-not-kept', `${m.what}: no ${m.aside}.broken-… copy was left in .lab${m.aside === 'state.json' ? '' : '/comments'} (it holds: ${names.join(', ')})`, { damage: m.what });
      else if (!/damaged|left out/.test(said)) ctx.add('silent', 'damaged-file-not-said', `${m.what}: the file was put aside as ${aside} and the lab printed nothing about it`, { damage: m.what });
    }
    // And the store works on: a new pin on each page is kept over a stop and a start.
    const fresh = [];
    for (const p of PAGES.slice(0, 2)) {
      const r = await post({ page: p, name: 'Leo', text: `after the damage ${p}`, anchor: H1 });
      if (r.status !== 201) ctx.add('loud', 'write-refused', `a pin on ${p} after the damaged start: ${r.status} ${r.text.slice(0, 200)}`, { ...tags, step: 'after-damage' });
      else fresh.push([p, r.json().comment.id]);
    }
    await lab.stop('SIGTERM');
    if (!(await lab.start()).ok) return ctx.add('loud', 'lab-did-not-start-on-a-damaged-store', `the second start after ${applied.join(', ')}: ${lab.log.slice(-300)}`, { ...tags, start: 'second' });
    for (const [p, id] of fresh) if (!(await list(p)).some((c) => c.id === id)) ctx.add('silent', 'acknowledged-comment-missing', `a pin made on ${p} after the damaged start is gone after the next start`, { when: 'after-damage', ...tags });
    return;
  }

  // ----- two labs on one folder -----
  if (plan.kind === 'two-labs') {
    for (const [op, i] of plan.ops.map((op, i) => [op, i]).filter(([op]) => op?.t === 'seed')) await seed(op, i);
    const op = plan.ops.find((o) => o?.t === 'second');
    if (!op) return;
    const tags = { how: op.how };
    // A lab started where one runs says so and exits; it must not serve, and must not touch the comments.
    const start = (port) => {
      const p = ctx.track(spawn(process.execPath, [LAB, '.', '--no-open', '--port', String(port)], { cwd: lab.dir, env: ctx.env(), stdio: ['ignore', 'pipe', 'pipe'] }));
      const o = { p, port, out: '', code: null };
      p.stdout.on('data', (d) => (o.out += d));
      p.stderr.on('data', (d) => (o.out += d));
      p.once('exit', (c) => (o.code = c ?? -1));
      return o;
    };
    const answers = (port) => rq({ port }, { path: '/_lab/state', timeout: 800 }).then((r) => r.status === 200, () => false);
    if (op.how === 'while-running') {
      const b = start(ctx.port());
      await until(() => b.code !== null, 12000 * opts.slow, 50);
      if (b.code === null) ctx.add(await answers(b.port) ? 'silent' : 'loud', 'second-lab-kept-running', `a second lab on the folder did not exit in 12 s${(await answers(b.port)) ? ' and serves the folder too' : ''}: ${b.out.slice(-200)}`, tags);
      else if (b.code !== 0 || !/already running for this folder/.test(b.out)) ctx.add('loud', 'second-lab-ended-badly', `exit ${b.code}: ${b.out.trim().slice(-300)}`, tags);
      await check('with-a-second-lab', PAGES, tags);
      return;
    }
    await lab.stop(op.how === 'after-a-crash' ? 'SIGKILL' : 'SIGTERM');
    const n = op.how === 'three-at-once' ? 3 : op.how === 'both-at-once' ? 2 : 1;
    const labs = Array.from({ length: n }, () => start(ctx.port()));
    // In the end exactly one serves the folder, the others have said why and gone.
    const done = await until(async () => (await Promise.all(labs.map((l) => (l.code === null ? answers(l.port) : false)))).filter(Boolean).length === 1 && labs.filter((l) => l.code === null).length === 1, 15000 * opts.slow, 100);
    const up = [];
    for (const l of labs) if (l.code === null && (await answers(l.port))) up.push(l);
    if (!done || up.length !== 1) return ctx.add(up.length > 1 ? 'silent' : 'loud', up.length > 1 ? 'two-labs-serve-one-folder' : 'no-lab-came-up', `${up.length} of ${n} labs serve the folder after 15 s; exits: ${labs.map((l) => l.code).join(', ')}; ${labs.map((l) => l.out.trim().split('\n').pop()).join(' | ').slice(0, 300)}`, tags);
    for (const l of labs) if (l !== up[0] && (l.code !== 0 || !/already running for this folder/.test(l.out))) ctx.add('loud', 'second-lab-ended-badly', `exit ${l.code}: ${l.out.trim().slice(-300)}`, tags);
    lab.port = up[0].port;
    lab.proc = up[0].p;
    Object.defineProperty(lab, 'log', { get: () => up[0].out, set: () => {}, configurable: true });
    await check('with-the-lab-that-won', PAGES, tags);
    const r = await post({ page: '/index', name: 'Leo', text: 'to the lab that won', anchor: H1 });
    if (r.status === 201) note(r.json().comment, 999, '/index');
    else ctx.add('loud', 'write-refused', `a pin to the lab that won: ${r.status}`, { ...tags, step: 'new' });
    await check('after-a-write-to-it', PAGES, tags);
    return;
  }

  // ----- rename: pages moved under their comments -----
  if (plan.kind === 'rename') {
    const where = { '/one': '/one', '/two': '/two' }; // a page's first key -> its key now
    const origin = new Map(); // comment id -> the page it was made on
    for (const [op, i] of plan.ops.map((op, i) => [op, i]).filter(([op]) => op?.t === 'seed')) await seed(op, i);
    for (const [id, m] of M) origin.set(id, m.page);
    let n = 0;
    const mv = (from, to) => {
      fs.mkdirSync(path.dirname(pageFile(to)), { recursive: true });
      fs.renameSync(pageFile(from), pageFile(to));
    };
    for (const op of plan.ops.filter((o) => o?.t === 'mv')) {
      ctx.note(describe(op));
      if (!op.running) await lab.stop('SIGTERM');
      const a = where['/one'];
      const b = where['/two'];
      if (op.how === 'rename') (mv(a, `/renamed${++n}`), (where['/one'] = `/renamed${n}`));
      else if (op.how === 'into-folder') (mv(a, `/folder${++n}/inner`), (where['/one'] = `/folder${n}/inner`));
      else if (op.how === 'chain') (mv(a, `/step${++n}`), await sleep(op.running ? 250 : 0), mv(`/step${n}`, `/step${n}b`), (where['/one'] = `/step${n}b`));
      else if (op.how === 'swap') (mv(a, '/swap-tmp'), mv(b, a), mv('/swap-tmp', b), (where['/one'] = b), (where['/two'] = a));
      if (!op.running && !(await lab.start()).ok) throw new Error(`the lab did not start again: ${lab.log.slice(-300)}`);
      // Rename or move a page with mv: its comments follow the file (skills/labit/SKILL.md).
      const now = Object.values(where);
      const want = (id) => where[origin.get(id)];
      let all = [];
      const followed = await until(async () => {
        all = await everything([...new Set([...now, '/one', '/two'])]);
        return [...M.keys()].every((id) => all.find((c) => c.id === id)?.page === want(id));
      }, 4000 * opts.slow, 80);
      if (!followed) {
        for (const id of M.keys()) {
          const at = all.find((c) => c.id === id)?.page;
          if (at !== want(id)) ctx.add(op.how === 'swap' ? 'unclear' : 'silent', 'comments-did-not-follow-the-page', `${op.how}, lab ${op.running ? 'running' : 'stopped'}: ${id} was made on ${origin.get(id)}, whose file is now ${want(id)}; the lab has it on ${at || 'no page'}`, { how: op.how, lab: op.running ? 'running' : 'stopped' });
        }
        return;
      }
      for (const m of M.values()) m.page = where[m.page] ?? m.page;
      for (const k of Object.keys(where)) origin.forEach((p, id) => origin.set(id, p));
    }
    // After the moves the model's pages are the files' keys now.
    for (const [id, m] of M) m.page = where[origin.get(id)];
    await check('after-the-moves', [...new Set(Object.values(where))]);
    return;
  }
}

// A random source for one step of one case (lib's is per case; a step's words must not depend on the steps left out).
function mulberry(seed, i) {
  let a = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { float: next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
}

// ---------- the lab in front of a dev server ----------
const HOLD = /<script>\(\(\)=>\{const L=window\.__lab=\{writing[\s\S]*?<\/script>/;
const WIDGET = /<script src="\/_lab\/comments\.js"[^>]*><\/script>\n/;
async function proxyCase(plan, ctx, opts) {
  // The dev server: each address answers what the step asked for, the HTML in as many pieces as it says.
  const served = new Map(); // path -> { body: Buffer, type, cuts: [byte offsets], encoding }
  const dev = http.createServer(async (req, res) => {
    const s = served.get(req.url.split('?')[0]);
    if (!s) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('no such page');
    res.writeHead(200, { 'content-type': s.type, ...(s.encoding ? { 'content-encoding': s.encoding } : {}) });
    let at = 0;
    for (const cut of [...s.cuts, s.body.length]) {
      res.write(s.body.subarray(at, cut));
      at = cut;
      await sleep(2);
    }
    res.end();
  });
  dev.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(d)); // says back what it hears, byte for byte
    socket.on('error', () => {});
    socket.on('end', () => socket.destroy());
    sockets.add(socket);
  });
  const sockets = new Set();
  await new Promise((r) => dev.listen(0, '127.0.0.1', r));
  const devOff = () => {
    for (const x of sockets) x.destroy();
    dev.closeAllConnections();
    dev.close();
  };
  ctx.onEnd(devOff);
  const lab = new Lab(ctx, { args: ['--proxy', String(dev.address().port)] });
  if (!(await lab.start()).ok) return ctx.add('harness', 'lab-did-not-start', lab.log.slice(-400));
  for (const [i, op] of plan.ops.entries()) {
    if (!op) continue;
    ctx.note(`${i}: ${describe(op)}`);
    const rng = mulberry(op.seed, i);
    const p = `/p${i}`;
    const cuts = (len) => Array.from({ length: op.cuts }, () => rng.int(len)).sort((a, b) => a - b);
    if (op.what === 'page' || op.what === 'own-widget') {
      const own = op.what === 'own-widget' ? '<script src="/_lab/comments.js" data-x="1"></script>' : '';
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>dev ${i} — ünïcödé 👍</title><script>var s = "<b>not a tag</b> </bo" + "dy>";</script></head><body><h1>Dev page ${i}</h1><p>${'słowa и слова 言葉 '.repeat(rng.int(60))}</p>${own}<script type="module">console.log("</scr" + "ipt>")</script></body></html>`;
      const body = Buffer.from(html);
      served.set(p, { body, type: 'text/html; charset=utf-8', cuts: cuts(body.length) });
      const r = await rq(lab, { path: p, headers: { accept: 'text/html' } });
      const got = r.text.replace(HOLD, '').replace(WIDGET, '');
      const widgets = (r.text.match(/\/_lab\/comments\.js/g) || []).length;
      if (r.status !== 200 || got !== html.replace(own, '')) {
        const at = [...got].findIndex((ch, k) => ch !== [...html.replace(own, '')][k]);
        ctx.add('silent', 'page-through-the-lab-differs', `${p} in ${op.cuts + 1} pieces: status ${r.status}, ${got.length} characters for ${html.replace(own, '').length}; first difference at ${at}: got ${JSON.stringify(got.slice(Math.max(0, at - 20), at + 30))}, sent ${JSON.stringify(html.replace(own, '').slice(Math.max(0, at - 20), at + 30))}`, { what: op.what, pieces: op.cuts ? 'several' : 'one' });
      } else if (widgets !== 1) ctx.add('silent', 'page-has-not-one-widget', `${p}: the page through the lab loads the comment widget ${widgets} times`, { what: op.what });
    } else if (op.what === 'bytes' || op.what === 'packed') {
      const plainBody = Buffer.from(Array.from({ length: 2000 + rng.int(60000) }, () => rng.int(256)));
      const body = op.what === 'packed' ? zlib.gzipSync(plainBody) : plainBody;
      served.set(p, { body, type: op.what === 'packed' ? 'text/css' : 'application/octet-stream', cuts: cuts(body.length), encoding: op.what === 'packed' ? 'gzip' : '' });
      const r = await rq(lab, { path: p, headers: { 'accept-encoding': 'gzip' } });
      if (r.status !== 200 || !r.buf.equals(plainBody)) ctx.add('silent', 'bytes-through-the-lab-differ', `${p} (${op.what}): ${r.buf.length} bytes for ${plainBody.length}, status ${r.status}`, { what: op.what });
    } else if (op.what === 'socket') {
      // The dev server's own live reload goes through the lab as a websocket: bytes in, the same bytes back.
      const sent = Buffer.from(Array.from({ length: 500 + rng.int(4000) }, () => rng.int(256)));
      const got = await new Promise((resolve) => {
        const s = net.connect(lab.port, '127.0.0.1', () => s.write(`GET /hmr HTTP/1.1\r\nHost: localhost:${lab.port}\r\nOrigin: http://localhost:${lab.port}\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n`));
        let buf = Buffer.alloc(0);
        let open = false;
        s.on('data', (d) => {
          buf = Buffer.concat([buf, d]);
          const head = buf.indexOf('\r\n\r\n');
          if (!open && head >= 0) {
            open = true;
            buf = buf.subarray(head + 4);
            s.write(sent);
          }
          if (open && buf.length >= sent.length) (s.destroy(), resolve(buf));
        });
        s.on('error', () => resolve(null));
        setTimeout(() => (s.destroy(), resolve(open ? buf : null)), 3000 * opts.slow);
      });
      if (!got || !got.equals(sent)) ctx.add(got ? 'silent' : 'loud', 'socket-through-the-lab-differs', got ? `${got.length} bytes came back for ${sent.length} sent` : 'the socket did not open through the lab', {});
    } else if (op.what === 'comment') {
      // Comments on a dev server's page are kept by the lab, under the page's address.
      const r = await rq(lab, { method: 'POST', path: '/_lab/api/comments', body: { page: p, name: 'Leo', text: `on the dev page ${i}`, anchor: H1 } });
      const listed = r.status === 201 && (await rq(lab, { path: `/_lab/api/comments?page=${p}` })).json().comments.some((c) => c.id === r.json().comment.id);
      const onDisk = listed && (await until(() => Object.values(lab.store()[p] || {}).some((c) => c.id === r.json().comment.id), 2500 * opts.slow, 40));
      if (r.status !== 201) ctx.add('loud', 'write-refused', `a pin on the dev page ${p}: ${r.status} ${r.text.slice(0, 200)}`, { step: 'proxy-comment' });
      else if (!listed || !onDisk) ctx.add('silent', 'acknowledged-comment-missing', `a pin on the dev page ${p} is ${listed ? 'listed but not in .lab/comments' : 'not listed'}`, { when: 'behind-a-dev-server' });
    }
  }
  // The dev server gone: the lab says so, plainly.
  devOff();
  await sleep(60);
  const r = await rq(lab, { path: '/p0', headers: { accept: 'text/html' } }).catch((e) => ({ status: 0, text: String(e) }));
  if (r.status !== 502 || !/no answer from the dev server/.test(r.text)) ctx.add(r.status >= 500 || r.status === 0 ? 'loud' : 'silent', 'dev-server-down-not-said', `with the dev server stopped, a page through the lab answered ${r.status}: ${r.text.slice(0, 120)}`, {});
}
