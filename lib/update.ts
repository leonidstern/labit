// A newer labit release, offered in the ⋯ menu of a lab run from npm: its version and a few lines of what changed.

const parts = (v: string) => String(v).split('-')[0].split('.').map(Number);
/** Whether version `a` is a later release than `b` (major.minor.patch; a -tag after it is not compared). */
export const newer = (a: string, b: string): boolean => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

/** What changed after `from`, up to `upto`, from CHANGELOG.md: each bullet's first sentence, newest first, at most `max`. */
export function releaseNotes(md: string, from: string, upto: string, max = 5): string[] {
  const out: string[] = [];
  let on = false;
  for (const line of md.split('\n')) {
    const head = /^## (\d+\.\d+\.\d+)/.exec(line);
    if (head) on = newer(head[1], from) && !newer(head[1], upto);
    else if (line.startsWith('## ')) on = false;
    else if (on && line.startsWith('- ')) {
      const text = line.slice(2).replace(/`/g, '').replace(/\*\*/g, '');
      const first = /^(.{12,}?[.:;])(\s|$)/.exec(text)?.[1] || text;
      const said = first.replace(/[:;]$/, '');
      out.push(said.length > 110 ? said.slice(0, 108).trimEnd() + '…' : said);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** The release's CHANGELOG.md from its tag on GitHub; null when it can't be read (offline, no tag yet). */
export async function fetchNotes(version: string, from: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/leonidstern/labit/v${version}/CHANGELOG.md`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? releaseNotes(await res.text(), from, version) : null;
  } catch {
    return null;
  }
}
