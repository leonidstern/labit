// Things being tried. A new instrument arrives here first: off unless somebody turns it on, used in a real lab for
// a while, then kept (the flag goes and it is simply labit) or dropped (the code goes with it). The changelog says
// which. Nothing is in the product because it was built.
//
// Each flag: the key as it is written in labit.json or your settings.json (`flags`), the word the ⋯ menu's experiments
// section shows, and when it was first offered.

// Kept or dropped before: sinceLooked, sectionBar, board, agentPins, liveUrl, native, select, inkOnText (19-20 Nov).
export const FLAGS: Record<string, { name: string; since: string }> = {
  // Talk while you point (K, src/widget/walkie.ts): an experiment from 26 Nov (Leo: off by default).
  talk: { name: 'talk', since: '2026-11-26' },
};

/** Every flag, off. */
export const flagDefaults = (): Record<string, boolean> => Object.fromEntries(Object.keys(FLAGS).map((k) => [k, false]));

/** The ones that are on, for the page and for a listing. */
export const flagsOn = (flags: Record<string, boolean> = {}): string[] => Object.keys(FLAGS).filter((k) => flags[k]);
