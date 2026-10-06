/* Catan Advisor lookahead: chooses between the engine's top candidate moves by playing each one
 * out a few turns into the future (random dice, sampled dev cards, both players following the
 * engine's greedy policy) and keeping the move with the best average outcome.
 * Works in the browser (window.CatanLookahead) and in Node. */
(function (root) {
  'use strict';
  const E = root.CatanEngine || (typeof require !== 'undefined' && require('./engine.js'));
  const { RES, GEO, COST, DEV_TYPES } = E;

  // options: candidate first steps; samples: futures per candidate; horizon: turns played out;
  // confidence: how many standard errors better than the greedy move an alternative must be.
  const OPTS = { options: 4, samples: 12, horizon: 8, confidence: 1.5 };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Dev cards nobody has seen yet, from p's point of view.
  function unseenDeck(game, p, rand) {
    const counts = { knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
    const me = game.players[p];
    DEV_TYPES.forEach(t => { counts[t] -= me.dev[t] + me.devNew[t]; });
    counts.knight -= game.players.reduce((s, pl) => s + pl.knights, 0); // played knights are public
    const deck = [];
    DEV_TYPES.forEach(t => { for (let i = 0; i < Math.max(0, counts[t]); i++) deck.push(t); });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const remaining = Math.max(0, E.DEV_TOTAL - game.devBought);
    return deck.slice(0, remaining);
  }

  // Opponents' unplayed dev cards are unknown to p: replace them with cards sampled from the unseen deck.
  function materializeHidden(game, p, deck) {
    game.players.forEach((pl, q) => {
      if (q === p) return;
      const n = pl.devHidden || 0;
      DEV_TYPES.forEach(t => { pl.dev[t] = 0; pl.devNew[t] = 0; });
      for (let i = 0; i < n && deck.length; i++) pl.dev[deck.pop()]++;
      pl.devHidden = 0;
    });
  }

  function moveRobber(board, game, p, rand) {
    const best = E.robberAdvice(board, game, p)[0];
    if (!best) return;
    board.robber = best.hex;
    const o = E.occupancy(game);
    const victims = E.others(game, p).filter(q => GEO.hexes[best.hex].vertices.some(v => o.v[v] && o.v[v].p === q));
    const q = best.victim !== null && best.victim !== undefined ? best.victim : victims[0];
    if (q === undefined) return;
    const cards = RES.flatMap(r => Array(Math.max(0, game.players[q].res[r])).fill(r));
    if (!cards.length) return;
    const r = cards[Math.floor(rand() * cards.length)];
    game.players[q].res[r]--; game.players[p].res[r]++;
  }

  function playDev(board, game, p, card, rand) {
    const pl = game.players[p];
    pl.dev[card]--; game.turn.devPlayed = true;
    if (card === 'knight') { pl.knights++; E.updateAwards(game); moveRobber(board, game, p, rand); }
    if (card === 'roadBuilding') {
      for (let k = 0; k < 2; k++) {
        const road = E.candidateActions(board, game, p).filter(c => c.type === 'road').sort((a, b) => b.value - a.value)[0];
        if (road) E.buildRoad(board, game, p, road.e, { free: true });
      }
    }
    if (card === 'yearOfPlenty') {
      const goal = E.savingTarget(board, game, p, pl.res);
      const picks = goal ? Object.entries(goal.missing).flatMap(([r, n]) => Array(n).fill(r)) : [];
      while (picks.length < 2) picks.push(picks.length ? 'wheat' : 'ore');
      picks.slice(0, 2).forEach(r => { pl.res[r]++; });
    }
    if (card === 'monopoly') {
      const r = RES.slice().sort((a, b) => E.others(game, p).reduce((s, q) => s + game.players[q].res[b] - game.players[q].res[a], 0))[0];
      E.others(game, p).forEach(q => { pl.res[r] += game.players[q].res[r]; game.players[q].res[r] = 0; });
    }
  }

  // Execute one planned step (trades + action). Returns false if it can't be done.
  function applyStep(board, game, p, step, deck) {
    const pl = game.players[p];
    for (const t of step.trades) {
      if (pl.res[t.give] < t.rate * t.n) return false;
      pl.res[t.give] -= t.rate * t.n; pl.res[t.get] += t.n;
    }
    if (step.type === 'trade') return true;
    let r = {};
    if (step.type === 'settlement') r = E.buildSettlement(board, game, p, step.v);
    if (step.type === 'city') r = E.buildCity(board, game, p, step.v);
    if (step.type === 'road') r = E.buildRoad(board, game, p, step.e);
    if (step.type === 'dev') {
      if (!deck.length) return false;
      E.pay(pl, COST.dev);
      pl.devNew[deck.pop()]++; game.devBought++;
    }
    return !r.error;
  }

  const won = (game, p) => E.victoryPoints(game, p) >= game.target;

  // Rest of the current turn with the greedy plan.
  function finishTurn(board, game, p, deck) {
    for (let guard = 0; guard < 10; guard++) {
      const step = E.planTurn(board, game, p).steps[0];
      if (!step || !applyStep(board, game, p, step, deck)) break;
      if (won(game, p)) return;
    }
  }

  // A whole turn for the current player under the greedy policy.
  function policyTurn(board, game, rand, deck) {
    const p = game.turn.player, pl = game.players[p];
    if (pl.dev.knight > 0 && E.devCardAdvice(board, game, p).some(t => t.card === 'knight')) playDev(board, game, p, 'knight', rand);
    if (won(game, p)) return;
    const roll = 2 + Math.floor(rand() * 6) + Math.floor(rand() * 6);
    E.rollDice(board, game, roll);
    if (roll === 7) {
      game.players.forEach((_, q) => {
        const d = E.discardAdvice(board, game, q);
        if (d) RES.forEach(r => { game.players[q].res[r] -= d.discard[r]; });
      });
      moveRobber(board, game, p, rand);
    }
    if (!game.turn.devPlayed) {
      const tip = E.devCardAdvice(board, game, p).find(t => t.card !== 'knight' || pl.dev.knight > 0);
      if (tip && pl.dev[tip.card] > 0) playDev(board, game, p, tip.card, rand);
    }
    finishTurn(board, game, p, deck);
  }

  // Position value for p: points lead, plus a little for production and progress toward Largest Army.
  function evaluate(board, game, p) {
    if (won(game, p)) return 1000;
    if (E.others(game, p).some(q => won(game, q))) return -1000;
    const o = E.occupancy(game);
    const prod = q => RES.reduce((s, r) => s + E.production(board, o, q)[r], 0);
    const best = Math.max(...E.others(game, p).map(q => E.victoryPoints(game, q) * 10 + 0.4 * prod(q)));
    return E.victoryPoints(game, p) * 10 + 0.4 * prod(p) - best;
  }

  // Outcome of taking `step` now (null = end turn), then playing on for `horizon` turns, once per seed.
  function outcomes(board, game, p, step, seeds, horizon) {
    return seeds.map(seed => {
      const rand = mulberry32(seed);
      const b = { ...board };
      const g = E.cloneGame(game);
      const deck = unseenDeck(g, p, rand);
      materializeHidden(g, p, deck);
      if (step) {
        if (!applyStep(b, g, p, step, deck)) return -50;
        if (!won(g, p)) finishTurn(b, g, p, deck);
      }
      for (let t = 0; t < horizon && !g.players.some((_, q) => won(g, q)); t++) {
        E.endTurn(g);
        policyTurn(b, g, rand, deck);
      }
      return evaluate(b, g, p);
    });
  }

  // The engine's first-step options this turn, best first (each with its trades).
  function stepOptions(board, game, p, k) {
    const out = [];
    const seen = new Set();
    const base = E.planTurn(board, game, p).steps[0];
    if (base) { out.push(base); seen.add(base.type + (base.v ?? '') + (base.e ?? '')); }
    for (const c of E.rankedSteps(board, game, p)) {
      const key = c.type + (c.v ?? '') + (c.e ?? '');
      if (seen.has(key)) continue;
      seen.add(key); out.push(c);
      if (out.length >= k) break;
    }
    return out;
  }

  // Drop-in replacement for engine.planTurn: an alternative first step replaces the greedy one only
  // when it does clearly better on the same sampled futures (paired comparison).
  function planTurn(board, game, p, opts = {}) {
    const o = { ...OPTS, ...opts };
    const greedy = E.planTurn(board, game, p);
    const options = stepOptions(board, game, p, o.options);
    const base = greedy.steps[0] || null;
    const alternatives = [...options.filter(s => s !== base), ...(base ? [null] : [])];
    if (!alternatives.length) return greedy;
    const seeds = Array.from({ length: o.samples }, (_, i) => 7919 * (i + 1) + game.turn.number * 104729 + p);
    const baseOut = outcomes(board, game, p, base, seeds, o.horizon);
    let pick = null, pickGain = 0;
    const report = [{ step: base, gain: 0 }];
    for (const step of alternatives) {
      const out = outcomes(board, game, p, step, seeds, o.horizon);
      const diffs = out.map((x, i) => x - baseOut[i]);
      const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
      const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
      const se = sd / Math.sqrt(diffs.length) || 1e-9;
      report.push({ step, gain: mean, z: mean / se });
      if (mean > o.confidence * se && mean > pickGain) { pick = step; pickGain = mean; }
    }
    if (pickGain <= 0) return { ...greedy, lookahead: report };
    if (!pick) return { steps: [], handAfter: game.players[p].res, game, lookahead: report };
    return { steps: [pick], handAfter: game.players[p].res, game, lookahead: report };
  }

  // Setup: rank the engine's top settlement spots by playing whole games out from each one.
  // Remaining placements follow the engine; returns spots ordered by simulated win rate.
  function openingAdvice(board, game, p, { candidates = 6, games = 60, maxTurns = 300 } = {}) {
    const base = E.setupAdvice(board, game, p);
    if (base.kind !== 'settlement') return base;
    const spots = base.spots.slice(0, candidates);
    const seeds = Array.from({ length: games }, (_, i) => 15485863 * (i + 1) + game.setupStep * 7 + p);
    const ranked = spots.map(spot => {
      let wins = 0;
      for (const seed of seeds) wins += playOut(board, game, p, spot.v, seed, maxTurns);
      return { ...spot, winRate: wins / games };
    }).sort((a, b) => b.winRate - a.winRate);
    return { kind: 'settlement', spots: ranked, simulated: true };
  }

  // Same as openingAdvice, but incremental: call step(ms) repeatedly (e.g. from timers) until it returns true.
  function openingSearch(board, game, p, { candidates = 6, games = 60, maxTurns = 300 } = {}) {
    const base = E.setupAdvice(board, game, p);
    const spots = base.kind === 'settlement' ? base.spots.slice(0, candidates).map(s => ({ ...s, wins: 0 })) : [];
    const seeds = Array.from({ length: games }, (_, i) => 15485863 * (i + 1) + game.setupStep * 7 + p);
    let i = 0; // next (spot, seed) pair
    const total = spots.length * games;
    return {
      base,
      progress: () => (total ? i / total : 1),
      step(ms) {
        const end = Date.now() + ms;
        while (i < total && Date.now() < end) {
          const s = spots[Math.floor(i / games)];
          s.wins += playOut(board, game, p, s.v, seeds[i % games], maxTurns);
          i++;
        }
        return i >= total;
      },
      result: () => ({ kind: 'settlement', simulated: true, spots: spots.map(s => ({ ...s, winRate: s.wins / games })).sort((a, b) => b.winRate - a.winRate) }),
    };
  }

  // 1 if p wins after settling on v (0.5 for an unfinished game, 0 for a loss).
  function playOut(board, game, p, v, seed, maxTurns) {
    const rand = mulberry32(seed);
    const b = { ...board };
    const g = E.cloneGame(game);
    const deck = unseenDeck(g, p, rand);
    if (E.buildSettlement(b, g, p, v).error) return 0;
    while (g.phase === 'setup') {
      const q = E.currentPlayer(g);
      const sa = E.setupAdvice(b, g, q);
      if (sa.kind === 'settlement') { if (!sa.spots.length || E.buildSettlement(b, g, q, sa.spots[0].v).error) return 0.5; }
      else if (!sa.roads.length || E.buildRoad(b, g, q, sa.roads[0].e).error) return 0.5;
    }
    for (let t = 0; t < maxTurns; t++) {
      g.players.forEach(pl => { pl.devHidden = DEV_TYPES.reduce((s, k) => s + pl.dev[k] + pl.devNew[k], 0) - pl.dev.vp - pl.devNew.vp; });
      policyTurn(b, g, rand, deck);
      if (won(g, p)) return 1;
      if (E.others(g, p).some(q => won(g, q))) return 0;
      E.endTurn(g);
    }
    return 0.5;
  }

  // An engine whose planTurn uses lookahead (for the simulator or the overlay).
  function withLookahead(engine, opts = {}) {
    const out = { ...engine };
    if (opts.horizon) out.planTurn = (board, game, p) => planTurn(board, game, p, opts);
    if (opts.opening) {
      out.setupAdvice = (board, game, p) => (game.setupSub === 'settlement' ? openingAdvice(board, game, p, opts.opening) : engine.setupAdvice(board, game, p));
    }
    return out;
  }

  const api = { planTurn, openingAdvice, openingSearch, withLookahead, OPTS, policyTurn, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatanLookahead = api;
})(typeof window !== 'undefined' ? window : globalThis);
