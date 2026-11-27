// Makes the pictures, the animated GIF and the video for batch 2 of the situations (bench/situations/media/b2-*),
// with known things at known pixels, and writes where they are to bench/situations-2-media.json
// (part of the truth: an answering agent must not read it, or this file).
// Run once (the results are committed): NODE_PATH=<folder with playwright> node bench/situations-2-media.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MEDIA = path.join(HERE, 'situations/media');
fs.mkdirSync(MEDIA, { recursive: true });

// A flat illustration: an SVG world, seen through a viewBox (x y w h), rendered at w×h pixels.
const svgPage = (w, h, view, body) => `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${view}" preserveAspectRatio="none" style="display:block;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif">${body}</svg>`;

// ---------- the office (2400×1600 world): cropped three ways for <picture> art direction ----------
const person = (id, x, y, shirt, hair) => `<g data-box="${id}"><rect x="${x - 70}" y="${y}" width="140" height="330" rx="50" fill="${shirt}"/><circle cx="${x}" cy="${y - 70}" r="70" fill="#e9b98f"/><path d="M${x - 70} ${y - 80} a70 70 0 0 1 140 0 z" fill="${hair}"/></g>`;
const office = `
  <rect width="2400" height="1600" fill="#efe9dd"/><rect y="1250" width="2400" height="350" fill="#c9b79c"/>
  <g data-box="window"><rect x="120" y="330" width="520" height="620" rx="10" fill="#bcd9ee"/><rect x="372" y="330" width="16" height="620" fill="#fff"/><rect x="120" y="632" width="520" height="16" fill="#fff"/></g>
  <g data-box="whiteboard"><rect x="880" y="420" width="560" height="420" rx="12" fill="#fff" stroke="#b9b2a3" stroke-width="12"/>
    <path d="M940 520 h300 M940 590 h380 M940 660 h240" stroke="#2f6fed" stroke-width="12" stroke-linecap="round"/></g>
  <rect data-box="sticky-note" x="1300" y="700" width="90" height="90" fill="#f2c230"/>
  <g data-box="clock"><circle cx="1650" cy="520" r="78" fill="#fff" stroke="#2b2f36" stroke-width="14"/><path d="M1650 520 V468 M1650 520 L1692 540" stroke="#2b2f36" stroke-width="12" stroke-linecap="round"/></g>
  <g data-box="poster"><rect x="1900" y="400" width="300" height="400" fill="#27324d"/><circle cx="2050" cy="560" r="80" fill="#ef8a2b"/><rect x="1960" y="690" width="180" height="24" fill="#f4f1ea"/></g>
  <g data-box="plant"><rect x="700" y="1090" width="110" height="170" fill="#8a5a3a"/><ellipse cx="755" cy="1010" rx="60" ry="130" fill="#2f8f5b"/><ellipse cx="700" cy="1050" rx="40" ry="100" fill="#3aa86c" transform="rotate(-24 700 1050)"/><ellipse cx="812" cy="1050" rx="40" ry="100" fill="#3aa86c" transform="rotate(24 812 1050)"/></g>
  ${person('person-mira', 1030, 1010, '#b4459b', '#3b2a20')}${person('person-jonas', 1290, 1040, '#2e9d6a', '#c98b3a')}${person('person-ines', 1640, 1000, '#2f6fed', '#1b1d21')}
  <g data-box="lamp"><rect x="2190" y="900" width="14" height="380" fill="#2b2f36"/><path d="M2120 900 L2274 900 L2240 800 L2154 800 Z" fill="#f2a43a"/><rect x="2150" y="1270" width="94" height="16" fill="#2b2f36"/></g>
  <g data-box="bicycle"><circle cx="230" cy="1290" r="110" fill="none" stroke="#2b2f36" stroke-width="14"/><circle cx="520" cy="1290" r="110" fill="none" stroke="#2b2f36" stroke-width="14"/><path d="M230 1290 L340 1130 L470 1130 L520 1290 M340 1130 L400 1290 L230 1290" fill="none" stroke="#c8372d" stroke-width="14"/></g>`;

// ---------- the offsite on the beach: shown tilted (CSS transform) ----------
const beach = `
  <rect width="1200" height="900" fill="#9fd0ee"/><circle data-box="sun" cx="170" cy="150" r="70" fill="#ffe08a"/>
  <rect y="430" width="1200" height="170" fill="#3f86b8"/><rect y="590" width="1200" height="310" fill="#ecd9a8"/>
  <g data-box="kite"><path d="M1010 85 L1045 130 L1010 175 L975 130 Z" fill="#d6312b"/><path d="M1010 175 q-18 40 6 70 t-10 60" stroke="#2b2f36" stroke-width="3" fill="none"/></g>
  <g data-box="sailboat"><path d="M520 470 L700 470 L670 510 L548 510 Z" fill="#f4f1ea"/><rect x="606" y="330" width="6" height="140" fill="#4a3b2a"/><path d="M616 340 L616 460 L690 460 Z" fill="#fff"/></g>
  <g data-box="umbrella"><rect x="296" y="560" width="8" height="220" fill="#4a3b2a"/><path d="M160 570 a140 110 0 0 1 280 0 Z" fill="#ef8a2b"/><path d="M253 570 a47 110 0 0 1 94 0 Z" fill="#f4f1ea"/></g>
  <g data-box="ball"><circle cx="640" cy="760" r="46" fill="#f4f1ea"/><path d="M640 714 a46 46 0 0 1 0 92 Z" fill="#2f6fed"/></g>
  <g data-box="sandcastle"><rect x="880" y="690" width="180" height="110" fill="#d9bf7e"/><rect x="860" y="650" width="50" height="150" fill="#cfb26c"/><rect x="1030" y="650" width="50" height="150" fill="#cfb26c"/><path d="M958 640 L958 590 L1000 606 L958 622" fill="#2e9d6a" stroke="#4a3b2a" stroke-width="4"/></g>
  <g data-box="towel"><rect x="420" y="800" width="250" height="60" fill="#b4459b" transform="rotate(-4 545 830)"/></g>`;

// ---------- the floor plan: a PNG shown inside an inline SVG as <image> ----------
const room = (id, name, x, y, w, h, fill) => `<g data-box="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#2b2f36" stroke-width="8"/><text x="${x + w / 2}" y="${y + h / 2 + 10}" text-anchor="middle" font-size="30" font-weight="600" fill="#2b2f36">${name}</text></g>`;
const plan = `<rect width="1600" height="1000" fill="#fbfaf8"/>
  ${room('lobby', 'Lobby', 40, 40, 420, 300, '#eee9df')}${room('kitchen', 'Kitchen', 460, 40, 380, 300, '#f6e3c8')}${room('studio', 'Studio', 840, 40, 720, 460, '#e7eefc')}
  ${room('focus-1', 'Focus 1', 40, 340, 210, 280, '#e3f1e8')}${room('focus-2', 'Focus 2', 250, 340, 210, 280, '#e3f1e8')}${room('library', 'Library', 460, 340, 380, 280, '#eee9df')}
  ${room('meeting-a', 'Meeting A', 40, 620, 400, 340, '#f6e3f1')}${room('meeting-b', 'Meeting B', 440, 620, 400, 340, '#f6e3f1')}${room('terrace', 'Terrace', 840, 500, 720, 460, '#dff0d8')}`;

// ---------- five slides: the same layout, other things in the same three places ----------
const SHAPES = {
  disc: (x, y, c) => `<circle cx="${x}" cy="${y}" r="120" fill="${c}"/>`,
  square: (x, y, c) => `<rect x="${x - 110}" y="${y - 110}" width="220" height="220" rx="24" fill="${c}"/>`,
  triangle: (x, y, c) => `<path d="M${x} ${y - 125} L${x + 130} ${y + 105} L${x - 130} ${y + 105} Z" fill="${c}"/>`,
  diamond: (x, y, c) => `<path d="M${x} ${y - 130} L${x + 130} ${y} L${x} ${y + 130} L${x - 130} ${y} Z" fill="${c}"/>`,
  ring: (x, y, c) => `<circle cx="${x}" cy="${y}" r="100" fill="none" stroke="${c}" stroke-width="44"/>`,
  bar: (x, y, c) => `<rect x="${x - 130}" y="${y - 50}" width="260" height="100" rx="50" fill="${c}"/>`,
};
const SLIDES = [
  { bg: '#101626', things: [['disc', '#f2c230'], ['bar', '#2f6fed'], ['triangle', '#e5484d']] },
  { bg: '#27324d', things: [['square', '#2e9d6a'], ['ring', '#f4f1ea'], ['disc', '#ef8a2b']] },
  { bg: '#1f3a2c', things: [['triangle', '#f4f1ea'], ['disc', '#b4459b'], ['diamond', '#f2c230']] },
  { bg: '#3d2a4d', things: [['ring', '#f2a43a'], ['square', '#e5484d'], ['bar', '#2e9d6a']] },
  { bg: '#4a2a22', things: [['diamond', '#2f6fed'], ['triangle', '#f2c230'], ['square', '#f4f1ea']] },
];
const slide = ({ bg, things }) => `<rect width="1600" height="900" fill="${bg}"/><rect y="760" width="1600" height="140" fill="rgba(255,255,255,.06)"/>
  ${things.map(([shape, c], i) => `<g data-box="${['left', 'middle', 'right'][i]}-${shape}">${SHAPES[shape](300 + i * 500, 420, c)}</g>`).join('')}`;

// ---------- the market: loaded late, far down the page ----------
const crate = (id, x, y, c) => `<g data-box="${id}"><rect x="${x}" y="${y}" width="300" height="170" fill="#9a7447"/><rect x="${x}" y="${y + 60}" width="300" height="12" fill="#7a5a3c"/>
  ${Array.from({ length: 10 }, (_, i) => `<circle cx="${x + 42 + (i % 5) * 54}" cy="${y + 10 - Math.floor(i / 5) * 40}" r="30" fill="${c}"/>`).join('')}</g>`;
const market = `<rect width="1800" height="1200" fill="#f3e6cf"/><rect y="900" width="1800" height="300" fill="#b9a383"/>
  <g data-box="awning">${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 200}" y="120" width="200" height="220" fill="${i % 2 ? '#f4f1ea' : '#c8372d'}"/>`).join('')}</g>
  ${crate('oranges', 120, 700, '#ef8a2b')}${crate('lemons', 520, 700, '#f2d230')}${crate('apples', 920, 700, '#c8372d')}${crate('limes', 1320, 700, '#6fae3c')}
  <g data-box="scale"><rect x="800" y="430" width="200" height="30" fill="#2b2f36"/><rect x="890" y="460" width="20" height="120" fill="#2b2f36"/><circle cx="900" cy="400" r="60" fill="#f4f1ea" stroke="#2b2f36" stroke-width="10"/></g>
  <g data-box="price-sign"><rect x="1420" y="430" width="240" height="150" fill="#27324d"/><rect x="1450" y="470" width="180" height="20" fill="#f4f1ea"/><rect x="1450" y="515" width="120" height="20" fill="#f4f1ea"/></g>`;

// ---------- the icon sheet: 6 icons × 2 rows of 96 px (dark, and blue for the picked one), shown at half size ----------
const ICONS = ['calendar', 'bell', 'clock', 'people', 'link', 'lock'];
const icon = (name, c) => ({
  calendar: `<rect x="20" y="26" width="56" height="50" rx="8" fill="none" stroke="${c}" stroke-width="8"/><path d="M20 44 H76 M34 16 V32 M62 16 V32" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,
  bell: `<path d="M26 66 V46 a22 22 0 0 1 44 0 V66 Z" fill="${c}"/><rect x="18" y="64" width="60" height="8" rx="4" fill="${c}"/><circle cx="48" cy="80" r="7" fill="${c}"/>`,
  clock: `<circle cx="48" cy="48" r="30" fill="none" stroke="${c}" stroke-width="8"/><path d="M48 30 V48 L62 56" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,
  people: `<circle cx="34" cy="36" r="13" fill="${c}"/><circle cx="64" cy="40" r="10" fill="${c}"/><path d="M12 78 a22 22 0 0 1 44 0 Z M50 78 a16 16 0 0 1 32 0 Z" fill="${c}"/>`,
  link: `<rect x="14" y="36" width="40" height="24" rx="12" fill="none" stroke="${c}" stroke-width="8"/><rect x="42" y="36" width="40" height="24" rx="12" fill="none" stroke="${c}" stroke-width="8"/>`,
  lock: `<rect x="24" y="44" width="48" height="38" rx="8" fill="${c}"/><path d="M34 44 V32 a14 14 0 0 1 28 0 V44" fill="none" stroke="${c}" stroke-width="8"/>`,
}[name]);
const sheet = ['#1b1d21', '#2f6fed'].map((c, row) => ICONS.map((n, i) => `<g data-box="${n}${row ? '-picked' : ''}" transform="translate(${i * 96} ${row * 96})"><rect width="96" height="96" fill="none"/>${icon(n, c)}</g>`).join('')).join('');

// ---------- the sync status clip (animated GIF): the chip top right says something else every two seconds ----------
const STATES = [['Offline', '#85827a'], ['Syncing…', '#2f6fed'], ['Synced', '#2e9d6a'], ['Conflict', '#e5484d']];
const syncHtml = (i) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; } body { margin: 0; width: 640px; height: 360px; overflow: hidden; font: 15px/1.3 -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1b1d21; background: #f6f5f2; }
  .bar { height: 56px; background: #fff; border-bottom: 1px solid #e4e2dc; display: flex; align-items: center; padding: 0 20px; font-weight: 700; font-size: 17px; }
  .chip { position: absolute; right: 20px; top: 13px; width: 132px; height: 30px; border-radius: 15px; color: #fff; font-size: 14px; font-weight: 600; display: grid; place-items: center; }
  .ev { position: absolute; left: 40px; width: 360px; height: 52px; border-radius: 10px; color: #fff; padding: 8px 14px; font-weight: 600; }
  .dev { position: absolute; right: 40px; top: 96px; width: 150px; height: 220px; border-radius: 22px; background: #1b1d21; } .dev i { position: absolute; inset: 14px; border-radius: 10px; background: ${i > 1 ? '#e7eefc' : '#3a3f48'}; }
  </style><div class="bar">Tidepool</div><div class="chip" data-box="status-chip" style="background:${STATES[i][1]}">${STATES[i][0]}</div>
  <div class="ev" data-box="event-standup" style="top:96px;background:#2f6fed">Standup · 09:30</div>
  <div class="ev" data-box="event-review" style="top:164px;background:${i === 3 ? '#e5484d' : '#b4459b'}">Design review · ${i === 3 ? '14:00 / 15:00' : '14:00'}</div>
  <div class="ev" data-box="event-release" style="top:232px;background:#d9772b;opacity:${i ? 1 : 0.35}">Release window · 15:00</div>
  <div class="dev" data-box="phone"><i></i></div>`;

// ---------- the harbour, moving: a background video that loops; something else is in the sky every two seconds ----------
const sky = (t) => {
  const boat = 180 + t * 110;
  const inSky = t < 4 ? `<g data-box="gull"><path d="M${880 + t * 12} 250 q30 -34 60 0 q30 -34 60 0" fill="none" stroke="#2b2f36" stroke-width="9" stroke-linecap="round"/></g>`
    : t < 6 ? `<g data-box="balloon"><ellipse cx="940" cy="240" rx="62" ry="76" fill="#d6312b"/><path d="M905 300 L922 350 H958 L975 300" fill="none" stroke="#2b2f36" stroke-width="4"/><rect x="918" y="350" width="44" height="30" fill="#7a5a3c"/></g>`
    : `<g data-box="cloud"><ellipse cx="940" cy="260" rx="120" ry="44" fill="#fff"/><ellipse cx="900" cy="230" rx="60" ry="40" fill="#fff"/><ellipse cx="980" cy="226" rx="70" ry="46" fill="#fff"/></g>`;
  return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f9fd6"/><stop offset="1" stop-color="#f3c9a2"/></linearGradient></defs>
  <rect width="1280" height="460" fill="url(#s)"/><circle data-box="sun" cx="250" cy="330" r="60" fill="#ffe2a8"/><rect y="440" width="1280" height="280" fill="#2d5f8a"/>
  ${Array.from({ length: 8 }, (_, i) => `<path d="M${(i * 211 + t * 17) % 1200} ${480 + i * 28} q20 -8 40 0 t40 0" stroke="#5c8cb6" stroke-width="4" fill="none"/>`).join('')}
  <g data-box="ferry"><path d="M${boat} 470 h220 l-30 50 h-164 Z" fill="#f4f1ea"/><rect x="${boat + 60}" y="430" width="100" height="40" fill="#c8372d"/></g>
  <g data-box="lighthouse"><path d="M1130 450 L1146 250 L1186 250 L1202 450 Z" fill="#f4f1ea"/><rect x="1142" y="300" width="48" height="34" fill="#c8372d"/><rect x="1146" y="220" width="40" height="30" fill="#ffe680"/></g>${inSky}`;
};

// ---------- render ----------
const browser = await chromium.launch();
const boxes = {};
async function shot(name, html, { w, h, scale = 1, type = 'png', quality, transparent = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.setContent(html);
  const found = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('[data-box]')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.box, [r.left, r.top, r.right, r.bottom]]; })));
  const buf = await page.screenshot({ type, omitBackground: transparent, ...(type === 'jpeg' ? { quality: quality || 82 } : {}) });
  await ctx.close();
  const info = { width: Math.round(w * scale), height: Math.round(h * scale), boxes: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.map((n) => Math.round(n * scale))])) };
  if (name) {
    fs.writeFileSync(path.join(MEDIA, name), buf);
    boxes[name] = info;
  }
  return { buf, info };
}

await shot('b2-team-wide.jpg', svgPage(2400, 1000, '0 300 2400 1000', office), { w: 2400, h: 1000, type: 'jpeg' });
await shot('b2-team-tall.jpg', svgPage(1050, 1400, '800 100 1050 1400', office), { w: 1050, h: 1400, type: 'jpeg' });
await shot('b2-team.jpg', svgPage(1200, 800, '0 0 2400 1600', office), { w: 1200, h: 800, type: 'jpeg' });
await shot('b2-offsite.jpg', svgPage(1200, 900, '0 0 1200 900', beach), { w: 1200, h: 900, type: 'jpeg' });
await shot('b2-floor-plan.png', svgPage(1600, 1000, '0 0 1600 1000', plan), { w: 1600, h: 1000 });
for (const [i, s] of SLIDES.entries()) await shot(`b2-slide-${i + 1}.jpg`, svgPage(1600, 900, '0 0 1600 900', slide(s)), { w: 1600, h: 900, type: 'jpeg' });
await shot('b2-market.jpg', svgPage(1800, 1200, '0 0 1800 1200', market), { w: 1800, h: 1200, type: 'jpeg' });
await shot('b2-market-tiny.jpg', svgPage(60, 40, '0 0 1800 1200', market), { w: 60, h: 40, type: 'jpeg', quality: 60 });
delete boxes['b2-market-tiny.jpg'].boxes;
await shot('b2-icons.png', svgPage(576, 192, '0 0 576 192', sheet), { w: 576, h: 192, transparent: true });

// The GIF: four stills, two seconds each, encoded in the page (6×6×6 colour cube + LZW), no extra tools.
{
  const frames = [];
  let info;
  for (let i = 0; i < STATES.length; i++) {
    const s = await shot(null, syncHtml(i), { w: 640, h: 360 });
    frames.push(s.buf.toString('base64'));
    info = s.info;
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const b64 = await page.evaluate(async ({ frames, delay }) => {
    const W = 640, H = 360, out = [];
    const u16 = (v) => out.push(v & 255, v >> 8);
    const str = (s) => { for (const ch of s) out.push(ch.charCodeAt(0)); };
    str('GIF89a'); u16(W); u16(H); out.push(0xf7, 0, 0);
    for (let i = 0; i < 256; i++) out.push(i < 216 ? Math.floor(i / 36) * 51 : 0, i < 216 ? (Math.floor(i / 6) % 6) * 51 : 0, i < 216 ? (i % 6) * 51 : 0);
    out.push(0x21, 0xff, 11); str('NETSCAPE2.0'); out.push(3, 1, 0, 0, 0); // loop for ever
    const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d', { willReadFrequently: true });
    for (const f of frames) {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${f}`)).blob());
      g.drawImage(img, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      out.push(0x21, 0xf9, 4, 0); u16(delay); out.push(0, 0, 0x2c); u16(0); u16(0); u16(W); u16(H); out.push(0, 8);
      // LZW, 8-bit codes to start with
      const bytes = [];
      let cur = 0, bits = 0, size = 9, next = 258, table = new Map();
      const emit = (c) => { cur |= c << bits; bits += size; while (bits >= 8) { bytes.push(cur & 255); cur >>>= 8; bits -= 8; } };
      const at = (i) => Math.round(px[i * 4] / 51) * 36 + Math.round(px[i * 4 + 1] / 51) * 6 + Math.round(px[i * 4 + 2] / 51);
      emit(256);
      let prefix = at(0);
      for (let i = 1; i < W * H; i++) {
        const k = at(i), key = (prefix << 8) | k;
        if (table.has(key)) { prefix = table.get(key); continue; }
        emit(prefix);
        if (next === 4096) { emit(256); table = new Map(); size = 9; next = 258; }
        else { if (next >= 1 << size) size++; table.set(key, next++); }
        prefix = k;
      }
      emit(prefix); emit(257);
      if (bits) bytes.push(cur & 255);
      for (let i = 0; i < bytes.length; i += 255) { const part = bytes.slice(i, i + 255); out.push(part.length, ...part); }
      out.push(0);
    }
    out.push(0x3b);
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.slice(i, i + 0x8000));
    return btoa(bin);
  }, { frames, delay: 200 });
  await ctx.close();
  fs.writeFileSync(path.join(MEDIA, 'b2-sync.gif'), Buffer.from(b64, 'base64'));
  boxes['b2-sync.gif'] = { ...info, duration: 8, scenes: STATES.map(([shows], i) => ({ from: i * 2, to: i * 2 + 2, shows: `status chip says "${shows}"` })) };
}

// The video: one still per second, 10 frames each, piped as JPEGs into the ffmpeg that ships with Playwright.
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const ffmpeg = process.env.FFMPEG || fs.readdirSync(cache).filter((d) => d.startsWith('ffmpeg-')).sort().map((d) => path.join(cache, d, 'ffmpeg-mac')).filter((f) => fs.existsSync(f)).pop();
const encoder = /libvpx-vp9/.test(execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })) ? 'libvpx-vp9' : 'libvpx';
{
  const out = path.join(MEDIA, 'b2-harbour-loop.webm');
  const ff = spawn(ffmpeg, ['-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '10', '-i', 'pipe:0', '-y', '-an',
    '-c:v', encoder, ...(encoder === 'libvpx' ? ['-qmin', '0', '-qmax', '40', '-crf', '8', '-b:v', '1M'] : ['-crf', '24', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4']), '-g', '10', '-r', '10', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const scenes = [];
  for (let t = 0; t < 8; t++) {
    const { buf, info } = await shot(null, svgPage(1280, 720, '0 0 1280 720', sky(t)), { w: 1280, h: 720, type: 'jpeg', quality: 88 });
    for (let f = 0; f < 10; f++) ff.stdin.write(buf);
    scenes.push({ from: t, to: t + 1, shows: t < 4 ? 'a gull in the sky' : t < 6 ? 'a red balloon in the sky' : 'a cloud in the sky', boxes: info.boxes });
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (code) => (code ? j(new Error(`ffmpeg ${code}`)) : r())));
  boxes['b2-harbour-loop.webm'] = { width: 1280, height: 720, duration: 8, scenes };
}
await browser.close();
fs.writeFileSync(path.join(HERE, 'situations-2-media.json'), JSON.stringify(boxes, null, 1) + '\n');
for (const f of fs.readdirSync(MEDIA).filter((f) => f.startsWith('b2-'))) console.log(f, Math.round(fs.statSync(path.join(MEDIA, f)).size / 1024) + ' KB');
