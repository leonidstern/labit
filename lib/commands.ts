// The commands that answer and exit: preview, add / remove, list, pages (the labs on this computer) and the agent's
// wait, reply, resolve, pin, invite. Loaded by local.mjs only for these, so starting a lab never reads it.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { choiceSpills, FOREGROUND_CAP, letter, listenPages, replyChoices, replyIntent, waitSeconds, type Opts } from './args.ts';
import { mySession } from './agents.ts';
import { askPages, keyFor, runningLabs, type Lab } from './labs.ts';
import { findLab, labAck, labCall, setWifi, WAIT_SAID } from './labcall.ts';
import { read as readBoard } from './board.ts';
import { numberOf, UNMATCHED } from './schema.mjs';
import { loadSettings } from './settings.ts';

type Ctx = { pos: string[]; opts: Opts; HERE: string; CMD: string; ME: string; die: (msg: string) => never };

export async function runCommand({ pos, opts, HERE, CMD, ME, die }: Ctx): Promise<void> {
  // ---------- the Claude desktop app's preview pane ----------
  // It starts servers from .claude/launch.json in the session's folder and hands them a free port in PORT.
  if (pos[0] === 'preview') {
    const root = path.resolve(pos[1] || '.');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) die(`Not a folder: ${root}`);
    const file = path.join(root, '.claude/launch.json');
    let config = { version: '0.0.1', configurations: [] };
    if (fs.existsSync(file)) {
      // The app writes this file too, and allows comments and trailing commas in it (they don't survive this rewrite).
      const jsonc = (t) => t.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '').replace(/,(\s*[}\]])/g, '$1');
      try {
        config = JSON.parse(jsonc(fs.readFileSync(file, 'utf8')));
      } catch {
        die(`${file} isn't valid JSON, so it's left as it is. Add this to its "configurations":\n${JSON.stringify(entry(), null, 2)}`);
      }
    }
    function entry() {
      const args = ['.', '--no-open', ...(typeof opts.proxy === 'string' ? ['--proxy', opts.proxy] : opts.proxy ? ['--proxy'] : [])];
      // Under npx this script sits in npx's cache, which moves with every version: name the package, not the path.
      return CMD.startsWith('npx')
        ? { name: 'lab', runtimeExecutable: 'npx', runtimeArgs: ['--yes', '@leonidstern/labit@latest', ...args], port: 4400, autoPort: true }
        : { name: 'lab', program: ME, args, port: 4400, autoPort: true };
    }
    config.configurations = [...(config.configurations || []).filter((c) => c.name !== 'lab'), entry()];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    console.log(`Added "lab" to ${file}.`);
    console.log('Open this folder in the Claude desktop app and ask Claude to start the "lab" preview.');
    console.log(`Then: run \`${CMD} wait\` in the background and answer the comments.`);
    process.exit(0);
  }

  // This folder's lab (or --dir's), for the commands that talk to one.
  const myLab = () => findLab(opts.dir || '.') || die(`No lab server for this folder. Start one: run ${CMD} in the project.`);
  const forHere = (lab: Lab) => lab.root === HERE || lab.root.startsWith(HERE + path.sep) || HERE.startsWith(lab.root + path.sep);
  // `labit publish <page.html | folder>`: like publishing an Artifact (Leo 18 Nov: "process is similar to artifacts, can
  // you do it like this"). The page goes into the one pages lab (pagesFolder), named for its topic; that lab starts if
  // it isn't running; the link is printed. Publishing again replaces it, same link. No folder or lab of its own.
  if (pos[0] === 'publish') {
    const src = pos[1] && path.resolve(pos[1]);
    if (!src || !fs.existsSync(src)) die(`Usage: ${CMD} publish <page.html | folder> [--name "topic"]`);
    const home = String(loadSettings(HERE, {}).values.pagesFolder || '~/lab-pages').replace(/^~(?=$|\/)/, os.homedir());
    fs.mkdirSync(home, { recursive: true });
    const root = fs.realpathSync(home);
    const dir = fs.statSync(src).isDirectory();
    const topic = typeof opts.name === 'string' ? opts.name : path.basename(src).replace(/\.html?$/i, '');
    const slug = topic.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
    if (!dir && !/\.html?$/i.test(src)) die(`${src}: give an .html file, or a folder of pages`);
    const dest = path.join(root, dir ? slug : `${slug}.html`);
    // The page's old copy is removed first, so the source must not be that copy, in it or around it: a folder
    // published under the name of the folder it sits in (or through a link to the pages folder) used to delete itself.
    const from = fs.realpathSync(src);
    const within = (a: string, b: string) => a.startsWith(b + path.sep);
    if (within(from, dest) || within(dest, from)) die(`${src} and its place in the pages lab (${dest}) are inside one another. Publish it from another folder, or under another --name.`);
    if (from !== dest) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    }
    let lab = runningLabs().find((l) => l.root === root);
    if (!lab) {
      spawn(process.execPath, [ME, root, '--no-open', '--name', 'Pages'], { cwd: root, env: { ...process.env, LABIT_EXIT_WITH_PARENT: '' }, detached: true, stdio: 'ignore' }).unref();
      for (let i = 0; i < 100 && !lab; i++) {
        await new Promise((r) => setTimeout(r, 100));
        lab = runningLabs().find((l) => l.root === root);
      }
      if (!lab) die(`The pages lab didn't start. Run it yourself: ${CMD} ${root}`);
    }
    const key = keyFor(path.relative(root, dir ? path.join(dest, 'index.html') : dest)); // "/topic", or "/topic/index"
    console.log(`http://localhost:${lab.port}${key.replace(/\/index$/, '/')}`);
    console.log(`In the pages lab (${root.replace(os.homedir(), '~')}). Publish again to update it, same link.`);
    console.log(`Listen for its pins: cd ${root} && ${CMD} wait --bg --pages ${key}`);
    process.exit(0);
  }

  // `labit list`: what runs, so an agent reuses a lab instead of starting another.
  if (pos[0] === 'list') {
    const labs = runningLabs();
    if (!labs.length) console.log('No labs running.');
    for (const lab of labs) {
      let pages = '';
      try {
        const info = await (await askPages(lab.port, 2000)).json();
        const waiting = info.pages.reduce((n, p) => n + (p.waiting ?? p.open), 0);
        pages = ` · ${info.pages.length} page${info.pages.length === 1 ? '' : 's'}${waiting ? `, ${waiting} waiting` : ''}${info.listening ? ` · ${info.listening} listening` : ''}`;
      } catch {}
      // What it runs and how long it has been up: between releases every lab says the same version, and the age is
      // what tells a lab left running for days (serving old code) from a fresh one.
      const age = lab.startedAt ? Date.now() - Date.parse(lab.startedAt) : NaN;
      const since = !Number.isFinite(age) ? '' : age < 36e5 ? `${Math.max(1, Math.round(age / 6e4))} min` : age < 864e5 ? `${Math.round(age / 36e5)} h` : `${Math.round(age / 864e5)} days`;
      // A lab started through a link to a build (the edge script's) that points at a newer one now: it moves onto it
      // by itself once no agent is working on its pins.
      let newer = false;
      try {
        newer = Boolean(lab.entry && lab.me && fs.realpathSync(lab.entry) !== lab.me);
      } catch {}
      const what = `${lab.version ? ` · labit ${lab.version}${lab.edge ? ` (${lab.edge})` : ''}` : ''}${since ? `, up ${since}` : ''}${newer ? ' · newer build installed' : ''}`;
      console.log(`${lab.name}  http://localhost:${lab.port}  ${lab.root}${lab.proxy ? ` (on ${lab.proxy})` : ''}${what}${pages}`);
    }
    process.exit(0);
  }

  // ---------- every running lab's pages, as a Markdown list ----------
  // Written to .lab/lab-pages.md in this folder: a file Claude can send to the person, so the pages sit with its outputs.
  if (pos[0] === 'pages') {
    const labs = [];
    // The nearest lab wins: one serving this folder (or inside it) hides one serving a folder above, which would list
    // everything else up there too.
    const here = runningLabs().filter((l) => opts.all || forHere(l));
    const near = here.filter((l) => l.root === HERE || l.root.startsWith(HERE + path.sep));
    for (const lab of opts.all || !near.length ? here : near) {
      try {
        const res = await askPages(lab.port, 2000);
        if (res.ok) labs.push(await res.json());
      } catch {}
    }
    labs.sort((a, b) => a.name.localeCompare(b.name));
    // One group per local lab. Names only when there's more than one.
    const groups = labs.map((lab) => ({ name: lab.name, pages: lab.pages }));
    const lines = [];
    for (const group of groups) {
      if (groups.length > 1) lines.push(`**${group.name}**`, '');
      for (const p of group.pages) {
        const name = (p.title || p.file || p.path).replace(/[[\]]/g, '');
        const heard = p.listener ? ` · ${p.listener} listening` : p.waiting ? ' · nobody listening' : '';
        lines.push(`- [${name}](${p.url})${p.waiting ? ` · ${p.waiting} waiting` : ''}${heard}${p.when ? ` · ${p.when}` : ''}`);
      }
      lines.push('');
    }
    const out = path.join(HERE, '.lab', 'lab-pages.md');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, (lines.join('\n').trim() || (opts.all ? 'No labs running.' : 'No labs for this folder. `pages --all` lists every lab on this computer.')) + '\n');
    console.log(out);
    process.exit(0);
  }

  // ---------- boards: the lab places the frames and copies the pages; the agent says what and in what order ----------
  if (pos[0] === 'board') {
    const [, action, first, ...rest] = pos;
    const lab = myLab();
    const arg = action === 'new' ? { topic: [first, ...rest].filter(Boolean).join(' ') } : action === 'list' ? { name: first } : action === 'pick' ? { name: first, frames: rest } : action === 'move' ? { name: first, frame: rest[0] } : { name: first, target: rest[0] };
    if (!['new', 'add', 'move', 'pick', 'list'].includes(action)) die(`Usage: ${CMD} board new "<topic>" [--of /page] [--variants 3 | --widths 390,820,1280 | --flow /a,/b] | add <board> <frame|/page|file.html|image> [--label "…"] [--width N] [--after <frame>] | move <board> <frame> --after <frame> (or --first) | pick <board> <frame>… | list [<board>]`);
    const out = await labCall(lab.server, '/_lab/api/board', { action, ...arg, of: opts.of, variants: opts.variants, widths: opts.widths, flow: opts.flow, label: opts.label, width: opts.width, after: opts.after, first: opts.first }, mySession(opts.name, opts.model)).catch(() => null);
    if (!out) die(`The lab server for ${lab.dir} isn't running. Start it: ${CMD}`);
    let said = out.text;
    try {
      said = JSON.parse(out.text).text;
    } catch {}
    console.log(said);
    process.exit(out.status < 300 ? 0 : 1);
  }

  // ---------- labit update: this folder's lab moves onto the newer release its ⋯ menu offers ----------
  // The person pressed update (an "action: update labit to X" pin): this prints what changed, for the agent to say in
  // its reply, and the lab hands over to npx at that version on the same folder and port.
  if (pos[0] === 'update') {
    const lab = myLab();
    const res = await fetch(`http://localhost:${lab.server.port}/_lab/labs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lab-admin': lab.server.token },
      body: JSON.stringify({ action: 'update', port: lab.server.port }),
    }).catch(() => null);
    if (!res) die(`The lab server for ${lab.dir} isn't running.`);
    if (res.status === 409) die('This lab is on the newest labit: nothing to update.');
    if (!res.ok) die(`The lab didn't update: ${res.status} ${await res.text()}`);
    const { version, notes } = await res.json();
    console.log(`Updating this lab to labit ${version}: it starts again on the same port in a few seconds, open pages catch up.`);
    console.log(notes.length ? `What changed:\n${notes.map((n: string) => `- ${n}`).join('\n')}` : 'No notes for this release.');
    process.exit(0);
  }

  // ---------- Claude's side: wait, reply, resolve, pin ----------
  if (['wait', 'reply', 'resolve', 'pin', 'invite'].includes(pos[0])) {
    // `pin move <id> <selector>` and `pin gone <id>` settle a pin that is already there; any other `pin` makes one.
    const settle = pos[0] === 'pin' && (pos[1] === 'move' || pos[1] === 'gone') ? pos[1] : '';
    const [cmd, ref, ...words] = settle ? [pos[0], ...pos.slice(2)] : pos;
    const lab = myLab();
    const { dir } = lab;
    let { server } = lab;
    const session = mySession(opts.name, opts.model);
    const gone = () =>
      die(
        process.env.CODEX_SANDBOX_NETWORK_DISABLED
          ? `Codex's sandbox blocks this command from reaching the lab on this computer (port ${server.port}). Let the sandbox reach it: ` +
              `-c sandbox_workspace_write.network_access=true`
          : `The lab server for ${dir} isn't running. Start it: ${CMD} ${dir === process.cwd() ? '' : dir}`.trim() + '.',
      );
    // A lab that goes and comes back (--dev, an update, a crash and a start again) shouldn't end a wait: the command
    // holds on for a few seconds and carries on. The clock starts when the lab first goes, not when the call began --
    // a wait sits open for 25 minutes, so a deadline set up front would already have passed by then.
    // A lab started again has a new key in its .lab/server.json (this folder's, not a lab above): each try reads it again, so the old key isn't refused
    // (before, a wait outlived the restart and then ended on "forbidden", and the lab showed nobody listening).
    const call = async (pathname: string, body: object, seconds = 5) => {
      let until = 0;
      for (;;) {
        try {
          server = JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));
        } catch {} // mid-write or gone: the last one read
        try {
          return await labCall(server, pathname, body, session);
        } catch {
          if (!until) until = Date.now() + seconds * 1000;
          if (Date.now() >= until) return gone();
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };

    // The same words sent again by the same session to the same thing (the agent ran reply again because it never saw
    // the first one's answer) carry the same nonce, so the lab gives back the first comment instead of a second one,
    // as it does for the browser's retries (kept 15 minutes). The browser's nonce is random; the agent's command is a
    // new process each time, so its nonce comes from what it sends and what it answers: a reply names the thread's
    // latest message from a person, so "Done." after the person wrote again is a new answer, not a retry.
    // The name on the agent's own pins and replies: the agent, and its session's name when that is another.
    const signed = () => `${process.env.LAB_AGENT_NAME || session.agent}${session.name !== session.agent ? ` · ${session.name}` : ''}`;
    // One wait: the lab's answer is said, and confirmed as shown. A wait sits open for as long as it is allowed to; in an
    // agent's foreground that is the person's whole turn, so without --bg it is held to a minute (waitSeconds, args.ts,
    // says why it can't just be detected).
    const listen = async () => {
      const { seconds, capped } = waitSeconds(opts, process.stdout.isTTY === true);
      const out = await call('/_lab/wait', { timeout: seconds, pages: listenPages(opts, true), ack: true }, 20);
      console.log(WAIT_SAID[out.status] ?? out.text);
      await labAck(server, out.delivery, session);
      if (capped && out.status === 204)
        console.log(
          `\nThat wait was held to ${FOREGROUND_CAP} seconds. Run it in the background (your app's own way of doing that) and ` +
            'add --bg for the full wait: in the foreground this command holds your turn open, and the person cannot ' +
            'say anything to you until it ends.',
        );
      return out.status;
    };
    const nonceOf = (...parts: unknown[]) =>
      createHash('sha256').update(JSON.stringify([session.id || session.name, ...parts])).digest('hex').slice(0, 32);

    // A link for a phone on the same wifi: one use, ten minutes. Claude hands it over in chat; the lab must be --wifi.
    // `invite <name>` says who is coming, so their phone starts out named; with none, your own name goes along.
    if (cmd === 'invite') {
      const ask = () => call('/_lab/invite', { name: [ref, ...words].filter(Boolean).join(' '), page: opts.page || '' });
      let out = await ask();
      // A lab open to this computer only switches to wifi itself (same port, name and comments): never a second lab.
      if (out.status === 404) {
        const done = await setWifi(dir, true, session, console.log);
        if ('error' in done) die(`Could not turn wifi on for this lab: ${done.error}`);
        console.log('On the wifi only a device with a one-time link gets in, and the pages travel as plain http. `' + CMD + ' --no-wifi` turns it off again.\n');
        out = await ask();
      }
      if (out.status >= 300) die(`Could not make a link: ${out.text}`);
      const { links, name } = JSON.parse(out.text);
      console.log(links.join('\n'));
      if (name) console.log(`\nThe device that opens it is ${name} in this lab.`);
      console.log('\nOne use, ten minutes. Over wifi this is plain http: it keeps strangers out, it does not hide the page from someone listening to the network.');
      process.exit(0);
    }

    if (cmd === 'wait') {
      const status = await listen();
      process.exit(status < 300 || status === 409 || status === 410 || status === 423 ? 0 : 1);
    }

    // The agent's own pin on a spot: a suggestion or a question about the page, where a person would have pinned it.
    // The widget finds the element by its selector and draws the pin with labit's mark (it has a session: the agent's).
    // One pin: pin <selector> "text" [--quote "words"] [--question | --choice A --choice B [--recommend B]] [--at x,y];
    // many: pin --file points.json; on a board: pin --board <name> [--frame b] <selector|-> "text".
    if (cmd === 'pin' && !settle) {
      const usage = `${CMD} pin <selector> "text" [--page /path] | pin --file points.json | pin --board <name> --frame <id> <selector> "text"`;
      type Point = { selector?: string; text?: string; quote?: string; at?: unknown; page?: unknown; question?: boolean; choices?: unknown; recommend?: unknown };
      let points: Point[];
      if (opts.file !== undefined) {
        if (typeof opts.file !== 'string') die('--file takes a JSON file.');
        if (ref || words.length) die('--file holds the pins: no selector or text on the command line.');
        const each = ['quote', 'at', 'question', 'choice', 'recommend'].filter((k) => opts[k] !== undefined);
        if (each.length) die(`${each.map((k) => `--${k}`).join(', ')} go on a single pin: in --file put them in each pin's own entry.`);
        let list: unknown;
        try {
          list = JSON.parse(fs.readFileSync(path.resolve(opts.file), 'utf8'));
        } catch (e) {
          die(`Could not read ${opts.file}: ${(e as Error).message}`);
        }
        if (!Array.isArray(list) || !list.length || list.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) die(`${opts.file} must be a list of pins: [{ "selector", "text" }, …]`);
        if ((list as unknown[]).length > 50) die('At most 50 pins in one file.');
        points = list as Point[];
      } else {
        let selector = (ref || '').trim();
        let said = words;
        // On a board a pin may be on no element: with one word left over, it is the text.
        if (opts.board !== undefined && !words.length && selector) [selector, said] = ['', [ref]];
        else if (selector === '-') selector = '';
        points = [{ selector, text: said.join(' '), quote: opts.quote, at: opts.at, question: opts.question === true, choices: Array.isArray(opts.choice) ? opts.choice : undefined, recommend: opts.recommend }];
      }

      let browser = false; // whether a browser has the lab open (said by the lab with its pages)
      let listed: ReturnType<typeof call> | undefined; // the lab's pages, asked once, however many pins
      async function pinPage(asked: unknown): Promise<string> {
        const got = await (listed ??= call('/_lab/pages', {}));
        browser = got.status < 300 && Boolean(JSON.parse(got.text).browser);
        const pages: { path: string; file: string; url: string }[] = got.status < 300 ? JSON.parse(got.text).pages || [] : [];
        const proxied = got.status < 300 && Boolean(JSON.parse(got.text).proxy);
        const list = () => pages.map((p) => p.path).join(', ') || 'none yet';
        if (asked === undefined || asked === true) {
          if (pages.length === 1 && !proxied) return pages[0].path;
          die(`Which page? Add --page /path. This lab's pages: ${list()}.`);
        }
        let want = String(asked).trim();
        try {
          if (/^https?:\/\//.test(want)) want = new URL(want).pathname;
        } catch {}
        try {
          want = decodeURIComponent(want);
        } catch {}
        const bare = want.replace(/^\/+|\/+$/g, '');
        const pathOf = (u: string) => {
          try {
            return decodeURIComponent(new URL(u).pathname).replace(/^\/+|\/+$/g, '');
          } catch {
            return null;
          }
        };
        // A folder's address is its index page; anything else is keyed the way the lab keys it (lib/labs.ts). Behind a
        // dev server any address is a page (the lab lists only those with pins): its key is the answer.
        const key = keyFor((bare.replace(/\.html?$/i, '') || 'index').split('/').join(path.sep));
        if (proxied) return key;
        const asIndex = keyFor(`${bare}/index`.split('/').join(path.sep));
        const hit = pages.find((p) => [want, '/' + bare, key, asIndex].includes(p.path) || (p.file && p.file === bare) || pathOf(p.url) === bare);
        if (hit) return hit.path;
        die(`No page ${want} in this lab. Its pages: ${list()}.`);
      }

      const notes = new Set<string>();
      const who = process.env.LAB_AGENT_NAME || session.agent;
      const name = `${who}${session.name !== session.agent ? ` · ${session.name}` : ''}`;
      // --at: shares of the element (0 to 1), or pixels on a board.
      const at = (v: unknown, px = false) => {
        const m = /^\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*$/.exec(String(v));
        const n = m ? [Number(m[1]), Number(m[2])] : [];
        if (n.length < 2 || (px ? n.some((x) => x % 1) : n.some((x) => x < 0 || x > 1))) return die(`--at takes x,y ${px ? 'in pixels (from the frame\'s top left, or the board\'s origin): --at 40,120' : 'as shares of the element, each 0 to 1: --at 0.5,0.5'}.`);
        return n;
      };

      // Each pin is checked and made ready before any is saved, so a file with one wrong selector leaves nothing half done.
      const ready = [];
      for (const [i, pt] of points.entries()) {
        const fail = (msg: string): never => die((points.length > 1 ? `Pin ${i + 1}: ` : '') + msg);
        const text = typeof pt.text === 'string' ? pt.text.trim() : '';
        const selector = typeof pt.selector === 'string' ? pt.selector.trim() : '';
        const { board, frame } = opts as { board?: string; frame?: string };
        if (!selector && !board) fail(`Say where: ${usage}`);
        if (!text) fail(`Pin text is missing: ${CMD} pin ${selector || '<selector>'} "<point>"`);
        if (pt.quote !== undefined && (typeof pt.quote !== 'string' || !pt.quote.trim())) fail('--quote takes the exact words.');
        if (pt.quote && !selector) fail('--quote goes with a selector.');
        let asked: { choices: string[]; recommend?: number } | undefined;
        if (pt.choices !== undefined || pt.recommend !== undefined) {
          const c = replyChoices({ choice: pt.choices, recommend: pt.recommend });
          if (c instanceof Error) fail(c.message);
          asked = c as { choices: string[]; recommend?: number } | undefined;
        }

        // Where the pin goes: a page of the lab, or a board (and one of its frames).
        let page = '';
        let spot: Record<string, unknown> = {};
        if (board) {
          const b = readBoard(dir, board) || fail(`No board ${board}. See: ${CMD} board list`);
          const ids = b.frames.map((x) => x.id).join(', ');
          const f = frame ? b.frames.find((x) => x.id === frame) || fail(`No frame ${frame} on board ${board} (its frames: ${ids}).`) : null;
          if (!frame && selector) fail(`A pin on an element of a board names its frame: --frame <id> (its frames: ${ids}).`);
          if (!f || !selector) {
            // On the board itself (--at: pixels from its origin) or on a frame (from its top left).
            const [px, py] = pt.at === undefined && f ? [24, 24] : pt.at === undefined ? fail('A pin on the board itself needs --at x,y in pixels from its origin (or --frame <id>).') : at(pt.at, true);
            page = `/_board/${board}`;
            if (b.of) page = JSON.parse((await call('/_lab/api/board', { action: 'list', name: board })).text).home || page; // a board about a page is pinned on that page
            spot = { kind: 'board', board, ...(f ? { frame: f.id, fx: px, fy: py } : { bx: px, by: py }), selector: '', x: 0, y: 0, docX: 0, docY: 0 };
          } else if (f.src.startsWith('/_lab/')) {
            // A variant of the board: its own page.
            page = `/_board/${board}/${f.id}`;
            spot = { board, frame: f.id };
          } else {
            // A frame that is a page of the lab: the pin goes on that page, with the board and frame it was made on.
            page = await pinPage(f.src.split(/[?#]/)[0]);
            spot = { board, frame: f.id };
          }
        } else {
          page = await pinPage(pt.page === undefined ? opts.page : pt.page);
        }

        let [x, y] = [0.5, 0.5];
        if (selector && pt.at !== undefined) [x, y] = at(pt.at);
        let anchor: Record<string, unknown> = selector ? { kind: 'element', selector, x, y, ...spot } : spot;

        // The words of a text pin: the browser finds them in the element (and says when it cannot).
        if (pt.quote) anchor = { ...anchor, kind: 'text', quote: { exact: String(pt.quote).replace(/\s+/g, ' ').trim().slice(0, 300), prefix: '', suffix: '' } };
        ready.push({ page, selector, text, anchor, asked, question: pt.question === true || Boolean(asked) });
      }

      const ids: string[] = [];
      // Each pin is printed as it is saved, so a batch cut short (a refused pin, the lab gone) shows what was saved before it.
      for (const r of ready) {
        const res = await call('/_lab/api/comments', {
          page: r.page, name, text: r.text, anchor: r.anchor, nonce: nonceOf(r.page, r.selector, r.text, JSON.stringify(r.anchor), JSON.stringify([r.asked, r.question])),
          ...(r.question ? { intent: 'question' } : {}), ...r.asked,
        });
        if (res.status >= 300) die(`Could not pin${ready.length > 1 ? ` ${ids.length + 1} (${ids.length} of ${ready.length} saved: run it again, the saved ones are not made twice)` : ''}: ${res.text}`);
        const { comment } = JSON.parse(res.text);
        const words = r.anchor.quote ? ` (on the words "${(r.anchor.quote as { exact: string }).exact}")` : '';
        const asks = r.asked ? ` (asks: ${r.asked.choices.map((c, n) => `${letter(n)}) ${c}`).join('  ')}${r.asked.recommend !== undefined ? `; your pick: ${letter(r.asked.recommend)}` : ''})` : r.question ? ' (a question)' : '';
        ids.push(comment.id);
        console.log(`Pinned ${comment.id} on ${r.page}${r.selector ? ` at ${r.selector}` : ' on the board'}${words}${asks}.`);
      }
      // The selector is checked by a browser: the page draws each pin and marks it when the selector matches nothing (or fills in
      // what is there). With a browser open this waits up to 3 s for that; a pin it has not answered is saved unchecked.
      const check = ready.map((r, n) => [r, ids[n]] as const).filter(([r]) => r.selector && !r.anchor.board);
      if (check.length && !opts['no-check']) {
        if (!browser) notes.add('No browser has the lab open: selector not checked.');
        else {
          const answer = (id: string) => {
            const store = path.join(dir, '.lab/comments');
            for (const f of fs.existsSync(store) ? fs.readdirSync(store) : [])
              try {
                const c = JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')).comments?.[id];
                if (c) return c.unmatched ? 1 : c.anchor?.element ? 2 : 0;
              } catch {}
            return 0;
          };
          for (let t = 0; t < 10 && check.some(([, id]) => !answer(id)); t++) await new Promise((r) => setTimeout(r, 300));
          const slow = check.filter(([, id]) => !answer(id)).map(([, id]) => id);
          if (slow.length) notes.add(`No browser answered in 3 s for ${slow.join(', ')}: saved unchecked.`);
          for (const [r, id] of check) if (answer(id) === 1) notes.add(UNMATCHED(id, r.page, r.selector));
        }
      }
      for (const n of notes) console.log(`Note: ${n}`);
      process.exit(0);
    }

    // A comment by its id (of the thread or of a reply in it) or by the number on its card.
    // The store: one file per page in .lab/comments/.
    const data = {};
    const store = path.join(dir, '.lab/comments');
    if (fs.existsSync(store))
      for (const name of fs.readdirSync(store).filter((n) => n.endsWith('.json'))) {
        try {
          const file = JSON.parse(fs.readFileSync(path.join(store, name), 'utf8'));
          if (typeof file.page === 'string' && file.comments) data[file.page] = file.comments;
        } catch {} // a file half written or put aside: the others still count
      }
    const want = opts.page ? '/' + opts.page.replace(/^\/+/, '') : null;
    let hit = null;
    // A reply's id: the answer goes in its thread, and says which message it answers (shown as a quote, as in chat).
    for (const [page, list] of Object.entries(data)) if (list[ref]) hit = { page, id: list[ref].parent || ref, to: list[ref].parent ? ref : '' };
    if (!hit && /^\d+$/.test(ref || '')) {
      const hits = Object.entries(data)
        .filter(([page]) => !want || page === want)
        .map(([page, list]) => {
          const all = Object.values(list) as any[];
          const pin = all.find((c) => !c.parent && !c.resolved && numberOf(c, all) === Number(ref));
          return pin && { page, id: pin.id };
        })
        .filter(Boolean);
      if (hits.length > 1) die(`Comment ${ref} is on several pages (${hits.map((h) => h.page).join(', ')}). Add --page <path>.`);
      hit = hits[0];
    }
    if (!hit) die(`No open comment ${ref || ''}${want ? ` on ${want}` : ''}. See .lab/comments.md.`);
    // pin move / pin gone: the agent that changed the page settles a pin the page was unsure of (its words changed, a copy,
    // a spot that cannot be told). move puts it on the element <selector> finds (and --quote on words in it); gone says
    // its spot has been removed: the page draws a ghost where it stood. Nothing is told to the agent about it again.
    if (settle) {
      const pin = data[hit.page]?.[hit.id] as { anchor?: Record<string, unknown> } | undefined;
      const old = pin?.anchor || {};
      if (old.kind === 'page' || old.kind === 'board') die(`That pin is on the ${old.kind === 'page' ? 'page as a whole' : 'board'}: it has no element to ${settle === 'gone' ? 'mark gone' : 'move'}.`);
      let anchor: Record<string, unknown>;
      if (settle === 'gone') {
        if (words.length) die(`${CMD} pin gone <id> takes no more words.`);
        anchor = { ...old, gone: true };
      } else {
        if (words.length !== 1 || !words[0].trim()) die(`Say where: ${CMD} pin move <id> <selector> [--quote "words"] [--page /path]`);
        if (opts.quote !== undefined && (typeof opts.quote !== 'string' || !opts.quote.trim())) die('--quote takes the exact words.');
        const exact = typeof opts.quote === 'string' ? opts.quote.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        const { board, frame, docX, docY } = old;
        anchor = { kind: exact ? 'text' : 'element', selector: words[0].trim(), x: 0.5, y: 0.5, docX, docY, board, frame, ...(exact ? { quote: { exact, prefix: '', suffix: '' } } : {}) };
      }
      const out = await call('/_lab/api/comments', { page: hit.page, action: 'move', id: hit.id, anchor });
      if (out.status >= 300) die(`Could not ${settle === 'gone' ? 'mark it gone' : 'move it'}: ${out.text}`);
      console.log(settle === 'gone' ? `Marked gone on ${hit.page}: the page shows a ghost where it stood. Answer it as usual (${CMD} reply ${hit.id} --done).` : `Moved to ${anchor.selector} on ${hit.page}: a browser with the page open finds it there.`);
      process.exit(0);
    }
    // --progress: the line the page shows while you work, kept on the thread (the latest only), not a message.
    const progress = cmd === 'reply' && opts.progress !== undefined;
    if (progress) {
      if (typeof opts.progress !== 'string' || !opts.progress.trim()) die(`Progress text is missing: ${CMD} reply <id> --progress "what you're on now"`);
      if (words.length || opts.done || opts['on-it'] || opts.question || opts.resolve) die('--progress is only the line, with no answer text, --done, --on-it, --question or --resolve: those are answers, and an answer clears it.');
      const out = await call('/_lab/api/comments', { page: hit.page, action: 'progress', id: hit.id, text: opts.progress });
      if (out.status >= 300) die(`Could not note progress: ${out.text}`);
    } else if (cmd === 'reply') {
      if (!words.length) die(`Reply text is missing: ${CMD} reply <id> "what you did"`);
      let intent = replyIntent(opts);
      if (intent instanceof Error) die(intent.message);
      // A question with choices (--choice "…" --choice "…" [--recommend B]): the person picks one on the page, and the
      // pick comes back in a wait as their reply ("Picked B: …"). It is a question, whatever else it says.
      const choices = replyChoices(opts);
      if (choices instanceof Error) return die(choices.message);
      const asked = choices;
      if (asked && intent && intent !== 'question') die(`A reply with --choice is a question; leave out --${intent === 'working' ? 'on-it' : intent}.`);
      if (asked && opts.resolve) die('A reply with --choice waits for the person to pick; leave out --resolve.');
      if (asked) intent = 'question';
      // --checked "<how>": the agent looked at what it did (the page at a width, a test run); a done answer without it shows
      // as not checked (#425). Only with --done: on it, a question or a pick isn't a result.
      if (opts.checked !== undefined && (typeof opts.checked !== 'string' || !opts.checked.trim())) die('--checked takes how you looked: --checked "opened /pricing at 390 px"');
      if (opts.checked !== undefined && intent !== 'done') die('--checked goes with --done: it says how you checked the result.');
      const said = Object.values(((data as Record<string, object>)[hit.page] || {}) as Record<string, { id: string; parent?: string; session?: unknown; createdAt: string }>)
        .filter((c) => (c.id === hit.id || c.parent === hit.id) && !c.session)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .pop()?.id;
      const out = await call('/_lab/api/comments', { page: hit.page, parent: hit.id, nonce: nonceOf(hit.page, hit.id, hit.to, said, words.join(' ')), ...(hit.to ? { to: hit.to } : {}), name: signed(), text: words.join(' '), ...(typeof opts['suggest-rule'] === 'string' ? { suggest: opts['suggest-rule'] } : {}), ...(intent ? { intent } : {}), ...(typeof opts.checked === 'string' ? { checked: opts.checked } : {}), ...asked });
      if (out.status >= 300) die(`Could not reply: ${out.text}`);
      // The page tries each choice in place of the quoted words: a choice that reaches past them is said here.
      if (asked) for (const note of choiceSpills(data[hit.page]?.[hit.id]?.anchor?.quote, asked.choices)) console.log(`Note: ${note}`);
      // A note on no words (a spot or an element) has nothing to put them in: the choices show as rows, nothing is tried.
      if (asked && !data[hit.page]?.[hit.id]?.anchor?.quote?.exact) console.log('Note: this note has no quoted words, so the choices show as rows and nothing is tried in the page.');
      if (asked) console.log(`Asked with ${asked.choices.map((c, i) => `${letter(i)}) ${c}${asked.hints?.[i] ? ` (${asked.hints[i]})` : ''}`).join('  ')}${asked.recommend !== undefined ? `  (your pick: ${letter(asked.recommend)})` : ''}. The pick comes back in your next wait: make that change, then ${CMD} resolve <id> with no words (words only if something is not obvious or you could not do it).`);
    }
    if (cmd === 'resolve' || opts.resolve) {
      const out = await call('/_lab/api/comments', { page: hit.page, action: 'resolve', id: hit.id });
      if (out.status >= 300) die(`Could not resolve: ${out.text}`);
    }
    console.log(`${progress ? 'Progress noted' : cmd === 'reply' ? (opts.resolve ? 'Replied and resolved' : 'Replied') : 'Resolved'} on ${hit.page}.`);
    // --wait: answer and listen again in one command (one round trip less per pin). It listens where --page or
    // --pages says, as wait does: `reply <id> --wait --page /x` used to listen on every page but /x's claim, so a
    // session listening on one page stopped hearing it after its first answer (Leo, 18 Nov).
    if (opts.wait) await listen();
    process.exit(0);
  }
}
