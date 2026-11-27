// Is this request a person loading a page, or a script of the app asking for HTML (fetch, XHR)? Only a page load gets
// the widget: an HTML fragment an app fetches is its data, and the widget tag carries the admin key, which must not
// end up in the app's own state. Used by the proxy (lib/proxy.ts).
import type { IncomingHttpHeaders } from 'node:http';

// What a browser says it is fetching: a page (top level or in a frame), or anything else ('empty' is fetch() and XHR).
const NAVIGATION = new Set(['document', 'iframe', 'frame']);

// A page load for sure: the widget's own fetch of the page (it sends X-Lab: it needs the page as the lab sends it), a
// navigation, a prefetch of one (its answer is what the next navigation shows), or with no Sec-Fetch-Dest at all, a
// request that asks for text/html and no script marked as its own. (A dev server's page, which may be no .html file,
// is told apart this way; `*/*` is not enough there.)
export function isPageLoad(h: IncomingHttpHeaders): boolean {
  if (h['x-lab']) return true;
  const dest = h['sec-fetch-dest'];
  if (dest) return NAVIGATION.has(String(dest)) || /prefetch|prerender/i.test(String(h['sec-purpose'] || ''));
  return !h['x-requested-with'] && /text\/html/i.test(h.accept || '');
}

// A browser really loading the page, which is what a page's errors belong to (local.mjs pageErrors): a new load of it
// forgets what the last one reported. Not the widget's own fetch of the page (a patch in place, the page stays open),
// not a prefetch, and not a script or a curl that asks for HTML: over the wifi address (plain http) a browser sends no
// Sec-Fetch headers, so there it is told by what it calls itself.
export function isNavigation(h: IncomingHttpHeaders): boolean {
  if (h['x-lab'] || !isPageLoad(h)) return false;
  const dest = h['sec-fetch-dest'];
  if (dest) return NAVIGATION.has(String(dest)) && !/prefetch|prerender/i.test(String(h['sec-purpose'] || ''));
  return String(h['user-agent'] || '').startsWith('Mozilla/');
}
