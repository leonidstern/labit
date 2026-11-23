// The moment a pin was written on (Leo, 19 Nov: "pause > comment > repeat"): what was paused and where it stood, in
// plain words. One wording for the pin's chip (src/comments.js) and the agent's text (comments-api.mjs).
// kind: loop (an animation that repeats for ever), anim (one that repeats a few times), video, gif (it keeps playing:
// how long it had been showing). at / of: seconds into one pass, of how long one pass is. pass: which pass, from 1.
// what: a short name of the paused thing. sel: its selector, to find it again. ms: the animation's own time, to seek.
// playing: it was moving (nothing paused), so the moment is the one showing as the pin went down.

/** @typedef {{ kind: 'loop' | 'anim' | 'video' | 'gif', at: number, of?: number, pass?: number, what?: string, sel?: string, ms?: number, frame?: number, fps?: number }} Moment */
// frame, fps (Leo, 23 Nov, 9b): a video's frame from 1 and its frame rate, once measured (src/widget/step.ts): the exact
// frame to go back to, where at (a tenth of a second) is two or three frames.

const KINDS = ['loop', 'anim', 'video', 'gif'];
const num = (v, max) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : undefined);
const cut = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '') || undefined;

/** A moment from a page, checked: anything else is dropped. */
export function cleanMoment(m) {
  if (!m || typeof m !== 'object' || !KINDS.includes(m.kind)) return undefined;
  const at = num(m.at, 86400);
  if (at === undefined) return undefined;
  const of = num(m.of, 86400);
  const pass = num(m.pass, 1e9);
  const ms = num(m.ms, 864e5);
  return {
    kind: m.kind,
    at: Math.round(at * 10) / 10,
    of: of ? Math.round(of * 10) / 10 : undefined,
    pass: pass && m.kind !== 'video' && m.kind !== 'gif' ? Math.round(pass) : undefined,
    what: cut(m.what, 80),
    sel: cut(m.sel, 300),
    ms: ms === undefined ? undefined : Math.round(ms),
    playing: m.playing === true && m.kind !== 'gif' ? true : undefined, // not paused: the moment it was showing as the pin went down
    ...(m.kind === 'video' && Number.isInteger(m.frame) && m.frame > 0 && m.frame < 1e8 && Number.isInteger(m.fps) && m.fps > 0 && m.fps <= 240 ? { frame: m.frame, fps: m.fps } : {}),
  };
}

// 4 → "4", 3.25 → "3.3"
const s = (v) => String(Math.round(v * 10) / 10);
// A video's clock, to a tenth where it says where (0:04.2), whole where it is a length (0:12): 1:02:05.3
export const clock = (v, tenth = false) => {
  const t = tenth ? Math.round(v * 10) / 10 : Math.round(v);
  const w = Math.floor(t);
  const h = Math.floor(w / 3600), m = Math.floor((w % 3600) / 60);
  const sec = String(w % 60).padStart(2, '0') + (tenth ? `.${Math.round((t - w) * 10)}` : '');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** "loop 3.2 of 4 s · pass 209", "video 0:04.2 of 0:12", "animation 1.5 of 3 s · pass 2", "GIF 2.4 s after it showed". */
export function momentText(m) {
  if (!m) return '';
  if (m.playing) return `at ${momentText({ ...m, playing: undefined })}`; // it was moving: "at loop 2.1 of 4 s · pass 7"
  if (m.kind === 'video') return `video ${clock(m.at, true)}${m.of ? ` of ${clock(m.of)}` : ''}${m.frame ? ` · frame ${m.frame}` : ''}`;
  if (m.kind === 'gif') return `GIF ${s(m.at)} s after it showed`;
  const name = m.kind === 'loop' ? 'loop' : 'animation';
  return `${name} ${s(m.at)}${m.of ? ` of ${s(m.of)}` : ''} s${m.pass ? ` · pass ${m.pass}` : ''}`;
}
