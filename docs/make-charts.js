// Renders the README charts as SVG files (light and dark aware) from docs/analysis.json.
// Usage: node sim/analyze.js 20000 500000 --json docs/analysis.json && node docs/make-charts.js
'use strict';
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'analysis.json'), 'utf8'));
const OUT = path.join(__dirname, 'img');
fs.mkdirSync(OUT, { recursive: true });

// Head-to-head results from the strategy experiments (see README); win rate vs. the previous version, 95% CI half-width.
const EXPERIMENTS = [
  { label: 'Save for next build + paired opening', rate: 62.3, ci: 1.1, kept: true },
  { label: 'Simulated openings', rate: 55.4, ci: 2.4, kept: true },
  { label: 'Turn lookahead', rate: 52.7, ci: 1.7, kept: true },
  { label: 'Weight search', rate: 51.7, ci: 0.8, kept: true },
  { label: 'Knight race for Largest Army', rate: 51.0, ci: 0.8, kept: true },
  { label: 'Discount 2nd building on a tile', rate: 50.6, ci: 1.1, kept: false },
  { label: 'Play every knight to block', rate: 50.2, ci: 1.1, kept: false },
  { label: 'Rank goals by turns-to-afford', rate: 49.4, ci: 0.8, kept: false },
  { label: 'Penalize low wood+brick openings', rate: 49.3, ci: 1.1, kept: false },
  { label: 'Push expansion when all are cities', rate: 48.7, ci: 1.1, kept: false },
  { label: 'Value ports by total production', rate: 44.8, ci: 1.1, kept: false },
];

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
// Reference palette (validated light and dark): slot 1 blue, slot 2 orange; neutral ink and chrome.
const STYLE = `
  .surface { fill: #fcfcfb; stroke: rgba(11,11,11,0.10); }
  .ink { fill: #0b0b0b; } .ink2 { fill: #52514e; } .muted { fill: #898781; }
  .grid { stroke: #e1e0d9; } .axis { stroke: #c3c2b7; } .ref { stroke: #898781; }
  .s1 { fill: #2a78d6; } .s2 { fill: #eb6834; } .s0 { fill: #c3c2b7; }
  .w1 { stroke: #2a78d6; } .w0 { stroke: #898781; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; stroke: rgba(255,255,255,0.10); }
    .ink { fill: #ffffff; } .ink2 { fill: #c3c2b7; } .muted { fill: #898781; }
    .grid { stroke: #2c2c2a; } .axis { stroke: #383835; } .ref { stroke: #898781; }
    .s1 { fill: #3987e5; } .s2 { fill: #d95926; } .s0 { fill: #52514e; }
    .w1 { stroke: #3987e5; } .w0 { stroke: #898781; }
  }
  text { font-family: ${FONT}; }
  .title { font-size: 17px; font-weight: 600; } .sub { font-size: 13px; }
  .tick { font-size: 12px; } .val { font-size: 12px; font-weight: 600; } .label { font-size: 13px; }`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function svg(w, h, title, subtitle, body, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<style>${STYLE}</style>
<rect class="surface" x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12"/>
<text class="title ink" x="24" y="34">${esc(title)}</text>
<text class="sub ink2" x="24" y="56">${esc(subtitle)}</text>
${body}
</svg>`;
}

// Bar with a 4px rounded data-end and a square base.
function vbar(x, y, w, h, cls) {
  const r = Math.min(4, h, w / 2);
  return `<path class="${cls}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"/>`;
}
function hbar(x, y, w, h, cls) {
  const r = Math.min(4, w, h / 2);
  return `<path class="${cls}" d="M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z"/>`;
}
const pctTxt = v => `${(100 * v).toFixed(1)}%`;

// 1. Win rate by opening pip advantage (vertical bars, one series).
function pipChart() {
  const rows = data.pipAdvantage;
  const W = 720, H = 360, L = 64, R = 24, T = 84, B = 64;
  const pw = W - L - R, ph = H - T - B;
  const y = v => T + ph * (1 - v);
  const slot = pw / rows.length, bw = Math.min(64, slot * 0.5);
  let b = '';
  [0, 0.25, 0.5, 0.75, 1].forEach(t => {
    b += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick muted" x="${L - 10}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text>`;
  });
  rows.forEach((r, i) => {
    const cx = L + slot * (i + 0.5);
    b += vbar(cx - bw / 2, y(r.winRate), bw, y(0) - y(r.winRate), 's1');
    b += `<text class="val ink" x="${cx}" y="${y(r.winRate) - 8}" text-anchor="middle">${pctTxt(r.winRate)}</text>`;
    b += `<text class="tick ink2" x="${cx}" y="${y(0) + 20}" text-anchor="middle">${esc(r.label)}</text>`;
  });
  b += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(0.5)}" y2="${y(0.5)}" stroke-dasharray="4 4"/>`;
  b += `<text class="tick muted" x="${L + 8}" y="${y(0.5) - 6}">50% = coin flip</text>`;
  b += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
  b += `<text class="tick ink2" x="${L + pw / 2}" y="${H - 16}" text-anchor="middle">Your opening's production pips minus your opponent's</text>`;
  return svg(W, H, 'A stronger opening wins more often', 'Win rate by opening production advantage, 1v1 to 15 (self-play)', b,
    rows.map(r => `${r.label} pips: ${pctTxt(r.winRate)}`).join('; '));
}

// 2. Win rate by awards held at the end (horizontal bars, one series).
function awardsChart() {
  const rows = data.awards;
  const W = 720, H = 300, L = 170, R = 70, T = 84, B = 40;
  const pw = W - L - R, rowH = (H - T - B) / rows.length, bh = Math.min(28, rowH * 0.6);
  const x = v => L + pw * v;
  let b = '';
  [0, 0.5, 1].forEach(t => {
    b += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - B}"/><text class="tick muted" x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t * 100}%</text>`;
  });
  rows.forEach((r, i) => {
    const cy = T + rowH * (i + 0.5);
    b += `<text class="label ink" x="${L - 12}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>`;
    b += hbar(L, cy - bh / 2, Math.max(2, x(r.winRate) - L), bh, 's1');
    b += `<text class="val ink" x="${x(r.winRate) + 8}" y="${cy + 4}">${pctTxt(r.winRate)}</text>`;
  });
  b += `<line class="axis" x1="${L}" x2="${L}" y1="${T - 6}" y2="${H - B}"/>`;
  return svg(W, H, 'Longest Road + Largest Army is almost a guaranteed win', 'Win rate by which awards a player holds when the game ends', b,
    rows.map(r => `${r.label}: ${pctTxt(r.winRate)}`).join('; '));
}

// 3. Where points come from: winner vs loser (grouped horizontal bars, two series, legend + direct labels).
function pointsChart() {
  const ws = data.pointSources.winner, ls = data.pointSources.loser;
  const keys = [['cities', 'Cities'], ['settlements', 'Settlements'], ['road', 'Longest Road'], ['cards', 'VP cards'], ['army', 'Largest Army']];
  const W = 720, H = 400, L = 130, R = 60, T = 104, B = 40;
  const max = 8;
  const pw = W - L - R, rowH = (H - T - B) / keys.length, bh = Math.min(16, rowH * 0.32);
  const x = v => L + pw * v / max;
  let b = '';
  // legend (above the plot)
  b += `<rect class="s1" x="24" y="72" width="12" height="12" rx="3"/><text class="label ink" x="42" y="82">Winner</text>`;
  b += `<rect class="s2" x="110" y="72" width="12" height="12" rx="3"/><text class="label ink" x="128" y="82">Loser</text>`;
  [0, 2, 4, 6, 8].forEach(t => {
    b += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - B}"/><text class="tick muted" x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t}</text>`;
  });
  keys.forEach(([k, label], i) => {
    const cy = T + rowH * (i + 0.5);
    b += `<text class="label ink" x="${L - 12}" y="${cy + 4}" text-anchor="end">${label}</text>`;
    b += hbar(L, cy - bh - 1, Math.max(2, x(ws[k]) - L), bh, 's1');
    b += `<text class="val ink" x="${x(ws[k]) + 6}" y="${cy - 4}">${ws[k].toFixed(1)}</text>`;
    b += hbar(L, cy + 1, Math.max(2, x(ls[k]) - L), bh, 's2');
    b += `<text class="val ink2" x="${x(ls[k]) + 6}" y="${cy + bh - 2}">${ls[k].toFixed(1)}</text>`;
  });
  b += `<line class="axis" x1="${L}" x2="${L}" y1="${T - 6}" y2="${H - B}"/>`;
  return svg(W, H, 'Cities carry the game; the awards decide it', 'Average victory points at game end, by source', b,
    keys.map(([k, l]) => `${l}: winner ${ws[k].toFixed(2)}, loser ${ls[k].toFixed(2)}`).join('; '));
}

// 4. Experiments: win rate vs. previous version with 95% CI (dot + whisker), kept vs rejected.
function experimentsChart() {
  const rows = EXPERIMENTS;
  const W = 720, H = 120 + rows.length * 30, L = 270, R = 70, T = 104, B = 44;
  const lo = 40, hi = 66;
  const pw = W - L - R, rowH = (H - T - B) / rows.length;
  const x = v => L + pw * (v - lo) / (hi - lo);
  let b = '';
  b += `<circle class="s1" cx="30" cy="78" r="6"/><text class="label ink" x="42" y="82">Kept in the engine</text>`;
  b += `<circle class="s0" cx="196" cy="78" r="6"/><text class="label ink" x="208" y="82">Tested and rejected</text>`;
  [40, 45, 50, 55, 60, 65].forEach(t => {
    b += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - B}"/><text class="tick muted" x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t}%</text>`;
  });
  b += `<line class="ref" x1="${x(50)}" x2="${x(50)}" y1="${T - 10}" y2="${H - B}" stroke-dasharray="4 4"/>`;
  rows.forEach((r, i) => {
    const cy = T + rowH * (i + 0.5);
    b += `<text class="label ${r.kept ? 'ink' : 'ink2'}" x="${L - 14}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>`;
    b += `<line class="${r.kept ? 'w1' : 'w0'}" x1="${x(r.rate - r.ci)}" x2="${x(r.rate + r.ci)}" y1="${cy}" y2="${cy}" stroke-width="2"/>`;
    b += `<circle class="${r.kept ? 's1' : 's0'}" cx="${x(r.rate)}" cy="${cy}" r="5"/>`;
    b += `<text class="val ${r.kept ? 'ink' : 'ink2'}" x="${x(r.rate + r.ci) + 8}" y="${cy + 4}">${r.rate.toFixed(1)}%</text>`;
  });
  b += `<text class="tick ink2" x="${L + pw / 2}" y="${H - 12}" text-anchor="middle">dot = win rate vs. previous version · line = 95% interval</text>`;
  return svg(W, H, 'Which ideas actually won games', 'Each change played head-to-head against the version before it', b,
    rows.map(r => `${r.label}: ${r.rate}% ± ${r.ci} (${r.kept ? 'kept' : 'rejected'})`).join('; '));
}

// 5. Opening resources: ore+wheat vs wood+brick, two panels on one win-rate scale.
function resourcesChart() {
  const panels = [['oreWheat', 'Ore + wheat pips (cities, dev cards)', 's1'], ['woodBrick', 'Wood + brick pips (roads, settlements)', 's2']];
  const W = 720, H = 340, T = 96, B = 56, gap = 40, L0 = 56, R = 24;
  const pwTotal = W - L0 - R - gap, pw = pwTotal / 2, ph = H - T - B;
  const lo = 0.3, hi = 0.6;
  const y = v => T + ph * (1 - (v - lo) / (hi - lo));
  let b = '';
  panels.forEach(([key, label, cls], pi) => {
    const L = L0 + pi * (pw + gap);
    const rows = data[key].filter(r => r.players >= 100); // skip near-empty buckets
    [0.3, 0.4, 0.5, 0.6].forEach(t => {
      b += `<line class="grid" x1="${L}" x2="${L + pw}" y1="${y(t)}" y2="${y(t)}"/>`;
      if (pi === 0) b += `<text class="tick muted" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`;
    });
    b += `<text class="label ink" x="${L}" y="${T - 14}">${esc(label)}</text>`;
    const slot = pw / 4, bw = Math.min(40, slot * 0.55);
    rows.forEach((r, i) => {
      const cx = L + slot * (i + 0.5);
      b += vbar(cx - bw / 2, y(r.winRate), bw, y(lo) - y(r.winRate), cls);
      b += `<text class="val ink" x="${cx}" y="${y(r.winRate) - 7}" text-anchor="middle">${(100 * r.winRate).toFixed(1)}%</text>`;
      b += `<text class="tick ink2" x="${cx}" y="${y(lo) + 18}" text-anchor="middle">${esc(r.label)}</text>`;
    });
    b += `<line class="ref" x1="${L}" x2="${L + pw}" y1="${y(0.5)}" y2="${y(0.5)}" stroke-dasharray="4 4"/>`;
    b += `<line class="axis" x1="${L}" x2="${L + pw}" y1="${y(lo)}" y2="${y(lo)}"/>`;
  });
  b += `<text class="tick ink2" x="${W / 2}" y="${H - 14}" text-anchor="middle">pips of that pair in your two starting settlements (y-axis starts at 30%)</text>`;
  return svg(W, H, 'Ore and wheat keep paying; wood and brick plateau', 'Win rate by opening production of each resource pair', b,
    panels.map(([k, l]) => `${l}: ` + data[k].map(r => `${r.label} ${(100 * r.winRate).toFixed(1)}%`).join(', ')).join('; '));
}

// 6. Winner vs loser, per game: ratio bars against a 1x reference.
function ratioChart() {
  const rows = data.perGame.map(r => ({ ...r, ratio: r.winner / r.loser })).sort((a, b) => b.ratio - a.ratio);
  const W = 720, H = 110 + rows.length * 32, L = 200, R = 120, T = 84, B = 40;
  const pw = W - L - R, rowH = (H - T - B) / rows.length, bh = Math.min(18, rowH * 0.55);
  const max = 2.5, x = v => L + pw * v / max;
  let b = '';
  [0, 0.5, 1, 1.5, 2, 2.5].forEach(t => {
    b += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - B}"/><text class="tick muted" x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t}×</text>`;
  });
  rows.forEach((r, i) => {
    const cy = T + rowH * (i + 0.5);
    b += `<text class="label ink" x="${L - 12}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>`;
    b += hbar(L, cy - bh / 2, Math.max(2, x(r.ratio) - L), bh, 's1');
    b += `<text class="val ink" x="${x(r.ratio) + 8}" y="${cy + 4}">${r.ratio.toFixed(2)}×</text>`;
    b += `<text class="tick ink2" x="${W - 16}" y="${cy + 4}" text-anchor="end">${r.winner.toFixed(1)} vs ${r.loser.toFixed(1)}</text>`;
  });
  b += `<line class="ref" x1="${x(1)}" x2="${x(1)}" y1="${T - 10}" y2="${H - B}" stroke-dasharray="4 4"/>`;
  b += `<line class="axis" x1="${L}" x2="${L}" y1="${T - 6}" y2="${H - B}"/>`;
  return svg(W, H, 'What winners do differently', 'Winner ÷ loser, per game (right column: winner vs loser averages)', b,
    rows.map(r => `${r.label}: ${r.ratio.toFixed(2)}x (${r.winner.toFixed(2)} vs ${r.loser.toFixed(2)})`).join('; '));
}

const charts = { 'resources.svg': resourcesChart(), 'winner-vs-loser.svg': ratioChart(), 'pip-advantage.svg': pipChart(), 'awards.svg': awardsChart(), 'point-sources.svg': pointsChart(), 'experiments.svg': experimentsChart() };
for (const [name, content] of Object.entries(charts)) fs.writeFileSync(path.join(OUT, name), content);
console.log('Wrote', Object.keys(charts).map(n => 'docs/img/' + n).join(', '));
