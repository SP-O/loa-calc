// src/vision/anchor.js
// Tier 1 anchor: 다중배율 랜드마크 매칭으로 게임 창 위치+배율 검출.
// toGray/cropGray는 image.js에서 import (재정의 금지).

export function resizeGray(gr, nw, nh) { // bilinear
  const { g, width: w, height: h } = gr, out = new Uint8Array(nw * nh), sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const fx = x * sx, fy = y * sy, x0 = fx | 0, y0 = fy | 0, x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), dx = fx - x0, dy = fy - y0;
    out[y * nw + x] = g[y0 * w + x0] * (1 - dx) * (1 - dy) + g[y0 * w + x1] * dx * (1 - dy) + g[y1 * w + x0] * (1 - dx) * dy + g[y1 * w + x1] * dx * dy;
  }
  return { g: out, width: nw, height: nh };
}

export function matchTemplate(frame, tmpl, opts = {}) {
  const D = opts.coarse ?? 8;
  const fw = frame.width, fh = frame.height, tw = tmpl.width, th = tmpl.height;
  const x0 = opts.x0 ?? 0, y0 = opts.y0 ?? 0;
  const x1 = Math.min(opts.x1 ?? fw, fw) - tw, y1 = Math.min(opts.y1 ?? fh, fh) - th;
  let best = { x: 0, y: 0, score: Infinity };
  for (let y = y0; y <= y1; y += D) {
    for (let x = x0; x <= x1; x += D) {
      let sad = 0;
      for (let ty = 0; ty < th; ty += D) {
        const frow = (y + ty) * fw + x, trow = ty * tw;
        for (let tx = 0; tx < tw; tx += D) {
          sad += Math.abs(frame.g[frow + tx] - tmpl.g[trow + tx]);
          if (sad >= best.score) { tx = tw; ty = th; }
        }
      }
      if (sad < best.score) best = { x, y, score: sad };
    }
  }
  const fineBest = { ...best, score: Infinity };
  for (let y = Math.max(y0, best.y - D); y <= Math.min(y1, best.y + D); y++) {
    for (let x = Math.max(x0, best.x - D); x <= Math.min(x1, best.x + D); x++) {
      let sad = 0;
      for (let ty = 0; ty < th; ty++) {
        const frow = (y + ty) * fw + x, trow = ty * tw;
        for (let tx = 0; tx < tw; tx++) sad += Math.abs(frame.g[frow + tx] - tmpl.g[trow + tx]);
      }
      if (sad < fineBest.score) { fineBest.x = x; fineBest.y = y; fineBest.score = sad; }
    }
  }
  fineBest.perPixel = fineBest.score / (tw * th);
  return fineBest;
}

export function findAnchor(frameGray, landmark, opts = {}) {
  const scales = opts.scales ?? [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
  let best = { x: 0, y: 0, scale: 1, perPixel: Infinity };
  for (const s of scales) {
    const t = resizeGray(landmark, Math.round(landmark.width * s), Math.round(landmark.height * s));
    const m = matchTemplate(frameGray, t, { coarse: 8 });
    if (m.perPixel < best.perPixel) best = { x: m.x, y: m.y, scale: s, perPixel: m.perPixel };
  }
  return best;
}
