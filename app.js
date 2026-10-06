/* Catan Advisor UI: screenshot import, board editing, move recording and advice. */
(function () {
  'use strict';
  const E = window.CatanEngine, V = window.CatanVision;
  const { GEO, RES, RES_LABEL } = E;
  const S = 100; // SVG units per hex width
  const RES_COLOR = { wood: '#2f7d32', brick: '#c8612f', sheep: '#93c54b', wheat: '#ecc04a', ore: '#9ea3a8', desert: '#d9cfa3' };
  const RES_ICON = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '🪨', desert: '🌵', any: '?' };
  const PLAYER_COLOR = ['#f08a24', '#d62f2f'];
  const NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  const STORE_KEY = 'catanAdvisor.v1';

  const state = { view: 'import', board: null, game: null, uncertain: [], selectedHex: null };
  let history = [];
  let flash = '';
  let trade = { give: null, get: null };
  const imp = { img: null, data: null, clicks: [], detect: null };

  const $ = id => document.getElementById(id);
  const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const names = ['You', 'Opponent'];
  const resText = (r, n = 1) => `${n} ${RES_ICON[r]} ${RES_LABEL[r]}`;
  const handText = hand => RES.filter(r => hand[r]).map(r => resText(r, hand[r])).join(', ') || 'nothing';

  // ---------- Persistence & undo ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        view: state.view, board: state.board, game: state.game, uncertain: state.uncertain, history: history.slice(-60),
      }));
    } catch (e) { /* storage unavailable: the session just won't survive a reload */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.board) {
        Object.assign(state, { view: s.view === 'import' ? 'edit' : s.view, board: s.board, game: s.game, uncertain: s.uncertain || [] });
        history = s.history || [];
      }
    } catch (e) { /* ignore corrupt or unavailable storage */ }
  }
  function snapshot() {
    history.push(JSON.stringify({ board: state.board, game: state.game }));
    if (history.length > 80) history.shift();
  }
  function undo() {
    const s = history.pop();
    if (!s) return;
    const o = JSON.parse(s);
    state.board = o.board; state.game = o.game;
    flash = 'Undone.';
    render();
  }
  function log(msg) { state.game.log.unshift(msg); }
  function act(fn) { // wrap a mutating action with undo + render
    snapshot();
    const err = fn();
    if (err) { history.pop(); flash = err; }
    render();
  }

  // ---------- Board SVG ----------
  const P = v => `${(GEO.vertices[v].x * S).toFixed(1)},${(GEO.vertices[v].y * S).toFixed(1)}`;
  function hexPoints(h) { return GEO.hexes[h].vertices.map(P).join(' '); }

  function settlementShape(x, y, color) {
    const pts = [[-10, 7], [-10, -4], [0, -13], [10, -4], [10, 7]].map(([a, b]) => `${x + a},${y + b}`).join(' ');
    return `<polygon points="${pts}" fill="${color}" stroke="#222" stroke-width="2"/>`;
  }
  function cityShape(x, y, color) {
    const pts = [[-15, 9], [-15, -5], [-6, -5], [-6, -12], [2, -20], [10, -12], [10, -5], [15, -5], [15, 9]].map(([a, b]) => `${x + a},${y + b}`).join(' ');
    return `<polygon points="${pts}" fill="${color}" stroke="#222" stroke-width="2"/>`;
  }

  function renderBoard(hl = { v: [], e: [], h: [] }) {
    const { board, game } = state;
    const play = state.view === 'play' && game;
    const out = [];
    // Tiles
    board.hexes.forEach((t, h) => {
      const c = GEO.hexes[h], cx = c.x * S, cy = c.y * S;
      const unsure = state.view === 'edit' && state.uncertain.includes(h);
      const sel = state.view === 'edit' && state.selectedHex === h;
      out.push(`<polygon class="hex" data-h="${h}" points="${hexPoints(h)}" fill="${RES_COLOR[t.res]}" stroke="${sel ? '#fff' : '#f3e7c3'}" stroke-width="${sel ? 6 : 3}" ${unsure ? 'stroke-dasharray="8 6"' : ''}/>`);
      out.push(`<text x="${cx}" y="${cy - 26}" font-size="20" text-anchor="middle" pointer-events="none">${RES_ICON[t.res]}</text>`);
      if (t.num) {
        const hot = t.num === 6 || t.num === 8;
        out.push(`<circle cx="${cx}" cy="${cy + 6}" r="21" fill="#f6efdc" stroke="#00000033" pointer-events="none"/>`);
        out.push(`<text x="${cx}" y="${cy + 12}" font-size="19" font-weight="700" text-anchor="middle" fill="${hot ? '#c62828' : '#1f2328'}" pointer-events="none">${t.num}</text>`);
        const pips = E.PIPS[t.num];
        for (let i = 0; i < pips; i++) out.push(`<circle cx="${cx + (i - (pips - 1) / 2) * 4.5}" cy="${cy + 20}" r="1.6" fill="${hot ? '#c62828' : '#1f2328'}" pointer-events="none"/>`);
      }
      if (board.robber === h) {
        out.push(`<g pointer-events="none"><circle cx="${cx + 30}" cy="${cy - 2}" r="9" fill="#3b3f45" stroke="#fff" stroke-width="1.5"/><rect x="${cx + 22}" y="${cy + 5}" width="16" height="16" rx="5" fill="#3b3f45" stroke="#fff" stroke-width="1.5"/></g>`);
      }
    });
    hl.h.forEach(h => out.push(`<polygon points="${hexPoints(h)}" fill="none" stroke="#f5b301" stroke-width="7" pointer-events="none"/>`));
    // Ports
    GEO.ports.forEach(pt => {
      const t = board.ports[pt.id], x = pt.x * S, y = pt.y * S;
      pt.vertices.forEach(v => out.push(`<line x1="${x}" y1="${y}" x2="${GEO.vertices[v].x * S}" y2="${GEO.vertices[v].y * S}" stroke="#c9a36b" stroke-width="4"/>`));
      out.push(`<g class="port" data-p="${pt.id}" style="cursor:${state.view === 'edit' ? 'pointer' : 'default'}"><circle cx="${x}" cy="${y}" r="19" fill="#fffaf0" stroke="#8a6d3b" stroke-width="2"/>`);
      if (t === 'any') out.push(`<text x="${x}" y="${y + 5}" font-size="13" font-weight="700" text-anchor="middle">3:1</text></g>`);
      else out.push(`<text x="${x}" y="${y - 1}" font-size="13" text-anchor="middle">${RES_ICON[t]}</text><text x="${x}" y="${y + 13}" font-size="10" font-weight="700" text-anchor="middle">2:1</text></g>`);
    });
    if (game) {
      game.players.forEach((pl, p) => pl.roads.forEach(e => {
        const { a, b } = GEO.edges[e];
        const [x1, y1] = P(a).split(','), [x2, y2] = P(b).split(',');
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#222" stroke-width="12" stroke-linecap="round"/>`);
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${PLAYER_COLOR[p]}" stroke-width="8" stroke-linecap="round"/>`);
      }));
    }
    hl.e.forEach(e => {
      const { a, b } = GEO.edges[e];
      const [x1, y1] = P(a).split(','), [x2, y2] = P(b).split(',');
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f5b301" stroke-width="9" stroke-dasharray="10 7" stroke-linecap="round" pointer-events="none"/>`);
    });
    if (play) GEO.edges.forEach(({ id, a, b }) => {
      const [x1, y1] = P(a).split(','), [x2, y2] = P(b).split(',');
      out.push(`<line class="edg" data-e="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    });
    if (game) {
      game.players.forEach((pl, p) => {
        pl.settlements.forEach(v => out.push(settlementShape(GEO.vertices[v].x * S, GEO.vertices[v].y * S, PLAYER_COLOR[p])));
        pl.cities.forEach(v => out.push(cityShape(GEO.vertices[v].x * S, GEO.vertices[v].y * S, PLAYER_COLOR[p])));
      });
    }
    hl.v.forEach(({ v, rank }) => {
      const x = GEO.vertices[v].x * S, y = GEO.vertices[v].y * S;
      out.push(`<g pointer-events="none"><circle cx="${x}" cy="${y}" r="14" fill="#f5b301" stroke="#fff" stroke-width="3"/><text x="${x}" y="${y + 5}" font-size="14" font-weight="800" text-anchor="middle" fill="#1f2328">${rank}</text></g>`);
    });
    if (play) GEO.vertices.forEach(({ id, x, y }) => out.push(`<circle class="vtx" data-v="${id}" cx="${x * S}" cy="${y * S}" r="13"/>`));
    $('board').innerHTML = out.join('');
  }

  // ---------- Advice ----------
  // ---------- Monte Carlo (lookahead.js; optional) ----------
  const LA = window.CatanLookahead;
  const mc = { opening: null, turn: null };

  // Simulated openings: one search per setup position, advanced in small slices between renders.
  function openingSearch(board, game) {
    if (!LA) return null;
    const key = JSON.stringify(game.players.map(p => [p.settlements, p.roads]));
    if (!mc.opening || mc.opening.key !== key) {
      mc.opening = { key, search: LA.openingSearch(board, game, 0, { candidates: 6, games: 60 }), done: false, result: null };
    }
    const o = mc.opening;
    if (!o.done && !o.timer) {
      o.timer = setTimeout(() => {
        o.timer = null;
        if (o.search.step(60)) { o.done = true; o.result = o.search.result(); }
        if (mc.opening === o && state.view === 'play') render();
      }, 20);
    }
    return o;
  }

  // Turn lookahead, cached per position (it takes up to about a second).
  function turnLookahead(board, game) {
    if (!LA) return null;
    const key = JSON.stringify([game.turn.number, board.robber, game.turn.devPlayed, game.players.map(p => [p.res, p.settlements, p.cities, p.roads.length, p.dev, p.knights, p.devHidden])]);
    if (!mc.turn || mc.turn.key !== key) mc.turn = { key, result: LA.planTurn(board, game, 0, { options: 4, samples: 16, horizon: 10 }) };
    return mc.turn.result;
  }

  function computeAdvice() {
    const { board, game } = state;
    const hl = { v: [], e: [], h: [] };
    const me = 0, opp = 1;
    const lines = [];
    let title = '';

    if (game.phase === 'setup') {
      const p = E.currentPlayer(game);
      if (p === me) {
        let sa = E.setupAdvice(board, game, me);
        if (sa.kind === 'settlement') {
          const search = openingSearch(board, game);
          if (search && search.done) sa = search.result;
          title = 'Place your settlement on spot 1';
          sa.spots.slice(0, 3).forEach((s, i) => {
            hl.v.push({ v: s.v, rank: i + 1 });
            const why = s.winRate !== undefined ? `wins ${Math.round(100 * s.winRate)}% in simulation` : `${s.pips} pips`;
            lines.push(`<b>${i + 1}.</b> ${esc(E.vertexLabel(board, s.v))} <span class="muted">— ${why}</span>`);
          });
          if (search && !search.done) lines.push(`<span class="muted">🔮 Simulating whole games from each spot… ${Math.round(100 * search.search.progress())}%</span>`);
          else if (search) lines.push('<span class="muted">🔮 Ranked by simulated win rate: 60 whole games from each spot, with the engine playing your opponent.</span>');
          lines.push('<span class="muted">Click the spot on the board once you\'ve placed it.</span>');
        } else {
          const best = sa.roads[0];
          title = 'Place your road on the highlighted edge';
          hl.e.push(best.e);
          if (best.target) {
            hl.v.push({ v: best.target.v, rank: '★' });
            lines.push(`It points toward ${esc(E.vertexLabel(board, best.target.v))} for your next settlement.`);
          }
        }
      } else {
        title = `Record Opponent's ${game.setupSub}`;
        lines.push(`Click where Opponent placed their ${game.setupSub === 'settlement' ? 'settlement (a corner)' : 'road (an edge)'}.`);
        if (game.setupSub === 'settlement') {
          const sa = E.setupAdvice(board, game, me);
          lines.push(`<span class="muted">Your best spots right now: ${sa.spots.slice(0, 3).map(s => esc(E.vertexLabel(board, s.v))).join('; ')}</span>`);
        }
      }
      return { title, lines, hl };
    }

    const pend = game.pending;
    if (pend && pend.type === 'robber') {
      if (pend.by === me) {
        const ra = E.robberAdvice(board, game, me);
        title = `Move the robber to ${E.hexLabel(board, ra[0].hex)}`;
        hl.h.push(ra[0].hex);
        lines.push(ra[0].victims ? 'It blocks the most Opponent production; steal from Opponent.' : 'Opponent has nothing worth blocking; this spot hurts you least.');
        if (ra[1]) lines.push(`<span class="muted">Alternative: ${esc(E.hexLabel(board, ra[1].hex))}</span>`);
      } else {
        title = 'Click the tile where Opponent moved the robber';
      }
      return { title, lines, hl };
    }
    if (pend) return { title: 'Finish the step below', lines, hl };

    const discards = game.pendingDiscard || {};
    if (discards[me]) {
      const d = E.discardAdvice(board, game, me);
      if (d) lines.push(`<b>Discard ${d.count}:</b> ${handText(d.discard)} <span class="muted">(keeps cards for a ${d.keepingFor})</span> <button data-act="applyDiscard">Apply</button> <button data-act="clearDiscard" data-p="0">I discarded manually</button>`);
    }

    if (game.turn.player === me) {
      const tips = E.devCardAdvice(board, game, me);
      if (!game.turn.rolled) {
        title = 'Your turn — roll and enter the dice';
        tips.filter(t => t.card === 'knight').forEach(t => lines.push(esc(t.text)));
        return { title, lines, hl };
      }
      tips.forEach(t => lines.push(`🃏 ${esc(t.text)}`));
      let plan = E.planTurn(board, game, me);
      // The lookahead replaces the first step only when playing the future out says it's clearly better.
      const la = turnLookahead(board, game);
      if (la && la.lookahead) {
        const same = (a, b) => a && b && a.type === b.type && a.v === b.v && a.e === b.e;
        const pick = la.steps[0] || null;
        if (!same(pick, plan.steps[0]) && (pick || plan.steps.length)) {
          const entry = la.lookahead.find(x => (x.step === null && pick === null) || same(x.step, pick));
          const gain = entry ? (entry.gain / 10).toFixed(1) : '?';
          lines.push(`<span class="muted">🔮 Lookahead: ${pick ? `this beats "${esc(lowerFirst(plan.steps[0] ? plan.steps[0].text : 'ending the turn'))}"` : 'keeping your cards beats building now'} by ~${gain} VP over the next few turns.</span>`);
          plan = { steps: pick ? [pick] : [], handAfter: game.players[me].res, game };
        }
      }
      if (plan.steps.length) {
        title = 'Best moves this turn';
        const items = [];
        let rank = 1;
        plan.steps.forEach(s => {
          s.trades.forEach(t => items.push(`Trade ${t.rate * t.n} ${RES_ICON[t.give]} ${RES_LABEL[t.give]} → ${t.n} ${RES_ICON[t.get]} ${RES_LABEL[t.get]} <span class="muted">(${t.rate}:1)</span>`));
          let mark = '';
          if (s.v !== undefined) { hl.v.push({ v: s.v, rank }); mark = ` <span class="pill">${rank}</span>`; rank++; }
          if (s.e !== undefined) hl.e.push(s.e);
          items.push(`${esc(s.text)}${mark}`);
        });
        lines.push('<ol>' + items.map(i => `<li>${i}</li>`).join('') + '<li>End your turn.</li></ol>');
      } else {
        title = 'Nothing worth building — end your turn';
      }
      const left = plan.handAfter;
      const goal = E.savingTarget(board, plan.game, me, left);
      if (goal) {
        const miss = Object.entries(goal.missing).map(([r, n]) => resText(r, n)).join(' + ');
        lines.push(`<span class="muted">Next goal: ${esc(lowerFirst(goal.text))} — missing ${miss}.</span>`);
        const spare = RES.filter(r => left[r] - (goal.cost[r] || 0) > 0).sort((a, b) => left[b] - left[a])[0];
        const want = Object.keys(goal.missing)[0];
        if (spare && want) lines.push(`<span class="muted">Try offering Opponent 1 ${RES_LABEL[spare]} for 1 ${RES_LABEL[want]}.</span>`);
        if (goal.v !== undefined && !hl.v.some(x => x.v === goal.v)) hl.v.push({ v: goal.v, rank: '★' });
      }
      const after = E.handSize(left);
      if (after > game.discardLimit) lines.push(`<span class="warn">You'd end with ${after} cards — a 7 would cost you ${Math.floor(after / 2)}.</span>`);
      return { title, lines, hl };
    }

    title = "Opponent's turn";
    lines.push(game.turn.rolled ? 'Click whatever they build, then press <b>End turn</b>.' : 'Enter their dice roll.');
    const oppVP = E.victoryPoints(game, opp);
    if (oppVP + game.players[opp].devHidden >= game.target - 3) {
      lines.push(`<span class="warn">Opponent is close: ${oppVP} VP + ${game.players[opp].devHidden} hidden dev card(s).</span>`);
    }
    return { title, lines, hl };
  }

  // ---------- Panels ----------
  function renderPlay(advice) {
    const { board, game } = state;
    $('advice').innerHTML = `<h3>${advice.title}</h3>${advice.lines.map(l => (l.startsWith('<ol') ? l : `<div>${l}</div>`)).join('')}`;

    // Pending step
    const pend = game.pending;
    const pc = $('pendingCard');
    let ph = '';
    if (pend) {
      const who = names[pend.by];
      if (pend.type === 'robber') ph = `<b>${who}</b>: click a tile to move the robber.`;
      if (pend.type === 'steal') {
        ph = `<b>${names[pend.by]}</b> stole from <b>${names[pend.victim]}</b> — which card?<div class="row">` +
          RES.map(r => `<button data-act="steal" data-r="${r}">${RES_ICON[r]} ${RES_LABEL[r]}</button>`).join('') +
          '<button data-act="steal" data-r="">Nothing</button></div>';
      }
      if (pend.type === 'devType') {
        ph = 'Which development card did you get?<div class="row">' +
          E.DEV_TYPES.map(t => `<button data-act="devType" data-t="${t}">${E.DEV_LABEL[t]}</button>`).join('') + '</div>';
      }
      if (pend.type === 'freeRoads') ph = `<b>${who}</b>: click ${pend.n} free road${pend.n > 1 ? 's' : ''}. <button data-act="doneRoads">Done</button>`;
      if (pend.type === 'yop') {
        ph = `<b>${who}</b> takes ${pend.n} more card${pend.n > 1 ? 's' : ''} (Year of Plenty):<div class="row">` +
          RES.map(r => `<button data-act="yop" data-r="${r}">${RES_ICON[r]} ${RES_LABEL[r]}</button>`).join('') + '</div>';
      }
      if (pend.type === 'monopoly') {
        ph = `<b>${who}</b> plays Monopoly on:<div class="row">` +
          RES.map(r => `<button data-act="mono" data-r="${r}">${RES_ICON[r]} ${RES_LABEL[r]}</button>`).join('') + '</div>';
      }
    }
    const disc = game.pendingDiscard || {};
    if (!pend && disc[1]) ph += `<div>Opponent must discard ${disc[1]} — use the − buttons below. <button data-act="clearDiscard" data-p="1">Done</button></div>`;
    pc.innerHTML = ph;
    pc.classList.toggle('hidden', !ph);

    // Turn controls
    let th = '';
    if (game.phase === 'setup') {
      th = `<h2>Setup</h2><div>${E.currentPlayer(game) === 0 ? 'You place' : 'Opponent places'} a <b>${game.setupSub}</b> (${game.setupStep + 1} of 4).</div>`;
    } else {
      const p = game.turn.player, pl = game.players[p];
      const busy = !!pend;
      th = `<h2>Turn ${game.turn.number} — ${names[p]}${game.turn.roll ? ` · rolled ${game.turn.roll}` : ''}</h2>`;
      th += '<div class="row dice">' + [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n =>
        `<button data-act="roll" data-n="${n}" class="${n === 6 || n === 8 ? 'hot' : ''}" ${game.turn.rolled || busy ? 'disabled' : ''}>${n}</button>`).join('') + '</div>';
      th += '<div class="muted" style="font-size:12px">Click a corner to build a settlement (click your own settlement for a city), an edge for a road.</div>';
      th += `<div class="row"><button data-act="buyDev" ${busy ? 'disabled' : ''}>Buy dev card</button>`;
      const playable = p === 0 ? E.DEV_TYPES.filter(t => t !== 'vp' && pl.dev[t] > 0) : ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
      playable.forEach(t => {
        th += `<button data-act="playDev" data-t="${t}" ${game.turn.devPlayed || busy ? 'disabled' : ''}>Play ${E.DEV_LABEL[t]}${p === 0 ? ` (${pl.dev[t]})` : ''}</button>`;
      });
      th += '</div>';
      const rates = E.tradeRates(board, E.occupancy(game), p);
      th += '<div class="row">Bank trade: give ' + RES.map(r => `<button data-act="tg" data-r="${r}" class="${trade.give === r ? 'sel' : ''}" title="${rates[r]}:1">${RES_ICON[r]}${rates[r]}</button>`).join('') + '</div>';
      th += '<div class="row">get ' + RES.map(r => `<button data-act="tt" data-r="${r}" class="${trade.get === r ? 'sel' : ''}">${RES_ICON[r]}</button>`).join('') +
        ` <button data-act="trade" ${trade.give && trade.get && trade.give !== trade.get ? '' : 'disabled'}>Trade</button></div>`;
      th += `<div class="row"><button class="primary" data-act="endTurn" ${busy ? 'disabled' : ''}>End turn</button></div>`;
    }
    $('turnCard').innerHTML = th;

    // Hands
    const o = E.occupancy(game);
    let hh = '<table class="hands"><tr><th></th>' + RES.map(r => `<th>${RES_ICON[r]}</th>`).join('') + '<th>Σ</th></tr>';
    game.players.forEach((pl, p) => {
      hh += `<tr><td style="color:${PLAYER_COLOR[p]}">${names[p]}</td>` + RES.map(r =>
        `<td><span class="adj"><button data-act="adj" data-p="${p}" data-r="${r}" data-d="-1">−</button><span>${pl.res[r]}</span><button data-act="adj" data-p="${p}" data-r="${r}" data-d="1">+</button></span></td>`).join('') +
        `<td>${E.handSize(pl.res)}</td></tr>`;
    });
    hh += '</table>';
    const me = game.players[0], op = game.players[1];
    const myDev = E.DEV_TYPES.filter(t => me.dev[t] + me.devNew[t]).map(t => `${E.DEV_LABEL[t]} ×${me.dev[t] + me.devNew[t]}`).join(', ') || 'none';
    hh += `<div class="muted" style="margin-top:6px">Your dev cards: ${myDev} · knights played: you ${me.knights}, opp ${op.knights}<br>` +
      `Opponent hidden dev cards: ${op.devHidden} · longest road: you ${E.longestRoad(o, 0)}, opp ${E.longestRoad(o, 1)}` +
      `${game.awards.road !== null ? ` (${names[game.awards.road]} holds it)` : ''}${game.awards.army !== null ? ` · Largest Army: ${names[game.awards.army]}` : ''}</div>`;
    $('hands').innerHTML = hh;
    $('log').innerHTML = game.log.slice(0, 80).map(l => `<div>${esc(l)}</div>`).join('');

    $('scoreBar').innerHTML = `<span class="me">You ${E.victoryPoints(game, 0)}</span> · <span class="opp">Opponent ${E.victoryPoints(game, 1)}${op.devHidden ? `<span class="muted">+${op.devHidden}?</span>` : ''}</span> <span class="muted">/ ${game.target}</span>`;
    $('status').textContent = flash || (game.phase === 'setup' ? 'Setup phase' : `Turn ${game.turn.number}`);
  }

  function renderEdit() {
    const { board } = state;
    let h = '';
    const sel = state.selectedHex;
    if (sel !== null) {
      const t = board.hexes[sel];
      h += `<div><b>Selected:</b> ${esc(E.hexLabel(board, sel))}</div><div class="row">` +
        [...RES, 'desert'].map(r => `<button data-act="setRes" data-r="${r}" class="${t.res === r ? 'sel' : ''}">${RES_ICON[r]} ${RES_LABEL[r]}</button>`).join('') + '</div>';
      if (t.res !== 'desert') {
        h += '<div class="row">' + NUMBERS.map(n => `<button data-act="setNum" data-n="${n}" class="${t.num === n ? 'sel' : ''}">${n}</button>`).join('') + '</div>';
      }
      h += `<div class="row"><button data-act="setRobber" ${board.robber === sel ? 'disabled' : ''}>Put robber here</button></div>`;
    } else {
      h += '<div class="muted">No tile selected.</div>';
    }
    $('hexEditor').innerHTML = h;
    const problems = E.validateBoard(board);
    const unsure = state.uncertain.length ? `<div class="warn">Please double-check the dashed tiles: ${state.uncertain.map(i => esc(E.hexLabel(board, i))).join(', ')}.</div>` : '';
    $('boardProblems').innerHTML = unsure + (problems.length
      ? `<div class="warn" style="margin-top:6px">${problems.map(esc).join('<br>')}</div>`
      : '<div style="color:var(--good);margin-top:6px">✓ Tile and number counts match a standard board.</div>');
    $('startBtn').textContent = state.game ? 'Back to game' : 'Start game';
    $('status').textContent = flash || 'Check the board';
    $('scoreBar').innerHTML = '';
  }

  function render() {
    const view = state.view;
    $('importView').classList.toggle('hidden', !(view === 'import' || (view === 'edit' && imp.img)));
    $('boardWrap').classList.toggle('hidden', view === 'import');
    $('editPanel').classList.toggle('hidden', view !== 'edit');
    $('playPanel').classList.toggle('hidden', view !== 'play');
    $('undoBtn').classList.toggle('hidden', view !== 'play');
    $('editBtn').classList.toggle('hidden', view !== 'play');
    if (view === 'import') { $('status').textContent = flash || 'Load a screenshot'; $('scoreBar').innerHTML = ''; }
    if (view === 'edit') { renderBoard(); renderEdit(); }
    if (view === 'play') {
      const advice = computeAdvice();
      renderBoard(advice.hl);
      renderPlay(advice);
    }
    flash = '';
    save();
  }

  // ---------- Game actions ----------
  function result(r) {
    if (r.error) return r.error;
    log(r.log + (r.short ? ' (hand tracking was short — check their cards)' : ''));
    return null;
  }

  function onVertex(v) {
    const { board, game } = state;
    if (game.pending) { flash = 'Finish the pending step first.'; return render(); }
    if (game.phase === 'setup') {
      if (game.setupSub !== 'settlement') { flash = 'Place the road first (click an edge).'; return render(); }
      return act(() => result(E.buildSettlement(board, game, E.currentPlayer(game), v)));
    }
    const p = game.turn.player;
    if (game.players[p].settlements.includes(v)) return act(() => result(E.buildCity(board, game, p, v)));
    act(() => result(E.buildSettlement(board, game, p, v)));
  }

  function onEdge(e) {
    const { board, game } = state;
    const pend = game.pending;
    if (pend && pend.type === 'freeRoads') {
      return act(() => {
        const err = result(E.buildRoad(board, game, pend.by, e, { free: true }));
        if (!err && --pend.n <= 0) game.pending = null;
        return err;
      });
    }
    if (pend) { flash = 'Finish the pending step first.'; return render(); }
    if (game.phase === 'setup' && game.setupSub !== 'road') { flash = 'Place the settlement first (click a corner).'; return render(); }
    act(() => result(E.buildRoad(board, game, E.currentPlayer(game), e)));
  }

  function onHex(h) {
    const { board, game } = state;
    if (state.view === 'edit') { state.selectedHex = h; return render(); }
    const pend = game.pending;
    if (!pend || pend.type !== 'robber') return;
    if (h === board.robber) { flash = 'The robber has to move to a different tile.'; return render(); }
    act(() => {
      board.robber = h;
      log(`${names[pend.by]} moved the robber to ${E.hexLabel(board, h)}`);
      const victim = 1 - pend.by;
      const o = E.occupancy(game);
      const touches = GEO.hexes[h].vertices.some(v => o.v[v] && o.v[v].p === victim);
      game.pending = touches ? { type: 'steal', by: pend.by, victim } : null;
    });
  }

  function onAction(btn) {
    const { board, game } = state;
    const a = btn.dataset.act, r = btn.dataset.r;
    switch (a) {
      case 'setRes': state.board.hexes[state.selectedHex].res = r; if (r === 'desert') state.board.hexes[state.selectedHex].num = null; return render();
      case 'setNum': state.board.hexes[state.selectedHex].num = +btn.dataset.n; state.uncertain = state.uncertain.filter(i => i !== state.selectedHex); return render();
      case 'setRobber': state.board.robber = state.selectedHex; return render();
      case 'roll': return act(() => {
        const n = +btn.dataset.n;
        const gains = E.rollDice(board, game, n);
        log(`${names[game.turn.player]} rolled ${n}` + (n === 7 ? '' : ` — you got ${handText(gains[0])}; opponent got ${handText(gains[1])}`));
        if (n === 7) {
          game.pendingDiscard = {};
          game.players.forEach((pl, p) => { const s = E.handSize(pl.res); if (s > game.discardLimit) game.pendingDiscard[p] = Math.floor(s / 2); });
          game.pending = { type: 'robber', by: game.turn.player };
        }
      });
      case 'steal': return act(() => {
        const { by, victim } = game.pending;
        if (r) { game.players[victim].res[r] = Math.max(0, game.players[victim].res[r] - 1); game.players[by].res[r] += 1; }
        log(r ? `${names[by]} stole 1 ${RES_LABEL[r]} from ${names[victim]}` : `${names[by]} stole nothing`);
        game.pending = null;
      });
      case 'buyDev': return act(() => {
        const p = game.turn.player, pl = game.players[p];
        const short = E.pay(pl, E.COST.dev);
        game.devBought += 1;
        if (p === 0) game.pending = { type: 'devType', by: 0 };
        else pl.devHidden += 1;
        log(`${names[p]} bought a development card${short ? ' (hand tracking was short)' : ''}`);
      });
      case 'devType': return act(() => {
        game.players[0].devNew[btn.dataset.t] += 1;
        game.pending = null;
        log(`It was a ${E.DEV_LABEL[btn.dataset.t]}`);
      });
      case 'playDev': return act(() => {
        const t = btn.dataset.t, p = game.turn.player, pl = game.players[p];
        if (p === 0) pl.dev[t] -= 1; else pl.devHidden = Math.max(0, pl.devHidden - 1);
        game.turn.devPlayed = true;
        log(`${names[p]} played ${E.DEV_LABEL[t]}`);
        if (t === 'knight') { pl.knights += 1; E.updateAwards(game); game.pending = { type: 'robber', by: p }; }
        if (t === 'roadBuilding') game.pending = { type: 'freeRoads', by: p, n: 2 };
        if (t === 'yearOfPlenty') game.pending = { type: 'yop', by: p, n: 2 };
        if (t === 'monopoly') game.pending = { type: 'monopoly', by: p };
      });
      case 'doneRoads': return act(() => { game.pending = null; });
      case 'yop': return act(() => {
        const pend = game.pending;
        game.players[pend.by].res[r] += 1;
        log(`${names[pend.by]} took 1 ${RES_LABEL[r]}`);
        if (--pend.n <= 0) game.pending = null;
      });
      case 'mono': return act(() => {
        const by = game.pending.by, victim = game.players[1 - by];
        const n = victim.res[r];
        victim.res[r] = 0;
        game.players[by].res[r] += n;
        log(`${names[by]} took ${n} ${RES_LABEL[r]} with Monopoly${by === 0 ? '' : ' (check your hand)'}`);
        game.pending = null;
      });
      case 'tg': trade.give = r; return render();
      case 'tt': trade.get = r; return render();
      case 'trade': return act(() => {
        const p = game.turn.player, pl = game.players[p];
        const rate = E.tradeRates(board, E.occupancy(game), p)[trade.give];
        if (pl.res[trade.give] < rate) return `${names[p]} needs ${rate} ${RES_LABEL[trade.give]} for that trade.`;
        pl.res[trade.give] -= rate; pl.res[trade.get] += 1;
        log(`${names[p]} traded ${rate} ${RES_LABEL[trade.give]} → 1 ${RES_LABEL[trade.get]}`);
        trade = { give: null, get: null };
      });
      case 'adj': return act(() => {
        const pl = game.players[+btn.dataset.p];
        pl.res[r] = Math.max(0, pl.res[r] + +btn.dataset.d);
      });
      case 'applyDiscard': return act(() => {
        const d = E.discardAdvice(board, game, 0);
        RES.forEach(x => { game.players[0].res[x] -= d.discard[x]; });
        log(`You discarded ${handText(d.discard)}`);
        delete game.pendingDiscard[0];
      });
      case 'clearDiscard': return act(() => { delete game.pendingDiscard[+btn.dataset.p]; });
      case 'endTurn': return act(() => {
        E.endTurn(game);
        game.pendingDiscard = null;
        trade = { give: null, get: null };
        log(`— Turn ${game.turn.number}: ${names[game.turn.player]} —`);
      });
      default:
    }
  }

  // ---------- Screenshot import ----------
  function loadImage(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = $('importCanvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      imp.img = img; imp.data = ctx.getImageData(0, 0, c.width, c.height); imp.clicks = []; imp.detect = null;
      c.classList.remove('hidden');
      $('drop').classList.add('hidden');
      setHint('Click the <b>number token</b> on the <b>top-left</b> tile.');
      state.view = 'import';
      render();
    };
    img.src = url;
  }
  function setHint(html) { $('importHint').innerHTML = html; $('importHint').classList.remove('hidden'); }

  function drawImport() {
    const c = $('importCanvas'), ctx = c.getContext('2d');
    ctx.drawImage(imp.img, 0, 0);
    const r = Math.max(6, c.width / 120);
    ctx.lineWidth = Math.max(2, c.width / 400);
    imp.clicks.forEach(p => { ctx.strokeStyle = '#ff00aa'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke(); });
    if (imp.detect) {
      const { layout, details } = imp.detect;
      ctx.font = `bold ${Math.round(layout.W * 0.14)}px sans-serif`;
      layout.tokens.forEach((t, i) => {
        ctx.strokeStyle = details[i].sure ? '#00e676' : '#ffea00';
        ctx.beginPath(); ctx.arc(t.x, t.y, layout.W * 0.2, 0, 7); ctx.stroke();
        const d = details[i];
        const label = d.res === 'desert' ? 'desert' : `${d.res} ${d.num ?? '?'}`;
        ctx.fillStyle = '#000a'; ctx.fillRect(t.x - layout.W * 0.4, t.y + layout.W * 0.22, layout.W * 0.8, layout.W * 0.18);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, t.x, t.y + layout.W * 0.36);
      });
    }
  }

  function onImportClick(ev) {
    if (!imp.img || imp.clicks.length >= 2) return;
    const c = $('importCanvas');
    const rect = c.getBoundingClientRect();
    imp.clicks.push({ x: (ev.clientX - rect.left) * c.width / rect.width, y: (ev.clientY - rect.top) * c.height / rect.height });
    if (imp.clicks.length === 1) { setHint('Now click the <b>number token</b> on the <b>bottom-right</b> tile.'); drawImport(); return; }
    imp.detect = V.detectBoard(imp.data, imp.clicks[0], imp.clicks[1]);
    state.board = imp.detect.board;
    state.uncertain = imp.detect.details.map((d, i) => (d.sure ? -1 : i)).filter(i => i >= 0);
    state.selectedHex = state.uncertain.length ? state.uncertain[0] : null;
    drawImport();
    setHint('Detected tiles are labelled on the screenshot (yellow = unsure). <button id="reclick">Redo the two clicks</button>');
    $('reclick').onclick = () => { imp.clicks = []; imp.detect = null; drawImport(); setHint('Click the <b>number token</b> on the <b>top-left</b> tile.'); state.view = 'import'; render(); };
    state.view = 'edit';
    render();
  }

  // ---------- Wiring ----------
  $('board').addEventListener('click', ev => {
    const t = ev.target.closest('[data-v],[data-e],[data-h],[data-p]');
    if (!t) return;
    if (t.dataset.p !== undefined) {
      if (state.view !== 'edit') return;
      const i = +t.dataset.p;
      const types = E.PORT_TYPES;
      state.board.ports[i] = types[(types.indexOf(state.board.ports[i]) + 1) % types.length];
      return render();
    }
    if (t.dataset.v !== undefined) return onVertex(+t.dataset.v);
    if (t.dataset.e !== undefined) return onEdge(+t.dataset.e);
    if (t.dataset.h !== undefined) return onHex(+t.dataset.h);
  });
  document.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-act]');
    if (b && !b.disabled) onAction(b);
  });
  $('importCanvas').addEventListener('click', onImportClick);
  $('fileInput').addEventListener('change', e => { if (e.target.files[0]) loadImage(e.target.files[0]); });
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) loadImage(f);
  });
  document.addEventListener('paste', e => {
    if (state.view === 'play') return;
    const item = [...(e.clipboardData || {}).items || []].find(x => x.type.startsWith('image/'));
    if (item) loadImage(item.getAsFile());
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && state.view === 'play' && !/INPUT|SELECT/.test(e.target.tagName)) { e.preventDefault(); undo(); }
  });
  $('exampleBtn').onclick = () => {
    state.board = E.exampleBoard(); state.uncertain = []; state.selectedHex = null; state.view = 'edit'; render();
  };
  $('startBtn').onclick = () => {
    if (state.game) { state.view = 'play'; return render(); }
    const problems = E.validateBoard(state.board);
    if (problems.length && !confirm(`The board doesn't look standard:\n${problems.join('\n')}\n\nStart anyway?`)) return;
    state.game = E.newGame({ first: +$('firstSel').value, target: +$('targetIn').value || 15, discardLimit: +$('discardIn').value || 7 });
    state.game.log = ['Game started'];
    history = [];
    state.view = 'play';
    render();
  };
  $('undoBtn').onclick = undo;
  $('editBtn').onclick = () => { state.view = 'edit'; state.selectedHex = null; render(); };
  $('newBtn').onclick = () => {
    if (state.game && !confirm('Start over with a new board? The current game will be lost.')) return;
    Object.assign(state, { view: 'import', board: null, game: null, uncertain: [], selectedHex: null });
    Object.assign(imp, { img: null, data: null, clicks: [], detect: null });
    history = [];
    $('importCanvas').classList.add('hidden'); $('drop').classList.remove('hidden'); $('importHint').classList.add('hidden');
    render();
  };

  load();
  render();
})();
