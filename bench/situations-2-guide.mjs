// Writes bench/situations/b2-guide.html: the four code blocks of batch 2 (a diff, a table with line numbers,
// a block whose lines are separate elements, a block with a folded part) from the files in situations/src/calendar,
// so the page and the files cannot drift apart. Run after changing those files: node bench/situations-2-guide.mjs
// An agent answering bench/situations-2-task.md must not read this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'situations');
const read = (f) => fs.readFileSync(path.join(SITE, f), 'utf8').replace(/\n$/, '').split('\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

// A small TypeScript colourer: comments, strings, keywords, numbers; the rest is plain.
const TOKEN = /(\/\*\*.*?\*\/|\/\/.*$)|('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|export|const|let|function|async|await|return|if|for|of|while|switch|case|default|break|continue|throw|new|type|interface|null)\b|\b(\d[\d_]*)\b/g;
function tokens(line) {
  const out = [];
  let at = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index > at) out.push(['', line.slice(at, m.index)]);
    out.push([m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'n', m[0]]);
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push(['', line.slice(at)]);
  return out;
}
const colour = (line) => tokens(line).map(([t, s]) => (t ? `<span class="tok-${t}">${esc(s)}</span>` : esc(s))).join('');

// 1. A diff: two hunks of src/calendar/invite.ts as it is now against the version before.
function diff() {
  const now = read('src/calendar/invite.ts');
  const hunk = (from, to, added, removed) => {
    const rows = [];
    for (let n = from; n <= to; n++) {
      for (const r of removed[n] || []) rows.push(['del', '-' + r]);
      rows.push(added.includes(n) ? ['add', '+' + now[n - 1]] : ['ctx', ' ' + now[n - 1]]);
    }
    return rows;
  };
  const first = hunk(1, 5, [2], {});
  const second = hunk(7, 17, [10, 11, 14], { 10: ['    await mailer.send(guest.email, render(event));'] });
  const rows = [['hunk', '@@ -1,4 +1,5 @@'], ...first, ['hunk', '@@ -6,9 +7,11 @@ import type { CalendarEvent, Guest } from \'./types\';'], ...second];
  return rows.map(([cls, text]) => `<span class="${cls}">${esc(text)}</span>`).join('\n');
}

// 2. A table with the line numbers in their own column (drawn from data-line by CSS): lines 34 to 51 of recurrence.ts.
function numbered(from, to) {
  const lines = read('src/calendar/recurrence.ts');
  return lines.slice(from - 1, to).map((l, i) => `      <tr><td class="num" data-line="${from + i}"></td><td class="src">${colour(l)}</td></tr>`).join('\n');
}

// 3. The way Docusaurus prints code: one element per line, ending in <br>, all on one line of HTML, no newline characters.
function tokenLines() {
  const names = { c: 'comment', s: 'string', k: 'keyword', n: 'number' };
  return read('src/calendar/timezone.ts').map((l) => `<span class="token-line">${
    tokens(l).map(([t, s]) => `<span class="token ${names[t] || 'plain'}">${esc(s)}</span>`).join('') || '<span class="token plain" style="display:inline-block"></span>'}<br></span>`).join('');
}

// 4. A whole file with one function folded: its lines are in the page, hidden, behind a button.
function folded() {
  const lines = read('src/calendar/reminders.ts');
  const from = lines.findIndex((l) => l.startsWith('export function digest('));
  const to = lines.indexOf('}', from);
  const hidden = lines.slice(from + 1, to);
  return [
    ...lines.slice(0, from).map(colour),
    `${colour(lines[from])}<button type="button" class="fold" aria-expanded="false" title="Show ${hidden.length} lines">⋯ ${hidden.length} lines</button><span class="folded" hidden>`,
    ...hidden.map(colour).map((l, i) => (i === hidden.length - 1 ? `${l}</span>` : l)),
    ...lines.slice(to).map(colour),
  ].join('\n');
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Calendar internals · Tidepool Docs</title>
<link rel="stylesheet" href="site.css">
<link rel="stylesheet" href="b2.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="/sit/tour">Tidepool</a>
  <span class="tagline">Docs</span>
  <nav>
    <a href="/sit/docs">Sync</a>
    <a href="/sit/b2-guide" aria-current="page">Calendar</a>
    <a class="btn small" href="/signup">Start free trial</a>
  </nav>
</header>

<main class="docs">
  <h1>Calendar internals</h1>
  <p class="lead">How invites, repeating events, time zones and reminders work, for people who change that code.</p>

  <section id="invites">
    <h2>Invites skip people who opted out</h2>
    <p>
      Since 2.4 a guest who opted out of mail gets no invite, the invite is written in the
      guest's language, and every batch is written to the audit log. The change:
    </p>
    <figure class="code">
      <figcaption>src/calendar/invite.ts</figcaption>
      <pre class="diff"><code>${diff()}</code></pre>
    </figure>
    <p>Sending an invite again works the same way and is logged the same way.</p>
  </section>

  <section id="repeats">
    <h2>Repeating events</h2>
    <p>
      A repeating event is stored once, with a rule. The dates you see in the week view are
      worked out when the view opens, never further ahead than <code>HORIZON_DAYS</code>.
    </p>
    <table class="code-table" data-file="src/calendar/recurrence.ts">
${numbered(34, 51)}
    </table>
    <p>The step between two repeats comes from <code>stepOf</code>, which only knows days and weeks.</p>
  </section>

  <section id="zones">
    <h2>Time zones</h2>
    <p>Events keep the zone they were made in. Everything the viewer sees is shifted when it is shown.</p>
    <div class="language-ts codeBlockContainer">
      <div class="codeBlockTitle">src/calendar/timezone.ts</div>
      <div class="codeBlockContent"><pre tabindex="0" class="prism-code language-ts"><code class="codeBlockLines">${tokenLines()}</code></pre></div>
    </div>
  </section>

  <section id="reminders">
    <h2>Reminders</h2>
    <p>One push per event, held back during quiet hours. The evening digest is folded away below.</p>
    <figure class="code">
      <figcaption>src/calendar/reminders.ts</figcaption>
      <pre class="folds"><code>${folded()}</code></pre>
    </figure>
  </section>
</main>

<footer class="site-footer">
  <p class="brand">Tidepool</p>
  <p class="tagline">Shared calendars for small teams</p>
  <p class="fine">© 2026 Tidepool GmbH · Hamburg</p>
</footer>
<script src="b2-guide.js" defer></script>
<script src="/_lab/comments.js" defer></script>
</body>
</html>
`;
fs.writeFileSync(path.join(SITE, 'b2-guide.html'), html);
console.log('wrote bench/situations/b2-guide.html');
