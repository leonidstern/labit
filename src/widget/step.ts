// Stepping a video or an animation a frame at a time (Leo, 23 Nov: ← → one frame, ⇧ one second; an arrow on a playing
// one pauses it first). Shared by the motion menu's keys (motion.ts) and a page inside a board's open frame (frame.ts).
//
// Browsers don't say a video's frame rate: it is measured from the frames as they show (requestVideoFrameCallback,
// Chrome and Safari), one frame being the smallest step between two frames shown in a row. Until then a frame is 1/30 s.
// An animation steps by a screen frame, 1/60 s.

const fpsOf = new WeakMap<HTMLVideoElement, number>();
const watched = new WeakSet<HTMLVideoElement>();

/** Start measuring a video's frame rate as it plays (once per video; cheap: one callback per shown frame). */
export function watchFrames(v: HTMLVideoElement) {
  if (watched.has(v) || !('requestVideoFrameCallback' in v)) return;
  watched.add(v);
  let last: { n: number; t: number } | null = null;
  let best = Infinity, seen = 0;
  const tick = (_now: number, m: VideoFrameCallbackMetadata) => {
    if (last && m.presentedFrames - last.n === 1) {
      const d = m.mediaTime - last.t;
      if (d > 0.004 && d < 0.2) {
        best = Math.min(best, d);
        if (++seen >= 3) fpsOf.set(v, Math.round(1 / best));
      }
    }
    last = { n: m.presentedFrames, t: m.mediaTime };
    if (seen < 60) v.requestVideoFrameCallback(tick); // enough to know: stop listening
  };
  v.requestVideoFrameCallback(tick);
}

export const fps = (v: HTMLVideoElement) => fpsOf.get(v) || 30;
/** The frame rate once measured, else nothing: a moment names its frame only when it is known. */
export const knownFps = (v: HTMLVideoElement) => fpsOf.get(v);
/** The frame showing, from 0. */
export const frameAt = (v: HTMLVideoElement) => Math.floor(v.currentTime * fps(v) + 1e-3);

/** Move a paused video by n frames (or whole seconds: n × its frame rate), stopping at its ends. */
export function stepVideo(v: HTMLVideoElement, frames: number) {
  const f = fps(v);
  const last = Number.isFinite(v.duration) ? Math.max(0, Math.ceil(v.duration * f) - 1) : Infinity;
  const to = Math.min(Math.max(frameAt(v) + frames, 0), last);
  v.currentTime = (to + 0.5) / f; // the middle of the frame: lands on it in every browser
}

/** Move paused animations by n screen frames (1/60 s), never before their start. */
export function stepAnims(anims: Animation[], frames: number) {
  for (const a of anims) {
    const t = Number(a.currentTime);
    if (Number.isFinite(t)) a.currentTime = Math.max(0, t + (frames * 1000) / 60);
  }
}

/** The key's step: ← → one frame, ⇧ one second; 0 when it is no step key (or has another modifier). */
export function stepOfKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, perSecond: number) {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return 0;
  return (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? perSecond : 1);
}
