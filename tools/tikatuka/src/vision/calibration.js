// src/vision/calibration.js — 보정 박스 기하(핸들/히트테스트/드래그/좌표환산). 순수, DOM 없음.
const MIN = 40;

export function handlesOf(r) {
  const { x, y, w, h } = r, mx = x + w / 2, my = y + h / 2;
  return [
    { id: 'nw', x, y }, { id: 'n', x: mx, y }, { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: my }, { id: 'se', x: x + w, y: y + h },
    { id: 's', x: mx, y: y + h }, { id: 'sw', x, y: y + h }, { id: 'w', x, y: my },
  ];
}

export function hitTest(pt, r, tol) {
  for (const hnd of handlesOf(r)) {
    if (Math.abs(pt.x - hnd.x) <= tol && Math.abs(pt.y - hnd.y) <= tol) return hnd.id;
  }
  if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return 'inside';
  return null;
}

export function applyDrag(r, target, dx, dy) {
  let { x, y, w, h } = r;
  if (target === 'inside') return { x: x + dx, y: y + dy, w, h };
  const id = target;
  if (id.includes('w')) { x += dx; w -= dx; }
  if (id.includes('e')) { w += dx; }
  if (id.includes('n')) { y += dy; h -= dy; }
  if (id.includes('s')) { h += dy; }
  if (w < MIN) { if (id.includes('w')) x -= (MIN - w); w = MIN; }
  if (h < MIN) { if (id.includes('n')) y -= (MIN - h); h = MIN; }
  return { x, y, w, h };
}

export function toDisplayRect(r, scale) {
  return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
}
export function toFrameRect(r, scale) {
  return { x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale };
}
