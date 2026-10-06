# catan-advisor

A research project on what wins at the board game *The Settlers of Catan*: a rule-based strategy engine, a Monte Carlo lookahead and a self-play simulator used to test strategy ideas over tens of thousands of games.

> **For education and research only.** Use it to study strategy, review your own finished games, or play against bots. Don't use it for live assistance in games against other people. See [Disclaimer](#disclaimer).

## What's here

| Path | What it is |
|---|---|
| `engine.js` | Board geometry, rules bookkeeping and the strategy heuristics (opening choice, build planning, trades, robber, dev cards, Longest Road / Largest Army). Strategy weights live in `TUNE`. |
| `lookahead.js` | Monte Carlo search on top of the engine: simulated openings and turn-level lookahead. |
| `sim/` | Self-play tools: `simulate.js` (one match), `search.js` (parallel weight search), `verify.js` (large parallel head-to-head checks), `engine-baseline.js` (the frozen first version, used as a reference opponent). |
| `index.html`, `app.js`, `vision.js` | A browser tool: enter a board (or read it from a screenshot), record moves by clicking, and get suggestions. Open `index.html` directly; nothing to install. |

## Running the simulator

Requires Node.js 18 or later. The simulator plays 1v1 games to 15 points on random standard boards, with a 9-card discard limit; bank and port trades are simulated, player-to-player trades are not.

```sh
# 2000 games: the current engine (B) against the frozen baseline (A)
node sim/simulate.js 2000 7

# The current engine against itself with one weight changed
node sim/simulate.js 2000 7 --vs current spendReserve=10

# Large parallel check (uses all cores): weights, turn lookahead and simulated openings
node sim/verify.js 16000 900000 knightRace=true lookahead=4,16,10 opening=6,60

# Search each weight up and down; keep changes that win at least 52%
node sim/search.js 3200 2
```

## Findings so far

Each row is a head-to-head result against the version just before it, so the gains don't simply add up.

| Change | Win rate vs. previous version |
|---|---|
| Save cards for the nearest city or settlement instead of spending them on roads and dev cards; score both opening spots as a pair; value roads less | ~62% vs. the original |
| Weight search: a victory point worth less relative to production; costlier bank trades | 51.7% ± 0.8 |
| Turn lookahead: play the top moves out 10 turns over 16 dice sequences; switch only on a clear paired gain | ~53% ± 1.7 |
| Simulated openings: play whole games out from each of the top six spots | 55.4% ± 2.4 |
| Play knights to race for Largest Army; value 2:1 ports by surplus production | 51.1% ± 0.8 |

Things that measured as neutral or harmful: trading toward a goal whenever nothing is buildable, an "endgame mode" that discounts production near the target, ranking goals by estimated turns to afford them, valuing ports by total production (44.8%), and pushing expansion once every settlement is a city.

## Disclaimer

This project is provided for educational and research purposes only, "as is", without warranty of any kind; see [LICENSE](LICENSE). The author is not responsible for how it is used.

- Use it for studying strategy, reviewing your own completed games, or games against bots. Do not use it to get live assistance in games against other people. That is unfair to your opponents and breaks the rules of most online platforms.
- You are responsible for complying with the terms of service of any platform you play on.
- *CATAN* and *The Settlers of Catan* are trademarks of Catan GmbH. This project is not affiliated with, endorsed by or sponsored by Catan GmbH, CATAN Studio, colonist.io or any other publisher or platform. Game names are used only to describe what the software studies.
