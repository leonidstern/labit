// The known labit bugs and the failure signatures they show as (see "Known bugs and their signatures" in README.md).
// A simple mapping by signature text: `all` are substrings that must all be in the signature
// ("area | class | check | tags"), `any` (when given) at least one. The first bug that matches names the signature.
// A signature that matches none is NEW (or a bug nobody listed yet). Add a line when a bug is found; a signature that
// stops coming back after a fix just shows "not seen" for its bug in the report.
export const KNOWN_BUGS = [
  { n: 1, name: 'js-import', all: ['stale-content', 'res=js-import'] },
  { n: 2, name: 'dead page', all: ['| dead-page |'] },
  { n: 3, name: 'css stale after restart', all: ['stale-content', 'cause=lab-stopped-or-restarted-around-the-save'], any: ['res=css', 'res=css-import'] },
  { n: 4, name: 'first live message / NaN catch-up', all: ['stale-content', "cause=saved-before-the-page's-first-live-message"] },
  { n: 5, name: '>50 files', all: ['stale-content', 'cause=saved-among-over-50-files'] },
  { n: 6, name: 'letter case', all: ['stale-content', 'cause=page-opened-in-another-letter-case'] },
  { n: 7, name: 'same size/mtime ETag', all: ['stale-content', 'cause=same-size-and-time-as-before'] },
  { n: 8, name: 'comments follow mv', all: ['comments-did-not-follow-the-page'] },
  { n: 9, name: 'comment during page load missing', all: ['cond=made-while-the-page-loaded'], any: ['comment-missing-on-device', 'agent-reply-missing-on-device'] },
  { n: 10, name: 'waitingOn name', all: ['waiting-count-wrong'] },
  { n: 11, name: 'hand-off record flush', all: ['message-handed-out-twice'] },
  { n: 12, name: 'duplicate own bubble', all: ['device-shows-a-comment-twice'] },
];

/** The known bug a signature shows as, or null. */
export const knownBugOf = (signature) => KNOWN_BUGS.find((b) => b.all.every((x) => signature.includes(x)) && (!b.any || b.any.some((x) => signature.includes(x)))) || null;
/** The tag a report prints beside a signature. */
export const bugTag = (signature) => {
  const b = knownBugOf(signature);
  return b ? `known bug ${b.n} (${b.name})` : 'NEW: matches no known bug';
};
