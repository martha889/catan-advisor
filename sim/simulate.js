// Self-play simulator: pits two versions of the advisor engine against each other in 1v1 games to 15.
// Usage: node sim/simulate.js [games=400] [seed=1] [--vs baseline|current] [--lookahead options,samples,horizon] [key=value ...] [A.key=value ...]
//   Seat B plays engine.js; seat A plays sim/engine-baseline.js (--vs baseline, default) or
//   engine.js with its default weights (--vs current). key=value overrides B's TUNE weights,
//   A.key=value overrides A's. Seats alternate who goes first. Player-to-player trades aren't simulated.
'use strict';
const path = require('path');

const ENGINE = path.join(__dirname, '..', 'engine.js');
const BASELINE = path.join(__dirname, 'engine-baseline.js');
// A fresh module instance per seat, so both seats can load the same file with different weights.
function loadEngine(file, tune = {}) {
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  const engine = require(resolved);
  delete require.cache[resolved];
  if (Object.keys(tune).length) {
    if (!engine.TUNE) throw new Error(`${path.basename(file)} has no TUNE weights`);
    Object.entries(tune).forEach(([k, v]) => {
      if (!(k in engine.TUNE)) throw new Error('Unknown TUNE key ' + k);
      engine.TUNE[k] = v;
    });
  }
  return engine;
}
const R = loadEngine(ENGINE); // rules helpers (identical in every version)
const { RES } = R;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(1);
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const d6 = () => 1 + Math.floor(rand() * 6);

function randomBoard() {
  const tiles = shuffle(['wood', 'wood', 'wood', 'wood', 'brick', 'brick', 'brick', 'sheep', 'sheep', 'sheep', 'sheep', 'wheat', 'wheat', 'wheat', 'wheat', 'ore', 'ore', 'ore', 'desert']);
  const nums = shuffle([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
  let k = 0;
  const hexes = tiles.map(res => ({ res, num: res === 'desert' ? null : nums[k++] }));
  return { hexes, ports: shuffle(['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore']), robber: tiles.indexOf('desert') };
}

function finish(game, stats, res) {
  [0, 1].forEach(p => { stats[p].lr += game.awards.road === p ? 1 : 0; stats[p].la += game.awards.army === p ? 1 : 0; stats[p].vpCards += game.players[p].dev.vp + game.players[p].devNew.vp; });
  return res;
}

function playGame(engines, first, { target = 15, discardLimit = 9 } = {}) {
  const board = randomBoard();
  const game = R.newGame({ first, target, discardLimit });
  const deck = shuffle([...Array(14).fill('knight'), ...Array(5).fill('vp'), 'roadBuilding', 'roadBuilding', 'yearOfPlenty', 'yearOfPlenty', 'monopoly', 'monopoly']);
  const mk = () => ({ cities: 0, settlements: 0, devs: 0, knights: 0, idle: 0, discarded: 0, trades: 0, lr: 0, la: 0, vpCards: 0 });
  const stats = [mk(), mk()];
  const syncHidden = () => game.players.forEach(pl => { pl.devHidden = R.DEV_TYPES.reduce((s, t) => s + pl.dev[t] + pl.devNew[t], 0) - pl.dev.vp - pl.devNew.vp; });

  // Setup (snake order).
  while (game.phase === 'setup') {
    const p = R.currentPlayer(game), X = engines[p];
    const sa = X.setupAdvice(board, game, p);
    if (sa.kind === 'settlement') R.buildSettlement(board, game, p, sa.spots[0].v);
    else R.buildRoad(board, game, p, sa.roads[0].e);
  }

  const won = p => R.victoryPoints(game, p) >= target;
  const moveRobber = (p, X) => {
    const best = X.robberAdvice(board, game, p)[0];
    board.robber = best.hex;
    const q = 1 - p, o = R.occupancy(game);
    const touches = R.GEO.hexes[best.hex].vertices.some(v => o.v[v] && o.v[v].p === q);
    const cards = RES.flatMap(r => Array(game.players[q].res[r]).fill(r));
    if (touches && cards.length) {
      const r = cards[Math.floor(rand() * cards.length)];
      game.players[q].res[r]--; game.players[p].res[r]++;
    }
  };
  const playDev = (p, X, card) => {
    const pl = game.players[p];
    pl.dev[card]--; game.turn.devPlayed = true;
    if (card === 'knight') { pl.knights++; stats[p].knights++; R.updateAwards(game); moveRobber(p, X); }
    if (card === 'roadBuilding') {
      for (let k = 0; k < 2; k++) {
        const road = X.candidateActions(board, game, p).filter(c => c.type === 'road').sort((a, b) => b.value - a.value)[0];
        if (road) R.buildRoad(board, game, p, road.e, { free: true });
      }
    }
    if (card === 'yearOfPlenty') {
      const goal = X.savingTarget(board, game, p, pl.res);
      const picks = goal ? Object.entries(goal.missing).flatMap(([r, n]) => Array(n).fill(r)) : [];
      while (picks.length < 2) picks.push(picks.length ? 'wheat' : 'ore');
      picks.slice(0, 2).forEach(r => { pl.res[r]++; });
    }
    if (card === 'monopoly') {
      const opp = game.players[1 - p].res;
      const r = RES.slice().sort((a, b) => opp[b] - opp[a])[0];
      pl.res[r] += opp[r]; opp[r] = 0;
    }
  };

  for (let turn = 0; turn < 400; turn++) {
    const p = game.turn.player, X = engines[p], pl = game.players[p];
    syncHidden();
    // Before rolling: knight if the advisor says so.
    if (X.devCardAdvice(board, game, p).some(t => t.card === 'knight')) playDev(p, X, 'knight');
    if (won(p)) return finish(game, stats, { winner: p, turns: game.turn.number, stats });
    const roll = d6() + d6();
    R.rollDice(board, game, roll);
    if (roll === 7) {
      [0, 1].forEach(q => {
        const d = engines[q].discardAdvice(board, game, q);
        if (d) { RES.forEach(r => { game.players[q].res[r] -= d.discard[r]; }); stats[q].discarded += d.count; }
      });
      moveRobber(p, X);
    }
    // After rolling: other dev cards the advisor recommends.
    if (!game.turn.devPlayed) {
      const tip = X.devCardAdvice(board, game, p).find(t => t.card !== 'knight' || pl.dev.knight > 0);
      if (tip && pl.dev[tip.card] > 0) playDev(p, X, tip.card);
    }
    // Build plan, executed step by step.
    let built = 0;
    for (let guard = 0; guard < 10; guard++) {
      syncHidden();
      const step = X.planTurn(board, game, p).steps[0];
      if (!step) break;
      let ok = true;
      for (const t of step.trades) {
        if (pl.res[t.give] < t.rate * t.n) { ok = false; break; }
        pl.res[t.give] -= t.rate * t.n; pl.res[t.get] += t.n; stats[p].trades++;
      }
      if (!ok) break;
      let r = {};
      if (step.type === 'trade') continue;
      if (step.type === 'settlement') { r = R.buildSettlement(board, game, p, step.v); stats[p].settlements++; }
      if (step.type === 'city') { r = R.buildCity(board, game, p, step.v); stats[p].cities++; }
      if (step.type === 'road') r = R.buildRoad(board, game, p, step.e);
      if (step.type === 'dev') {
        if (!deck.length) break;
        R.pay(pl, R.COST.dev);
        const card = deck.pop();
        pl.devNew[card]++; game.devBought++; stats[p].devs++;
      }
      if (r.error) break;
      built++;
      if (won(p)) return finish(game, stats, { winner: p, turns: game.turn.number, stats });
    }
    if (!built) stats[p].idle++;
    if (won(p)) return finish(game, stats, { winner: p, turns: game.turn.number, stats });
    R.endTurn(game);
  }
  return finish(game, stats, { winner: null, turns: 400, stats });
}

function runMatch({ a, b, games = 400, seed = 1 }) {
  rand = mulberry32(seed);
  const seat = x => {
    const engine = loadEngine(x.file, x.tune);
    return x.lookahead ? require('../lookahead.js').withLookahead(engine, x.lookahead) : engine;
  };
  const engines = { A: seat(a), B: seat(b) };
  const tally = { A: 0, B: 0, draw: 0 };
  let turnsSum = 0;
  const agg = { A: {}, B: {} };
  for (let g = 0; g < games; g++) {
    // Alternate seats: in even games A is player 0, in odd games B is player 0. Player `first` alternates too.
    const seats = g % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    const first = Math.floor(g / 2) % 2;
    const res = playGame([engines[seats[0]], engines[seats[1]]], first);
    if (res.winner === null) tally.draw++; else tally[seats[res.winner]]++;
    turnsSum += res.turns;
    res.stats.forEach((st, i) => Object.keys(st).forEach(k => { agg[seats[i]][k] = (agg[seats[i]][k] || 0) + st[k]; }));
  }
  return { games, tally, turnsSum, agg };
}

function parseValue(k, v) {
  const val = v === 'true' ? true : v === 'false' ? false : Number(v);
  if (typeof val === 'number' && !Number.isFinite(val)) throw new Error(`Bad value for ${k}: ${v}`);
  return val;
}

function main() {
  const args = process.argv.slice(2);
  const games = +args[0] || 400, seed = +args[1] || 1;
  let vs = 'baseline', lookahead = null;
  const aTune = {}, bTune = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--vs') { vs = args[++i]; continue; }
    if (args[i] === '--lookahead') { const [options, samples, horizon] = args[++i].split(',').map(Number); lookahead = { options, samples, horizon }; continue; }
    const [k, v] = args[i].split('=');
    if (k.startsWith('A.')) aTune[k.slice(2)] = parseValue(k, v); else bTune[k] = parseValue(k, v);
  }
  const a = vs === 'current' ? { file: ENGINE, tune: aTune } : { file: BASELINE, tune: aTune };
  const t0 = Date.now();
  const { tally, turnsSum, agg } = runMatch({ a, b: { file: ENGINE, tune: bTune, lookahead }, games, seed });
  const pct = n => (100 * n / games).toFixed(1) + '%';
  console.log(`${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${vs} (A) ${pct(tally.A)}, new (B) ${pct(tally.B)}, unfinished ${tally.draw}`);
  console.log(`avg turns ${(turnsSum / games).toFixed(1)}`);
  for (const k of ['A', 'B']) console.log(k, Object.entries(agg[k]).map(([x, n]) => `${x} ${(n / games).toFixed(2)}`).join(', '));
}

module.exports = { runMatch, ENGINE, BASELINE };
if (require.main === module) main();
