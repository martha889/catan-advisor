/* Catan Advisor engine: board geometry, rules bookkeeping and move heuristics.
 * Works in the browser (window.CatanEngine) and in Node (module.exports) for testing. */
(function (root) {
  'use strict';

  const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
  const RES_LABEL = { wood: 'Wood', brick: 'Brick', sheep: 'Sheep', wheat: 'Wheat', ore: 'Ore', desert: 'Desert', any: '3:1' };
  const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const COST = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    dev: { sheep: 1, wheat: 1, ore: 1 },
  };
  const PIECES = { road: 15, settlement: 5, city: 4 };
  const DEV_TOTAL = 25;
  const DEV_TYPES = ['knight', 'vp', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
  const DEV_LABEL = { knight: 'Knight', vp: 'Victory Point', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly' };
  const ROWS = [3, 4, 5, 4, 3];
  const SQ3 = Math.sqrt(3);

  // Standard port positions: hex index + edge index (edge i joins corner i and i+1; corner 0 is the top, clockwise).
  const PORT_SLOTS = [
    { hex: 0, edge: 5 }, { hex: 1, edge: 0 }, { hex: 6, edge: 0 }, { hex: 11, edge: 1 }, { hex: 15, edge: 2 },
    { hex: 17, edge: 2 }, { hex: 16, edge: 3 }, { hex: 12, edge: 4 }, { hex: 3, edge: 4 },
  ];
  const PORT_TYPES = ['any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
  const STANDARD_COUNTS = { wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3, desert: 1 };
  const STANDARD_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  // Heuristic constants (units: weighted pips, i.e. dice combinations out of 36).
  // One victory point, in weighted pips (tunable).
  const VP = () => TUNE.vpValue;
  // Tunable strategy weights (the self-play simulator in sim adjusts these).
  const TUNE = {
    tradeSurplus: 1, // cost per card traded away that no goal needs
    tradeReserve: 3, // cost per card traded away that the best VP build needs
    minValue: 3, // smallest worthwhile action
    progressTrades: false, // trade surplus toward the next goal when nothing is buildable (hurt in self-play)
    devValue: 10, // base value of buying a development card
    cityBonus: 1, // extra value on top of a city's production gain
    settlementBonus: 0, // extra value on a new settlement
    roadFactor: 0.35, // share of a target settlement's value credited to each road toward it
    lrTake: 1.2, // share of a victory point credited to a road that takes Longest Road
    lrDefend: 0.5, // share of a victory point for extending a Longest Road the opponent can catch
    lrBlock: 0.6, // share of a victory point for a settlement that cuts the opponent's Longest Road
    armyDefend: true, // play knights to keep Largest Army ahead of the opponent
    spendReserve: 15, // cost per card an action pushes the nearest VP build further away
    pairedOpening: true, // score opening spots as a pair rather than one at a time
    vpValue: 9, // value of one victory point, in weighted pips
    contestedBonus: 3, // extra value for a settlement spot a rival could reach first
    armyRaceBonus: 2, // extra dev card value while Largest Army is contestable
    robberSelf: 1.3, // weight on avoiding our own tiles when placing the robber
    portAny: 1.5, // value of a 3:1 port at a spot
    port2Factor: 0.35, // value of a 2:1 port per pip of that resource
    monopolyMin: 3, // fewest cards worth taking with Monopoly
    knightEager: 0, // play a knight before rolling when the best robber tile scores at least this (0 = off)
    endgame: 0, // how much production value shrinks as we near the target (0 = off, 1 = down to a quarter at the target)
    etaGoals: false, // rank goals by estimated turns to afford them instead of by missing card count
    roadNeed: 4, // wood+brick pips an opening should have
    roadNeedPenalty: 0, // penalty per pip short of roadNeed (0 = flat -3 below 4)
    stackPenalty: 0, // discount on a tile's value per building we already have on it (robber exposure)
    riskTradeAt: null, // with this many cards over the discard limit (e.g. -1), trade surplus toward the next goal
    expandUrgency: 1, // multiplier on road values once we have no settlements left to upgrade
    denial: 0, // weight on the best opening spot our picks leave a rival who still has to place
    portModel: 'surplus', // value ports by the extra cards their better rate yields: false, true (all production) or 'surplus'
    portTrade: 3, // with portModel: value per extra card-equivalent a port yields
    knightRace: true, // play knights to build toward Largest Army whenever the race is winnable
    knightAlways: false, // play any held knight before rolling when the robber has a worthwhile target
  };
  const PHASE_WEIGHT = { wood: 1, brick: 1, sheep: 0.95, wheat: 1.1, ore: 1.15 }; // long games favour cities and dev cards

  // ---------- Geometry ----------
  function buildGeometry() {
    const hexes = [];
    ROWS.forEach((n, r) => {
      for (let c = 0; c < n; c++) hexes.push({ id: hexes.length, row: r, col: c, x: c + (5 - n) / 2 + 0.5, y: r * SQ3 / 2 });
    });
    const R = 1 / SQ3;
    const vertices = [], edges = [];
    const vkey = new Map(), ekey = new Map();
    for (const h of hexes) {
      h.vertices = [];
      for (let i = 0; i < 6; i++) {
        const a = (60 * i - 90) * Math.PI / 180;
        const x = h.x + R * Math.cos(a), y = h.y + R * Math.sin(a);
        const k = Math.round(x * 1000) + ',' + Math.round(y * 1000);
        if (!vkey.has(k)) { vkey.set(k, vertices.length); vertices.push({ id: vertices.length, x, y, hexes: [], edges: [], neighbors: [] }); }
        const v = vkey.get(k);
        h.vertices.push(v);
        vertices[v].hexes.push(h.id);
      }
      h.edges = [];
      for (let i = 0; i < 6; i++) {
        const a = h.vertices[i], b = h.vertices[(i + 1) % 6];
        const k = Math.min(a, b) + '-' + Math.max(a, b);
        if (!ekey.has(k)) {
          ekey.set(k, edges.length);
          edges.push({ id: edges.length, a, b, hexes: [] });
          vertices[a].edges.push(edges.length - 1); vertices[b].edges.push(edges.length - 1);
          vertices[a].neighbors.push(b); vertices[b].neighbors.push(a);
        }
        const e = ekey.get(k);
        h.edges.push(e);
        edges[e].hexes.push(h.id);
      }
    }
    const ports = PORT_SLOTS.map((s, i) => {
      const h = hexes[s.hex], e = edges[h.edges[s.edge]];
      const mx = (vertices[e.a].x + vertices[e.b].x) / 2, my = (vertices[e.a].y + vertices[e.b].y) / 2;
      const dx = mx - h.x, dy = my - h.y, len = Math.hypot(dx, dy);
      return { id: i, hex: s.hex, edge: e.id, vertices: [e.a, e.b], x: mx + dx / len * 0.32, y: my + dy / len * 0.32 };
    });
    return { hexes, vertices, edges, ports };
  }
  const GEO = buildGeometry();
  const other = (eid, v) => (GEO.edges[eid].a === v ? GEO.edges[eid].b : GEO.edges[eid].a);

  // ---------- Board ----------
  function exampleBoard() {
    const layout = [
      ['wheat', 11], ['wood', 4], ['wood', 8],
      ['ore', 12], ['sheep', 3], ['desert', null], ['wood', 10],
      ['ore', 9], ['wheat', 6], ['wheat', 11], ['brick', 9], ['ore', 5],
      ['brick', 10], ['wheat', 5], ['sheep', 4], ['sheep', 2],
      ['wood', 8], ['sheep', 3], ['brick', 6],
    ];
    return {
      hexes: layout.map(([res, num]) => ({ res, num })),
      ports: ['any', 'brick', 'wheat', 'any', 'sheep', 'wood', 'ore', 'any', 'any'],
      robber: 5,
    };
  }

  function validateBoard(board) {
    const problems = [];
    const counts = {};
    board.hexes.forEach(h => { counts[h.res] = (counts[h.res] || 0) + 1; });
    for (const r of Object.keys(STANDARD_COUNTS)) {
      if ((counts[r] || 0) !== STANDARD_COUNTS[r]) problems.push(`${RES_LABEL[r]}: ${counts[r] || 0} tiles (expected ${STANDARD_COUNTS[r]})`);
    }
    const nums = board.hexes.filter(h => h.res !== 'desert').map(h => h.num).sort((a, b) => a - b);
    if (nums.join() !== STANDARD_NUMBERS.join()) problems.push('Number tokens differ from the standard set');
    board.hexes.forEach((h, i) => { if (h.res !== 'desert' && !PIPS[h.num]) problems.push(`Tile ${i + 1} has no number`); });
    return problems;
  }

  function hexLabel(board, h) {
    const t = board.hexes[h];
    return t.res === 'desert' ? 'Desert' : `${RES_LABEL[t.res]} ${t.num}`;
  }
  // Ports as [{vertices, type}]: board.portList when the map supplies its own positions, else the standard slots.
  function boardPorts(board) {
    return board.portList || GEO.ports.map(pt => ({ vertices: pt.vertices, type: board.ports[pt.id] }));
  }
  function portAt(board, v) {
    const p = boardPorts(board).find(pt => pt.vertices.includes(v));
    return p ? p.type : null;
  }
  function vertexLabel(board, v) {
    const hs = GEO.vertices[v].hexes.slice().sort((a, b) => (PIPS[board.hexes[b].num] || 0) - (PIPS[board.hexes[a].num] || 0));
    const port = portAt(board, v);
    return hs.map(h => hexLabel(board, h)).join(' · ') + (port ? ` (${port === 'any' ? '3:1' : RES_LABEL[port] + ' 2:1'} port)` : '');
  }
  function edgeLabel(board, e) {
    return `between ${vertexLabel(board, GEO.edges[e].a)} and ${vertexLabel(board, GEO.edges[e].b)}`;
  }

  // ---------- Game state ----------
  const emptyHand = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const handSize = hand => RES.reduce((s, r) => s + hand[r], 0);

  function newPlayer(name) {
    return {
      name, settlements: [], cities: [], roads: [], res: emptyHand(),
      dev: { knight: 0, vp: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }, // known, unplayed cards (yours)
      devNew: { knight: 0, vp: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }, // bought this turn
      devHidden: 0, // unplayed cards of unknown type (opponent)
      knights: 0,
    };
  }

  function newGame({ first = 1, target = 15, discardLimit = 7 } = {}) {
    return {
      target, discardLimit, first,
      players: [newPlayer('You'), newPlayer('Opponent')],
      phase: 'setup', setupStep: 0, setupSub: 'settlement', lastSetupVertex: null,
      turn: { player: first, number: 0, rolled: false, devPlayed: false, roll: null },
      pending: null, devBought: 0, awards: { road: null, army: null },
    };
  }

  // Snake order: each player once starting with `first`, then the same order reversed.
  const setupOrder = game => {
    const n = game.players.length;
    const round = Array.from({ length: n }, (_, i) => (game.first + i) % n);
    return [...round, ...round.slice().reverse()];
  };
  function currentPlayer(game) {
    return game.phase === 'setup' ? setupOrder(game)[game.setupStep] : game.turn.player;
  }

  function occupancy(game) {
    const v = new Array(GEO.vertices.length).fill(null);
    const e = new Array(GEO.edges.length).fill(null);
    game.players.forEach((pl, p) => {
      pl.settlements.forEach(id => { v[id] = { p, city: false }; });
      pl.cities.forEach(id => { v[id] = { p, city: true }; });
      pl.roads.forEach(id => { e[id] = p; });
    });
    return { v, e };
  }

  const others = (game, p) => game.players.map((_, q) => q).filter(q => q !== p);
  const hasRoadAt = (o, p, v) => GEO.vertices[v].edges.some(e => o.e[e] === p);
  const canSettleSpot = (o, v) => !o.v[v] && GEO.vertices[v].neighbors.every(n => !o.v[n]);

  function canBuildRoad(game, o, p, e) {
    if (o.e[e] !== null) return false;
    const { a, b } = GEO.edges[e];
    if (game.phase === 'setup') return a === game.lastSetupVertex || b === game.lastSetupVertex;
    return [a, b].some(x => (o.v[x] && o.v[x].p === p) || (!o.v[x] && hasRoadAt(o, p, x)));
  }

  function tradeRates(board, o, p) {
    const rates = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    boardPorts(board).forEach(pt => {
      if (!pt.vertices.some(v => o.v[v] && o.v[v].p === p)) return;
      const t = pt.type;
      if (t === 'any') RES.forEach(r => { rates[r] = Math.min(rates[r], 3); });
      else rates[t] = 2;
    });
    return rates;
  }

  function production(board, o, p, { robber = true } = {}) {
    const prod = emptyHand();
    board.hexes.forEach((t, h) => {
      if (t.res === 'desert' || (robber && board.robber === h)) return;
      for (const v of GEO.hexes[h].vertices) {
        if (o.v[v] && o.v[v].p === p) prod[t.res] += PIPS[t.num] * (o.v[v].city ? 2 : 1);
      }
    });
    return prod;
  }

  function longestRoad(o, p) {
    let best = 0;
    const used = new Set();
    const blocked = x => o.v[x] && o.v[x].p !== p;
    const dfs = (x, len) => {
      if (len > best) best = len;
      if (len > 0 && blocked(x)) return;
      for (const e of GEO.vertices[x].edges) {
        if (o.e[e] !== p || used.has(e)) continue;
        used.add(e); dfs(other(e, x), len + 1); used.delete(e);
      }
    };
    GEO.vertices.forEach(vx => { if (hasRoadAt(o, p, vx.id)) dfs(vx.id, 0); });
    return best;
  }

  function updateAwards(game) {
    const o = occupancy(game);
    const lens = game.players.map((_, p) => longestRoad(o, p));
    game.awards.road = pickAward(game.awards.road, lens, 5);
    game.awards.army = pickAward(game.awards.army, game.players.map(pl => pl.knights), 3);
    return lens;
  }
  function pickAward(holder, values, min) {
    if (holder !== null && values[holder] < min) holder = null;
    for (let p = 0; p < values.length; p++) {
      if (values[p] >= min && (holder === null || values[p] > values[holder])) holder = p;
    }
    return holder;
  }

  function victoryPoints(game, p) {
    const pl = game.players[p];
    return pl.settlements.length + 2 * pl.cities.length + pl.dev.vp + pl.devNew.vp +
      (game.awards.road === p ? 2 : 0) + (game.awards.army === p ? 2 : 0);
  }

  // ---------- Actions (mutate game; return a log line) ----------
  function pay(pl, cost) {
    let short = false;
    for (const r of Object.keys(cost)) {
      if (pl.res[r] < cost[r]) short = true;
      pl.res[r] = Math.max(0, pl.res[r] - cost[r]);
    }
    return short;
  }

  function buildSettlement(board, game, p, v, { free = false } = {}) {
    const o = occupancy(game), pl = game.players[p];
    if (!canSettleSpot(o, v)) return { error: 'Too close to another settlement (or occupied).' };
    if (game.phase !== 'setup' && !hasRoadAt(o, p, v)) return { error: 'Settlements must connect to your own road.' };
    if (pl.settlements.length >= PIECES.settlement) return { error: 'No settlements left.' };
    const short = game.phase !== 'setup' && !free && pay(pl, COST.settlement);
    pl.settlements.push(v);
    if (game.phase === 'setup') {
      if (game.players[p].settlements.length === 2) {
        GEO.vertices[v].hexes.forEach(h => { const t = board.hexes[h]; if (t.res !== 'desert') pl.res[t.res] += 1; });
      }
      game.lastSetupVertex = v;
      game.setupSub = 'road';
    }
    updateAwards(game);
    return { log: `${pl.name} built a settlement on ${vertexLabel(board, v)}`, short };
  }

  function buildCity(board, game, p, v) {
    const pl = game.players[p];
    if (!pl.settlements.includes(v)) return { error: 'A city must replace one of your settlements.' };
    if (pl.cities.length >= PIECES.city) return { error: 'No cities left.' };
    const short = pay(pl, COST.city);
    pl.settlements = pl.settlements.filter(x => x !== v);
    pl.cities.push(v);
    return { log: `${pl.name} upgraded ${vertexLabel(board, v)} to a city`, short };
  }

  function buildRoad(board, game, p, e, { free = false } = {}) {
    const o = occupancy(game), pl = game.players[p];
    if (!canBuildRoad(game, o, p, e)) return { error: 'That road is not connected to the player\'s network (or is taken).' };
    if (pl.roads.length >= PIECES.road) return { error: 'No roads left.' };
    const short = game.phase !== 'setup' && !free && pay(pl, COST.road);
    pl.roads.push(e);
    if (game.phase === 'setup') {
      game.setupSub = 'settlement';
      game.lastSetupVertex = null;
      game.setupStep += 1;
      if (game.setupStep >= 2 * game.players.length) {
        game.phase = 'main';
        game.turn = { player: game.first, number: 1, rolled: false, devPlayed: false, roll: null };
      }
    }
    const before = game.awards.road;
    updateAwards(game);
    const award = game.awards.road !== before && game.awards.road === p ? ' — takes Longest Road!' : '';
    return { log: `${pl.name} built a road ${edgeLabel(board, e)}${award}`, short };
  }

  function rollDice(board, game, n) {
    const o = occupancy(game);
    const gains = game.players.map(() => emptyHand());
    if (n !== 7) {
      board.hexes.forEach((t, h) => {
        if (t.num !== n || board.robber === h) return;
        for (const v of GEO.hexes[h].vertices) if (o.v[v]) gains[o.v[v].p][t.res] += o.v[v].city ? 2 : 1;
      });
      gains.forEach((g, p) => RES.forEach(r => { game.players[p].res[r] += g[r]; }));
    }
    game.turn.rolled = true;
    game.turn.roll = n;
    return gains;
  }

  function endTurn(game) {
    game.players.forEach(pl => {
      DEV_TYPES.forEach(t => { pl.dev[t] += pl.devNew[t]; pl.devNew[t] = 0; });
    });
    game.turn = { player: 1 - game.turn.player, number: game.turn.number + 1, rolled: false, devPlayed: false, roll: null };
    game.pending = null;
  }

  // ---------- Heuristics ----------
  function scarcityWeights(board) {
    const total = emptyHand();
    board.hexes.forEach(t => { if (t.res !== 'desert') total[t.res] += PIPS[t.num] || 0; });
    const mean = RES.reduce((s, r) => s + total[r], 0) / 5;
    const w = {};
    RES.forEach(r => { w[r] = Math.min(1.4, Math.max(0.75, Math.sqrt(mean / Math.max(1, total[r])))) * PHASE_WEIGHT[r]; });
    return w;
  }

  function rawPips(board, v) {
    return GEO.vertices[v].hexes.reduce((s, h) => s + (PIPS[board.hexes[h].num] || 0), 0);
  }

  // Value of the port at v: the extra cards per roll its better rate yields on our production
  // (including what v itself would produce), relative to the rates we already have.
  // Typical share of each resource that builds consume (roads, settlements, cities, dev cards).
  const DEMAND = { wood: 0.2, brick: 0.2, sheep: 0.15, wheat: 0.24, ore: 0.21 };
  function portGain(board, port, prod, rates) {
    let tradable = prod;
    if (TUNE.portModel === 'surplus') {
      // Only production beyond what our own builds use ends up traded.
      const total = RES.reduce((s, r) => s + prod[r], 0);
      tradable = {};
      RES.forEach(r => { tradable[r] = Math.max(0, prod[r] - DEMAND[r] * total); });
    }
    if (port === 'any') return RES.reduce((s, r) => s + tradable[r] * Math.max(0, 1 / 3 - 1 / rates[r]), 0);
    return tradable[port] * Math.max(0, 1 / 2 - 1 / rates[port]);
  }
  const prodWith = (board, prod, v) => {
    const out = { ...prod };
    GEO.vertices[v].hexes.forEach(h => { const t = board.hexes[h]; if (t.res !== 'desert' && PIPS[t.num]) out[t.res] += PIPS[t.num]; });
    return out;
  };

  // " — the 2:1 port turns your spare Wheat into …" when a port at v pays off on our surplus.
  function portWhy(board, o, p, v) {
    const port = portAt(board, v);
    if (!port || !TUNE.portModel) return '';
    const gain = portGain(board, port, prodWith(board, production(board, o, p), v), tradeRates(board, o, p));
    if (gain < 0.5) return '';
    return port === 'any' ? ' — the 3:1 port pays off on your spare cards' : ` — the 2:1 port pays off on your spare ${RES_LABEL[port]}`;
  }

  function vertexScore(board, o, p, v, prod = production(board, o, p)) {
    const sw = scarcityWeights(board);
    let s = 0;
    const kinds = new Set();
    for (const h of GEO.vertices[v].hexes) {
      const t = board.hexes[h];
      if (t.res === 'desert' || !PIPS[t.num]) continue;
      const pip = PIPS[t.num] * (board.robber === h ? 0.5 : 1) * stackFactor(o, p, h, v);
      const have = prod[t.res];
      const need = have === 0 ? 1.25 : have < 4 ? 1.1 : have < 8 ? 1 : 0.85;
      s += pip * sw[t.res] * need;
      kinds.add(t.res);
    }
    kinds.forEach(r => { if (prod[r] === 0) s += 1.5; });
    const port = portAt(board, v);
    if (port && TUNE.portModel) s += TUNE.portTrade * portGain(board, port, prodWith(board, prod, v), tradeRates(board, o, p));
    else if (port === 'any') s += TUNE.portAny;
    else if (port) {
      const atV = GEO.vertices[v].hexes.reduce((n, h) => n + (board.hexes[h].res === port ? PIPS[board.hexes[h].num] : 0), 0);
      s += Math.min(4, TUNE.port2Factor * (prod[port] + atV));
    }
    return s;
  }

  // Value of upgrading settlement v to a city: its production counted once more.
  // Robber exposure: a tile we already lean on is worth less for the next building (the robber will sit on it).
  function stackFactor(o, p, h, exclude) {
    if (!TUNE.stackPenalty || !o) return 1;
    const weight = GEO.hexes[h].vertices.reduce((n, v) => n + (v !== exclude && o.v[v] && o.v[v].p === p ? (o.v[v].city ? 2 : 1) : 0), 0);
    return 1 / (1 + TUNE.stackPenalty * weight);
  }

  function cityGain(board, v, o, p) {
    const sw = scarcityWeights(board);
    return GEO.vertices[v].hexes.reduce((s, h) => {
      const t = board.hexes[h];
      if (t.res === 'desert') return s;
      return s + PIPS[t.num] * sw[t.res] * (board.robber === h ? 0.5 : 1) * stackFactor(o, p, h, v);
    }, 0);
  }

  // BFS over buildable edges from p's network; dist[v] = roads needed to reach v.
  function roadDistances(o, p) {
    const n = GEO.vertices.length;
    const dist = new Array(n).fill(Infinity), via = new Array(n).fill(null);
    const opp = x => o.v[x] && o.v[x].p !== p;
    const q = [];
    for (let x = 0; x < n; x++) {
      if ((o.v[x] && o.v[x].p === p) || (!opp(x) && hasRoadAt(o, p, x))) { dist[x] = 0; q.push(x); }
    }
    for (let i = 0; i < q.length; i++) {
      const u = q[i];
      for (const e of GEO.vertices[u].edges) {
        if (o.e[e] !== null) continue;
        const w = other(e, u);
        if (opp(w) || dist[w] <= dist[u] + 1) continue;
        dist[w] = dist[u] + 1; via[w] = e; q.push(w);
      }
    }
    const path = target => {
      const edges = [];
      let x = target;
      while (dist[x] > 0 && via[x] !== null) { edges.unshift(via[x]); x = other(via[x], x); }
      return edges;
    };
    return { dist, path };
  }

  function expansionTargets(board, game, o, p) {
    const pl = game.players[p];
    const mine = roadDistances(o, p);
    const theirs = others(game, p).map(q => roadDistances(o, q).dist);
    const rivalDist = v => Math.min(Infinity, ...theirs.map(dist => dist[v]));
    const prod = production(board, o, p);
    const roadsLeft = PIECES.road - pl.roads.length;
    const out = [];
    GEO.vertices.forEach(({ id: v }) => {
      if (!canSettleSpot(o, v) || mine.dist[v] > Math.min(roadsLeft, 4)) return;
      out.push({
        v, dist: mine.dist[v], score: vertexScore(board, o, p, v, prod), path: mine.path(v),
        contested: rivalDist(v) <= mine.dist[v] && rivalDist(v) <= 2,
      });
    });
    return out;
  }

  function cloneGame(game) { return JSON.parse(JSON.stringify(game)); }

  function missing(hand, cost) {
    const m = {};
    for (const r of Object.keys(cost)) if (hand[r] < cost[r]) m[r] = cost[r] - hand[r];
    return m;
  }
  const missingCount = m => Object.values(m).reduce((s, n) => s + n, 0);

  // Bank/port trades that cover the cost; returns null if impossible.
  function tradesFor(hand, cost, rates, reserve = {}) {
    const h = { ...hand };
    const need = missing(h, cost);
    const trades = [];
    for (const r of Object.keys(need)) {
      for (let k = 0; k < need[r]; k++) {
        const surplus = res => h[res] - (cost[res] || 0) - (reserve[res] || 0);
        const giver = RES.filter(g => g !== r && surplus(g) >= rates[g])
          .sort((a, b) => rates[a] - rates[b] || surplus(b) - surplus(a))[0];
        if (!giver) return null;
        h[giver] -= rates[giver]; h[r] += 1;
        const last = trades[trades.length - 1];
        if (last && last.give === giver && last.get === r) { last.n += 1; } else trades.push({ give: giver, rate: rates[giver], get: r, n: 1 });
      }
    }
    return trades;
  }

  // Production matters less the closer we are to winning: there are fewer turns left to use it.
  function productionScale(game, p) {
    if (!TUNE.endgame) return 1;
    const progress = Math.max(0, victoryPoints(game, p) / game.target - 0.5) * 2; // 0 at half the target, 1 at the target
    return Math.max(0.25, 1 - 0.75 * TUNE.endgame * progress);
  }

  function candidateActions(board, game, p) {
    const o = occupancy(game), pl = game.players[p];
    const ps = productionScale(game, p);
    const targets = expansionTargets(board, game, o, p);
    const cands = [];
    if (pl.settlements.length < PIECES.settlement) {
      const rivals = others(game, p).map(q => ({ q, lr: longestRoad(o, q) }));
      const myLR = longestRoad(o, p);
      targets.filter(t => t.dist === 0).forEach(t => {
        // A settlement can cut a rival's road; worth a lot when it costs them Longest Road.
        let block = 0, blockWhy = '';
        o.v[t.v] = { p, city: false };
        rivals.forEach(({ q, lr }) => {
          const after = longestRoad(o, q);
          if (after >= lr) return;
          if (game.awards.road === q && (after < 5 || after <= myLR)) { block = Math.max(block, VP() * TUNE.lrBlock); blockWhy = ` — cuts ${game.players[q].name}'s Longest Road`; }
          else if (lr >= myLR - 1) block = Math.max(block, 2);
        });
        o.v[t.v] = null;
        cands.push({
          type: 'settlement', v: t.v, cost: COST.settlement, value: VP() + ps * t.score + (t.contested ? TUNE.contestedBonus : 0) + TUNE.settlementBonus + block,
          text: `Build a settlement on ${vertexLabel(board, t.v)}${blockWhy}${portWhy(board, o, p, t.v)}`,
        });
      });
    }
    if (pl.cities.length < PIECES.city) {
      pl.settlements.forEach(v => cands.push({
        type: 'city', v, cost: COST.city, value: VP() + ps * cityGain(board, v, o, p) + TUNE.cityBonus,
        text: `Upgrade ${vertexLabel(board, v)} to a city (+${rawPips(board, v)} pips)`,
      }));
    }
    if (pl.roads.length < PIECES.road) {
      const lrBefore = longestRoad(o, p);
      const oppLR = Math.max(0, ...others(game, p).map(q => longestRoad(o, q)));
      const roadCands = new Map();
      if (pl.settlements.length < PIECES.settlement) {
        targets.filter(t => t.dist >= 1 && t.dist <= 3 && t.path.length).forEach(t => {
          const urgency = pl.settlements.length === 0 ? TUNE.expandUrgency : 1; // every settlement already a city
          const value = urgency * TUNE.roadFactor * (VP() + ps * t.score) / t.dist + (t.contested ? 2 : 0);
          const e = t.path[0];
          if (!roadCands.has(e) || roadCands.get(e).value < value) {
            roadCands.set(e, { value, why: `toward ${vertexLabel(board, t.v)} (${t.dist} road${t.dist > 1 ? 's' : ''} away${t.contested ? ', contested' : ''})` });
          }
        });
      }
      // Longest Road: taking it, or defending it against a rival who could catch up next turn
      // (a hidden dev card might be Road Building).
      const rivalReach = Math.max(0, ...others(game, p).map(q => longestRoad(o, q) + 1 + (game.players[q].devHidden > 0 ? 1 : 0)));
      const defending = game.awards.road === p && rivalReach >= lrBefore;
      GEO.edges.forEach(({ id: e }) => {
        if (!canBuildRoad(game, o, p, e)) return;
        o.e[e] = p;
        const lrAfter = longestRoad(o, p);
        o.e[e] = null;
        if (lrAfter <= lrBefore) return;
        const takes = lrAfter >= 5 && lrAfter > oppLR && game.awards.road !== p;
        const bonus = takes ? VP() * TUNE.lrTake
          : defending ? VP() * TUNE.lrDefend
            : (lrAfter >= 4 && lrAfter >= oppLR ? 1.5 : 0.5);
        const cur = roadCands.get(e);
        const why = takes ? ' — takes Longest Road' : defending ? ' — protects your Longest Road' : '';
        if (cur) { cur.value += bonus; cur.why += why; }
        else if (bonus > 1) roadCands.set(e, { value: bonus, why: why ? why.slice(3) : 'extends your longest road' });
      });
      roadCands.forEach((c, e) => cands.push({
        type: 'road', e, cost: COST.road, value: c.value, text: `Build a road ${c.why}`,
      }));
    }
    const devLeft = DEV_TOTAL - game.devBought;
    if (devLeft > 0) {
      const opKnights = Math.max(0, ...others(game, p).map(q => game.players[q].knights));
      const armyRace = game.awards.army !== p && opKnights <= pl.knights + pl.dev.knight + 2 ? TUNE.armyRaceBonus : 0;
      cands.push({ type: 'dev', cost: COST.dev, value: TUNE.devValue + armyRace, text: 'Buy a development card' });
    }
    return cands;
  }

  function applySim(game, p, c) {
    const pl = game.players[p];
    RES.forEach(r => { pl.res[r] -= c.cost[r] || 0; });
    if (c.type === 'settlement') pl.settlements.push(c.v);
    if (c.type === 'city') { pl.settlements = pl.settlements.filter(x => x !== c.v); pl.cities.push(c.v); }
    if (c.type === 'road') pl.roads.push(c.e);
    if (c.type === 'dev') game.devBought += 1;
    updateAwards(game);
  }

  // Feasible next steps (an action plus the trades it needs), best first by value net of trade and saving costs.
  function rankedSteps(board, game, p) {
    const o = occupancy(game);
    const rates = tradeRates(board, o, p);
    const cands = candidateActions(board, game, p);
    const hand = game.players[p].res;
    const vpCands = cands.filter(c => c.type === 'city' || c.type === 'settlement');
    const vpBuild = vpCands.slice().sort((a, b) => b.value - a.value)[0];
    // The VP build closest to completion, which other spending shouldn't set back.
    const dist = c => goalDistance(board, game, p, missing(hand, c.cost));
    const nearest = vpCands.slice().sort((a, b) => b.value / (1 + dist(b)) - a.value / (1 + dist(a)))[0];
    const nearMissing = nearest ? missingCount(missing(hand, nearest.cost)) : 0;
    const out = [];
    for (const c of cands) {
      const isGoal = vpBuild && c.type === vpBuild.type && c.v === vpBuild.v;
      const reserve = vpBuild && !isGoal ? vpBuild.cost : null;
      let trades = reserve ? tradesFor(hand, c.cost, rates, reserve) : null;
      let factor = TUNE.tradeSurplus;
      if (!trades) { trades = tradesFor(hand, c.cost, rates); factor = reserve ? TUNE.tradeReserve : TUNE.tradeSurplus; }
      if (!trades) continue;
      let penalty = trades.reduce((s, t) => s + t.rate * t.n * factor, 0);
      if (TUNE.spendReserve && nearest && !(c.type === nearest.type && c.v === nearest.v)) {
        const after = { ...hand };
        trades.forEach(t => { after[t.give] -= t.rate * t.n; after[t.get] += t.n; });
        RES.forEach(r => { after[r] -= c.cost[r] || 0; });
        penalty += TUNE.spendReserve * Math.max(0, missingCount(missing(after, nearest.cost)) - nearMissing);
      }
      const eff = c.value - penalty;
      if (eff >= TUNE.minValue) out.push({ ...c, trades, eff });
    }
    return out.sort((a, b) => b.eff - a.eff);
  }

  // Greedy plan for the rest of p's turn (after rolling).
  function planTurn(board, game, p) {
    const sim = cloneGame(game);
    const steps = [];
    for (let iter = 0; iter < 10; iter++) {
      const best = rankedSteps(board, sim, p)[0];
      const pl = sim.players[p];
      if (!best) {
        // Nothing buildable: optionally convert idle cards toward the next goal.
        const atRisk = TUNE.riskTradeAt !== null && handSize(pl.res) >= sim.discardLimit + TUNE.riskTradeAt;
        const t = (TUNE.progressTrades || atRisk) && progressTrades(board, sim, p, tradeRates(board, occupancy(sim), p));
        if (!t) break;
        t.trades.forEach(x => { pl.res[x.give] -= x.rate * x.n; pl.res[x.get] += x.n; });
        steps.push(t);
        continue;
      }
      best.trades.forEach(t => { pl.res[t.give] -= t.rate * t.n; pl.res[t.get] += t.n; });
      applySim(sim, p, best);
      steps.push(best);
    }
    return { steps, handAfter: sim.players[p].res, game: sim };
  }

  // Bank trades of cards no goal needs into cards the next goal is missing (one resource per call).
  function progressTrades(board, game, p, rates) {
    const hand = game.players[p].res;
    const goal = savingTarget(board, game, p, hand);
    if (!goal) return null;
    const keep = { ...goal.cost };
    const want = Object.keys(goal.missing).sort((a, b) => goal.missing[b] - goal.missing[a])[0];
    const giver = RES.filter(r => r !== want && hand[r] - (keep[r] || 0) >= rates[r])
      .sort((a, b) => rates[a] - rates[b] || (hand[b] - (keep[b] || 0)) - (hand[a] - (keep[a] || 0)))[0];
    if (!giver) return null;
    return {
      type: 'trade', trades: [{ give: giver, rate: rates[giver], get: want, n: 1 }], cost: {}, value: 0,
      text: `Trade toward: ${goal.text.charAt(0).toLowerCase() + goal.text.slice(1)}`,
    };
  }

  // Estimated own turns until `missing` is covered, from production (all players roll once per round)
  // plus bank/port trades of other income.
  function turnsToAfford(board, game, p, m) {
    const o = occupancy(game);
    const prod = production(board, o, p);
    const rates = tradeRates(board, o, p);
    const rolls = game.players.length;
    const income = r => prod[r] * rolls / 36;
    const total = RES.reduce((s, r) => s + income(r), 0);
    let eta = 0;
    for (const [r, n] of Object.entries(m)) {
      const viaTrade = (total - income(r)) / Math.min(...RES.filter(x => x !== r).map(x => rates[x]));
      eta = Math.max(eta, n / Math.max(0.05, income(r) + viaTrade));
    }
    return eta;
  }

  // Goal "distance": estimated turns (etaGoals) or missing cards.
  function goalDistance(board, game, p, m) {
    return TUNE.etaGoals ? turnsToAfford(board, game, p, m) : missingCount(m);
  }

  // What to save for when nothing is affordable (or after the plan).
  function savingTarget(board, game, p, hand, { includeAffordable = false } = {}) {
    const cands = candidateActions(board, game, p);
    let best = null;
    for (const c of cands) {
      const m = missing(hand, c.cost);
      const n = missingCount(m);
      if (n === 0 && !includeAffordable) continue;
      const score = c.value / (1 + goalDistance(board, game, p, m));
      if (!best || score > best.score) best = { ...c, missing: m, score };
    }
    return best;
  }

  // Best robber tiles for p: block rivals (weighted toward the leader), avoid own tiles, need someone to rob.
  function robberAdvice(board, game, p) {
    const o = occupancy(game);
    const sw = scarcityWeights(board);
    const vp = game.players.map((_, q) => victoryPoints(game, q) + (game.players[q].vpHidden || 0));
    const cards = q => (game.players[q].cardCount !== undefined ? game.players[q].cardCount : handSize(game.players[q].res));
    const out = [];
    board.hexes.forEach((t, h) => {
      if (h === board.robber) return;
      let score = 0;
      const victims = new Set();
      for (const v of GEO.hexes[h].vertices) {
        if (!o.v[v] || t.res === 'desert') continue;
        const q = o.v[v].p;
        const amount = PIPS[t.num] * (o.v[v].city ? 2 : 1) * sw[t.res];
        if (q === p) score -= TUNE.robberSelf * amount;
        else { score += amount * (1 + 0.1 * vp[q]); victims.add(q); }
      }
      const robbable = [...victims].filter(q => cards(q) > 0).sort((a, b) => vp[b] - vp[a] || cards(b) - cards(a));
      if (robbable.length) score += 1;
      out.push({ hex: h, score, victims: robbable.length > 0, victim: robbable.length ? robbable[0] : null });
    });
    return out.sort((a, b) => b.score - a.score);
  }

  function discardAdvice(board, game, p) {
    const pl = game.players[p];
    const n = handSize(pl.res);
    if (n <= game.discardLimit) return null;
    const count = Math.floor(n / 2);
    const target = savingTarget(board, game, p, pl.res, { includeAffordable: true }) || { type: 'city', cost: COST.city };
    // Keep cards for the nearest build plus the best victory-point build.
    const vpBuild = candidateActions(board, game, p).filter(c => c.type === 'city' || c.type === 'settlement')
      .sort((a, b) => missingCount(missing(pl.res, a.cost)) - missingCount(missing(pl.res, b.cost)) || b.value - a.value)[0];
    const keepPriority = { ...target.cost };
    if (vpBuild && !(vpBuild.type === target.type && vpBuild.v === target.v)) RES.forEach(r => { keepPriority[r] = (keepPriority[r] || 0) + (vpBuild.cost[r] || 0); });
    const hand = { ...pl.res };
    const discard = emptyHand();
    for (let k = 0; k < count; k++) {
      // Drop the card that is least needed: most surplus over the target, then most plentiful.
      const r = RES.filter(x => hand[x] > 0)
        .sort((a, b) => (hand[b] - (keepPriority[b] || 0)) - (hand[a] - (keepPriority[a] || 0)) || hand[b] - hand[a])[0];
      hand[r] -= 1; discard[r] += 1;
    }
    return { count, discard, keepingFor: target.type };
  }

  // Value of an opening (a set of settlement spots): production with diminishing returns plus balance bonuses.
  function openingValue(board, vs, sw = scarcityWeights(board)) {
    const prod = emptyHand();
    vs.forEach(v => GEO.vertices[v].hexes.forEach(h => {
      const t = board.hexes[h];
      if (t.res !== 'desert' && PIPS[t.num]) prod[t.res] += PIPS[t.num] * (board.robber === h ? 0.5 : 1);
    }));
    let s = 0;
    RES.forEach(r => {
      const x = prod[r];
      s += sw[r] * (Math.min(x, 6) + 0.6 * Math.max(0, x - 6));
      if (x > 0) s += 1.5;
    });
    if (prod.wood > 0 && prod.brick > 0) s += 2.5; // can expand
    if (prod.wheat > 0 && prod.ore > 0) s += 2; // can build cities and dev cards
    const woodBrick = prod.wood + prod.brick; // stuck without roads otherwise
    if (TUNE.roadNeedPenalty) s -= TUNE.roadNeedPenalty * Math.max(0, TUNE.roadNeed - woodBrick);
    else if (woodBrick < 4) s -= 3;
    const base = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    vs.forEach(v => {
      const port = portAt(board, v);
      if (port && TUNE.portModel) s += TUNE.portTrade * portGain(board, port, prod, base);
      else if (port === 'any') s += TUNE.portAny;
      else if (port) s += Math.min(4, TUNE.port2Factor * prod[port]);
    });
    return s;
  }

  function setupAdvice(board, game, p) {
    const o = occupancy(game);
    if (game.setupSub === 'settlement' && !TUNE.pairedOpening) {
      const prod = production(board, o, p);
      const spots = GEO.vertices.filter(v => canSettleSpot(o, v.id))
        .map(v => ({ v: v.id, score: vertexScore(board, o, p, v.id, prod), pips: rawPips(board, v.id) }))
        .sort((a, b) => b.score - a.score);
      return { kind: 'settlement', spots: spots.slice(0, 5) };
    }
    if (game.setupSub === 'settlement') {
      const sw = scarcityWeights(board);
      const pl = game.players[p];
      const mine = [...pl.settlements, ...pl.cities];
      const legal = GEO.vertices.filter(v => canSettleSpot(o, v.id)).map(v => v.id);
      // Rivals who still place after us; our picks shouldn't leave them a great spot.
      const pending = TUNE.denial ? others(game, p).filter(q => game.players[q].settlements.length + game.players[q].cities.length < 2) : [];
      const rivalBest = taken => {
        if (!pending.length) return 0;
        const blocked = new Set(taken.flatMap(v => [v, ...GEO.vertices[v].neighbors]));
        let best = 0;
        for (const q of pending) {
          const theirs = [...game.players[q].settlements, ...game.players[q].cities];
          const base = openingValue(board, theirs, sw);
          for (const w of legal) if (!blocked.has(w)) best = Math.max(best, openingValue(board, [...theirs, w], sw) - base);
        }
        return best;
      };
      const placed = game.players.reduce((n, q) => n + q.settlements.length + q.cities.length, 0);
      const between = Math.max(0, 2 * game.players.length - 2 - 2 * placed);
      let score;
      if (mine.length) {
        score = v => openingValue(board, [...mine, v], sw) - TUNE.denial * rivalBest([...mine, v]);
      } else if (TUNE.denial && between === 0) {
        // Two picks in a row: choose the pair, then account for the rival's reply.
        score = a => {
          const near = new Set([a, ...GEO.vertices[a].neighbors]);
          let best = -Infinity;
          for (const b of legal) if (!near.has(b)) best = Math.max(best, openingValue(board, [a, b], sw) - TUNE.denial * rivalBest([a, b]));
          return best === -Infinity ? openingValue(board, [a], sw) : best;
        };
      } else {
        // First pick: pair it with the partner likely still free when our second pick comes round.
        score = a => {
          const near = new Set([a, ...GEO.vertices[a].neighbors]);
          const partners = legal.filter(b => !near.has(b)).map(b => openingValue(board, [a, b], sw)).sort((x, y) => y - x);
          const pairValue = partners.length ? partners[Math.min(between, partners.length - 1)] : openingValue(board, [a], sw);
          return pairValue - TUNE.denial * rivalBest([a]);
        };
      }
      const spots = legal.map(v => ({ v, score: score(v), pips: rawPips(board, v) })).sort((a, b) => b.score - a.score);
      return { kind: 'settlement', spots: spots.slice(0, 5) };
    }
    // Road: point toward the best spot two steps away.
    const from = game.lastSetupVertex;
    const prodAfter = production(board, o, p);
    const roads = GEO.vertices[from].edges.filter(e => o.e[e] === null).map(e => {
      const mid = other(e, from);
      let best = null;
      for (const w of GEO.vertices[mid].neighbors) {
        if (w === from || !canSettleSpot(o, w)) continue;
        const s = vertexScore(board, o, p, w, prodAfter);
        if (!best || s > best.score) best = { v: w, score: s };
      }
      return { e, target: best };
    }).sort((a, b) => (b.target ? b.target.score : 0) - (a.target ? a.target.score : 0));
    return { kind: 'road', roads };
  }

  // Dev cards worth playing now.
  function devCardAdvice(board, game, p) {
    const pl = game.players[p];
    const tips = [];
    if (game.turn.devPlayed || game.turn.player !== p) return tips;
    const o = occupancy(game);
    if (pl.dev.knight > 0) {
      const robbed = board.robber !== null && GEO.hexes[board.robber].vertices.some(v => o.v[v] && o.v[v].p === p);
      const army = game.awards.army !== p && pl.knights + 1 >= 3 && others(game, p).every(q => pl.knights + 1 > game.players[q].knights);
      // Keep Largest Army out of reach: a rival with hidden cards could match us next turn.
      const keep = TUNE.armyDefend && game.awards.army === p &&
        others(game, p).some(q => game.players[q].knights + (game.players[q].devHidden > 0 ? 1 : 0) >= pl.knights);
      // Use a knight to block the rival's best tile when the robber would do real damage there.
      const target = robberAdvice(board, game, p)[0];
      const block = !game.turn.rolled && target && (
        (TUNE.knightEager > 0 && target.score >= TUNE.knightEager) || (TUNE.knightAlways && target.score > 0));
      // Race for Largest Army: knights in hand can still overtake the leader.
      const rivalKnights = Math.max(0, ...others(game, p).map(q => game.players[q].knights));
      const race = TUNE.knightRace && game.awards.army !== p && target && target.score > 0 &&
        pl.knights + pl.dev.knight > rivalKnights && pl.knights + pl.dev.knight >= 3;
      if (robbed || army || keep || block || race) {
        const why = [robbed && 'the robber is blocking you', army && 'it wins Largest Army (+2 VP)', keep && 'it keeps Largest Army out of reach',
          race && !army && `it moves you to ${pl.knights + 1} of the 3+ knights needed for Largest Army`,
          block && !robbed && !army && !keep && 'the robber can block your rival\'s best tile'].filter(Boolean).join(' and ');
        tips.push({ card: 'knight', text: `Play a Knight${game.turn.rolled ? '' : ' before rolling'}: ${why}.` });
      }
    }
    if (pl.dev.roadBuilding > 0) {
      const t = expansionTargets(board, game, o, p).filter(x => x.dist >= 1 && x.dist <= 2).sort((a, b) => b.score - a.score)[0];
      if (t) tips.push({ card: 'roadBuilding', text: `Play Road Building to reach ${vertexLabel(board, t.v)}.` });
    }
    if (pl.dev.yearOfPlenty > 0 && game.turn.rolled) {
      const t = savingTarget(board, game, p, pl.res);
      if (t && missingCount(t.missing) <= 2) {
        const picks = Object.entries(t.missing).map(([r, n]) => `${n} ${RES_LABEL[r]}`).join(' + ');
        tips.push({ card: 'yearOfPlenty', text: `Play Year of Plenty for ${picks} → ${t.text.charAt(0).toLowerCase() + t.text.slice(1)}.` });
      }
    }
    if (pl.dev.monopoly > 0 && game.turn.rolled) {
      const opp = emptyHand();
      others(game, p).forEach(q => RES.forEach(r => { opp[r] += game.players[q].res[r]; }));
      const r = RES.slice().sort((a, b) => opp[b] - opp[a])[0];
      if (opp[r] >= TUNE.monopolyMin) tips.push({ card: 'monopoly', text: `Play Monopoly on ${RES_LABEL[r]} (opponents hold about ${opp[r]}).` });
    }
    return tips;
  }

  const api = {
    RES, RES_LABEL, PIPS, COST, PIECES, DEV_TOTAL, DEV_TYPES, DEV_LABEL, PORT_TYPES, GEO,
    TUNE, exampleBoard, validateBoard, boardPorts, hexLabel, vertexLabel, edgeLabel, portAt, rawPips,
    newGame, currentPlayer, occupancy, canSettleSpot, canBuildRoad, hasRoadAt, tradeRates, production,
    longestRoad, updateAwards, others, candidateActions, victoryPoints, handSize, emptyHand, cloneGame, missing, rankedSteps,
    buildSettlement, buildCity, buildRoad, rollDice, endTurn, pay,
    vertexScore, cityGain, planTurn, savingTarget, robberAdvice, discardAdvice, setupAdvice, devCardAdvice,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatanEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
