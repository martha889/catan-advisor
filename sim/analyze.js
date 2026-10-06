// Self-play statistics for the README: what winning games look like when the current engine plays itself.
// Usage: node sim/analyze.js [games=20000] [seed=500000]
// Prints Markdown tables. Results describe this engine's play (correlations, not causal effects).
'use strict';
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');

if (!isMainThread) {
  const { playGame, loadEngine, seedRandom, ENGINE } = require('./simulate.js');
  parentPort.on('message', ({ games, seed }) => {
    seedRandom(seed);
    const engines = [loadEngine(ENGINE), loadEngine(ENGINE)];
    const out = [];
    for (let g = 0; g < games; g++) {
      const first = g % 2;
      const r = playGame(engines, first);
      out.push({ winner: r.winner, first, turns: r.turns, stats: r.stats });
    }
    parentPort.postMessage(out);
  });
  return;
}

const games = +process.argv[2] || 20000;
const seed = +process.argv[3] || 500000;
const n = Math.max(1, os.cpus().length - 2);

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');
const avg = xs => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const fmt = x => x.toFixed(2);

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
}

// Win rate of players grouped by key(player record); each game contributes both players.
function byBucket(records, key, order) {
  const b = new Map();
  for (const r of records) {
    const k = key(r);
    if (k === null) continue;
    const e = b.get(k) || { n: 0, w: 0 };
    e.n++; e.w += r.won ? 1 : 0;
    b.set(k, e);
  }
  const keys = order || [...b.keys()].sort();
  return keys.filter(k => b.has(k)).map(k => [k, b.get(k).n.toLocaleString(), pct(b.get(k).w, b.get(k).n)]);
}

(async () => {
  const t0 = Date.now();
  const chunk = Math.ceil(games / n / 2) * 2;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => new Promise(resolve => {
    const w = new Worker(__filename);
    w.once('message', m => { resolve(m); w.terminate(); });
    w.postMessage({ games: chunk, seed: seed + i });
  })));
  const all = parts.flat().filter(g => g.winner !== null);
  const total = all.length;

  // One record per player per game.
  const players = all.flatMap(g => [0, 1].map(p => {
    const me = g.stats[p], opp = g.stats[1 - p];
    return { won: g.winner === p, first: g.first === p, me, opp };
  }));
  const winners = players.filter(r => r.won), losers = players.filter(r => !r.won);

  const out = [];
  out.push(`_${total.toLocaleString()} self-play games (1v1 to 15, 9-card discard limit), ${((Date.now() - t0) / 1000).toFixed(0)}s on ${n} cores, seed ${seed}._\n`);

  // Overview
  const turns = all.map(g => g.turns).sort((a, b) => a - b);
  const firstWins = all.filter(g => g.winner === g.first).length;
  out.push('### Overview\n');
  out.push(table(['Measure', 'Value'], [
    ['Game length (turns, both players)', `median ${turns[Math.floor(turns.length / 2)]}, middle 80% ${turns[Math.floor(turns.length * 0.1)]}–${turns[Math.floor(turns.length * 0.9)]}`],
    ['First player wins', pct(firstWins, total)],
    ["Loser's final score", `${fmt(avg(losers.map(r => r.me.vp)))} VP on average`],
  ]));

  // Where the points come from
  const src = rs => ({
    settlements: avg(rs.map(r => r.me.finalSettlements)),
    cities: avg(rs.map(r => 2 * r.me.finalCities)),
    road: avg(rs.map(r => 2 * r.me.lr)),
    army: avg(rs.map(r => 2 * r.me.la)),
    cards: avg(rs.map(r => r.me.vpCards)),
  });
  const ws = src(winners), ls = src(losers);
  out.push('\n### Where the points come from\n');
  out.push(table(['Source', 'Winner (avg VP)', 'Loser (avg VP)'], [
    ['Settlements', fmt(ws.settlements), fmt(ls.settlements)],
    ['Cities (2 each)', fmt(ws.cities), fmt(ls.cities)],
    ['Longest Road (2)', fmt(ws.road), fmt(ls.road)],
    ['Largest Army (2)', fmt(ws.army), fmt(ls.army)],
    ['VP cards', fmt(ws.cards), fmt(ls.cards)],
  ]));

  // Awards
  out.push('\n### Longest Road and Largest Army\n');
  out.push(table(['Holding at the end', 'Players', 'Win rate'], byBucket(players, r => {
    const lr = r.me.lr > 0, la = r.me.la > 0;
    return lr && la ? 'Both' : lr ? 'Longest Road only' : la ? 'Largest Army only' : 'Neither';
  }, ['Both', 'Longest Road only', 'Largest Army only', 'Neither'])));

  // Building and cards
  out.push('\n### What winners do differently\n');
  const m = (rs, f) => fmt(avg(rs.map(f)));
  out.push(table(['Per game', 'Winner', 'Loser'], [
    ['Settlements built', m(winners, r => r.me.settlements), m(losers, r => r.me.settlements)],
    ['Cities built', m(winners, r => r.me.cities), m(losers, r => r.me.cities)],
    ['Roads on the board', m(winners, r => r.me.finalRoads), m(losers, r => r.me.finalRoads)],
    ['Dev cards bought', m(winners, r => r.me.devs), m(losers, r => r.me.devs)],
    ['Knights played', m(winners, r => r.me.knights), m(losers, r => r.me.knights)],
    ['Bank/port trades', m(winners, r => r.me.trades), m(losers, r => r.me.trades)],
    ['Cards lost to 7s', m(winners, r => r.me.discarded), m(losers, r => r.me.discarded)],
    ['Turns with nothing built', m(winners, r => r.me.idle), m(losers, r => r.me.idle)],
  ]));

  // Openings
  out.push('\n### Openings: what predicts a win\n');
  out.push('Win rate by how many more production pips your two starting settlements have than your opponent\'s:\n');
  const diffBucket = d => (d <= -4 ? '≤ −4' : d <= -2 ? '−3 to −2' : d <= 1 ? '−1 to +1' : d <= 3 ? '+2 to +3' : '≥ +4');
  out.push(table(['Pip advantage', 'Players', 'Win rate'], byBucket(players, r => diffBucket(r.me.opening.pips - r.opp.opening.pips),
    ['≤ −4', '−3 to −2', '−1 to +1', '+2 to +3', '≥ +4'])));
  out.push('\nWin rate by wood + brick pips in the opening (what you need for roads and settlements):\n');
  const wb = x => (x <= 3 ? '0–3' : x <= 6 ? '4–6' : x <= 9 ? '7–9' : '10+');
  out.push(table(['Wood + brick pips', 'Players', 'Win rate'], byBucket(players, r => wb(r.me.opening.woodBrick), ['0–3', '4–6', '7–9', '10+'])));
  out.push('\nWin rate by ore + wheat pips in the opening (what you need for cities and dev cards):\n');
  const ow = x => (x <= 4 ? '0–4' : x <= 8 ? '5–8' : x <= 12 ? '9–12' : '13+');
  out.push(table(['Ore + wheat pips', 'Players', 'Win rate'], byBucket(players, r => ow(r.me.opening.oreWheat), ['0–4', '5–8', '9–12', '13+'])));
  out.push('\nWin rate by how many of the five resources the opening produces:\n');
  out.push(table(['Resources covered', 'Players', 'Win rate'], byBucket(players, r => `${r.me.opening.kinds}`, ['3', '4', '5'])));
  out.push('\nWin rate by port on a starting settlement:\n');
  out.push(table(['Starting port', 'Players', 'Win rate'], byBucket(players, r => r.me.opening.port, ['none', '3:1', '2:1'])));

  console.log(out.join('\n'));
})();
