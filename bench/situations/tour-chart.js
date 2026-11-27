// Draws "Teams using Tidepool" on the tour page: one bar per month, newest on the right.
const months = [
  { month: 'Dec', teams: 410 },
  { month: 'Jan', teams: 520 },
  { month: 'Feb', teams: 610 },
  { month: 'Mar', teams: 790 },
  { month: 'Apr', teams: 880 },
  { month: 'May', teams: 1040 },
  { month: 'Jun', teams: 1190 },
  { month: 'Jul', teams: 1260 },
  { month: 'Aug', teams: 1210 },
  { month: 'Sep', teams: 1480 },
  { month: 'Oct', teams: 1730 },
  { month: 'Nov', teams: 1910 },
];

const canvas = document.getElementById('growth');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const pad = { left: 96, right: 48, top: 48, bottom: 88 };
const top = 2000; // the value at the top of the chart
const slot = (W - pad.left - pad.right) / months.length;
const barWidth = slot * 0.62;

ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, W, H);

// Grid lines and their values.
ctx.font = '24px -apple-system, Helvetica, Arial, sans-serif';
ctx.textBaseline = 'middle';
for (let value = 0; value <= top; value += 500) {
  const y = H - pad.bottom - (value / top) * (H - pad.top - pad.bottom);
  ctx.fillStyle = '#e4e2dc';
  ctx.fillRect(pad.left, y, W - pad.left - pad.right, 2);
  ctx.fillStyle = '#62605a';
  ctx.textAlign = 'right';
  ctx.fillText(String(value), pad.left - 16, y);
}

// Bars and month names.
ctx.textAlign = 'center';
months.forEach((m, i) => {
  const height = (m.teams / top) * (H - pad.top - pad.bottom);
  const x = pad.left + i * slot + (slot - barWidth) / 2;
  const y = H - pad.bottom - height;
  ctx.fillStyle = i === months.length - 1 ? '#2f6fed' : '#9db9f5';
  ctx.fillRect(x, y, barWidth, height);
  ctx.fillStyle = '#62605a';
  ctx.fillText(m.month, x + barWidth / 2, H - pad.bottom + 36);
});
