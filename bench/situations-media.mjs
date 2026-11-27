// Makes the pictures and videos for bench/situations with known things at known pixels, and writes where they are
// to bench/situations-media.json (part of the truth: an answering agent must not read it, or this file).
// Run once (the results are committed): NODE_PATH=<folder with playwright> node bench/situations-media.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MEDIA = path.join(HERE, 'situations/media');
fs.mkdirSync(MEDIA, { recursive: true });

// ---------- the app mock: week view, used for the screenshot and the walkthrough video ----------
const DAYS = ['Mon 9', 'Tue 10', 'Wed 11', 'Thu 12', 'Fri 13', 'Sat 14', 'Sun 15'];
const EVENTS = [
  ...[0, 1, 2, 3, 4].map((d) => ({ d, at: 9.5, len: 0.25, title: 'Standup', cal: 'team', box: `standup-${DAYS[d].slice(0, 3).toLowerCase()}` })),
  { d: 0, at: 10, len: 1.5, title: 'Sprint planning', cal: 'team', box: 'sprint-planning' },
  { d: 1, at: 11, len: 0.5, title: '1:1 Mira', cal: 'personal', box: 'one-on-one' },
  { d: 2, at: 14, len: 1, title: 'Design review', cal: 'design', box: 'design-review' },
  { d: 3, at: 12.5, len: 1, title: 'Lunch with Ines', cal: 'personal', box: 'lunch' },
  { d: 3, at: 15, len: 2, title: 'Release window', cal: 'oncall', box: 'release-window' },
  { d: 4, at: 16, len: 0.5, title: 'On-call handover', cal: 'oncall', box: 'handover' },
];
const CAL = { team: '#2f6fed', design: '#b4459b', oncall: '#d9772b', personal: '#2e9d6a' };

function appHtml({ W, H, fab = false, modal = null, toast = false, extra = null, cursor = null, highlight = null }) {
  const top = 56, head = 44, hours = 10;
  const rowH = (H - top - head) / hours;
  const events = [...EVENTS, ...(extra ? [extra] : [])];
  const mini = Array.from({ length: 35 }, (_, i) => {
    const day = i - 5; // 1 Nov 2026 is a Sunday; the grid starts on Monday 26 Oct
    const n = day < 1 ? 31 + day - 0 : day > 30 ? day - 30 : day;
    return `<span class="${day < 1 || day > 30 ? 'dim' : ''}${day >= 9 && day <= 15 ? ' wk' : ''}">${n}</span>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; } body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; font: 13px/1.3 -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1b1d21; background: #fff; position: relative; }
  .side { position: absolute; left: 0; top: 0; bottom: 0; width: 240px; background: #f6f5f2; border-right: 1px solid #e4e2dc; padding: 18px 16px; }
  .logo { font-weight: 700; font-size: 17px; letter-spacing: -.01em; margin-bottom: 22px; }
  .mini { display: inline-block; padding: 10px; background: #fff; border: 1px solid #e4e2dc; border-radius: 10px; }
  .mini b { display: block; font-size: 12px; margin-bottom: 8px; } .mini div { display: grid; grid-template-columns: repeat(7, 26px); row-gap: 2px; }
  .mini span { text-align: center; font-size: 11px; line-height: 22px; border-radius: 6px; } .mini .dim { color: #b3b0a8; } .mini .wk { background: #e7eefc; border-radius: 0; }
  .cals { margin-top: 24px; } .cals h4 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #85827a; }
  .cals p { margin: 0; padding: 6px 8px; border-radius: 8px; display: flex; align-items: center; gap: 8px; } .cals i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .cals p.on { background: #fff; box-shadow: 0 0 0 2px #2f6fed; }
  .top { position: absolute; left: 240px; right: 0; top: 0; height: ${top}px; border-bottom: 1px solid #e4e2dc; display: flex; align-items: center; gap: 12px; padding: 0 20px; }
  .top h1 { font-size: 17px; margin: 0 auto 0 0; font-weight: 600; } .top button { font: inherit; padding: 6px 12px; border: 1px solid #d6d3cb; border-radius: 8px; background: #fff; }
  .bell { position: relative; width: 28px; height: 28px; border-radius: 50%; border: 1px solid #d6d3cb; display: grid; place-items: center; font-size: 13px; }
  .badge { position: absolute; right: -5px; top: -5px; width: 14px; height: 14px; border-radius: 50%; background: #e5484d; border: 2px solid #fff; }
  .me { width: 28px; height: 28px; border-radius: 50%; background: #b4459b; color: #fff; display: grid; place-items: center; font-weight: 600; font-size: 12px; }
  .grid { position: absolute; left: 240px; right: 0; top: ${top}px; bottom: 0; display: grid; grid-template-columns: 52px repeat(7, 1fr); grid-template-rows: ${head}px 1fr; }
  .grid .dh { border-bottom: 1px solid #e4e2dc; border-left: 1px solid #eeece7; padding: 12px 10px; font-weight: 600; font-size: 12px; } .grid .dh.today { color: #2f6fed; }
  .hrs { position: relative; } .hrs span { position: absolute; right: 8px; font-size: 10px; color: #85827a; transform: translateY(-6px); }
  .day { position: relative; border-left: 1px solid #eeece7; background: repeating-linear-gradient(#fff 0, #fff ${rowH - 1}px, #f0eee9 ${rowH - 1}px, #f0eee9 ${rowH}px); }
  .ev { position: absolute; left: 3px; right: 6px; border-radius: 6px; padding: 2px 8px; color: #fff; font-size: 11.5px; font-weight: 500; overflow: hidden; white-space: nowrap; }
  .fab { position: absolute; right: 24px; top: 72px; width: 168px; height: 56px; border-radius: 28px; background: #1b1d21; color: #fff; display: grid; place-items: center; font-size: 15px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
  .toast { position: absolute; right: 24px; top: 72px; width: 340px; height: 56px; border-radius: 12px; background: #17603f; color: #fff; display: flex; align-items: center; gap: 10px; padding: 0 18px; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
  .scrim { position: absolute; inset: 0; background: rgba(20,20,22,.45); }
  .modal { position: absolute; left: 50%; top: 50%; width: 460px; transform: translate(-50%, -50%); background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 24px 64px rgba(0,0,0,.35); }
  .modal h2 { margin: 0 0 16px; font-size: 18px; } .modal label { display: block; font-size: 11px; color: #85827a; margin: 12px 0 4px; }
  .modal .f { border: 1px solid #d6d3cb; border-radius: 8px; padding: 9px 12px; min-height: 38px; font-size: 14px; }
  .modal .row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; } .modal .row span { padding: 9px 18px; border-radius: 8px; border: 1px solid #d6d3cb; font-weight: 600; }
  .modal .row .save { background: #2f6fed; border-color: #2f6fed; color: #fff; }
  .cursor { position: absolute; width: 0; height: 0; border-left: 14px solid #111; border-bottom: 14px solid transparent; filter: drop-shadow(0 0 1px #fff); }
  </style>
  <div class="side"><div class="logo">Tidepool</div>
    <div class="mini" data-box="mini-calendar"><b>November 2026</b><div>${mini}</div></div>
    <div class="cals"><h4>Calendars</h4>${Object.entries({ team: 'Team', design: 'Design', oncall: 'On-call', personal: 'Personal' })
      .map(([k, v]) => `<p class="${highlight === k ? 'on' : ''}" data-box="cal-${k}"><i style="background:${CAL[k]}"></i>${v}</p>`).join('')}</div></div>
  <div class="top"><h1>Week 46 · 9–15 November 2026</h1><button>Today</button><button>Week ▾</button>
    <div class="bell" data-box="bell">◔<span class="badge" data-box="badge"></span></div><div class="me">LM</div></div>
  <div class="grid"><div class="dh" style="border-left:0"></div>${DAYS.map((d, i) => `<div class="dh${i === 3 ? ' today' : ''}">${d}</div>`).join('')}
    <div class="hrs">${Array.from({ length: hours }, (_, i) => `<span style="top:${i * rowH}px">${String(8 + i).padStart(2, '0')}:00</span>`).join('')}</div>
    ${DAYS.map((_, d) => `<div class="day">${events.filter((e) => e.d === d)
      .map((e) => `<div class="ev" data-box="${e.box}" style="top:${(e.at - 8) * rowH + 1}px;height:${Math.max(e.len * rowH - 2, 20)}px;background:${CAL[e.cal]}">${e.title}</div>`).join('')}</div>`).join('')}</div>
  ${modal ? `<div class="scrim"></div><div class="modal" data-box="modal"><h2>New event</h2>
    <label>Title</label><div class="f" data-box="modal-title">${modal.title || ''}</div>
    <label>When</label><div class="f">Thu 12 Nov · 10:00 – 11:00</div>
    <label>Guests</label><div class="f">${modal.guests || ''}</div>
    <div class="row"><span>Cancel</span><span class="save" data-box="modal-save">Save</span></div></div>` : ''}
  ${fab ? '<div class="fab" data-box="fab">+ New event</div>' : ''}
  ${toast ? '<div class="toast" data-box="toast">✓ Event saved · synced to 4 devices</div>' : ''}
  ${cursor ? `<div class="cursor" style="left:${cursor[0]}px;top:${cursor[1]}px"></div>` : ''}`;
}

// ---------- the activity log: one tall full-page screenshot, 125 rows of 28 px ----------
function logHtml() {
  let seed = 46;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const who = ['Mira', 'Jonas', 'Ines', 'Leo', 'Tariq', 'Sofie', 'Ana'];
  const what = ['moved', 'created', 'deleted', 'renamed', 'changed guests of', 'changed time of', 'accepted', 'declined'];
  const ev = ['Standup', 'Design review', 'Sprint planning', 'Release window', 'On-call handover', 'Lunch with Ines', '1:1 Mira', 'Retro', 'Customer call', 'Budget check'];
  const dev = ["iPhone", 'Mac', 'web', 'Android', 'iPad'];
  let t = 18 * 3600 + 12 * 60;
  const rows = Array.from({ length: 125 }, (_, i) => {
    t -= 20 + rnd(400);
    const hh = String(Math.floor(t / 3600)).padStart(2, '0'), mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
    const text = `${who[rnd(who.length)]} ${what[rnd(what.length)]} “${ev[rnd(ev.length)]}”`;
    return { i, time: `${hh}:${mm}:${ss}`, text, dev: dev[rnd(dev.length)] };
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; } body { margin: 0; width: 800px; font: 13px/28px -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1b1d21; background: #fff; }
  header { height: 80px; padding: 22px 24px 0; border-bottom: 1px solid #e4e2dc; } header b { font-size: 20px; } header span { color: #85827a; margin-left: 12px; }
  .r { height: 28px; display: grid; grid-template-columns: 96px 1fr 120px; padding: 0 24px; border-bottom: 1px solid #f0eee9; white-space: nowrap; }
  .r:nth-child(odd) { background: #fbfaf8; } .r time { color: #85827a; font-variant-numeric: tabular-nums; } .r i { color: #85827a; font-style: normal; text-align: right; }
  </style><header><b>Activity</b><span>Thursday 12 November 2026 · 125 changes</span></header>
  ${rows.map((r) => `<div class="r" data-box="log-row-${r.i}"><time>${r.time}</time><span>${r.text}</span><i>${r.dev}</i></div>`).join('')}`;
  return { html, rows };
}

// ---------- the "new event" clip: 960×720 (4:3), shown pillarboxed on the demo page ----------
function sheetHtml({ title = '', guests = [], saving = false, done = false }) {
  return `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; } body { margin: 0; width: 960px; height: 720px; overflow: hidden; font: 18px/1.3 -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1b1d21; background: #f6f5f2; padding: 48px 80px; }
  h1 { font-size: 30px; margin: 0 0 28px; } label { display: block; font-size: 14px; color: #85827a; margin: 22px 0 6px; }
  .f { background: #fff; border: 1px solid #d6d3cb; border-radius: 12px; min-height: 60px; padding: 16px 18px; display: flex; gap: 10px; align-items: center; }
  .chip { background: #e7eefc; color: #1d4fc0; border-radius: 999px; padding: 6px 14px; font-size: 16px; font-weight: 500; }
  .row { position: absolute; left: 80px; right: 80px; bottom: 48px; display: flex; justify-content: space-between; }
  .row span { padding: 16px 34px; border-radius: 12px; border: 1px solid #d6d3cb; font-weight: 600; background: #fff; } .row .save { background: ${done ? '#17603f' : '#2f6fed'}; border-color: transparent; color: #fff; }
  </style><h1>New event</h1>
  <label>Title</label><div class="f" data-box="sheet-title">${title}</div>
  <label>When</label><div class="f" data-box="sheet-when">Thursday 12 November · 10:00 – 11:00</div>
  <label>Guests</label><div class="f" data-box="sheet-guests">${guests.map((g) => `<span class="chip">${g}</span>`).join('')}</div>
  <label>Calendar</label><div class="f" data-box="sheet-calendar"><span class="chip" style="background:#f6e3f1;color:#8a2f75">Design</span></div>
  <div class="row"><span>Cancel</span><span class="save" data-box="sheet-save">${done ? '✓ Saved' : saving ? 'Saving…' : 'Save'}</span></div>`;
}

// ---------- flat illustrations (SVG), drawn at one size and rendered to JPG ----------
const svgPage = (w, h, vw, vh, body) => `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none" style="display:block">${body}</svg>`;

const harbour = `
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fa8d8"/><stop offset="1" stop-color="#f6c9a0"/></linearGradient></defs>
  <rect width="2400" height="840" fill="url(#sky)"/><circle data-box="sun" cx="520" cy="600" r="110" fill="#ffe2a8"/>
  <path d="M0 840 L0 700 Q300 600 620 720 T1300 700 T2400 640 L2400 840 Z" fill="#6f8fb0"/>
  <rect y="820" width="2400" height="780" fill="#2d5f8a"/>
  ${Array.from({ length: 14 }, (_, i) => `<path d="M${(i * 397) % 2200} ${900 + i * 48} q40 -14 80 0 t80 0" stroke="#5c8cb6" stroke-width="6" fill="none"/>`).join('')}
  <g data-box="lighthouse"><path d="M2010 830 L2040 420 L2120 420 L2150 830 Z" fill="#f4f1ea"/><rect x="2031" y="520" width="98" height="70" fill="#c8372d"/><rect x="2021" y="690" width="118" height="70" fill="#c8372d"/>
    <rect x="2030" y="360" width="100" height="60" fill="#2b2f36"/><rect x="2052" y="372" width="56" height="40" fill="#ffe680"/><path d="M2020 360 L2080 310 L2140 360 Z" fill="#c8372d"/></g>
  <g data-box="sailboat"><path d="M1130 960 L1470 960 L1410 1040 L1180 1040 Z" fill="#f4f1ea"/><rect x="1292" y="560" width="12" height="400" fill="#4a3b2a"/><path d="M1310 580 L1310 930 L1500 930 Z" fill="#fff"/><path d="M1286 620 L1286 930 L1150 930 Z" fill="#e9e4d8"/></g>
  <g data-box="red-boat"><path d="M520 1050 L960 1050 L900 1150 L570 1150 Z" fill="#c8372d"/><rect x="640" y="960" width="180" height="90" fill="#f4f1ea"/><rect x="664" y="982" width="50" height="40" fill="#2d5f8a"/><rect x="744" y="982" width="50" height="40" fill="#2d5f8a"/></g>
  <g data-box="pier"><rect x="0" y="1260" width="860" height="56" fill="#7a5a3c"/>${[60, 260, 460, 660, 820].map((x) => `<rect x="${x}" y="1300" width="28" height="220" fill="#5e4329"/>`).join('')}</g>
  <g data-box="orange-buoy"><rect x="1094" y="1300" width="12" height="70" fill="#2b2f36"/><circle cx="1100" cy="1410" r="50" fill="#ef8a2b"/><rect x="1050" y="1400" width="100" height="18" fill="#f4f1ea"/></g>
  <g data-box="red-buoy"><rect x="1574" y="1090" width="12" height="70" fill="#2b2f36"/><circle cx="1580" cy="1200" r="50" fill="#d6312b"/><rect x="1530" y="1190" width="100" height="18" fill="#f4f1ea"/></g>
  <g data-box="yellow-buoy"><rect x="1914" y="1020" width="12" height="60" fill="#2b2f36"/><circle cx="1920" cy="1120" r="44" fill="#f2c230"/><rect x="1876" y="1112" width="88" height="16" fill="#f4f1ea"/></g>`;

const offsite = `
  <rect width="1800" height="1200" fill="#27324d"/><circle data-box="moon" cx="330" cy="230" r="90" fill="#f3ecd2"/>
  <path d="M0 800 L380 330 L700 800 Z" fill="#3d4a6b"/><path d="M420 800 L900 260 L1380 800 Z" fill="#46557a"/><path d="M1080 800 L1500 400 L1800 720 L1800 800 Z" fill="#3d4a6b"/>
  <rect y="780" width="1800" height="420" fill="#1f3a2c"/>
  ${[120, 250, 1560, 1680].map((x, i) => `<g data-box="pine-${i}"><rect x="${x + 34}" y="820" width="22" height="90" fill="#4a3b2a"/><path d="M${x} 830 L${x + 45} 600 L${x + 90} 830 Z" fill="#2f6b4a"/></g>`).join('')}
  <g data-box="tent"><path d="M560 1000 L800 700 L1040 1000 Z" fill="#ef8a2b"/><path d="M800 700 L740 1000 L860 1000 Z" fill="#b85f12"/></g>
  <g data-box="campfire"><rect x="1250" y="968" width="170" height="26" rx="12" fill="#6b4a2c" transform="rotate(-8 1335 981)"/><rect x="1250" y="968" width="170" height="26" rx="12" fill="#7a5a3c" transform="rotate(8 1335 981)"/>
    <path d="M1335 850 Q1410 930 1375 980 L1295 980 Q1260 930 1335 850 Z" fill="#f2c230"/><path d="M1335 900 Q1370 945 1355 980 L1315 980 Q1300 945 1335 900 Z" fill="#e5484d"/></g>
  <g data-box="mug"><rect x="1100" y="1010" width="56" height="60" rx="8" fill="#f4f1ea"/></g>`;

const standup = `
  <rect width="1800" height="1200" fill="#fbe3c2"/><circle data-box="sun" cx="1380" cy="380" r="170" fill="#f2a43a"/>
  <path d="M0 900 Q450 640 900 860 T1800 800 L1800 1200 L0 1200 Z" fill="#8fb37a"/><path d="M0 1010 Q600 860 1100 1000 T1800 960 L1800 1200 L0 1200 Z" fill="#6f9a5c"/>
  <g data-box="signpost"><rect x="420" y="520" width="26" height="520" fill="#6b4a2c"/><path d="M300 560 L620 560 L680 620 L620 680 L300 680 Z" fill="#f4f1ea"/><rect x="340" y="606" width="220" height="28" fill="#2b2f36"/></g>
  <g data-box="clock"><circle cx="980" cy="560" r="120" fill="#f4f1ea" stroke="#2b2f36" stroke-width="16"/><path d="M980 560 L980 480 M980 560 L1040 590" stroke="#2b2f36" stroke-width="14" stroke-linecap="round"/></g>`;

const oncall = `
  <rect width="1800" height="1200" fill="#101626"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 487) % 1800}" cy="${(i * 211) % 620}" r="${3 + (i % 3)}" fill="#dfe6ff"/>`).join('')}
  <rect y="900" width="1800" height="300" fill="#1b2438"/>
  ${[80, 300, 560, 1320, 1560].map((x, i) => `<rect x="${x}" y="${640 + (i % 3) * 70}" width="${150 + (i % 2) * 50}" height="${260 + ((i + 1) % 3) * 40}" fill="#232e48"/>`).join('')}
  <g data-box="mast"><path d="M860 900 L930 300 L1000 900 Z" fill="none" stroke="#8b96b5" stroke-width="14"/><path d="M880 720 L980 720 M895 560 L965 560" stroke="#8b96b5" stroke-width="12"/></g>
  <circle data-box="beacon" cx="930" cy="280" r="46" fill="#e5484d"/>
  <g data-box="dish"><path d="M1180 760 Q1260 640 1380 700 Q1330 800 1180 760 Z" fill="#c9d2ea"/><rect x="1262" y="770" width="16" height="130" fill="#8b96b5"/></g>`;

const desk = `
  <rect width="2400" height="1350" fill="#b98a5e"/>${Array.from({ length: 9 }, (_, i) => `<rect y="${i * 150 + 40}" width="2400" height="5" fill="#ad7f54"/>`).join('')}
  <g data-box="laptop"><rect x="820" y="300" width="760" height="500" rx="26" fill="#2b2f36"/><rect x="850" y="330" width="700" height="440" rx="8" fill="#e7eefc"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${890 + i * 130}" y="${400 + (i % 3) * 90}" width="110" height="60" rx="8" fill="${['#2f6fed', '#b4459b', '#d9772b', '#2e9d6a', '#2f6fed'][i]}"/>`).join('')}
    <rect x="760" y="800" width="880" height="330" rx="26" fill="#3a3f48"/><rect x="1060" y="960" width="280" height="140" rx="12" fill="#4a505b"/></g>
  <g data-box="notebook"><rect x="250" y="760" width="400" height="500" rx="14" fill="#f4f1ea" transform="rotate(-6 450 1010)"/><rect x="300" y="860" width="260" height="14" fill="#c9c4b8" transform="rotate(-6 450 1010)"/><rect x="300" y="910" width="300" height="14" fill="#c9c4b8" transform="rotate(-6 450 1010)"/></g>
  <g data-box="mug"><circle cx="1960" cy="800" r="130" fill="#f4f1ea"/><circle cx="1960" cy="800" r="100" fill="#5a3a22"/><rect x="2070" y="770" width="100" height="60" rx="30" fill="none" stroke="#f4f1ea" stroke-width="26"/></g>
  <g data-box="plant"><circle cx="2160" cy="230" r="150" fill="#8a5a3a"/>${[0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="2160" cy="130" rx="46" ry="110" fill="#2f8f5b" transform="rotate(${a} 2160 230)"/>`).join('')}</g>
  <g data-box="phone"><rect x="1700" y="1010" width="170" height="300" rx="24" fill="#1b1d21" transform="rotate(12 1785 1160)"/></g>`;

// ---------- render ----------
const browser = await chromium.launch();
const boxes = {};
async function shot(name, html, { w, h, scale = 1, type = 'png', quality }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.setContent(html);
  const found = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('[data-box]')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.box, [r.left, r.top, r.right, r.bottom]]; })));
  const buf = await page.screenshot({ type, ...(type === 'jpeg' ? { quality: quality || 82 } : {}) });
  await ctx.close();
  if (name) {
    fs.writeFileSync(path.join(MEDIA, name), buf);
    boxes[name] = { width: Math.round(w * scale), height: Math.round(h * scale), boxes: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.map((n) => Math.round(n * scale))])) };
  }
  return { buf, found };
}

await shot('app-week.png', appHtml({ W: 1440, H: 900 }), { w: 1440, h: 900, scale: 2 });
const log = logHtml();
await shot('activity-log.png', log.html, { w: 800, h: 3600, scale: 2 });
boxes['activity-log.png'].rows = log.rows;
await shot('harbour-2400.jpg', svgPage(2400, 1600, 2400, 1600, harbour), { w: 2400, h: 1600, type: 'jpeg' });
await shot('harbour-1600.jpg', svgPage(1600, 1067, 2400, 1600, harbour), { w: 1600, h: 1067, type: 'jpeg' });
await shot('harbour-800.jpg', svgPage(800, 533, 2400, 1600, harbour), { w: 800, h: 533, type: 'jpeg' });
await shot('template-standup.jpg', svgPage(1800, 1200, 1800, 1200, standup), { w: 1800, h: 1200, type: 'jpeg' });
await shot('template-offsite.jpg', svgPage(1800, 1200, 1800, 1200, offsite), { w: 1800, h: 1200, type: 'jpeg' });
await shot('template-oncall.jpg', svgPage(1800, 1200, 1800, 1200, oncall), { w: 1800, h: 1200, type: 'jpeg' });
await shot('hero-desk.jpg', svgPage(2400, 1350, 2400, 1350, desk), { w: 2400, h: 1350, type: 'jpeg' });

// Videos: one still per second, 10 frames each, piped as JPEGs into the ffmpeg that ships with Playwright
// (it only encodes VP8 or VP9, depending on the build).
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const ffmpeg = process.env.FFMPEG || fs.readdirSync(cache).filter((d) => d.startsWith('ffmpeg-')).sort().map((d) => path.join(cache, d, 'ffmpeg-mac')).filter((f) => fs.existsSync(f)).pop();
const { execFileSync } = await import('node:child_process');
const encoder = /libvpx-vp9/.test(execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })) ? 'libvpx-vp9' : 'libvpx';
async function video(name, w, h, seconds) {
  const out = path.join(MEDIA, name);
  const ff = spawn(ffmpeg, ['-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '10', '-i', 'pipe:0', '-y', '-an',
    '-c:v', encoder, ...(encoder === 'libvpx' ? ['-qmin', '0', '-qmax', '40', '-crf', '8', '-b:v', '1M'] : ['-crf', '24', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4']), '-g', '10', '-r', '10', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const scenes = [];
  for (const [i, s] of seconds.entries()) {
    const { buf, found } = await shot(null, s.html, { w, h, type: 'jpeg', quality: 88 });
    for (let f = 0; f < 10; f++) ff.stdin.write(buf);
    scenes.push({ from: i, to: i + 1, shows: s.shows, boxes: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.map(Math.round)])) });
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (code) => (code ? j(new Error(`ffmpeg ${code}`)) : r())));
  boxes[name] = { width: w, height: h, duration: seconds.length, scenes };
}
const V = { W: 1280, H: 720 };
const added = { d: 3, at: 10, len: 1, title: 'Design review', cal: 'design', box: 'new-event' };
await video('tour.webm', V.W, V.H, [
  { shows: 'week view, + New event button top right', html: appHtml({ ...V, fab: true, cursor: [700, 300] }) },
  { shows: 'week view, + New event button top right', html: appHtml({ ...V, fab: true, cursor: [960, 520] }) },
  { shows: 'week view, + New event button top right', html: appHtml({ ...V, fab: true, cursor: [1170, 104] }) },
  { shows: 'New event dialog, empty', html: appHtml({ ...V, modal: {}, cursor: [640, 250] }) },
  { shows: 'New event dialog, title typed', html: appHtml({ ...V, modal: { title: 'Design review' }, cursor: [640, 250] }) },
  { shows: 'New event dialog, guests added', html: appHtml({ ...V, modal: { title: 'Design review', guests: 'Mira, Jonas' }, cursor: [820, 470] }) },
  { shows: 'toast "Event saved" top right, new event on Thursday', html: appHtml({ ...V, toast: true, extra: added, cursor: [820, 470] }) },
  { shows: 'toast "Event saved" top right, new event on Thursday', html: appHtml({ ...V, toast: true, extra: added, cursor: [600, 400] }) },
  { shows: 'toast "Event saved" top right, new event on Thursday', html: appHtml({ ...V, toast: true, extra: added, cursor: [300, 380] }) },
  { shows: 'Design calendar picked in the sidebar', html: appHtml({ ...V, fab: true, extra: added, highlight: 'design', cursor: [120, 372] }) },
  { shows: 'Design calendar picked in the sidebar', html: appHtml({ ...V, fab: true, extra: added, highlight: 'design', cursor: [400, 300] }) },
  { shows: 'Design calendar picked in the sidebar', html: appHtml({ ...V, fab: true, extra: added, highlight: 'design', cursor: [700, 300] }) },
]);
await video('new-event.webm', 960, 720, [
  { shows: 'empty form', html: sheetHtml({}) },
  { shows: 'empty form', html: sheetHtml({ title: 'Des' }) },
  { shows: 'title typed, two guests', html: sheetHtml({ title: 'Design review', guests: ['Mira', 'Jonas'] }) },
  { shows: 'title typed, two guests', html: sheetHtml({ title: 'Design review', guests: ['Mira', 'Jonas'] }) },
  { shows: 'saving', html: sheetHtml({ title: 'Design review', guests: ['Mira', 'Jonas', 'Ines'], saving: true }) },
  { shows: 'saved', html: sheetHtml({ title: 'Design review', guests: ['Mira', 'Jonas', 'Ines'], done: true }) },
]);
await browser.close();
fs.writeFileSync(path.join(HERE, 'situations-media.json'), JSON.stringify(boxes, null, 1) + '\n');
for (const f of fs.readdirSync(MEDIA)) console.log(f, Math.round(fs.statSync(path.join(MEDIA, f)).size / 1024) + ' KB');
