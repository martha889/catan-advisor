// Parallel head-to-head check of a weight set against the engine's defaults and the frozen baseline.
// Usage: node sim/verify.js [games=16000] [seed=900000] [key=value ...] [lookahead=options,samples,horizon] [opening=candidates,games]
'use strict';
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');

if (!isMainThread) {
  const { runMatch } = require('./simulate.js');
  parentPort.on('message', job => parentPort.postMessage(runMatch(job)));
  return;
}

const { ENGINE, BASELINE } = require('./simulate.js');
const games = +process.argv[2] || 16000;
const seed = +process.argv[3] || 900000;
const tune = {};
let lookahead = null;
process.argv.slice(4).forEach(kv => {
  const [k, v] = kv.split('=');
  if (k === 'lookahead') { const [options, samples, horizon] = v.split(',').map(Number); lookahead = { ...lookahead, options, samples, horizon }; return; }
  if (k === 'opening') { const [candidates, games] = v.split(',').map(Number); lookahead = { ...lookahead, opening: { candidates, games } }; return; }
  tune[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v;
});
const n = Math.max(1, os.cpus().length - 2);
// Opponent weights for the "current" match, e.g. A_TUNE='{"knightEager":6}' to test against another play style.
const aTune = process.env.A_TUNE ? JSON.parse(process.env.A_TUNE) : {};

async function match(a) {
  const chunk = Math.ceil(games / n / 2) * 2;
  const runs = Array.from({ length: n }, (_, i) => new Promise(resolve => {
    const w = new Worker(__filename);
    w.once('message', r => { resolve(r); w.terminate(); });
    w.postMessage({ a, b: { file: ENGINE, tune, lookahead }, games: chunk, seed: seed + i });
  }));
  const rs = await Promise.all(runs);
  const B = rs.reduce((s, r) => s + r.tally.B, 0), A = rs.reduce((s, r) => s + r.tally.A, 0);
  const total = rs.reduce((s, r) => s + r.games, 0);
  const p = B / (A + B);
  const se = Math.sqrt(p * (1 - p) / (A + B));
  const turns = rs.reduce((s, r) => s + r.turnsSum, 0) / total;
  return `${(100 * p).toFixed(1)}% ± ${(100 * 1.96 * se).toFixed(1)} (${total} games, avg ${turns.toFixed(1)} turns)`;
}

(async () => {
  console.log('weights', JSON.stringify(tune), lookahead ? 'lookahead ' + JSON.stringify(lookahead) : '');
  if (!process.env.SKIP_CURRENT) console.log(`vs current defaults${process.env.A_TUNE ? ' with ' + process.env.A_TUNE : ''}:`, await match({ file: ENGINE, tune: aTune }));
  if (!process.env.SKIP_BASELINE) console.log('vs original baseline:', await match({ file: BASELINE, tune: {} }));
})();
