// src/vision/recognize.js
// Pipeline: anchor → layout → classify cells → turn / bonusMode / clipped
// Imports: image.js, anchor.js, landmark-data.js, layout.js, templates-data.js, blob.js

import { toGray, normPatchScaled } from './image.js';
import { findAnchor } from './anchor.js';
import { LANDMARK } from './landmark-data.js';
import { anchorToBoardRect, computeLayout } from './layout.js';
import { TEMPLATES, TPL_SIZE } from './templates-data.js';
import { findDieBlob } from './blob.js';

// ---- colour helpers (use raw RGBA frame) --------------------------------

function isRed(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
  return r - g > 40 && r - b > 40 && r > 110;
}

function isGreen(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
  return g - r > 25 && g - b > 25 && g > 90;
}

// ---- shield detection ---------------------------------------------------
// Sample border ring at ~cellSize*0.5 and cellSize*0.55 from the centre (40-44px at cellSize=80)

function isShield(frame, cx, cy, cellSize) {
  function ratioAt(r) {
    let edge = 0, total = 0;
    for (let x = cx - r; x <= cx + r; x += 2) {
      if (x < 0 || x >= frame.width) continue;
      if (cy - r >= 0 && cy - r < frame.height) { total++; if (isRed(frame, x, cy - r) || isGreen(frame, x, cy - r)) edge++; }
      if (cy + r >= 0 && cy + r < frame.height) { total++; if (isRed(frame, x, cy + r) || isGreen(frame, x, cy + r)) edge++; }
    }
    for (let y = cy - r; y <= cy + r; y += 2) {
      if (y < 0 || y >= frame.height) continue;
      if (cx - r >= 0 && cx - r < frame.width) { total++; if (isRed(frame, cx - r, y) || isGreen(frame, cx - r, y)) edge++; }
      if (cx + r >= 0 && cx + r < frame.width) { total++; if (isRed(frame, cx + r, y) || isGreen(frame, cx + r, y)) edge++; }
    }
    return total > 0 ? edge / total : 0;
  }
  const r1 = Math.round(cellSize * 0.5), r2 = Math.round(cellSize * 0.55), r3 = Math.round(cellSize * 0.6);
  return Math.max(ratioAt(r1), ratioAt(r2), ratioAt(r3)) > 0.2;
}

// ---- SSD between two Float32Arrays -------------------------------------

function ssd(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

// ---- cell classification (template matching 1..6) ----------------------

// 템플릿은 기준 배율(cellSize≈80)에서 창 70px로 박제됨. 다른 해상도에선 실제 다이 크기에 맞춰
// srcSize 창을 잡아 TPL_SIZE로 리샘플 → 스케일 무관 매칭. srcSize = cs * (70/80).
const BASELINE_CELL = 80;
function srcWinFor(cs) { return Math.max(8, Math.round(cs * TPL_SIZE / BASELINE_CELL)); }
// 분류 창은 캘리브레이션 cs가 아니라 "실측 주사위면 크기"에서 뽑는다. 창모드 box-drag cs가
// 실제 주사위보다 크면 srcSize 과대 → 5가 3/1로 뒤집혀 계산이 깜빡였음(스케일 민감도).
// blob은 blobOpts로 [cs*0.6875, cs*1.375] 범위로 이미 제한돼 병적 값이 안 나온다.
function srcWinForBlob(blob) { return srcWinFor(Math.round((blob.w + blob.h) / 2)); }

// 3·5 전용 판별 마스크: 두 템플릿이 가장 다른 픽셀 상위 15%(= 5에만 있는 모서리 점 영역).
// 3(대각선 3점)과 5(네 모서리+중앙)는 점 배치가 겹쳐 전역 SSD 마진이 저해상도에서 붕괴(6% 수준)
// → 이 영역에서만 재비교하면 마진이 크게 벌어져(≈4배) 접전 5를 확신 있게 5로 굳힌다.
// 손으로 픽셀 좌표를 찍지 않고 템플릿에서 자동 생성 → 튜닝 상수 없음, 스케일 무관.
const MASK_35 = buildDiffMask(TEMPLATES[3], TEMPLATES[5], 0.15);
function buildDiffMask(a, b, frac) {
  if (!a || !b) return null;
  const n = a.length;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((i, j) => Math.abs(b[j] - a[j]) - Math.abs(b[i] - a[i]));
  return idx.slice(0, Math.round(n * frac));
}
function ssdMasked(p, T, mask) {
  let s = 0;
  for (const i of mask) { const d = p[i] - T[i]; s += d * d; }
  return s;
}

// 한 위치에서의 원시 템플릿 매칭(최적/차선).
function matchAt(gray, cx, cy, srcSize) {
  const p = normPatchScaled(gray, cx, cy, srcSize, TPL_SIZE);
  let bestVal = -1, secondVal = -1, bestScore = Infinity, secondScore = Infinity;
  for (let k = 1; k <= 6; k++) {
    if (!TEMPLATES[k]) continue;
    const s = ssd(p, TEMPLATES[k]);
    if (s < bestScore) { secondScore = bestScore; secondVal = bestVal; bestScore = s; bestVal = k; }
    else if (s < secondScore) { secondScore = s; secondVal = k; }
  }
  return { p, bestVal, secondVal, bestScore, secondScore };
}

// 중심 정밀화 반경(px): 라이브 캡처는 프레임마다 블롭 bbox 중심이 몇px 흔들려(노이즈/글로우)
// 템플릿 매칭이 어긋난다. 특히 5는 판별 점이 모서리라 중심 오차에 취약(→ 5만 3으로 튐).
const REFINE = 3;

export function classifyByTemplate(gray, cx, cy, srcSize) {
  // ±REFINE 이웃에서 best-template SSD가 최소인 중심을 골라 중심 지터에 강인하게 분류.
  // 정중심에서 정답 SSD가 압도적으로 낮으므로 국소 탐색이 참중심을 되찾는다(오답 유인 없음).
  let m = matchAt(gray, cx, cy, srcSize);
  for (let dy = -REFINE; dy <= REFINE; dy++) {
    for (let dx = -REFINE; dx <= REFINE; dx++) {
      if (dx === 0 && dy === 0) continue;
      const c = matchAt(gray, cx + dx, cy + dy, srcSize);
      if (c.bestScore < m.bestScore) m = c;
    }
  }
  const { p, bestVal, secondVal, bestScore, secondScore } = m;
  // 상위 두 후보가 정확히 3과 5면 차이영역 판별기로 재결정(+ 넓어진 마진을 conf로 노출).
  if (MASK_35 && ((bestVal === 3 && secondVal === 5) || (bestVal === 5 && secondVal === 3))) {
    const m3 = ssdMasked(p, TEMPLATES[3], MASK_35);
    const m5 = ssdMasked(p, TEMPLATES[5], MASK_35);
    const win = m5 < m3 ? 5 : 3;
    const lo = Math.min(m3, m5), hi = Math.max(m3, m5);
    return { value: win, conf: lo > 0 ? (hi - lo) / lo : Infinity };
  }
  const conf = bestScore > 0 ? (secondScore - bestScore) / bestScore : Infinity;
  return { value: bestVal, conf };
}

// ---- clipped detection --------------------------------------------------
// A cell is considered clipped if its centre + a full cellSize extends outside the frame.
// (Generous check: catches cases where the game window is scrolled partially off-screen.)

function isCellClipped(cx, cy, cellSize, width, height) {
  return (
    cx - cellSize < 0 ||
    cy - cellSize < 0 ||
    cx + cellSize > width ||
    cy + cellSize > height
  );
}

// Check if a sampling window (center ± half) is completely within frame bounds
function inFrameWindow(cx, cy, half, w, h) {
  return cx - half >= 0 && cy - half >= 0 && cx + half < w && cy + half < h;
}

// ---- main export -------------------------------------------------------

/**
 * Recognize board state from a raw RGBA frame.
 * @param {{ width:number, height:number, data:Uint8Array }} frame
 * @param {{ x:number, y:number, w:number, h:number }|null} boardRect
 * @returns {{ cells:{me:Array, opp:Array}, rolledDie:number, isMyTurn:boolean, bonusMode:boolean, clipped:boolean }}
 */
export function recognizeFrame(frame, boardRect = null) {
  const gray = toGray(frame);
  const rect = boardRect || anchorToBoardRect(findAnchor(gray, LANDMARK));
  const L = computeLayout(rect);
  const cs = L.cellSize;
  // 픽셀 파라미터(검색창·블롭크기 게이트)는 cellSize로 스케일 → 해상도 무관.
  // 단, 분류 srcSize만은 아래에서 각 블롭 실측 크기로 뽑는다(캘리브레이션 오차 강인).
  const cellHalf = Math.round(cs * 0.6);
  const blobOpts = { minPx: Math.round(cs * cs * 0.39), min: Math.round(cs * 0.6875), max: Math.round(cs * 1.375) };

  let clipped = false;

  // Process one side (me or opp), return 3×3 array of cells
  function processSide(sideCells) {
    return sideCells.map(row =>
      row.map(({ cx, cy }) => {
        if (isCellClipped(cx, cy, cs, gray.width, gray.height)) { clipped = true; return null; }
        const b = findDieBlob(gray, cx, cy, cellHalf, blobOpts);
        if (!b) return { value: 0, shield: false, conf: Infinity }; // 빈칸
        const { value, conf } = classifyByTemplate(gray, b.cx, b.cy, srcWinForBlob(b));
        const shield = isShield(frame, b.cx, b.cy, cs);
        return { value, shield, conf };
      })
    );
  }

  const meCells = processSide(L.cells.me);
  const oppCells = processSide(L.cells.opp);

  // Turn detection via holding blob detection (clip-guarded: out-of-frame → not my turn)
  const holdHalf = Math.round(cs * 0.875);
  let isMyTurn = false, rolledDie = 0, rolledShield = false;
  if (inFrameWindow(L.holdMine.cx, L.holdMine.cy, holdHalf, gray.width, gray.height)) {
    const hb = findDieBlob(gray, L.holdMine.cx, L.holdMine.cy, holdHalf, blobOpts);
    if (hb) { isMyTurn = true; rolledDie = classifyByTemplate(gray, hb.cx, hb.cy, srcWinForBlob(hb)).value; rolledShield = isShield(frame, hb.cx, hb.cy, cs); }
  }

  // 보너스 주사위: 굴린 주사위가 쉴드 + 내 필드에 이미 주사위 있음(첫턴 제외 — 상대필드 배치 불가)
  const myHasDice = meCells.some((row) => row.some((c) => c && c.value > 0));
  const bonusMode = rolledShield && myHasDice;

  return {
    cells: { me: meCells, opp: oppCells },
    rolledDie,
    isMyTurn,
    rolledShield,
    bonusMode,
    clipped,
  };
}
