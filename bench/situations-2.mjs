// Batch 2 of the situations: 32 more kinds of comment that batch 1 does not have (text that is not in the page's HTML
// as you read it, code blocks built in other ways, pictures that are moved, cut or animated, videos that play, and
// pages built from parts). Run by situations.mjs: NODE_PATH=<folder with playwright> node bench/situations.mjs --batch 2
// An agent answering bench/situations-2-task.md must not read this file.
import fs from 'node:fs';
import path from 'node:path';

export default function batch2({ lineOf, fit, mid, centreOf, field, has, HERE }) {
  const json = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
  // The clips on the film page are the two from batch 1 (other moments of them); the rest is new.
  const media = { ...json('situations-2-media.json'), 'tour.webm': json('situations-media.json')['tour.webm'], 'new-event.webm': json('situations-media.json')['new-event.webm'] };
  const sizeOf = (f) => [media[f].width, media[f].height];
  const A = 'b2-account.html', W = 'b2-world.html', G = 'b2-guide.html', I = 'b2-integrations.html';
  const first = (b) => b.split('\n').find((l) => /^(on|text|element|element text|spot)\b/.test(l)) || '';
  const need = {
    // Words that are on the screen but not in the page's own text: are they in the block at all?
    // got: the line that has them, else what the pin is on.
    says: (words, what) => (b) => {
      const line = b.split('\n').find((l) => l.includes(words));
      return [what, Boolean(line), line ?? `${field(b, 'element')}${field(b, 'element text') ? ` · element text ${field(b, 'element text')}` : ''}`];
    },
    chosen: (option) => (b) => ['it says which option of the list is chosen', field(b, 'element text') === `"${option}"` || new RegExp(`^(value|chosen|selected)[^:\\n]*: .*${option}`, 'm').test(b), `element text ${field(b, 'element text')}`],
    notOn: (part) => (b) => [`the pin is not on something else (${part})`, !field(b, 'element').includes(part), field(b, 'element')],
  };
  // The middle of a thing in a picture or video, on the screen.
  const onScreen = (b, f, box, mode, px, py) => fit(b, sizeOf(f), mode, px, py).screen(...mid(box));
  const visible = (w, sel) => w.page.locator(sel).first().waitFor({ state: 'visible' });
  const press = async (w, sel) => { await w.click(...centreOf(await w.$('box', sel, 0.5, 0.5, false))); await w.page.waitForTimeout(150); };

  const situations = {
    '/sit/b2-account': [
      {
        id: 'other-two-pins-close-a', group: 'other', comment: 'bigger, this is the number people look for',
        tests: 'two comments a few pixels apart on two elements (old price and new price, side by side; the next plan has the same pair): the new price',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#plan .plan-card:nth-of-type(1) .now', '€12')));
          return { expect: { file: A, lines: [lineOf(A, '<b class="now">€12</b>')], words: '€12' }, needs: [has.quote('€12'), has.element('<b class="now">')] };
        },
      },
      {
        id: 'other-two-pins-close-b', group: 'other', comment: 'grey this out more, it fights with the real price',
        tests: 'the second of the two close comments: the old price, right next to the first pin',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#plan .plan-card:nth-of-type(1) .was', '€15')));
          return { expect: { file: A, lines: [lineOf(A, '<s class="was">€15</s>')], words: '€15' }, needs: [has.quote('€15'), has.element('<s class="was">')] };
        },
      },
      {
        id: 'text-css-order', group: 'text', comment: 'the first tile should say Active',
        tests: 'a grid where CSS order shows the fourth tile first; three tiles carry the same words, the pin is on the one shown first',
        async pin(w) {
          const sel = '#included .tile:nth-of-type(4)';
          const [shown, written] = [await w.$('box', sel), await w.$('box', '#included .tile:nth-of-type(1)', 0.5, 0.5, false)];
          if (!(shown.x < written.x)) throw new Error('the fourth tile is not shown first: check .tile.featured { order }');
          await w.click(...centreOf(await w.$('word', `${sel} .status`, 'Included')));
          return { expect: { file: A, lines: [lineOf(A, 'Included in your plan', 3)], words: 'Included' }, needs: [has.quote('Included'), has.selector('article:nth-of-type(4)')] };
        },
      },
      {
        id: 'text-pseudo-content', group: 'text', comment: 'this label should say Preview',
        tests: 'point on a label that CSS adds after a heading (::after content); the word is in the stylesheet, and once in the page as ordinary text',
        async pin(w) {
          const t = await w.$('word', '#included .tile:nth-of-type(3) h3', 'Insights');
          await w.click(t.x + t.width + 10 + 22, t.y + t.height / 2); // 10 px margin, then the pill
          return { expect: { file: 'b2.css', lines: [lineOf('b2.css', '.is-beta::after {', 2), lineOf('b2.css', 'content: "Beta";')], words: 'Beta' }, needs: [need.says('Beta', 'the label under the pin ("Beta") is in the text')] };
        },
      },
      {
        id: 'text-ellipsis', group: 'text', comment: 'the name is cut off here, let it run over two lines',
        tests: 'point on the “…” of a title cut with text-overflow: ellipsis; another row shows the very same words, they differ only in the hidden part',
        async pin(w) {
          const b = await w.$('box', '#week li:nth-of-type(4) .title');
          await w.click(b.x + b.width - 7, b.y + b.height / 2);
          return { expect: { file: A, lines: [lineOf(A, 'Lisbon office')] }, needs: [has.selector('li:nth-of-type(4)')] };
        },
      },
      {
        id: 'text-long-url-wrapped', group: 'text', comment: 'nobody should have to copy this part by hand',
        tests: 'point on the last line of a 150-character address that wraps over three lines; a second address is the same up to its last characters',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#feeds li:nth-of-type(2) code', 'alarms=off')));
          return { expect: { file: A, lines: [lineOf(A, 'alarms=off')] }, needs: [has.selector('li:nth-of-type(2)')] };
        },
      },
      {
        id: 'text-dropdown-menu-item', group: 'text', comment: 'call this Copy invite link',
        tests: 'Option-click on an item of a menu that opens on click; the Export menu next to it has an item with the same words',
        async pin(w) {
          await w.$('box', '#sharing');
          await press(w, '#sharing .menu-wrap:nth-of-type(2) button');
          await visible(w, '#sharing .menu-wrap:nth-of-type(2) .menu');
          await w.click(...centreOf(await w.$('word', '#sharing .menu-wrap:nth-of-type(2) .menu li:nth-of-type(2)', 'link', 0, false)), { alt: true });
          return { expect: { file: A, lines: [lineOf(A, 'data-action="copy">Copy link', 2)], words: 'link' }, needs: [has.quote('link'), has.element('role="menuitem"')] };
        },
      },
      {
        id: 'text-tooltip-on-hover', group: 'text', comment: 'we call them visitors now',
        tests: 'Option-click on a word in a hint that only shows while the pointer is over its label; the hint above starts with the same word',
        async pin(w) {
          await w.$('box', '#usage');
          const label = await w.$('word', '#usage dt:nth-of-type(2) .has-tip', 'Storage', 0, false);
          await w.page.mouse.move(...centreOf(label));
          await visible(w, '#usage dt:nth-of-type(2) .tip');
          const word = centreOf(await w.$('word', '#usage dt:nth-of-type(2) .tip', 'Guests', 0, false));
          await w.page.mouse.move(...word, { steps: 8 });
          await w.click(...word, { alt: true });
          return { expect: { file: A, lines: [lineOf(A, 'Guests can attach files too')], words: 'Guests' }, needs: [has.quote('Guests'), has.element('role="tooltip"')] };
        },
      },
      {
        id: 'text-select-option', group: 'text', comment: 'make this one the default for new workspaces',
        tests: 'Option-click on a closed dropdown after picking its fourth option; the other dropdown shows almost the same words',
        async pin(w) {
          const sel = '#defaults select[name="reminder"]';
          await w.$('box', '#defaults');
          await w.page.selectOption(sel, { label: '30 minutes before' });
          await w.click(...centreOf(await w.$('box', sel, 0.5, 0.5, false)), { alt: true });
          return { expect: { file: A, lines: [lineOf(A, '<option>30 minutes before</option>')] }, needs: [has.element('<select'), need.chosen('30 minutes before')] };
        },
      },
      {
        id: 'text-inside-details', group: 'text', comment: 'link these words to the page itself',
        tests: 'point on text inside a <details> the person opened; the same sentence is in another, closed one',
        async pin(w) {
          const sel = '#billing-faq details:nth-of-type(4)';
          await w.$('box', '#billing-faq');
          await w.click(...centreOf(await w.$('word', `${sel} summary`, 'contact', 0, false)));
          await visible(w, `${sel} p`);
          await w.click(...centreOf(await w.$('word', `${sel} p`, 'billing')));
          return { expect: { file: A, lines: [lineOf(A, 'The person who created the workspace.')], words: 'billing' }, needs: [has.quote('billing'), has.selector('details:nth-of-type(4)')] };
        },
      },
      {
        id: 'text-modal-dialog', group: 'text', comment: 'say how many people, not this word',
        tests: 'point on a word in a window over the page (position: fixed), opened from the bottom of the page; the page behind has the same words',
        async pin(w) {
          await w.$('box', '#danger');
          await press(w, '#delete-open');
          await visible(w, '#delete-dialog');
          await w.click(...centreOf(await w.$('word', '#delete-dialog p:nth-of-type(1)', 'everyone', 0, false)));
          return { expect: { file: A, lines: [lineOf(A, 'This removes 14 calendars')], words: 'everyone' }, needs: [has.quote('everyone.'), has.selector('#delete-dialog')] };
        },
      },
    ],
    '/sit/b2-world': [
      {
        id: 'text-rtl-arabic', group: 'text', comment: 'our translator flagged this word',
        tests: 'point on a word in right-to-left text (Arabic); the next sentence has the same word',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#voices figure:nth-of-type(1) p:nth-of-type(1)', 'اجتماع')));
          return { expect: { file: W, lines: [lineOf(W, 'ولم نفوّت أي اجتماع')], words: 'اجتماع' }, needs: [has.quote('اجتماع')] };
        },
      },
      {
        id: 'text-cjk-no-spaces', group: 'text', comment: 'wrong term here, check with the Tokyo office',
        tests: 'point on a two-character word in a Japanese sentence (no spaces between words)',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#voices figure:nth-of-type(2) p:nth-of-type(1)', '調整')));
          return { expect: { file: W, lines: [lineOf(W, '会議の調整')], phrase: '調整' }, needs: [has.quote('調整')] };
        },
      },
    ],
    '/sit/b2-invite': [
      {
        id: 'text-i18n-strings-file', group: 'text', comment: 'too stiff, say Team here',
        tests: 'the page is shown in German from locales/de.json (the HTML holds the English words); the same German word is under two keys',
        async pin(w) {
          await w.page.waitForFunction(() => document.querySelector('#members h2').textContent === 'Mitglieder');
          await w.click(...centreOf(await w.$('word', '#members h2', 'Mitglieder')));
          return { expect: { file: 'locales/de.json', lines: [lineOf('locales/de.json', '"title": "Mitglieder"')], words: 'Mitglieder' }, needs: [has.quote('Mitglieder'), has.element('data-i18n="invite.members.title"')] };
        },
      },
    ],
    '/sit/b2-guide': [
      {
        id: 'code-diff-added-line', group: 'code', comment: 'log this before the loop, not after it',
        tests: 'an added line in a diff with two hunks; the file has the same line a second time, further down',
        async pin(w) {
          const f = 'src/calendar/invite.ts';
          await w.click(...centreOf(await w.$('word', '#invites pre code', 'audit.log')));
          const inBlock = await w.page.evaluate(() => document.querySelector('#invites pre').textContent.split('\n').findIndex((l) => l.startsWith('+  await audit.log')) + 1);
          return { expect: { file: f, lines: [lineOf(f, "await audit.log('invites.sent', sent.length);", 1)] }, needs: [has.codeLine(f, inBlock)] };
        },
      },
      {
        id: 'code-line-numbers-excerpt', group: 'code', comment: 'guard against a step of zero here',
        tests: 'a table with its own line-number column that shows lines 34 to 51 of a file; the same line is also at line 13 of the file',
        async pin(w) {
          const f = 'src/calendar/recurrence.ts';
          await w.click(...centreOf(await w.$('word', '#repeats .code-table', 'stepOf')));
          return { expect: { file: f, lines: [lineOf(f, 'const step = stepOf(rule);', 2)] }, needs: [has.file(f), has.selector('tr:nth-of-type(5)'), has.codeLine(f, lineOf(f, 'const step = stepOf(rule);', 2))] };
        },
      },
      {
        id: 'code-lines-as-elements', group: 'code', comment: 'this early return hides a bug',
        tests: 'a block printed the way Docusaurus does (one element per line, ending in <br>, no newline characters): the second of two identical lines',
        async pin(w) {
          const f = 'src/calendar/timezone.ts';
          await w.click(...centreOf(await w.$('word', '#zones pre code', 'allDay', 1)), { alt: true }); // the block can take focus (tabindex), like a control
          return { expect: { file: f, lines: [lineOf(f, 'if (event.allDay) return false;', 2)] }, needs: [has.codeLine(f, lineOf(f, 'if (event.allDay) return false;', 2))] };
        },
      },
      {
        id: 'code-below-folded-part', group: 'code', comment: 'count the ones we skip here',
        tests: 'a line below a folded function; the hidden lines hold the same line',
        async pin(w) {
          const f = 'src/calendar/reminders.ts';
          await w.click(...centreOf(await w.$('word', '#reminders pre code', '!at', 1)));
          return { expect: { file: f, lines: [lineOf(f, 'if (!at) continue;', 2)] }, needs: [has.codeLine(f, lineOf(f, 'if (!at) continue;', 2))] };
        },
      },
      {
        id: 'code-folded-part-itself', group: 'code', comment: 'open this by default, it is the part people look for',
        tests: 'Option-click on the “⋯ 8 lines” button of a folded function: the comment is about the hidden lines',
        async pin(w) {
          const f = 'src/calendar/reminders.ts';
          await w.click(...centreOf(await w.$('box', '#reminders .fold')), { alt: true });
          // The hidden lines only: after the line with the button, up to the last one in the fold.
          return { expect: { file: f, lines: [lineOf(f, 'export function digest(') + 1, lineOf(f, 'return `Tomorrow:')] }, needs: [has.codeLine(f, lineOf(f, 'export function digest('))] };
        },
      },
    ],
    '/sit/b2-about': [
      {
        id: 'photo-css-rotated', group: 'photos', comment: 'crop this out, it pulls the eye away',
        tests: 'point on a small thing in a picture that is turned 8 degrees with a CSS transform',
        async pin(w) {
          const f = 'b2-offsite.jpg', box = media[f].boxes.kite, at = [1010, 130]; // the kite itself, above its tail
          const xy = await w.page.evaluate(([fx, fy]) => {
            const el = document.querySelector('#offsite .tilted');
            const b = el.getBoundingClientRect();
            scrollBy(0, b.top + b.height / 2 - innerHeight / 2);
            const r = el.getBoundingClientRect();
            const p = new DOMMatrix(getComputedStyle(el).transform).transformPoint(new DOMPoint((fx - 0.5) * el.offsetWidth, (fy - 0.5) * el.offsetHeight));
            return [r.x + r.width / 2 + p.x, r.y + r.height / 2 + p.y];
          }, at.map((v, i) => v / sizeOf(f)[i]));
          await w.click(...xy);
          return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('b2-offsite'), has.spot(box)] };
        },
      },
      {
        id: 'photo-svg-image', group: 'photos', comment: 'this room has a new name, the picture is out of date',
        tests: 'point on a room of a floor plan: a PNG shown with <image> inside an inline SVG, with SVG text and a marker on top',
        async pin(w) {
          const f = 'b2-floor-plan.png', box = media[f].boxes['meeting-b'], [px, py] = mid(box);
          const at = [(40 + (px / 1600) * 880) / 960, (20 + (py / 1000) * 550) / 640]; // <image x="40" y="20" width="880" height="550"> in viewBox 960×640
          const b = await w.$('box', '#office svg.floor', ...at);
          await w.click(b.x + at[0] * b.width, b.y + at[1] * b.height);
          return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.element('b2-floor-plan'), has.spot(box)] };
        },
      },
      {
        id: 'photo-carousel-slide', group: 'photos', comment: 'swap this shape for our logo',
        tests: 'point on slide 3 of 5 after pressing “next” twice; every slide has another thing in that place',
        async pin(w) {
          const f = 'b2-slide-3.jpg', box = media[f].boxes['right-diamond'];
          await w.$('box', '#shipped-carousel');
          for (let i = 0; i < 2; i++) { await press(w, '#shipped-carousel .next'); await w.page.waitForTimeout(450); }
          const b = await w.$('box', '#shipped-carousel .track img:nth-of-type(3)', 0.5, 0.5, false);
          await w.click(...onScreen(b, f, box));
          return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('b2-slide-3'), has.spot(box)] };
        },
      },
      {
        id: 'photo-sprite-icon', group: 'photos', comment: 'the clapper is missing on this one',
        tests: 'Option-click on one icon of a sheet (one PNG, background-position per icon, shown at half size): the blue bell, second row',
        async pin(w) {
          const f = 'b2-icons.png', box = media[f].boxes['bell-picked'];
          await w.click(...centreOf(await w.$('box', '#brand .tool.picked .ico')), { alt: true });
          return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('b2-icons'), has.spot(box)] };
        },
      },
      {
        id: 'photo-animated-gif', group: 'photos', comment: 'this colour is too close to the one before it',
        gap: 'a page can’t read which frame of an animated picture is showing (a canvas copy is always the first frame); the text gives only a rough time since it loaded',
        tests: 'point on an animated GIF while its third state shows (4 to 6 s of an 8 s loop); the same place says something else in the other three',
        async pin(w) {
          const f = 'b2-sync.gif', box = media[f].boxes['status-chip'];
          const b = await w.$('box', '#sync img.clip');
          const [x, y] = onScreen(b, f, box);
          const probe = fit(b, sizeOf(f)).screen(box[0] + 9, (box[1] + box[3]) / 2); // on the chip, left of its words
          // Wait for the green chip (“Synced”), the way a person waits for the moment they mean.
          for (let i = 0; ; i++) {
            const png = (await w.page.screenshot({ clip: { x: probe[0] - 1, y: probe[1] - 1, width: 3, height: 3 } })).toString('base64');
            const [r, g, bl] = await w.page.evaluate(async (data) => {
              const c = new OffscreenCanvas(1, 1).getContext('2d');
              c.drawImage(await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob()), -1, -1);
              return [...c.getImageData(0, 0, 1, 1).data];
            }, png);
            if (g > r + 40 && g > bl + 20) break;
            if (i > 200) throw new Error('the GIF never showed its green state');
            await w.page.waitForTimeout(120);
          }
          await w.click(x, y);
          return { expect: { file: `media/${f}`, size: sizeOf(f), box, from: 4, to: 6 }, needs: [has.file('b2-sync'), has.spot(box), has.time(4, 6)] };
        },
      },
      {
        id: 'photo-lazy-loaded', group: 'photos', comment: 'this crate looks half empty, pick another shot',
        tests: 'point on a picture far down that loads late: the tag names a tiny placeholder file, a script swaps in the real one',
        async pin(w) {
          const f = 'b2-market.jpg', box = media[f].boxes.lemons;
          await w.$('box', '#market img');
          await w.page.waitForFunction(() => { const i = document.querySelector('#market img'); return i.complete && i.naturalWidth === 1800; });
          const b = await w.$('box', '#market img', ...mid(box).map((v, i) => v / sizeOf(f)[i]));
          await w.click(...onScreen(b, f, box));
          return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('b2-market'), has.spot(box)] };
        },
      },
    ],
    '/sit/b2-about#phone': [
      {
        id: 'photo-picture-art-direction', group: 'photos', comment: 'straighten this, it hangs crooked',
        tests: 'tap on a <picture> on a phone: the phone gets another crop (another file, other pixels) than the desktop; the <img> tag names a third file',
        async pin(w) {
          const f = 'b2-team-tall.jpg', box = media[f].boxes.clock;
          await w.page.waitForFunction(() => { const i = document.querySelector('#team picture img'); return i.complete && i.currentSrc.endsWith('b2-team-tall.jpg'); });
          const b = await w.$('box', '#team picture img', ...mid(box).map((v, i) => v / sizeOf(f)[i]));
          await w.tap(...onScreen(b, f, box));
          return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('b2-team-tall'), has.spot(box)] };
        },
      },
    ],
    '/sit/b2-film': [
      {
        id: 'video-background-loop', group: 'video', comment: 'too playful for us, cut this part of the loop',
        tests: 'point on a looping background video (no controls, cropped with object-fit: cover, a heading on top) while it plays; the thing is there from 4 to 6 s',
        async pin(w) {
          const f = 'b2-harbour-loop.webm', box = media[f].scenes[4].boxes.balloon;
          const b = await w.$('box', '#calm .bg');
          await w.page.waitForFunction(() => { const t = document.querySelector('#calm .bg').currentTime; return t >= 4.25 && t <= 5.2; }, null, { polling: 40, timeout: 30000 });
          await w.click(...onScreen(b, f, box, 'cover'));
          return { expect: { file: `media/${f}`, size: sizeOf(f), box, from: 4, to: 6 }, needs: [has.file('b2-harbour-loop'), has.spot(box), has.time(4, 6)] };
        },
      },
      {
        id: 'video-double-speed', group: 'video', comment: 'this field needs a label you can see',
        tests: 'point on a video while it plays at double speed (the page’s own Play button, no controls); the dialog is on screen from 3 to 6 s of the file',
        async pin(w) {
          const f = 'tour.webm', box = media[f].scenes[4].boxes['modal-title'];
          const b = await w.$('box', '#fast-video');
          await press(w, '#fast-play');
          await w.page.waitForFunction(() => { const t = document.querySelector('#fast-video').currentTime; return t >= 3.7 && t <= 4.6; }, null, { polling: 30, timeout: 30000 });
          await w.click(...onScreen(b, f, box));
          return { expect: { file: `media/${f}`, size: sizeOf(f), box, from: 3, to: 6 }, needs: [has.file('tour'), has.spot(box), has.time(3, 6)] };
        },
      },
      {
        id: 'video-in-modal', group: 'video', comment: 'the typing stutters here, show it letter by letter',
        tests: 'Option-click on a video in a window over the page (position: fixed, <source> inside the tag), paused at 1.4 s: the field is half typed for that second only',
        async pin(w) {
          const f = 'new-event.webm', box = media[f].scenes[1].boxes['sheet-title'];
          await w.$('box', '#phone-clip');
          await press(w, '#clip-open');
          await visible(w, '#clip-box video');
          await w.seek('#clip-box video', 1.4);
          const b = await w.$('box', '#clip-box video', 0.5, 0.5, false);
          await w.click(...onScreen(b, f, box), { alt: true });
          return { expect: { file: `media/${f}`, size: sizeOf(f), box, from: 1, to: 2 }, needs: [has.file('new-event'), has.spot(box), has.time(1, 2)] };
        },
      },
    ],
    '/sit/b2-integrations': [
      {
        id: 'other-repeated-cards', group: 'other', comment: 'this one is hourly, not what it says',
        tests: 'twelve cards with the same line of text: the ninth',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#all .card:nth-of-type(9) .sync', '5')));
          return { expect: { file: I, lines: [lineOf(I, 'Syncs every 5 minutes', 9)], words: '5' }, needs: [has.quote('5'), has.selector('article:nth-of-type(9)')] };
        },
      },
      {
        id: 'other-scaled-container', group: 'other', comment: 'fifteen would give people time to walk over',
        tests: 'point on a word inside a preview shrunk with transform: scale(0.6); the same sentence is in the paragraph above and almost the same in the next message',
        async pin(w) {
          await w.click(...centreOf(await w.$('word', '#slack-preview .msg:nth-of-type(1) p:nth-of-type(1)', '10')));
          return { expect: { file: I, lines: [lineOf(I, '<p>Design review starts in 10 minutes</p>')], words: '10' }, needs: [has.quote('10'), has.selector('#slack-preview')] };
        },
      },
      {
        id: 'other-shadow-dom', group: 'other', comment: 'is this still true? ask marketing',
        tests: 'point on a word inside a web component (shadow root); its words are in the component’s script, not in the page',
        async pin(w) {
          const b = await w.page.evaluate(() => {
            const root = document.querySelector('tide-rating').shadowRoot;
            const node = [...root.querySelectorAll('.source')][0].firstChild;
            const r = document.createRange();
            r.setStart(node, node.data.indexOf('weekly'));
            r.setEnd(node, node.data.indexOf('weekly') + 6);
            let box = r.getBoundingClientRect();
            scrollBy(0, box.top - innerHeight / 2);
            box = r.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          });
          await w.click(...centreOf(b));
          return { expect: { file: 'b2-rating.js', lines: [lineOf('b2-rating.js', 'Collected by Capterra')], words: 'weekly' }, needs: [has.quote('weekly')] };
        },
      },
    ],
  };
  const windows = {
    '/sit/b2-invite': { name: 'Jonas', context: { locale: 'de-DE' } },
    '/sit/b2-about#phone': { name: 'Ines', context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  };
  // SHOTS=<folder>: a picture of the window after each pin is placed (the draft pin shows where), to check by eye.
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    for (const s of Object.values(situations).flat()) {
      const pin = s.pin;
      s.pin = async (w) => { const out = await pin(w); await w.page.waitForTimeout(300); await w.page.screenshot({ path: path.join(process.env.SHOTS, `${s.id}.png`) }); return out; };
    }
  }
  return { situations, windows };
}
