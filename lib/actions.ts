// Your actions (Leo, 19 Nov: "one action list for pin and select", select since removed): one ordered list, each a short
// name (the chip) and the prompt the agent gets, set in labit.json (the project's, wins) or your settings.json
// (`actions`, docs/settings.md); the page has no editor (Leo, 20 Nov: "it can be in settings json"). The comment box
// shows as many as fit on one line; the rest are not shown. With no list anywhere, your settings.json is seeded once from SEED
// (lib/settings.ts), so it is there to edit. The lab always hands the widget the list (data-actions), so the widget
// carries no copy.
type Action = { name: string; prompt: string };
export const NAME_MAX = 7;
const PROMPT_MAX = 300;
export const SEED: Action[] = [
  { name: 'go', prompt: 'Go ahead: do what is proposed here.' },
  { name: 'more', prompt: 'Go further: show more options on this.' },
  { name: 'no', prompt: 'No: do not do this; leave it as it was.' },
];

/** The list, checked, in the order given: a name of NAME_MAX characters at most and a prompt; a bad or repeated one is
 *  said (bad) and left out. */
export function actionItems(list: unknown[], bad: (why: string) => void): Action[] {
  const out: Action[] = [];
  for (const x of list) {
    const o = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
    const name = typeof o?.name === 'string' ? o.name.trim() : '';
    const prompt = typeof o?.prompt === 'string' ? o.prompt.trim() : '';
    if (!name || !prompt) bad(`each action needs a "name" and a "prompt"; ${JSON.stringify(x)} ignored`);
    else if (name.length > NAME_MAX) bad(`"${name}" is ${name.length} characters: a name is ${NAME_MAX} at most; ignored`);
    else if (prompt.length > PROMPT_MAX) bad(`"${name}": a prompt is ${PROMPT_MAX} characters at most; ignored`);
    else if (out.some((a) => a.name.toLowerCase() === name.toLowerCase())) bad(`"${name}" is listed twice; ignored`);
    else out.push({ name, prompt });
  }
  return out;
}

/** The list to seed from what a settings file holds: the seed, then your own old { label, send } buttons (the
 *  { words, spot } form from before), cut to NAME_MAX. */
export function seedFrom(old: unknown): Action[] {
  const out = SEED.map((a) => ({ ...a }));
  const own = old && typeof old === 'object' && !Array.isArray(old) ? Object.values(old).flat() : [];
  for (const x of own as Record<string, unknown>[]) {
    const name = typeof x?.label === 'string' ? x.label.trim().slice(0, NAME_MAX) : '';
    const prompt = typeof x?.send === 'string' ? x.send.trim().slice(0, PROMPT_MAX) : '';
    if (name && prompt && !out.some((a) => a.name.toLowerCase() === name.toLowerCase())) out.push({ name, prompt });
  }
  return out;
}
