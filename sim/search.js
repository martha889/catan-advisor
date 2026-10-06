// Parallel coordinate search over the engine's TUNE weights.
// Usage: node sim/search.js [gamesPerCandidate=3200] [passes=2] [seed=1000]
// Each candidate changes one weight of the current best and plays it against the current best on the
// same boards and dice; it's adopted when it wins at least ACCEPT of the games.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort } = require('worker_threads');

if (!isMainThread) {
  const { runMatch } = require('./simulate.js');
  parentPort.on('message', job => {
    const r = runMatch(job);
    parentPort.postMessage({ id: job.id, tally: r.tally, turnsSum: r.turnsSum });
  });
  return;
}

const { ENGINE } = require('./simulate.js');
const CANDIDATES = {
  spendReserve: [10, 25],
  devValue: [8, 12, 14],
  roadFactor: [0.25, 0.45],
  vpValue: [9, 15],
  cityBonus: [-2, 4],
  settlementBonus: [-3, 3],
  tradeSurplus: [0.25, 1],
  tradeReserve: [1.5, 6],
  minValue: [1.5, 5],
  lrTake: [0.8, 1.6],
  lrDefend: [0.25, 1],
  lrBlock: [0.3, 1.2],
  armyDefend: [false],
  armyRaceBonus: [0, 4],
  contestedBonus: [0, 6],
  robberSelf: [0.8, 2],
  portAny: [0.5, 3],
  port2Factor: [0.2, 0.6],
  monopolyMin: [2, 5],
  knightEager: [4, 8, 12],
  pairedOpening: [false],
};
const ACCEPT = 0.52;

const gamesPer = +process.argv[2] || 3200;
const passes = +process.argv[3] || 2;
const seedBase = +process.argv[4] || 1000;
const nWorkers = Math.max(1, os.cpus().length - 2);
const workers = Array.from({ length: nWorkers }, () => new Worker(__filename));
let jobId = 0;
const waiting = new Map();
workers.forEach(w => w.on('message', m => { waiting.get(m.id)(m); waiting.delete(m.id); }));

// Candidate (B) vs current best (A), split across workers. Same seeds every call = same boards and dice.
async function evaluate(best, candidate, seed) {
  const chunk = Math.ceil(gamesPer / nWorkers / 2) * 2;
  const jobs = workers.map((w, i) => new Promise(resolve => {
    const id = ++jobId;
    waiting.set(id, resolve);
    w.postMessage({ id, a: { file: ENGINE, tune: best }, b: { file: ENGINE, tune: candidate }, games: chunk, seed: seed + i });
  }));
  const results = await Promise.all(jobs);
  const wins = results.reduce((s, r) => s + r.tally.B, 0), losses = results.reduce((s, r) => s + r.tally.A, 0);
  return wins / Math.max(1, wins + losses);
}

(async () => {
  const best = { ...require(ENGINE).TUNE };
  const log = [];
  const t0 = Date.now();
  console.log(`${nWorkers} workers, ${gamesPer} games per candidate`);
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const [key, values] of Object.entries(CANDIDATES)) {
      let pick = null;
      for (const v of values) {
        if (best[key] === v) continue;
        const rate = await evaluate(best, { ...best, [key]: v }, seedBase + pass * 100);
        log.push({ pass, key, from: best[key], to: v, rate });
        console.log(`pass ${pass + 1}  ${key}: ${best[key]} → ${v}  wins ${(100 * rate).toFixed(1)}%  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        if (rate >= ACCEPT && (!pick || rate > pick.rate)) pick = { v, rate };
      }
      if (pick) {
        console.log(`  ✔ adopt ${key} = ${pick.v}`);
        best[key] = pick.v;
        changed = true;
      }
    }
    if (!changed) break;
  }
  fs.writeFileSync(path.join(__dirname, 'search-results.json'), JSON.stringify({ best, log }, null, 1));
  console.log('BEST', JSON.stringify(best));
  workers.forEach(w => w.terminate());
})();
