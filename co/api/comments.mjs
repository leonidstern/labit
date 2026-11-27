// colabit's comments API (co/README.md): the lab's own (lib/comments-api.mjs) for sites of your own, with no agent:
// anyone on a page comments under a name they type; the owner's link (#lab-admin=<token>) may resolve, move and delete anyone's. New comments are limited per address and hour (CO_PER_HOUR, default 60).
// Storage: Upstash Redis (Vercel's KV_REST_API_URL + KV_REST_API_TOKEN), one hash per page, as the lab keeps it in memory.
// Env: LAB_COMMENTS_ADMIN_TOKEN (the owner's key).
import { GET as list, POST as save, sameKey, useStore } from './_lib/comments-api.mjs';

// The owner's key (LAB_COMMENTS_ADMIN_TOKEN), sent by the owner's browser after their #lab-admin= link.
const isOwner = (request) => {
  const owner = process.env.LAB_COMMENTS_ADMIN_TOKEN;
  const sent = request.headers.get('x-lab-admin');
  return Boolean(owner && sent && sameKey(sent, owner));
};
// data-site="lab": the colabit's own paths (/<name>/…, co/colabit.mjs), kept as they are. Any other data-site (or the
// site's host, dots as dashes): a site of your own with the script on it, its pages kept under /co/<site>/<path>.
const site = (request) => (request.headers.get('x-co-site') || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const under = (s, page) => (typeof page !== 'string' || !page.startsWith('/') ? null : s === 'lab' ? page : `/co/${s}${page === '/' ? '' : page}`);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-lab-admin, x-co-site', 'access-control-max-age': '86400' };
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
  const run = turn.then(fn).catch((e) => (console.error(e), json({ error: `could not reach the store: ${e.message}` }, 503)));
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

// The lab's API sees only what it may: the owner's key or none, never an agent's or a lab's headers.
const inner = (request, owner, init) =>
  new Request(request.url, { ...init, headers: { 'content-type': 'application/json', ...(owner ? { 'x-lab-admin': process.env.LAB_COMMENTS_ADMIN_TOKEN } : {}) } });

// New comments and replies from people (not the owner): CO_PER_HOUR per address and hour.
async function tooMany(request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const key = `co:rate:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const [n] = await redis([['INCR', key], ['EXPIRE', key, '3600']]);
  return n > (Number(process.env.CO_PER_HOUR) || 60);
}

export const OPTIONS = () => withCors(new Response(null, { status: 204 }));

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('format') || url.searchParams.has('thread')) return json({ error: 'not here' }, 400); // the agent's text
  const page = under(site(request), url.searchParams.get('page'));
  if (!site(request) || !page) return json({ error: 'bad page' }, 400);
  url.search = String(new URLSearchParams({ page }));
  const owner = isOwner(request);
  return withCors(await inTurn(() => handle(request, page, '', () => list(inner(new Request(url), owner, { method: 'GET' })))));
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!body || typeof body !== 'object' || body.action === 'progress') return json({ error: 'bad request' }, 400);
  const page = under(site(request), body.page);
  if (!site(request) || !page) return json({ error: 'bad page' }, 400);
  const owner = isOwner(request);
  try {
    if (!owner && !body.action && (await tooMany(request))) return json({ error: 'too many comments, try again later' }, 429);
  } catch (e) {
    return json({ error: `could not reach the store: ${e.message}` }, 503);
  }
  const nonce = typeof body.nonce === 'string' && /^[\w-]{8,40}$/.test(body.nonce) ? body.nonce : '';
  const sent = JSON.stringify({ ...body, page });
  return withCors(await inTurn(() => handle(request, page, nonce, () => save(inner(request, owner, { method: 'POST', body: sent })))));
}
