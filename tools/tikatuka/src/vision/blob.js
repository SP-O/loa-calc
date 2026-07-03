// src/vision/blob.js — 영역 내 밝은 주사위 타일(블롭)의 bbox 중심. 순수.
// gray = { g:Uint8Array, width, height } (image.js toGray 결과).
export function findDieBlob(gray, cx, cy, half, opts = {}) {
  const TH = opts.th ?? 165;       // 밝은 타일 임계(회색조)
  const MINPX = opts.minPx ?? 2500; // 최소 픽셀 수
  const MIN = opts.min ?? 55, MAX = opts.max ?? 110; // 타일 변 길이 범위
  const W = gray.width, H = gray.height, g = gray.g;
  const x0 = Math.max(0, cx - half), x1 = Math.min(W, cx + half);
  const y0 = Math.max(0, cy - half), y1 = Math.min(H, cy + half);
  const seen = new Set();
  let best = null;
  const key = (x, y) => y * W + x;
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const k0 = key(sx, sy);
      if (seen.has(k0) || g[k0] < TH) continue;
      let mnx = sx, mxx = sx, mny = sy, mxy = sy, cnt = 0;
      const st = [k0]; seen.add(k0);
      while (st.length) {
        const p = st.pop(), px = p % W, py = (p / W) | 0;
        cnt++;
        if (px < mnx) mnx = px; if (px > mxx) mxx = px;
        if (py < mny) mny = py; if (py > mxy) mxy = py;
        const nbrs = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
        for (const [nx, ny] of nbrs) {
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const kk = key(nx, ny);
          if (seen.has(kk) || g[kk] < TH) continue;
          seen.add(kk); st.push(kk);
        }
      }
      const w = mxx - mnx + 1, h = mxy - mny + 1;
      if (cnt >= MINPX && w >= MIN && w <= MAX && h >= MIN && h <= MAX && (!best || cnt > best.cnt)) {
        best = { cx: Math.round((mnx + mxx) / 2), cy: Math.round((mny + mxy) / 2), w, h, cnt };
      }
    }
  }
  // w,h = 실측 주사위면 bbox 크기(분류 srcSize를 캘리브레이션 대신 실측에서 뽑을 때 사용).
  return best ? { cx: best.cx, cy: best.cy, w: best.w, h: best.h } : null;
}
