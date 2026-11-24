// co-labit's comments API (co/README.md): the lab's own (lib/comments-api.mjs) for sites of your own, with no agent.
// Every request carries an invite key (co/invite.mjs): it says who is writing (their name is the key's, not what the
// page sends) and whether they are the owner (resolve, move and delete anyone's). No key, no comments.
// Storage: Upstash Redis (Vercel's KV_REST_API_URL + KV_REST_API_TOKEN), one hash per page, as the lab keeps it in memory.
// Env: CO_SECRET (signs the keys), CO_REVOKED (names whose keys stop working, comma separated).
import { createHmac } from 'node:crypto';
import { GET as list, POST as save, sameKey, useStore } from '../../lib/comments-api.mjs';

const secret = () => process.env.CO_SECRET || '';
// The lab's API signs each pin's edit key (moving your own pin) with its admin key: here one made from CO_SECRET, never sent.
const adminKey = () => createHmac('sha256', secret()).update('co:admin').digest('base64url');
const sign = (name, role) => createHmac('sha256', secret()).update(`co:${name}:${role}`).digest('base64url').slice(0, 24);

/** An invite key: <name, base64url>.<o: owner | p: person>.<signature>. */
export const inviteKey = (name, owner = false) => `${Buffer.from(name).toString('base64url')}.${owner ? 'o' : 'p'}.${sign(name, owner ? 'o' : 'p')}`;

function who(key) {
  const [b64, role, sig, extra] = String(key || '').split('.');
  if (!secret() || extra !== undefined || !b64 || !/^[op]$/.test(role) || !sig) return null;
  const name = Buffer.from(b64, 'base64url').toString().trim();
  if (!name || name.length > 60 || !sameKey(sig, sign(name, role))) return null;
  const revoked = (process.env.CO_REVOKED || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return revoked.includes(name.toLowerCase()) ? null : { name, owner: role === 'o' };
}

// A site's pages are kept under its name: /<site>/<path>. data-site on the script tag, else its host (dots as dashes).
const site = (request) => (request.headers.get('x-co-site') || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const under = (s, page) => (typeof page === 'string' && page.startsWith('/') ? `/${s}${page === '/' ? '' : page}` : null);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-co-key, x-co-site', 'access-control-max-age': '86400' };
const withCors = (res) => {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
};
const json = (body, status) => withCors(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }));

// Upstash's REST API: commands in one round trip, results in order.
let redis = async (commands) => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('no store');
  const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(commands) });
  const out = await res.json();
  if (!res.ok || !Array.isArray(out)) throw new Error(out?.error || `store ${res.status}`);
  return out.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
};
/** Tests and co/dev.mjs: another store with the same commands. */
export const useRedis = (fn) => (redis = fn);

// The lab's API works on one store at a time (useStore): requests take turns, each with its page loaded from Redis and
// what it changed written back (only the comments it changed, so two people's writes to one page both land).
let turn = Promise.resolve();
const inTurn = (fn) => {
  const run = turn.then(fn);
  turn = run.catch(() => {});
  return run;
};

async function handle(request, page, nonce, call) {
  const key = `lab:comments:${page}`;
  const nonceKey = nonce && `lab:nonce:${page}:${nonce}`;
  const [flat, earlier] = await redis([['HGETALL', key], nonceKey ? ['GET', nonceKey] : ['PING']]);
  const was = new Map();
  for (let i = 0; i < (flat || []).length; i += 2) was.set(flat[i], flat[i + 1]);
  const db = new Map(was.size ? [[key, new Map(was)]] : []);
  if (nonceKey && earlier) db.set(nonceKey, earlier);
  useStore(db);
  const res = await call();
  const now = db.get(key) || new Map();
  const writes = [];
  const set = [...now].filter(([id, v]) => was.get(id) !== v).flat();
  if (set.length) writes.push(['HSET', key, ...set]);
  const gone = [...was.keys()].filter((id) => !now.has(id));
  if (gone.length) writes.push(['HDEL', key, ...gone]);
  if (nonceKey && !earlier && db.get(nonceKey)) writes.push(['SET', nonceKey, db.get(nonceKey), 'EX', '900']);
  if (writes.length) await redis(writes);
  return res;
}

// The lab's API sees only what it may: the owner's admin key or none, never an agent's or a lab's headers.
const inner = (request, person, init) =>
  new Request(request.url, { ...init, headers: { 'content-type': 'application/json', 'x-forwarded-for': request.headers.get('x-forwarded-for') || '', ...(person.owner ? { 'x-lab-admin': adminKey() } : {}) } });

export const OPTIONS = () => withCors(new Response(null, { status: 204 }));

export async function GET(request) {
  const person = who(request.headers.get('x-co-key'));
  if (!person) return json({ error: 'not invited' }, 401);
  const url = new URL(request.url);
  if (url.searchParams.has('format') || url.searchParams.has('thread')) return json({ error: 'not here' }, 400); // the agent's text
  const page = under(site(request), url.searchParams.get('page'));
  if (!site(request) || !page) return json({ error: 'bad page' }, 400);
  url.search = String(new URLSearchParams({ page }));
  process.env.LAB_COMMENTS_ADMIN_TOKEN = adminKey();
  return withCors(await inTurn(() => handle(request, page, '', () => list(inner(new Request(url), person, { method: 'GET' })))));
}

export async function POST(request) {
  const person = who(request.headers.get('x-co-key'));
  if (!person) return json({ error: 'not invited' }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!body || typeof body !== 'object' || body.action === 'progress') return json({ error: 'bad request' }, 400);
  const page = under(site(request), body.page);
  if (!site(request) || !page) return json({ error: 'bad page' }, 400);
  const nonce = typeof body.nonce === 'string' && /^[\w-]{8,40}$/.test(body.nonce) ? body.nonce : '';
  const sent = JSON.stringify({ ...body, page, name: person.name });
  process.env.LAB_COMMENTS_ADMIN_TOKEN = adminKey();
  return withCors(await inTurn(() => handle(request, page, nonce, () => save(inner(request, person, { method: 'POST', body: sent })))));
}
