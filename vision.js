/* Catan Advisor vision: reads tiles and number tokens from a board screenshot.
 * The user clicks the number token of the top-left and bottom-right tiles; every other
 * tile position follows from the fixed hex layout. */
(function (root) {
  'use strict';
  const E = root.CatanEngine;

  const TOKEN_OFFSET = 0.22; // token centre sits this many hex-widths below the hex centre

  // Reference tile colours (colonist.io-style art); several shades per resource.
  const REFS = {
    wheat: [[240, 196, 72], [236, 205, 110], [226, 180, 60], [245, 215, 120]],
    wood: [[60, 140, 60], [80, 150, 70], [45, 120, 50], [35, 100, 45]],
    sheep: [[150, 200, 70], [170, 212, 95], [135, 190, 60], [185, 220, 110]],
    brick: [[215, 110, 60], [228, 130, 80], [200, 95, 50], [190, 85, 55]],
    ore: [[180, 180, 180], [160, 163, 168], [200, 200, 200], [140, 145, 150]],
    desert: [[225, 215, 170], [215, 205, 155], [235, 228, 190], [205, 190, 140]],
  };

  function pixel(img, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  function nearestRes(rgb) {
    let best = null, bestD = Infinity;
    for (const [res, list] of Object.entries(REFS)) {
      for (const c of list) {
        const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
        if (d < bestD) { bestD = d; best = res; }
      }
    }
    return { res: best, d: bestD };
  }

  function layout(t0, t18) {
    const h18 = E.GEO.hexes[18], h0 = E.GEO.hexes[0];
    const sx = (t18.x - t0.x) / (h18.x - h0.x);
    const sy = (t18.y - t0.y) / (h18.y - h0.y);
    const W = (sx + sy) / 2;
    const tokens = E.GEO.hexes.map(h => ({ x: t0.x + (h.x - h0.x) * sx, y: t0.y + (h.y - h0.y) * sy }));
    const centers = tokens.map(t => ({ x: t.x, y: t.y - TOKEN_OFFSET * W }));
    return { W, sx, sy, tokens, centers };
  }

  function detectResource(img, c, W) {
    const votes = {};
    let total = 0;
    for (const rr of [0.30, 0.34, 0.38, 0.42]) {
      for (let a = 0; a < 360; a += 6) {
        const rad = a * Math.PI / 180;
        const p = pixel(img, c.x + Math.cos(rad) * rr * W, c.y + Math.sin(rad) * rr * W);
        if (!p) continue;
        const n = nearestRes(p);
        if (n.d > 80 * 80) continue;
        votes[n.res] = (votes[n.res] || 0) + 1;
        total++;
      }
    }
    return { votes, total };
  }

  const isTokenWhite = (r, g, b) => Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
  const isDark = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b < 150;

  // Connected components of mask (Uint8Array w*h); returns [{pixels, x0,y0,x1,y1, area}]
  function components(mask, w, h, eight) {
    const seen = new Uint8Array(w * h);
    const out = [];
    const nb = eight ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || seen[s]) continue;
      const stack = [s], pixels = [];
      seen[s] = 1;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      while (stack.length) {
        const i = stack.pop();
        pixels.push(i);
        const x = i % w, y = (i / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const [dx, dy] of nb) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      out.push({ pixels, x0, y0, x1, y1, area: pixels.length });
    }
    return out;
  }

  // Enclosed background regions inside a component (0 for "5", 1 for "6"/"9", 2 for "8").
  function countHoles(comp, w) {
    const bw = comp.x1 - comp.x0 + 3, bh = comp.y1 - comp.y0 + 3;
    const filled = new Uint8Array(bw * bh);
    comp.pixels.forEach(i => { filled[((i / w | 0) - comp.y0 + 1) * bw + (i % w) - comp.x0 + 1] = 1; });
    const bg = new Uint8Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) bg[i] = filled[i] ? 0 : 1;
    const regions = components(bg, bw, bh, false);
    const minArea = Math.max(3, comp.area * 0.01);
    return regions.filter(r => r.x0 > 0 && r.y0 > 0 && r.x1 < bw - 1 && r.y1 < bh - 1 && r.area >= minArea).length;
  }

  function detectToken(img, tc, W) {
    const half = Math.round(0.32 * W);
    const bx = Math.max(0, Math.round(tc.x) - half), by = Math.max(0, Math.round(tc.y) - half);
    const bw = Math.min(img.width, Math.round(tc.x) + half) - bx, bh = Math.min(img.height, Math.round(tc.y) + half) - by;
    if (bw <= 0 || bh <= 0) return null;
    const white = new Uint8Array(bw * bh), dark = new Uint8Array(bw * bh), red = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const [r, g, b] = pixel(img, bx + x, by + y);
        const i = y * bw + x;
        white[i] = isTokenWhite(r, g, b) ? 1 : 0;
        dark[i] = isDark(r, g, b) ? 1 : 0;
        red[i] = r > 1.6 * g && r > 120 ? 1 : 0;
      }
    }
    const comps = components(white, bw, bh, false).sort((a, b) => b.area - a.area);
    const token = comps[0];
    if (!token || token.area < 0.04 * W * W) return null;

    // Dark marks inside the token's bounding box: digits and probability dots.
    const tw = token.x1 - token.x0 + 1, th = token.y1 - token.y0 + 1;
    const inner = new Uint8Array(tw * th);
    let redCount = 0, darkCount = 0;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const i = (token.y0 + y) * bw + token.x0 + x;
        if (dark[i]) { inner[y * tw + x] = 1; darkCount++; if (red[i]) redCount++; }
      }
    }
    const marks = components(inner, tw, th, true).filter(c => c.area >= 2 && c.x0 > 0 && c.x1 < tw - 1);
    const digits = marks.filter(c => c.y1 - c.y0 + 1 >= 0.25 * th).sort((a, b) => a.x0 - b.x0);
    const dotMaxH = Math.max(3, 0.16 * th);
    const dots = marks.filter(c => c.y1 - c.y0 + 1 <= dotMaxH && c.x1 - c.x0 + 1 <= dotMaxH && (c.y0 + c.y1) / 2 > 0.55 * th);
    const isRed = darkCount > 0 && redCount / darkCount > 0.4;
    const holes = digits.length === 1 ? countHoles(digits[0], tw) : null;
    return { pips: dots.length, digits: digits.length, holes, isRed, number: decideNumber(dots.length, digits.length, holes, isRed) };
  }

  function decideNumber(pips, digits, holes, isRed) {
    if (isRed || pips === 5) {
      if (holes === 2) return { num: 8, sure: pips === 5 || isRed };
      if (holes === 1) return { num: 6, sure: pips === 5 || isRed };
      return { num: 6, sure: false };
    }
    const twoDigit = digits >= 2;
    switch (pips) {
      case 1: return { num: twoDigit ? 12 : 2, sure: true };
      case 2: return { num: twoDigit ? 11 : 3, sure: true };
      case 3: return { num: twoDigit ? 10 : 4, sure: true };
      case 4: return { num: holes >= 1 ? 9 : 5, sure: holes !== null };
      default: return { num: null, sure: false };
    }
  }

  // Full detection: returns { board, layout, details[] }.
  function detectBoard(img, t0, t18) {
    const lay = layout(t0, t18);
    const details = E.GEO.hexes.map((h, i) => {
      const color = detectResource(img, lay.centers[i], lay.W);
      const token = detectToken(img, lay.tokens[i], lay.W);
      const ranked = Object.entries(color.votes).sort((a, b) => b[1] - a[1]);
      let res;
      if (!token) res = 'desert';
      else res = (ranked.find(([r]) => r !== 'desert') || ['wheat'])[0];
      const share = color.total ? (color.votes[res] || 0) / color.total : 0;
      const sure = (token ? token.number.sure : true) && share > 0.35;
      return { res, num: token ? token.number.num : null, sure, token, votes: color.votes };
    });
    const desert = details.findIndex(d => d.res === 'desert');
    const board = {
      hexes: details.map(d => ({ res: d.res, num: d.res === 'desert' ? null : d.num })),
      ports: E.exampleBoard().ports,
      robber: desert >= 0 ? desert : 0,
    };
    return { board, layout: lay, details };
  }

  root.CatanVision = { detectBoard, layout, TOKEN_OFFSET };
})(typeof window !== 'undefined' ? window : globalThis);
