// src/vision/image.js
export function toGray(frame) {
  const { width, height, data } = frame;
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  return { g, width, height };
}
export function cropGray(gray, x, y, w, h) {
  const out = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out[yy * w + xx] = gray.g[(y + yy) * gray.width + (x + xx)];
  return { g: out, width: w, height: h };
}
export function normPatch(gray, cx, cy, size) {
  const h = size >> 1, a = new Float32Array(size * size);
  let m = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = gray.g[(cy - h + y) * gray.width + (cx - h + x)]; a[y * size + x] = v; m += v; }
  m /= a.length;
  for (let i = 0; i < a.length; i++) a[i] -= m;
  return a;
}
// 스케일 정규화 패치: (cx,cy) 중심의 srcSize×srcSize 영역을 dstSize×dstSize로 리샘플(최근접) 후 평균차감.
// 해상도가 달라 주사위 픽셀 크기가 변해도 템플릿(고정 dstSize)과 스케일을 맞춰 매칭 가능.
// srcSize === dstSize 이면 normPatch 와 동일(기준 배율 하위호환).
export function normPatchScaled(gray, cx, cy, srcSize, dstSize) {
  const a = new Float32Array(dstSize * dstSize);
  const srcHalf = srcSize >> 1;
  const scale = srcSize / dstSize;
  const W = gray.width, H = gray.height;
  let m = 0;
  for (let y = 0; y < dstSize; y++) {
    let iy = cy - srcHalf + Math.round(y * scale);
    iy = iy < 0 ? 0 : iy >= H ? H - 1 : iy;
    for (let x = 0; x < dstSize; x++) {
      let ix = cx - srcHalf + Math.round(x * scale);
      ix = ix < 0 ? 0 : ix >= W ? W - 1 : ix;
      const v = gray.g[iy * W + ix];
      a[y * dstSize + x] = v; m += v;
    }
  }
  m /= a.length;
  for (let i = 0; i < a.length; i++) a[i] -= m;
  return a;
}
export function meanGray(gray, cx, cy, half) {
  let s = 0, n = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) { s += gray.g[y * gray.width + x]; n++; }
  return s / n;
}
