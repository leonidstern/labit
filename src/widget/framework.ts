// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
//
// Framework detection: whether the page was drawn by React, Vue or Svelte, so components.ts (loaded only then) can say
// which component a pin is on.
import { readComponents } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
// Which component drew what a pin is on (components.ts, React, Vue, Svelte): its own file, loaded once the page shows
// it was drawn by one of them: at start, at load, or the first element the pointer goes over that says so. A pin
// reads it at once (anchorAt doesn't wait), so it is there before the first click.
const drawnByFramework = (n: any) => Boolean(n && (n.__vueParentComponent || n.__svelte_meta || Object.keys(n).some((k) => k.startsWith('__react'))));
const lookForFramework = (nodes: Iterable<Element | EventTarget | null>) => {
  if (W.S.components) return;
  for (const n of nodes) {
    if (!drawnByFramework(n)) continue;
    removeEventListener('pointerover', overFramework, true);
    W.S.components = W.part('components').then((m) => readComponents(m.componentAt), () => (W.S.components = null));
    return;
  }
};
export const overFramework = (e: PointerEvent) => lookForFramework([e.target]);
export const scanForFramework = () => lookForFramework([document.body, ...document.querySelectorAll('body > *, body > * > *, body > * > * > *')]);
export function bindFramework(w: unknown) {
  W = w;
}
