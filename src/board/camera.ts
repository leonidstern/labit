// The board's camera: cam = { x, y, z }, screen = (world + cam) * z, world = screen / z - cam (the view's top-left is at
// world (-x, -y)). Zoom about a point keeps the world point under it still. Pure functions: nothing here touches the page.
export type Cam = { x: number; y: number; z: number };
export type Box = { x: number; y: number; w: number; h: number };
const MAX_Z = 4;
const PAD = 96; // room left round everything when it is all fitted into the view

const extent = (b: Box[]) => {
  const lo = { x: Math.min(...b.map((f) => f.x)), y: Math.min(...b.map((f) => f.y)) };
  return { ...lo, w: Math.max(...b.map((f) => f.x + f.w)) - lo.x, h: Math.max(...b.map((f) => f.y + f.h)) - lo.y };
};
/** The zoom that fits all of them with room round, never above 100%. */
const fitZ = (b: Box[], v: { w: number; h: number }) => {
  if (!b.length) return 1;
  const e = extent(b);
  return Math.min(1, (v.w - PAD) / e.w, (v.h - PAD) / e.h);
};
// Further out than everything fitted (Leo, 19 Nov: "do more zoom out"): to 10 %, or a quarter of the fit when that is less.
const minZ = (b: Box[], v: { w: number; h: number }) => Math.min(0.1, fitZ(b, v) / 4);
export const fitAll = (b: Box[], v: { w: number; h: number }): Cam => {
  if (!b.length) return { x: 0, y: 0, z: 1 };
  const e = extent(b);
  const z = fitZ(b, v);
  return { z, x: v.w / 2 / z - (e.x + e.w / 2), y: v.h / 2 / z - (e.y + e.h / 2) };
};
/** One frame fills the view (a phone's first view). */
export const fitFrame = (f: Box, v: { w: number; h: number }): Cam => {
  const z = Math.min(MAX_Z, (v.w - 24) / f.w, (v.h - 24) / f.h);
  return { z, x: v.w / 2 / z - (f.x + f.w / 2), y: v.h / 2 / z - (f.y + f.h / 2) };
};
// Finite edges: with margin m = view / 2 / z each axis is held to -(lo + len) - m + view / z <= cam <= -lo + m; when the
// content plus margin is smaller than the view the axis centres.
// From was (the camera before, at the same zoom) the edges only stop it, never push it: frames moved in from the edge make
// the board smaller, and the view the person had panned to stays where it is (Leo, 23 Nov: "moving several images after
// panned canvas right or left" moved the camera with them); the way back in is open, the way further out is not.
const hold = (c: number, lo: number, len: number, view: number, z: number, was?: number) => {
  const m = view / 2 / z;
  let [min, max] = [-(lo + len) - m + view / z, -lo + m];
  if (was !== undefined) [min, max] = [Math.min(min, was), Math.max(max, was)];
  return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, c));
};
export const clamp = (c: Cam, b: Box[], v: { w: number; h: number }, was?: Cam): Cam => {
  if (!b.length) return c;
  const z = Math.min(MAX_Z, Math.max(minZ(b, v), c.z));
  const e = extent(b);
  const same = was && Math.abs(was.z - z) < 1e-9 ? was : undefined;
  return { z, x: hold(c.x, e.x, e.w, v.w, z, same?.x), y: hold(c.y, e.y, e.h, v.h, z, same?.y) };
};
export const panBy = (c: Cam, dx: number, dy: number): Cam => ({ ...c, x: c.x + dx / c.z, y: c.y + dy / c.z });
/** Zoom to z2 with the world point under screen (sx, sy) staying there: cam' = s / z' - (s / z - cam). */
export const zoomAt = (c: Cam, sx: number, sy: number, z2: number, b: Box[], v: { w: number; h: number }): Cam => {
  const z = Math.min(MAX_Z, Math.max(minZ(b, v), z2));
  return { z, x: sx / z - (sx / c.z - c.x), y: sy / z - (sy / c.z - c.y) };
};
